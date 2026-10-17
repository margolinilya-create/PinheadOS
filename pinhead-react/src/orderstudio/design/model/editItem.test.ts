import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { designSnapshotOf, itemOf, setItemDesign, setItemFlat, setItemPrints } from './editItem';

const p1 = newSalesPrint({ zone: 'Спина' });
const a = newSalesItem({ key: 'a', prints: [p1], flat_id: '' });
const b = newSalesItem({ key: 'b' });
const order = newSalesOrder({ id: 'o', items: [a, b] });

describe('editItem — чистые правки позиции', () => {
  it('itemOf находит позицию по ключу; нет — null', () => {
    expect(itemOf(order, 'b')).toBe(b);
    expect(itemOf(order, 'x')).toBeNull();
    expect(itemOf(null, 'a')).toBeNull();
    expect(itemOf(order, null)).toBeNull();
  });

  it('setItemPrints меняет только свою позицию, исходный заказ не трогает', () => {
    const p2 = newSalesPrint({ zone: 'Грудь (перед)' });
    const next = setItemPrints(order, 'a', [p1, p2]);
    expect(next).not.toBe(order);
    expect(next.items[0].prints).toEqual([p1, p2]);
    expect(next.items[1]).toBe(b);
    expect(order.items[0].prints).toEqual([p1]);
  });

  it('setItemFlat пишет flat_id', () => {
    const next = setItemFlat(order, 'a', 'tshirt-freefit');
    expect(next.items[0].flat_id).toBe('tshirt-freefit');
    expect(order.items[0].flat_id).toBe('');
  });

  it('setItemDesign: снимок {prints, flat_id}; без изменений — тот же заказ', () => {
    const next = setItemDesign(order, 'a', { prints: [], flat_id: 'f' });
    expect(next.items[0]).toMatchObject({ prints: [], flat_id: 'f' });
    expect(setItemDesign(order, 'a', { prints: a.prints, flat_id: a.flat_id })).toBe(order);
    expect(setItemDesign(order, 'a', {})).toBe(order);
  });

  it('неизвестная позиция — заказ без изменений', () => {
    expect(setItemPrints(order, 'x', [])).toBe(order);
    expect(setItemFlat(order, 'x', 'f')).toBe(order);
  });

  it('designSnapshotOf — ровно нанесения и флэт', () => {
    expect(designSnapshotOf(a)).toEqual({ prints: [p1], flat_id: '' });
  });
});
