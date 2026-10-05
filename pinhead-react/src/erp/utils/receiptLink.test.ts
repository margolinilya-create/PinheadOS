import { describe, it, expect } from 'vitest';
import {
  RECEIPT_TASK_MISSING_HINT, materialReceiptTask, purchasingReturnHref,
  qtyLeftToAccept, receiptAction, receiptHref,
} from './receiptLink';

/**
 * Связь закупки с приёмкой (правка 05.10, п. 7). Сценарий постановки:
 * «закупка 100 кг, принять 40 через позицию материала → осталось 60
 * к приёмке; принять 60 → всего 100, полная; повторное открытие первой
 * поставки ничего не добавляет».
 */

const task = (patch: Record<string, unknown> = {}) => ({
  id: 't1', task_type: 'material_receipt', material_id: 'm1', status: 'awaiting', ...patch,
}) as never;

describe('задача приёмки позиции закупки', () => {
  it('находится по material_id, а не первой попавшейся приёмкой заказа', () => {
    const order = { warehouse_tasks: [
      task({ id: 't0', material_id: 'm0' }),
      task({ id: 't-pack', task_type: 'pack_ship', material_id: null }),
      task(),
    ] };
    expect(materialReceiptTask(order as never, 'm1')?.id).toBe('t1');
    expect(materialReceiptTask(order as never, 'm9')).toBeNull();
    expect(materialReceiptTask({ warehouse_tasks: undefined } as never, 'm1')).toBeNull();
  });
});

describe('действие приёмки в строке закупки', () => {
  it('ожидаемая поставка — «Принять поставку»', () => {
    expect(receiptAction({ source: 'purchase' }, task())).toEqual(
      { label: 'Принять поставку', disabled: false, hint: null });
  });

  it('принятая — «Открыть приёмку»: открывается та же, а не новая', () => {
    expect(receiptAction({ source: 'purchase' }, task({ status: 'accepted' }))?.label)
      .toBe('Открыть приёмку');
  });

  it('задачи ещё нет — кнопка погашена и объясняет почему', () => {
    expect(receiptAction({ source: 'purchase' }, null)).toEqual(
      { label: 'Принять поставку', disabled: true, hint: RECEIPT_TASK_MISSING_HINT });
    expect(RECEIPT_TASK_MISSING_HINT).toBe('Задача приёмки появится, когда поставка будет в пути');
  });

  it('со склада и давальческое без задачи — действия нет вовсе', () => {
    expect(receiptAction({ source: 'stock' }, null)).toBeNull();
    expect(receiptAction({ source: 'client' }, null)).toBeNull();
  });
});

describe('адреса перехода и возврата', () => {
  it('склад получает задачу, источник и заказ; запрос закупки — для возврата', () => {
    const href = receiptHref('t1', 'o1', '?supply=o1&q=футер&page=2');
    const sp = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/warehouse?')).toBe(true);
    expect(sp.get('task')).toBe('t1');
    expect(sp.get('from')).toBe('purchasing');
    expect(sp.get('supply')).toBe('o1');
    expect(purchasingReturnHref(sp.get('back'), sp.get('supply')))
      .toBe('/purchasing?supply=o1&q=футер&page=2');
  });

  it('без сохранённого запроса возврат ведёт в ту же закупку', () => {
    expect(purchasingReturnHref(null, 'o1')).toBe('/purchasing?supply=o1');
    expect(purchasingReturnHref('', null)).toBe('/purchasing');
  });

  it('путь возврата фиксирован — через back подставляется только запрос', () => {
    expect(purchasingReturnHref('//evil.example/x', null)).toBe('/purchasing?//evil.example/x');
  });
});

describe('осталось принять', () => {
  it('100 кг: до приёмки 100, после 40 — 60, после ещё 60 — 0', () => {
    expect(qtyLeftToAccept({ qty_expected: 100, qty_received: null, qty_ordered: 110 })).toBe(100);
    expect(qtyLeftToAccept({ qty_expected: 100, qty_received: 40, qty_ordered: 110 })).toBe(60);
    expect(qtyLeftToAccept({ qty_expected: 100, qty_received: 100, qty_ordered: 110 })).toBe(0);
  });

  it('перебор не уходит в минус, дробные не ломаются', () => {
    expect(qtyLeftToAccept({ qty_expected: 100, qty_received: 110 })).toBe(0);
    expect(qtyLeftToAccept({ qty_expected: 10.2, qty_received: 3.1 })).toBe(7.1);
  });

  it('без потребности — от заказанного; без обоих — неизвестно', () => {
    expect(qtyLeftToAccept({ qty_expected: null, qty_received: 5, qty_ordered: 20 })).toBe(15);
    expect(qtyLeftToAccept({ qty_expected: null, qty_received: null })).toBeNull();
  });
});
