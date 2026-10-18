import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesLabel, newSalesPrint } from '../../model/factory';
import { duplicateInColor } from '../../model/itemOps';
import { alignPrints } from './tzGroups';
import { groupDivergence } from './groupDiff';
import type { TextileCatalogs } from '../../model/garmentTextile';

/** Без палитр: подложка — по слову «белый» в подписи цвета */
const NO_CAT: TextileCatalogs = { suppliers: [], fabricsCatalog: [] };

const base = () => newSalesItem({
  product_type: 'Футболка',
  fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 1 } }] },
  labels: [newSalesLabel({ label_type: 'brand', place: 'Горловина' })],
  prints: [
    newSalesPrint({ zone: 'Грудь', method: 'silkscreen', width_mm: 100, height_mm: 80 }),
    newSalesPrint({ zone: 'Спина', method: 'dtf', width_mm: 300, height_mm: 400 }),
  ],
});

describe('alignPrints — сопоставление нанесений по ключу группы', () => {
  it('переставленные нанесения находятся по ключу; лишнего нет — undefined', () => {
    const a = base();
    const b = { ...a, prints: [a.prints[1], a.prints[0]] };
    expect(alignPrints(a, b)).toEqual([a.prints[0], a.prints[1]]);
    expect(alignPrints(a, { ...a, prints: [a.prints[1]] })).toEqual([undefined, a.prints[1]]);
  });

  it('одинаковые ключи — по очереди появления', () => {
    const p = newSalesPrint({ zone: 'Рукав', method: 'dtf', width_mm: 50, height_mm: 50 });
    const a = { ...base(), prints: [{ ...p, key: 'a1' }, { ...p, key: 'a2' }] };
    const b = { ...a, prints: [{ ...p, key: 'b1' }, { ...p, key: 'b2' }] };
    expect(alignPrints(a, b).map((x) => x?.key)).toEqual(['b1', 'b2']);
  });
});

describe('groupDivergence', () => {
  it('копия в другом цвете без правок — расхождений нет; одна позиция — пусто', () => {
    const a = base();
    expect(groupDivergence([a, duplicateInColor(a, 'Белый', NO_CAT)])).toEqual([]);
    expect(groupDivergence([a])).toEqual([]);
  });

  it('бирка, упаковка, подрядчик, эффект, отступ — названы в постоянном порядке', () => {
    const a = base();
    const b = duplicateInColor(a, 'Белый', NO_CAT);
    const changed = {
      ...b,
      labels: [{ ...b.labels[0], place: 'Бок' }],
      packaging: 'zip',
      prints: [
        { ...b.prints[1], contractor: 'Партнёр' },
        { ...b.prints[0], special: 'puff', offset_mm: 50 },
      ],
    };
    expect(groupDivergence([a, changed])).toEqual(['бирки', 'упаковка', 'подрядчик', 'эффекты', 'отступ']);
  });

  it('упаковка «как у заказа» — свои размеры позиции не считаются', () => {
    const a = base();
    const b = { ...duplicateInColor(a, 'Белый', NO_CAT), packaging_width_mm: 200 };
    expect(groupDivergence([a, b])).toEqual([]);
  });
});
