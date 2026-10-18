import { describe, it, expect } from 'vitest';
import {
  screenLookup, flexLookup, getZoneSurcharge, getTotalQty,
  calcTotal, getSkuEstPrice, getMarkup,
  isAccessory, hasNoPrint, SCREEN_FX, TECH_TABS,
} from './pricing';
import * as pricing from './pricing';
import * as pricingCore from './pricingCore';
import { SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT } from '../data';

// ── Helpers ──
const baseState = () => ({
  step: 0, type: 'tee', fabric: 'medas-kulirnaya-100-160', color: '01-01', fit: 'regular',
  sku: SKU_CATALOG_DEFAULT[0], // Футболка Regular
  sizes: { '2XS': 0, 'XS': 0, 'S': 10, 'M': 20, 'L': 10, 'XL': 0, '2XL': 0, '3XL': 0 },
  customSizes: [],
  extras: [], labels: [], zones: [], zoneTechs: {}, zonePrints: {},
  flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
  noPrint: false,
  packOption: false, urgentOption: false,
  labelConfig: {
    careLabel: { enabled: false, logoOption: 'no-logo' },
    mainLabel: { option: 'none', material: 'woven' },
    hangTag: { option: 'none' },
  },
  skuCatalog: SKU_CATALOG_DEFAULT,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
});

// ═══════════════════════════════
// 1. Screen lookup
// ═══════════════════════════════
describe('screenLookup', () => {
  it('returns correct price for A4 / 1 color / 50 qty', () => {
    expect(screenLookup('A4', 1, 50)).toBe(128);
  });
  it('returns correct price for A4 / 1 color / 100 qty', () => {
    expect(screenLookup('A4', 1, 100)).toBe(115);
  });
  it('returns correct price for A3 / 3 colors / 300 qty', () => {
    expect(screenLookup('A3', 3, 300)).toBe(192);
  });
  it('returns correct price for Max / 8 colors / 1000 qty', () => {
    expect(screenLookup('Max', 8, 1000)).toBe(414);
  });
  it('clamps colors to 1-8', () => {
    expect(screenLookup('A4', 0, 50)).toBe(128); // clamped to 1
    expect(screenLookup('A4', 99, 50)).toBe(423); // clamped to 8
  });
  it('returns 0 for invalid format', () => {
    expect(screenLookup('A2', 1, 100)).toBe(0);
  });
  it('uses first tier for qty below 50', () => {
    expect(screenLookup('A4', 1, 10)).toBe(128);
  });
});

// ═══════════════════════════════
// 2. Flex lookup
// ═══════════════════════════════
describe('flexLookup', () => {
  it('returns single price for qty < 20', () => {
    expect(flexLookup('A4', 1, 5)).toBe(750);
    expect(flexLookup('A6', 2, 19)).toBe(450);
  });
  it('returns correct price for A4 / 1 color / 50 qty', () => {
    expect(flexLookup('A4', 1, 50)).toBe(227);
  });
  it('returns correct price for A3 / 3 colors / 35 qty', () => {
    expect(flexLookup('A3', 3, 35)).toBe(540);
  });
});

// ═══════════════════════════════
// 3. getTotalQty
// ═══════════════════════════════
describe('getTotalQty', () => {
  it('sums standard sizes', () => {
    const s = baseState();
    expect(getTotalQty(s)).toBe(40); // 10+20+10
  });
  it('includes custom sizes', () => {
    const s = baseState();
    s.customSizes = [{ label: '4XL', qty: 5 }];
    expect(getTotalQty(s)).toBe(45);
  });
  it('returns 0 for empty', () => {
    const s = baseState();
    s.sizes = { S: 0, M: 0 };
    s.customSizes = [];
    expect(getTotalQty(s)).toBe(0);
  });
});

// ═══════════════════════════════
// 4. Zone surcharge
// ═══════════════════════════════
describe('getZoneSurcharge', () => {
  it('screen: basic A4/1c/40qty', () => {
    const s = baseState();
    s.zoneTechs = { front: 'screen' };
    s.zonePrints = { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(128); // qty=40, nearest tier is 50 → first row
  });

  it('dtg: A4 white', () => {
    const s = baseState();
    s.zoneTechs = { front: 'dtg' };
    s.dtgZones = { front: { size: 'A4', textile: 'white' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(450); // таблица DTG 13.10: А4 белый, тираж 40 (35–49)
  });

  it('dtg: A4 color (adds white under)', () => {
    const s = baseState();
    s.zoneTechs = { front: 'dtg' };
    s.dtgZones = { front: { size: 'A4', textile: 'color' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(600); // А4 цветной, тираж 40 (35–49)
  });

  it('embroidery: 50x50mm default (stitch pricing)', () => {
    const s = baseState();
    s.zoneTechs = { front: 'embroidery' };
    s.embZones = { front: { width_mm: 50, height_mm: 50, fill: 1.0, extra: null } };
    const result = getZoneSurcharge('front', s);
    // 25 см² × 300 = 7500 стежков; на крое, тираж 40 < 50 → первая ступень 15 ₽/1000
    expect(result).toBe(112.5);
  });

  it('dtf: A3 (film pricing, optimal rotation)', () => {
    const s = baseState();
    s.zoneTechs = { front: 'dtf' };
    s.dtfZones = { front: { fmt: 'A3' } };
    const result = getZoneSurcharge('front', s);
    // A3 297×420 + 1 см: повёрнутый 430×307 → 1 в ряд, 3 ряда в метре; 40 шт. → 14 м
    // по 1400 ₽ (непрерывно 40 × 0,307 = 12,28 м) + перенос 50 → (19600 + 2000) / 40 = 540
    expect(result).toBe(540);
  });
});

// ═══════════════════════════════
// 5. SKU est price
// ═══════════════════════════════
describe('getSkuEstPrice', () => {
  it('calculates for T-001 (Футболка Classic woman) — рубли за метр', () => {
    const sku = SKU_CATALOG_DEFAULT[0]; // пошив 141, ткань 0,95 м, рибана 1×1 0,15 м
    const price = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    // кулирка Медас 160: 307,12 ₽/м; рибана Медас 600 ₽/м; курс на ₽-цены не влияет
    expect(price).toBe(141 + 291.76 + 90);
  });

  it('returns sewing + trim when no fabric match', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], category: 'nonexistent' };
    const price = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(price).toBe(141 + 90);
  });

  it('applies priceMultiplier when set', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], priceMultiplier: 1.1 };
    const base = getSkuEstPrice({ ...SKU_CATALOG_DEFAULT[0] }, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const withMult = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(withMult).toBeCloseTo(base * 1.1, 2);
  });

  it('priceMultiplier of 1 returns same as no multiplier', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], priceMultiplier: 1 };
    const base = getSkuEstPrice({ ...SKU_CATALOG_DEFAULT[0] }, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const withMult = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(withMult).toBe(base);
  });

  it('priceMultiplier of 0.9 reduces cost by 10%', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], priceMultiplier: 0.9 };
    const base = getSkuEstPrice({ ...SKU_CATALOG_DEFAULT[0] }, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const withMult = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(withMult).toBeCloseTo(base * 0.9, 2);
  });

  it('undefined priceMultiplier returns base cost', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], priceMultiplier: undefined };
    const base = getSkuEstPrice({ ...SKU_CATALOG_DEFAULT[0] }, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const withMult = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(withMult).toBe(base);
  });
});

// ═══════════════════════════════
// 6. Бирки визарда v3 (labelConfig) — мёртвая ветка удалена (веха 8, задача 4)
// ═══════════════════════════════
// UI бирок визарда убран в вехе 3; цена бирок v4 — `salesLabelPrice` по библиотеке
// (`orderstudio/pricing/priceOrder.ts`). Буфер визарда ещё носит `labelConfig`,
// но в цене он участвовать не должен: иначе мёртвое поле молча меняет сумму.
describe('бирки v3 (labelConfig) в цене визарда не участвуют', () => {
  it('getLabelConfigPrice больше не экспортируется', () => {
    expect('getLabelConfigPrice' in pricing).toBe(false);
    expect('getLabelConfigPrice' in pricingCore).toBe(false);
  });

  it('все бирки включены — цена та же, что без бирок', () => {
    const none = baseState();
    const all = baseState();
    all.labelConfig = {
      careLabel: { enabled: true, logoOption: 'my-logo' },
      mainLabel: { option: 'custom', material: 'canvas' },
      hangTag: { option: 'standard' },
    };
    expect(calcTotal(all)).toBe(calcTotal(none));
  });
});

// ═══════════════════════════════
// 7. calcTotal
// ═══════════════════════════════
describe('calcTotal', () => {
  // T-001, 40 шт.: себестоимость 522,76; накладные 70 %; группа А, тираж 25–49 → 90 %
  const garment = (base) => Math.round(base * 1.7 * 1.9);

  it('returns 0 when qty is 0', () => {
    const s = baseState();
    s.sizes = { S: 0, M: 0 };
    expect(calcTotal(s)).toBe(0);
  });

  it('cost × overhead × markup × qty (no extras, no print)', () => {
    const s = baseState();
    expect(getMarkup(40, s.sku.category)).toBe(0.90);
    expect(calcTotal(s)).toBe(40 * garment(522.76));
  });

  it('extras are inside the cost: overhead and markup apply to them', () => {
    const s = baseState();
    s.extras = ['double-stitch']; // 30₽
    expect(calcTotal(s)).toBe(40 * garment(522.76 + 30));
  });

  it('extra already included in sewing price is not charged twice', () => {
    const s = baseState();
    s.extras = ['double-stitch'];
    s.sku = { ...s.sku, includedExtras: ['double-stitch'] };
    expect(calcTotal(s)).toBe(40 * garment(522.76));
  });

  it('print surcharge is added without overhead and markup', () => {
    const s = baseState();
    s.zones = ['front'];
    s.zoneTechs = { front: 'dtf' };
    s.dtfZones = { front: { fmt: 'A4' } };
    // A4 210×297 + 1 см: прямо 2 в ряд × 3 ряда = 6/м → 40 шт. = 7 м по 1500 + перенос 50
    const techCost = Math.round((7 * 1500 + 40 * 50) / 40 * 100) / 100;
    expect(calcTotal(s)).toBe(Math.round(40 * (garment(522.76) + techCost)));
  });

  it('legacy urgent flag = 5 days (+15 %) on the garment only', () => {
    const s = baseState();
    s.urgentOption = true;
    expect(calcTotal(s)).toBe(40 * Math.round(522.76 * 1.7 * 1.9 * 1.15));
  });

  it('adds pack option', () => {
    const s = baseState();
    s.packType = 'bopp';
    s.packOption = true;
    expect(calcTotal(s)).toBe(40 * (garment(522.76) + 20)); // BOPP = 20₽
  });
});

// ═══════════════════════════════
// 8. Utility checks
// ═══════════════════════════════
describe('isAccessory / hasNoPrint', () => {
  it('identifies accessories', () => {
    expect(isAccessory('shopper')).toBe(true);
    expect(isAccessory('socks')).toBe(true);
    expect(isAccessory('tee')).toBe(false);
    expect(isAccessory('hoodie')).toBe(false);
  });
  it('socks has no print', () => {
    expect(hasNoPrint('socks')).toBe(true);
    expect(hasNoPrint('tee')).toBe(false);
  });
});

describe('TECH_TABS', () => {
  it('has 5 techniques', () => {
    expect(TECH_TABS).toHaveLength(5);
    expect(TECH_TABS.map(t => t.key)).toEqual(['screen', 'flex', 'dtg', 'embroidery', 'dtf']);
  });
});

describe('SCREEN_FX', () => {
  it('has 6 effects with coefficients of 13.10', () => {
    expect(SCREEN_FX.map(f => [f.key, f.mult])).toEqual([
      ['none', 1], ['stone', 2], ['puff', 1.5], ['metallic', 1.2], ['fluor', 1.2], ['discharge', 1.35],
    ]);
  });
});
