import { describe, it, expect } from 'vitest';
import { qtyLeftToAccept } from './receiptLink';

/**
 * Сколько осталось принять (правка 05.10, п. 7). Сценарий постановки:
 * «закупка 100 кг, принять 40 → осталось 60 к приёмке; принять 60 →
 * всего 100, полная». С правки 19.10 переход к приёмке из закупки убран
 * (приёмка — только на складе), остаток считается здесь же для обоих экранов.
 */

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
