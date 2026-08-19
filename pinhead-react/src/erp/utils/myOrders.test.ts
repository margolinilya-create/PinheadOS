import { describe, it, expect } from 'vitest';
import { isMyOrder } from './myOrders';

const ME = { id: 'u-1', name: 'Иванов Пётр' };

describe('isMyOrder', () => {
  it('заказ, который я завёл', () => {
    expect(isMyOrder({ created_by: 'u-1', manager: 'Сидорова' }, ME)).toBe(true);
  });

  /** Заказ, заведённый РОПом на меня, — тоже мой: иначе «Мои» врут менеджеру */
  it('заказ на моём имени, заведённый другим', () => {
    expect(isMyOrder({ created_by: 'u-9', manager: 'Иванов Пётр' }, ME)).toBe(true);
  });

  it('поле свободное — регистр и пробелы не считаются различием', () => {
    expect(isMyOrder({ manager: '  иванов пётр ' }, ME)).toBe(true);
  });

  it('чужой заказ', () => {
    expect(isMyOrder({ created_by: 'u-9', manager: 'Сидорова' }, ME)).toBe(false);
  });

  /** Без имени пустое поле менеджера совпало бы со всеми заказами сразу */
  it('человек без имени не забирает заказы без менеджера', () => {
    expect(isMyOrder({ manager: '' }, { id: 'u-2', name: '' })).toBe(false);
    expect(isMyOrder({ manager: null }, { id: null, name: null })).toBe(false);
  });
});
