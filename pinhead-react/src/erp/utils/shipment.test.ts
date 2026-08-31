import { describe, expect, it } from 'vitest';
import { orderQty, shipmentTotals } from './shipment';
import type { ErpOrderItem } from '../types';

/**
 * Остатки отгрузки (правка заказчика 30.08, п. 6).
 *
 * До правки величины «отгружено» не существовало вовсе: `shipOrder` писал
 * `shipped_status='shipped'` и архивный статус заказа одним патчем, а склад
 * фильтрует по `status='active'` — первая же отгрузка убирала заказ вместе
 * с неотданным остатком.
 */

const item = (over: Partial<ErpOrderItem> = {}): ErpOrderItem => ({
  id: 'i1', qty: 100, product_type: 'Футболка',
  ...over,
} as ErpOrderItem);

describe('shipmentTotals', () => {
  it('ничего не отгружено — остаток равен тиражу', () => {
    const t = shipmentTotals({ items: [item(), item({ id: 'i2', qty: 50 })] });
    expect(t.qty).toBe(150);
    expect(t.shipped).toBe(0);
    expect(t.left).toBe(150);
    expect(t.complete).toBe(false);
    expect(t.partial).toBe(false);
  });

  it('отдана часть — partial, остаток по каждой позиции свой', () => {
    const t = shipmentTotals({ items: [
      item({ qty_shipped: 100 }),
      item({ id: 'i2', qty: 50, qty_shipped: 20 }),
    ] });
    expect(t.shipped).toBe(120);
    expect(t.left).toBe(30);
    expect(t.partial).toBe(true);
    expect(t.complete).toBe(false);
    expect(t.lines.map((l) => l.left)).toEqual([0, 30]);
  });

  it('отдано всё — complete, и это НЕ partial', () => {
    const t = shipmentTotals({ items: [item({ qty_shipped: 100 })] });
    expect(t.complete).toBe(true);
    expect(t.partial).toBe(false);
    expect(t.left).toBe(0);
  });

  it('`qty_shipped` отсутствует — читается как ноль, а не как «неизвестно»', () => {
    // Поле приезжает undefined со старого бандла или урезанной выборки;
    // «отгружено неизвестно сколько» превратило бы остаток в NaN
    const t = shipmentTotals({ items: [item({ qty_shipped: undefined })] });
    expect(t.shipped).toBe(0);
    expect(t.left).toBe(100);
  });

  it('отгружено больше тиража — остаток не уходит в минус', () => {
    const t = shipmentTotals({ items: [item({ qty_shipped: 120 })] });
    expect(t.left).toBe(0);
    expect(t.complete).toBe(true);
  });

  it('пустой заказ не считается отгруженным сам собой', () => {
    // Та же осторожность, что у `isOrderReadyToShip`: заказ без позиций
    // не должен объявлять себя завершённым
    const t = shipmentTotals({ items: [] });
    expect(t.complete).toBe(false);
    expect(t.partial).toBe(false);
  });

  it('нет заказа вовсе — нули, а не бросок', () => {
    expect(shipmentTotals(null).qty).toBe(0);
    expect(shipmentTotals(undefined).left).toBe(0);
  });
});

describe('orderQty', () => {
  it('суммарный тираж — та величина, что жила семью копиями по экранам', () => {
    expect(orderQty({ items: [item(), item({ id: 'i2', qty: 50 })] })).toBe(150);
    expect(orderQty(null)).toBe(0);
  });
});
