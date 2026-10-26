import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { leadDaysOf, METHOD_LEAD_DAYS } from '../../model/printMethods';
import type { OrderPrice } from '../../pricing/priceOrder';
import { kpDocument, kpFileName, kpRub } from './kpDocument';

const order = () => newSalesOrder({
  id: 'o1', number: 'PH-1234', customer: ' ООО Ромашка ', title: 'Мерч',
  items: [newSalesItem({
    key: 'a', product_type: 'Футболка',
    size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 50 } }] },
    prints: [newSalesPrint({ key: 'p1', method: 'dtf', zone: 'Грудь', width_mm: 250, height_mm: 120 }), newSalesPrint({ key: 'p2', method: 'silkscreen', zone: '', width_mm: null, height_mm: null })],
  })],
});
const price: OrderPrice = {
  items: [{ key: 'a', qty: 50, cost_unit: 0, markup_pct: 0, prints: [{ key: 'p1', method: 'dtf', qty: 50, unit: 120 }, { key: 'p2', method: 'silkscreen', qty: 50, unit: 80 }],
    labels_unit: 0, pack_unit: 0, calc_unit: 950, unit: 950, total: 47500, manual: false, cost_total: 0, issues: [] }],
  subtotal: 47500, prep_total: 1500, discount_amount: 1000, total: 48000, cost_total: 0, margin: 0, margin_pct: 0, below_threshold: false, incomplete: false,
};

describe('КП — модель документа (веха 5в, Э6)', () => {
  it('позиция: название, тираж, цена; нанесения строками с ценой; итог со скидкой и подготовкой', () => {
    const d = kpDocument(order(), price, '26.10.2026');
    expect(d).toMatchObject({ number: 'PH-1234', date: '26.10.2026', client: 'ООО Ромашка', subtotal: 47500, prep: 1500, discount: 1000, total: 48000, incomplete: false });
    expect(d.items[0]).toMatchObject({ qty: 50, unit: 950, total: 47500, leadDays: 7 });
    expect(d.items[0].lines).toEqual([
      { n: 1, zone: 'Грудь', method: 'DTF', size: '250 × 120 мм', unit: 120 },
      { n: 2, zone: 'зона уточняется', method: 'Шелкография', size: 'размер уточняется', unit: 80 },
    ]);
    expect(d.leadDays).toBe(7);
    expect(kpDocument(order(), price, '2026-10-26').date).toBe('26.10.2026');
  });
  it('срок — наибольший по технике; только подряд — без срока', () => {
    expect(leadDaysOf(['dtf', 'embroidery'])).toBe(METHOD_LEAD_DAYS.embroidery);
    expect(leadDaysOf(['other'])).toBeNull();
    expect(leadDaysOf([])).toBeNull();
  });
  it('рубли и имя файла', () => {
    expect(kpRub(48000)).toBe(`48${' '}000 ₽`);
    expect(kpRub(null)).toBe('—');
    expect(kpFileName('PH-1234')).toBe('PH-1234-KP.pdf');
  });
});
