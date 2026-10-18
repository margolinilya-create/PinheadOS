import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { duplicateInColor } from '../../model/itemOps';
import { fnv1a8, tzGroupKey, tzGroups } from './tzGroups';

const tee = () => newSalesItem({
  sku_code: 'tee-freefit',
  product_type: 'Футболка',
  fabric_code: 'medas-180',
  part_colors: { Перед: 'Чёрный', Рукава: 'Белый' },
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] },
  tz_comment: 'один',
  prints: [
    newSalesPrint({ zone: 'Грудь (перед)', method: 'dtf', width_mm: 100, height_mm: 50, artwork_path: 'orders/x/logo/a.png' }),
    newSalesPrint({ zone: 'Спина', method: 'silkscreen', width_mm: 300, height_mm: 60, artwork_path: 'orders/x/logo/b.png' }),
  ],
});

describe('tzGroupKey', () => {
  it('копия в другом цвете и другой комментарий — тот же ключ', () => {
    const a = tee();
    const b = { ...duplicateInColor(a, 'Белый'), tz_comment: 'другой' };
    expect(tzGroupKey(b)).toBe(tzGroupKey(a));
  });

  it('порядок нанесений и пробелы в зоне ключ не меняют', () => {
    const a = tee();
    const b = { ...a, prints: [{ ...a.prints[1], zone: '  Спина ' }, a.prints[0]] };
    expect(tzGroupKey(b)).toBe(tzGroupKey(a));
  });

  it('другая ткань, нанесение, макет, цвета деталей или модель — другой ключ', () => {
    const a = tee();
    const k = tzGroupKey(a);
    expect(tzGroupKey({ ...a, fabric_code: 'medas-240' })).not.toBe(k);
    expect(tzGroupKey({ ...a, prints: [a.prints[0]] })).not.toBe(k);
    expect(tzGroupKey({ ...a, prints: [{ ...a.prints[0], width_mm: 120 }, a.prints[1]] })).not.toBe(k);
    expect(tzGroupKey({ ...a, prints: [{ ...a.prints[0], artwork_path: 'orders/x/logo/c.png' }, a.prints[1]] })).not.toBe(k);
    expect(tzGroupKey({ ...a, prints: [{ ...a.prints[0], method: 'dtg' }, a.prints[1]] })).not.toBe(k);
    expect(tzGroupKey({ ...a, part_colors: { Перед: 'Чёрный', Рукава: 'Красный' } })).not.toBe(k);
    expect(tzGroupKey({ ...a, part_colors: {} })).not.toBe(k);
    expect(tzGroupKey({ ...a, sku_code: 'tee-regular' })).not.toBe(k);
  });

  it('лекала клиента без модели — по названию лекал; ткань клиента — по тексту', () => {
    const a = { ...tee(), sku_code: '', client_pattern: 'Fertoing_T-shirt' };
    expect(tzGroupKey({ ...a, client_pattern: ' fertoing_t-shirt ' })).toBe(tzGroupKey(a));
    const c = { ...tee(), client_fabric: true, main_fabric: 'Своя ткань клиента' };
    expect(tzGroupKey({ ...c, fabric_code: 'другой-код' })).toBe(tzGroupKey(c));
  });
});

describe('tzGroups', () => {
  it('порядок позиций, номер ТЗ с единицы, hash8 — 8 hex', () => {
    const a = tee();
    const b = { ...tee(), fabric_code: 'futer-350' };
    const c = duplicateInColor(a, 'Белый');
    const groups = tzGroups(newSalesOrder({ items: [a, b, c] }));
    expect(groups.map((g) => g.items.map((i) => i.key))).toEqual([[a.key, c.key], [b.key]]);
    expect(groups.map((g) => [g.index, g.total])).toEqual([[1, 2], [2, 2]]);
    expect(groups[0].hash8).toMatch(/^[0-9a-f]{8}$/);
    expect(groups[0].hash8).toBe(fnv1a8(groups[0].key));
    expect(groups[0].hash8).not.toBe(groups[1].hash8);
  });

  it('пустой заказ — групп нет', () => {
    expect(tzGroups(newSalesOrder())).toEqual([]);
  });
});
