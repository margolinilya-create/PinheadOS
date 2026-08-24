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
  const applySubcontractAction = vi.fn().mockResolvedValue(true);
  useErpStore.setState({
    orders, departments: DEPTS, loaded: true, loadError: null,
    loadAll: vi.fn(), subcontracting, subcontractingLoaded: true,
    loadSubcontracting: vi.fn(), updateSubcontractOp: vi.fn().mockResolvedValue(true),
    addSubcontractMove,
    applySubcontractAction,
    myRole: 'manager',
    permissionMatrix: { manager: { 'order.manage': canManage } },
  });
  render(<MemoryRouter><Subcontracting /></MemoryRouter>);
  return { addSubcontractMove, applySubcontractAction };
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
   * ДВИЖЕНИЕ — ДЕЙСТВИЯ, А НЕ ВЫБОР СОСТОЯНИЯ (правки 20.08).
   *
   * Здесь стоял селект фазы и свободная форма журнала с видом `accept`:
   * ими можно было объявить операцию завершённой, не передав и не приняв
   * ни одной штуки, — счётчики этапа приращает только журнал, и заказ
   * оставался стоять при зелёном состоянии на экране.
   */
  it('возврат от подрядчика оформляется действием и пишет журнал', async () => {
    const { applySubcontractAction } = setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать возврат' }));
    fireEvent.change(screen.getByLabelText('Сколько вернулось'), { target: { value: '40' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Зафиксировать возврат' })[1]);

    await waitFor(() => expect(applySubcontractAction).toHaveBeenCalled());
    const [subId, action, input] = applySubcontractAction.mock.calls[0];
    expect(subId).toBe('sc1');
    expect(action).toMatchObject({ phase: 'returned', move: 'return' });
    expect(input).toMatchObject({ qty: '40' });
  });

  /**
   * ГЛАВНОЕ ДЕЙСТВИЕ ОДНО, И ОНО В ШАПКЕ (правка 22.08, пп. 3.3–3.4).
   * Раньше управление жило под заголовком «Журнал», то есть выглядело
   * историей, а кнопки шли вперемешку одинаковой заметности.
   */
  it('в шапке карточки ровно одна главная кнопка', () => {
    setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    const primary = screen.getAllByRole('button')
      .filter((b) => /_primary_/.test(b.className));
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Зафиксировать возврат');
  });

  it('приёмки в разделе НЕТ — её оформляет склад', () => {
    // Кнопка «принято» здесь была бы вторым путём к тому же переходу:
    // мимо складского гейта и мимо фиксации брака и недостачи
    setup();
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    expect(screen.queryByRole('button', { name: /Принят/ })).toBeNull();
    expect(screen.queryByLabelText('Вид перемещения')).toBeNull();
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
   * НЕПРИНЯТОЕ — НЕ БРАК (правка 22.08, п. 3.9). Раньше «вернулось 95,
   * принято 90» давало «брак: 5», хотя эти пять могли ещё просто не дойти
   * до приёмки. Брак теперь отмечается явно и хранится (`qty_defect`),
   * а разница называется своим именем.
   */
  it('непринятое ждёт приёмки, браком становится только отмеченное', () => {
    setup({
      subcontracting: [{
        ...SUB, qty_sent: 100, qty_returned: 95, qty_accepted: 90, qty_defect: 2,
      }],
    });
    fireEvent.click(within(row()).getByRole('button', { name: /90\/100/ }));
    expect(screen.getByText('не вернулось: 5')).toBeInTheDocument();
    expect(screen.getByText('ожидает приёмки: 3')).toBeInTheDocument();
    expect(screen.getByText('брак: 2')).toBeInTheDocument();
  });

  it('без отметки брака его на карточке нет вовсе', () => {
    setup({
      subcontracting: [{
        ...SUB, phase: 'returned', qty_sent: 100, qty_returned: 100, qty_accepted: 0,
      }],
    });
    fireEvent.click(within(row()).getByRole('button', { name: /0\/100/ }));
    expect(screen.getByText('ожидает приёмки: 100')).toBeInTheDocument();
    expect(screen.queryByText(/^брак:/)).toBeNull();
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
   * ОПЕРАЦИЙ БЕЗ МАРШРУТА В РАБОЧЕМ РАЗДЕЛЕ БОЛЬШЕ НЕТ (правка 23.08, п. 5).
   *
   * Блок описывал не работу подрядчика, а состояние миграции, и заказчик
   * попросил унести его в технический контур. Сами записи живы — их показывает
   * вкладка админки; здесь сторожим ровно отсутствие ШУМА в рабочем разделе,
   * а не отсутствие данных.
   */
  it('операции без маршрута в рабочий раздел не попадают', () => {
    setup({
      orders: [],
      subcontracting: [{ ...SUB, id: 'old', stage_id: null, order: { title: 'Старый', bitrix_id: '1' } }],
    });
    expect(screen.queryByText(/Операции подряда без маршрута/)).toBeNull();
    expect(screen.queryByText(/Старый/)).toBeNull();
  });
});
