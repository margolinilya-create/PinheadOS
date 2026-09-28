// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from './pricingCore';
import { PRICES } from '../data/prices';
import { SKU_CATALOG_DEFAULT } from '../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../data/extras';

/**
 * Ядро цены (срез 0 Order v4): цены приходят аргументом, стор не нужен.
 * Регресс самой формулы — `pricing.test.js` и `pricing-extended.test.js`
 * через обёртки `utils/pricing.ts`; здесь — то, ради чего ядро вынесено.
 */

const P = PRICES as core.PricesExt;

const state = (over: Record<string, unknown> = {}) => ({
  type: 'tee', fabric: 'medas-kulirnaya-100-160', fit: 'regular',
  sku: SKU_CATALOG_DEFAULT[0],
  sizes: { S: 10, M: 20, L: 10 }, customSizes: [],
  extras: [], zones: ['front'], zoneTechs: { front: 'screen' },
  zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
  labelConfig: null, packOption: false, urgentOption: false,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT, trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT, usdRate: 92,
  ...over,
});

describe('pricingCore — цены аргументом', () => {
  it('модуль не импортирует стор', () => {
    const src = readFileSync(join(__dirname, 'pricingCore.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports.filter((m) => /store|lib\//.test(m))).toEqual([]);
  });

  it('другая матрица шелкографии — другая цена нанесения', () => {
    const base = core.getZoneSurcharge(P, 'front', state());
    const doubled: core.PricesExt = {
      ...P,
      screenMatrix: Object.fromEntries(
        Object.entries(P.screenMatrix).map(([fmt, rows]) => [
          fmt,
          Object.fromEntries(Object.entries(rows as Record<string, number[]>)
            .map(([c, row]) => [c, row.map((v) => v * 2)])),
        ]),
      ),
    };
    expect(base).toBeGreaterThan(0);
    expect(core.getZoneSurcharge(doubled, 'front', state())).toBe(base * 2);
  });

  it('наценка по тиражу берётся из переданного прайса', () => {
    const flat: core.PricesExt = { ...P, markupTiers: [1], markupByType: {}, markupDefault: [0.5] };
    const b = core.calcTotalBreakdown(flat, state());
    expect(b.markupPct).toBe(0.5);
    expect(b.markedBase).toBe(Math.round(b.cost * 1.5));
  });

  it('срочность — множитель из прайса поверх цены единицы', () => {
    const plain = core.calcTotalBreakdown(P, state());
    const urgent = core.calcTotalBreakdown({ ...P, urgentMult: 0.5 }, state({ urgentOption: true }));
    expect(urgent.unitPrice).toBe(plain.unitPrice + Math.round(plain.unitPrice * 0.5));
  });

  it('calcTotal и calcTotalBreakdown сходятся по итогу', () => {
    for (const s of [state(), state({ urgentOption: true }), state({ sku: null })]) {
      expect(core.calcTotal(P, s)).toBe(core.calcTotalBreakdown(P, s).total);
    }
  });
});
