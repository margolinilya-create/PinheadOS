import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SupplyQueue } from './SupplyQueue';
import { useConfirmStore } from '../../../store/useConfirmStore';

/**
 * Очередь закупки — блок, которого не было и из-за отсутствия которого
 * заказ с этапом «Закупка» не показывался нигде.
 *
 * Проверяем ровно то, ради чего блок сделан: заказ БЕЗ материалов виден
 * и его можно закрыть; закрытие досрочно требует объяснения; действия
 * гейтятся правами.
 */

vi.mock('../../store/useStagePermissions', () => ({
  useStagePermissions: () => globalThis.__perms,
}));

const SUPPLY = { id: 'd-sup', code: 'supply', name: 'Закупка' };

function stage(patch = {}) {
  return { id: 'st1', department_id: SUPPLY.id, status: 'waiting', ...patch };
}

function order(patch = {}) {
  return {
    id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-08-30',
    items: [{ id: 'i1', stages: [stage()] }],
    materials: [],
    ...patch,
  };
}

function renderQueue(orders, perms = { take: true, complete: true }) {
  globalThis.__perms = perms;
  const handlers = { onTake: vi.fn(), onClose: vi.fn(), onAddMaterial: vi.fn() };
  render(
    <MemoryRouter>
      <SupplyQueue orders={orders} supplyDept={SUPPLY} {...handlers} />
    </MemoryRouter>,
  );
  return handlers;
}

/** Подтвердить открытый диалог, при необходимости заполнив поле причины */
function answerDialog(value = '') {
  const st = useConfirmStore.getState();
  expect(st.open, 'диалог не открылся').toBe(true);
  st._close(true, value);
}

beforeEach(() => {
  useConfirmStore.setState({ open: false, prompt: null, _resolver: null });
});

describe('очередь закупки', () => {
  it('заказ БЕЗ материалов виден и говорит об этом прямо', async () => {
    // Ровно тот заказ, который раньше исчезал: этап есть, материалов нет
    renderQueue([order()]);
    expect(screen.getByText(/№4821/)).toBeInTheDocument();
    expect(screen.getByText('материалы не заведены')).toBeInTheDocument();
  });

  it('пусто — так и написано, а не пустая таблица', () => {
    renderQueue([]);
    expect(screen.getByText(/Заказов, ожидающих закупки, нет/)).toBeInTheDocument();
  });

  it('показывает, сколько материалов на месте', () => {
    renderQueue([order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: 10 },
      { id: 'm2', name: 'Бирки', source: 'purchase', status: 'pending', qty_expected: 5 },
    ] })]);
    expect(screen.getByText('1 из 2 на месте')).toBeInTheDocument();
  });

  it('предупреждает о позициях без планового количества', () => {
    // Без плана приёмка на складе не сверит факт — сделка встанет там
    renderQueue([order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: null },
    ] })]);
    expect(screen.getByText(/без планового кол-ва: 1/)).toBeInTheDocument();
  });

  it('досрочное закрытие требует причины и передаёт её наверх', async () => {
    const h = renderQueue([order()]);
    fireEvent.click(screen.getByRole('button', { name: 'Закупка завершена' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    // Поле причины обязательно — этап закрывается пустым
    expect(useConfirmStore.getState().prompt?.required).toBe(true);
    answerDialog('Давальческое сырьё');
    await waitFor(() => expect(h.onClose).toHaveBeenCalledWith('o1', 'Давальческое сырьё'));
  });

  it('всё на месте — обычное подтверждение, без поля причины', async () => {
    const h = renderQueue([order({ materials: [
      { id: 'm1', name: 'Футер', source: 'purchase', status: 'received', qty_expected: 10 },
    ] })]);
    fireEvent.click(screen.getByRole('button', { name: 'Закупка завершена' }));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    expect(useConfirmStore.getState().prompt).toBeNull();
    answerDialog();
    await waitFor(() => expect(h.onClose).toHaveBeenCalled());
  });

  it('«Взять в работу» зовёт действие по заказу', async () => {
    const h = renderQueue([order()]);
    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(h.onTake).toHaveBeenCalledWith('o1'));
  });

  it('взятая в работу закупка помечена статусом', () => {
    renderQueue([order({ items: [{ id: 'i1', stages: [stage({ status: 'in_progress' })] }] })]);
    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
  });

  it('блокировка перебивает всё и показывает причину', () => {
    renderQueue([order({ items: [{ id: 'i1', stages: [
      stage({ status: 'blocked', block_reason: 'Нет поставщика' }),
    ] }] })]);
    expect(screen.getByText('Заблокировано')).toBeInTheDocument();
    expect(screen.getByText('Нет поставщика')).toBeInTheDocument();
  });

  it('без прав действий нет, но строка видна', () => {
    // Менеджеру заказа важно видеть, где стоит его заказ, даже без права работать
    renderQueue([order()], { take: false, complete: false });
    expect(screen.getByText(/№4821/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Закупка завершена' })).toBeNull();
    // «+ Материал» остаётся: заведение закупочной строки правом не гейтится
    expect(screen.getByRole('button', { name: '+ Материал' })).toBeInTheDocument();
  });

  it('считает открытые этапы заказа, а не все подряд', () => {
    renderQueue([order({ items: [
      { id: 'i1', stages: [stage({ id: 'a' })] },
      { id: 'i2', stages: [stage({ id: 'b' })] },
      { id: 'i3', stages: [stage({ id: 'c', status: 'done' })] },
    ] })]);
    const row = screen.getByText(/№4821/).closest('tr');
    expect(within(row).getByText('2 позиции')).toBeInTheDocument();
  });
});
