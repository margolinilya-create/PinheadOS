import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { RouteEditor } from './RouteEditor';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Компонент рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Конструктор маршрута: разметка и то, ЧТО именно уходит на сервер.
 *
 * Расчёт покрыт `routeDraft.test.ts` — здесь проверяется стык: правки человека
 * доезжают до payload `erp_route_apply` в том виде, который функция ждёт
 * (`depends_on` ИНДЕКСАМИ, `sort_order` шагом 10, `contractor` только у подряда),
 * и гейт совпадает с серверным правом.
 */

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный', active: true, sort_order: 10 },
  { id: 'd2', code: 'dtf', name: 'ДТФ', active: true, sort_order: 20 },
  { id: 'd3', code: 'sewing', name: 'Швейный', active: true, sort_order: 30 },
];

const stage = (over) => ({
  id: 's1', department_id: 'd1', sort_order: 10, depends_on: [],
  status: 'waiting', qty_done: 0, qty_rework: 0, started_at: null,
  executor: 'internal', contractor: null, operation: null, ...over,
});

/** Позиция с линейным маршрутом закрой → пошив, работа ещё не начиналась */
const ITEM = {
  id: 'i1',
  stages: [
    stage({ id: 's1', department_id: 'd1', sort_order: 10 }),
    stage({ id: 's2', department_id: 'd3', sort_order: 20, depends_on: ['s1'] }),
  ],
};

function setup(item = ITEM, { canManage = true } = {}) {
  const applyItemRoute = vi.fn().mockResolvedValue(true);
  useErpStore.setState({
    departments: DEPTS,
    applyItemRoute,
    // Право берётся из матрицы «роль × право», а не из роли учётной записи
    myRole: 'manager',
    permissionMatrix: { manager: { 'order.manage': canManage } },
  });
  render(<RouteEditor item={item} orderId="o1" onDone={() => {}} />);
  return { applyItemRoute };
}

describe('RouteEditor', () => {
  beforeEach(() => {
    useErpStore.setState({ departments: [], dictionaries: [] });
  });

  it('показывает расчётный маршрут шагами и не считает его изменённым', () => {
    setup();
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).getByLabelText('Участок ответственности')).toHaveValue('cutting');
    expect(within(steps[1]).getByLabelText('Участок ответственности')).toHaveValue('sewing');
    // Открытие конструктора без единой правки не должно ничего сохранять
    expect(screen.getByRole('button', { name: 'Сохранить маршрут' })).toBeDisabled();
    expect(screen.getByText('Маршрут не менялся')).toBeInTheDocument();
  });

  /**
   * Главный сценарий документа: подрядный этап посреди маршрута, после которого
   * изделие возвращается в наш цех. Проверяем именно payload — «вернулось
   * от подрядчика ≠ заказ готов» держится на том, что следующий этап существует
   * и зависит от подрядного.
   */
  it('подрядный этап уходит в payload с подрядчиком и зависимостями по индексам', async () => {
    const { applyItemRoute } = setup();

    // Новый шаг после закроя
    fireEvent.click(within(screen.getAllByRole('listitem')[0])
      .getByRole('button', { name: 'Шаг после' }));

    const added = screen.getAllByRole('listitem')[1];
    fireEvent.change(within(added).getByLabelText('Участок ответственности'), { target: { value: 'dtf' } });
    fireEvent.change(within(added).getByLabelText('Исполнитель этапа'), { target: { value: 'contractor' } });
    fireEvent.change(within(added).getByLabelText('Подрядчик'), { target: { value: 'ИП Иванов' } });
    fireEvent.change(within(added).getByLabelText('Операция'), { target: { value: 'Сублимация' } });

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить маршрут' }));

    await waitFor(() => expect(applyItemRoute).toHaveBeenCalledTimes(1));
    const [orderId, itemId, steps] = applyItemRoute.mock.calls[0];
    expect(orderId).toBe('o1');
    expect(itemId).toBe('i1');
    // Подрядные поля документа 20.08 едут той же строкой шага: у нашего этапа
    // они null (спутника у него нет), у подрядного — заполненные значения
    const EMPTY_SUB = {
      qty: null, send_plan_date: null, planned_date: null,
      responsible: null, materials_note: null, comment: null,
    };
    expect(steps).toEqual([
      {
        stage_id: 's1', department_id: 'd1', sort_order: 10,
        executor: 'internal', contractor: null, operation: null, depends_on: [],
        ...EMPTY_SUB,
      },
      {
        stage_id: null, department_id: 'd2', sort_order: 20,
        executor: 'contractor', contractor: 'ИП Иванов', operation: 'Сублимация',
        depends_on: [0],
        ...EMPTY_SUB,
      },
      {
        stage_id: 's2', department_id: 'd3', sort_order: 30,
        executor: 'internal', contractor: null, operation: null, depends_on: [1],
        ...EMPTY_SUB,
      },
    ]);
  });

  /**
   * Имя подрядчика у нашего этапа — не косметика: строка `erp_subcontracting`
   * при сохранении удаляется, и оставшееся имя врало бы про исполнителя.
   */
  it('возврат этапа в наш цех стирает подрядчика', async () => {
    const { applyItemRoute } = setup({
      id: 'i1',
      stages: [stage({ executor: 'contractor', contractor: 'ИП Иванов', operation: 'Печать' })],
    });

    fireEvent.change(screen.getByLabelText('Исполнитель этапа'), { target: { value: 'internal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить маршрут' }));

    await waitFor(() => expect(applyItemRoute).toHaveBeenCalled());
    expect(applyItemRoute.mock.calls[0][2][0]).toMatchObject({
      executor: 'internal', contractor: null,
    });
  });

  it('подрядный этап без подрядчика сохранить нельзя', async () => {
    setup();
    const first = screen.getAllByRole('listitem')[0];
    fireEvent.change(within(first).getByLabelText('Исполнитель этапа'), { target: { value: 'contractor' } });
    expect(screen.getByText(/не указан подрядчик/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить маршрут' })).toBeDisabled();
  });

  /**
   * Замок считается по ФАКТУ, а не по статусу, и обязан совпадать с RLS-политикой
   * удаления: мягче — конструктор предложит стереть проделанную работу и получит
   * отказ, строже — не даст убрать этап, который убрать можно.
   */
  it('этап с начатой работой не переставить и не убрать', () => {
    setup({
      id: 'i1',
      stages: [
        stage({ id: 's1', status: 'in_progress', started_at: '2026-08-16T08:00:00Z' }),
        stage({ id: 's2', department_id: 'd3', sort_order: 20, depends_on: ['s1'] }),
      ],
    });
    const first = screen.getAllByRole('listitem')[0];
    expect(within(first).getByText('в работе')).toBeInTheDocument();
    expect(within(first).queryByRole('button', { name: 'Убрать этап из маршрута' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Шаг 2 выше' })).toBeDisabled();
  });

  it('без права «Ведение заказа» конструктора нет вовсе', () => {
    setup(ITEM, { canManage: false });
    expect(screen.getByText(/Только просмотр/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить маршрут' })).toBeNull();
  });
});
