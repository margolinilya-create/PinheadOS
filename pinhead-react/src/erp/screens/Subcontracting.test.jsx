import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Subcontracting from './Subcontracting';
import { useErpStore } from '../store/useErpStore';
import { attachDomainSlices } from '../store/domainSlices';

// Экран рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Раздел «Подряд» после переделки на этапы маршрута.
 *
 * ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, — что строка берётся из ЭТАПА, а не из
 * реестра `erp_subcontracting`. Прежний экран читал реестр, и связь с маршрутом
 * (`stage_id`) не заполнялась никем: подряд выглядел рабочим разделом и при
 * этом не двигал производство. Ровно так же 12.08 сломалась закупка, и сторож
 * `routeReachable.test.ts` появился именно после неё.
 */

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный', active: true, is_production: true, sort_order: 10 },
  { id: 'd2', code: 'dtf', name: 'ДТФ', active: true, is_production: true, sort_order: 20 },
  { id: 'd3', code: 'sewing', name: 'Швейный', active: true, is_production: true, sort_order: 30 },
];

const stage = (over) => ({
  id: 's1', department_id: 'd1', sort_order: 10, depends_on: [],
  status: 'waiting', qty_done: 0, qty_rework: 0, started_at: null,
  executor: 'internal', contractor: null, operation: null, ...over,
});

/**
 * Заказ, в котором подрядная печать стоит ПОСРЕДИ маршрута: закрой сделан,
 * печать у подрядчика, швейка ждёт. Это и есть случай, ради которого документ
 * писался: «вернулось от подрядчика» не означает, что заказ готов.
 */
const ORDER = {
  id: 'o1', status: 'active', title: 'Худи «Ромашка»', bitrix_id: '4821',
  items: [{
    id: 'i1', product_type: 'Худи', variant: 'чёрное', qty: 100,
    stages: [
      stage({ id: 's1', department_id: 'd1', sort_order: 10, status: 'done', qty_done: 100 }),
      stage({
        id: 's2', department_id: 'd2', sort_order: 20, depends_on: ['s1'],
        status: 'in_progress', executor: 'contractor',
        contractor: 'ИП Иванов', operation: 'Сублимация',
      }),
      stage({ id: 's3', department_id: 'd3', sort_order: 30, depends_on: ['s2'] }),
    ],
  }],
  materials: [], attachments: [], procurement_tasks: [], warehouse_tasks: [],
};

/** Карточка подрядчика при этапе — сроки, фаза, оплата, журнал */
const SUB = {
  id: 'sc1', order_id: 'o1', item_id: 'i1', stage_id: 's2',
  operation: 'Сублимация', contractor: 'ИП Иванов', qty: 100,
  op_type: 'operation', material_source: 'pinhead', return_dept: null,
  sent_date: '2026-08-10', planned_date: '2026-08-20', returned_date: null,
  phase: 'at_contractor', status: 'in_progress', payment_status: 'unpaid',
  qty_sent: 100, qty_returned: 0, qty_accepted: 0,
  delay_comment: null, created_at: '', updated_at: '', moves: [],
};

function setup({ orders = [ORDER], subcontracting = [SUB], canManage = true } = {}) {
  const addSubcontractMove = vi.fn().mockResolvedValue(true);
  useErpStore.setState({
    orders, departments: DEPTS, loaded: true, loadError: null,
    loadAll: vi.fn(), subcontracting, subcontractingLoaded: true,
    loadSubcontracting: vi.fn(), updateSubcontractOp: vi.fn().mockResolvedValue(true),
    addSubcontractMove,
    myRole: 'manager',
    permissionMatrix: { manager: { 'order.manage': canManage } },
  });
  render(<MemoryRouter><Subcontracting /></MemoryRouter>);
  return { addSubcontractMove };
}

describe('Подряд', () => {
  beforeEach(() => {
    useErpStore.setState({ orders: [], departments: [], subcontracting: [], dictionaries: [] });
  });

  const row = () => screen.getAllByRole('row')[1];

  it('строка берётся из подрядного ЭТАПА маршрута', () => {
    setup();
    const cells = within(row()).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('№4821');
    expect(cells[1]).toHaveTextContent('Худи');
    expect(cells[2]).toHaveTextContent('100');
    // Подпись этапа — ОПЕРАЦИЯ, а не имя цеха: цех означает, куда работа вернётся
    expect(cells[3]).toHaveTextContent('Сублимация');
    expect(cells[3]).toHaveTextContent('участок: ДТФ');
    expect(cells[4]).toHaveTextContent('ИП Иванов');
  });

  it('«где заказ сейчас» отвечает у подрядчика он или у нас', () => {
    setup();
    expect(within(row()).getAllByRole('cell')[5]).toHaveTextContent('У подрядчика: ИП Иванов');
  });

  /**
   * Главное требование документа. Колонка ПОКАЗЫВАЕТ следующий этап, а не
   * вычисляет переход: переход делает обычный гейт готовности по `depends_on`.
   */
  it('следующий этап маршрута назван прямо — «вернулось» не значит «готово»', () => {
    setup();
    expect(within(row()).getAllByRole('cell')[7]).toHaveTextContent('Швейка');
  });

  it('у последнего подрядного этапа сказано, что он последний', () => {
    setup({
      orders: [{
        ...ORDER,
        items: [{
          ...ORDER.items[0],
          stages: ORDER.items[0].stages.filter((s) => s.id !== 's3'),
        }],
      }],
    });
    expect(within(row()).getAllByRole('cell')[7]).toHaveTextContent('последний этап маршрута');
  });

  /**
   * Журнал — не история, а механизм: приёмка приращает `qty_done` подрядного
   * этапа (`erp_subcontract_moves_rollup`) и закрывает его. До этой правки
   * `addSubcontractMove` не имел НИ ОДНОЙ точки вызова, и подрядный этап
   * не закрывался никогда — отсюда и тупик раздела.
   */
  it('журнал перемещений записывает приёмку', async () => {
    const { addSubcontractMove } = setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));

    fireEvent.change(screen.getByLabelText('Вид перемещения'), { target: { value: 'accept' } });
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));

    await waitFor(() => expect(addSubcontractMove).toHaveBeenCalled());
    const [subId, input] = addSubcontractMove.mock.calls[0];
    expect(subId).toBe('sc1');
    expect(input).toMatchObject({ kind: 'accept', qty: 40 });
  });

  /**
   * Поля п. 12–13 документа: стоимость и передача материалов Pinhead.
   * Пишутся по blur и ТОЛЬКО при реальном изменении — иначе каждый уход
   * фокуса отправлял бы запрос с тем же значением.
   */
  it('стоимость и передача материалов пишутся по blur', async () => {
    setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    const update = useErpStore.getState().updateSubcontractOp;

    const cost = screen.getByLabelText('Стоимость подрядных работ');
    fireEvent.blur(cost, { target: { value: '35000' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith('sc1', { cost: 35000 }));

    const what = screen.getByLabelText('Что передано подрядчику');
    fireEvent.blur(what, { target: { value: 'крой 100 шт' } });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('sc1', { materials_note: 'крой 100 шт' }));
  });

  /** Значение не изменилось — запроса быть не должно */
  it('blur без изменения не шлёт запрос', () => {
    setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    const update = useErpStore.getState().updateSubcontractOp;
    update.mockClear();
    fireEvent.blur(screen.getByLabelText('Стоимость подрядных работ'), { target: { value: '' } });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * При материалах подрядчика передавать нечего — блок не показывается вовсе,
   * а не стоит пустым с вопросом «что сюда писать».
   */
  it('материалы подрядчика убирают блок передачи', () => {
    setup({ subcontracting: [{ ...SUB, material_source: 'contractor' }] });
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    expect(screen.queryByLabelText('Что передано подрядчику')).toBeNull();
  });

  /**
   * Брак и потери СЧИТАЮТСЯ из журнала (п. 12 доп.): «не вернулось» =
   * передано − вернулось, «брак» = вернулось − принято. Колонок под них нет
   * намеренно — вторая пара счётчиков рядом с журналом означала бы двух
   * писателей одной величины.
   */
  it('расхождение показано из журнала, а не из отдельных полей', () => {
    setup({
      subcontracting: [{ ...SUB, qty_sent: 100, qty_returned: 95, qty_accepted: 90 }],
    });
    fireEvent.click(within(row()).getByRole('button', { name: /90\/100/ }));
    expect(screen.getByText('не вернулось: 5')).toBeInTheDocument();
    expect(screen.getByText('брак: 5')).toBeInTheDocument();
  });

  /** Документ (п. 19): «при открытии заказа показывать весь маршрут целиком» */
  it('в раскрытой строке виден весь маршрут позиции', () => {
    setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    expect(screen.getByText('Готовность позиции')).toBeInTheDocument();
  });

  it('без права «Ведение заказа» журнал только читается', () => {
    setup({ canManage: false });
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    expect(screen.queryByRole('button', { name: 'Записать' })).toBeNull();
    expect(screen.getByText(/передано 100/)).toBeInTheDocument();
  });

  /**
   * Форму «добавить операцию» убрали намеренно: подряд заводится конструктором
   * маршрута, иначе рядом с маршрутом снова заведётся вторая сущность — ровно
   * та, ради устранения которой раздел и переписан.
   */
  it('операции руками не заводятся — пустой экран отправляет в конструктор маршрута', () => {
    setup({ orders: [], subcontracting: [] });
    expect(screen.getByText(/Изменить маршрут/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить/ })).toBeNull();
  });

  /**
   * Строки старого реестра без `stage_id` не выбрасываются, но и не выдаются
   * за подрядные этапы: у них связи с маршрутом нет, и следующий этап после
   * возврата система не откроет. Убирать legacy-колонки можно только когда
   * этот блок опустеет.
   */
  it('операции без маршрута показаны отдельным блоком совместимости', () => {
    setup({
      orders: [],
      subcontracting: [{ ...SUB, id: 'old', stage_id: null, order: { title: 'Старый', bitrix_id: '1' } }],
    });
    expect(screen.getByText(/Операции подряда без маршрута — 1/)).toBeInTheDocument();
  });
});
