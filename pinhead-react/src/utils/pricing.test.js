import { describe, it, expect } from 'vitest';
import {
  screenLookup, flexLookup, getZoneSurcharge, getTotalQty, getTotalSurcharge,
  calcTotal, getUnitPrice, getSkuEstPrice, getLabelConfigPrice,
  isAccessory, hasNoPrint, SCREEN_FX, TECH_TABS,
} from './pricing';
import { SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT } from '../data';

// ── Helpers ──
const baseState = () => ({
  step: 0, type: 'tee', fabric: 'kulirnaya', color: '01-01', fit: 'regular',
  sku: SKU_CATALOG_DEFAULT[0], // Футболка Regular
  sizes: { '2XS': 0, 'XS': 0, 'S': 10, 'M': 20, 'L': 10, 'XL': 0, '2XL': 0, '3XL': 0 },
  customSizes: [],
  extras: [], labels: [], zones: [], zoneTechs: {}, zonePrints: {},
  flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
  zoneArtworks: {}, noPrint: false,
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
    expect(result).toBe(280 + 60); // base + A4 add
  });

  it('dtg: A4 color (adds white under)', () => {
    const s = baseState();
    s.zoneTechs = { front: 'dtg' };
    s.dtgZones = { front: { size: 'A4', textile: 'color' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(280 + 60 + 60); // base + A4 + white under
  });

  it('embroidery: area s, 3 colors', () => {
    const s = baseState();
    s.zoneTechs = { front: 'embroidery' };
    s.embZones = { front: { colors: 3, area: 's' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(350 + 0 + 2 * 20); // base + area_s + 2 extra colors
  });

  it('dtf: A3', () => {
    const s = baseState();
    s.zoneTechs = { front: 'dtf' };
    s.dtfZones = { front: { size: 'A3' } };
    const result = getZoneSurcharge('front', s);
    expect(result).toBe(180 + 100); // base + A3 add
  });
});

// ═══════════════════════════════
// 5. SKU est price
// ═══════════════════════════════
describe('getSkuEstPrice', () => {
  it('calculates for T-001 (Футболка Regular)', () => {
    const sku = SKU_CATALOG_DEFAULT[0]; // sewingPrice:200, mainFabricUsage:1.0, trimCode:ribana-1x1, trimUsage:0.15
    const price = getSkuEstPrice(sku, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    // fabric: kulirnaya $2.80 * 92 * 1.0 = 257.6 → 258
    // trim: ribana-1x1 $2.50 * 92 * 0.15 = 34.5 → 35 (Math.round)
    expect(price).toBe(200 + Math.round(1.0 * 2.80 * 92) + Math.round(0.15 * 2.50 * 92));
  });

  it('returns sewingPrice only when no fabric match', () => {
    const sku = { ...SKU_CATALOG_DEFAULT[0], category: 'nonexistent' };
    const price = getSkuEstPrice(sku, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(price).toBe(200 + 0 + Math.round(0.15 * 2.50 * 92)); // no fabric match
  });
});

// ═══════════════════════════════
// 6. Label config price
// ═══════════════════════════════
describe('getLabelConfigPrice', () => {
  it('returns 0 when all disabled', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: false },
      mainLabel: { option: 'none' },
      hangTag: { option: 'none' },
    })).toBe(0);
  });

  it('careLabel enabled + my-logo', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: true, logoOption: 'my-logo' },
      mainLabel: { option: 'none' },
      hangTag: { option: 'none' },
    })).toBe(10 + 20);
  });

  it('mainLabel standard + woven', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: false },
      mainLabel: { option: 'standard', material: 'woven' },
      hangTag: { option: 'none' },
    })).toBe(30);
  });

  it('hangTag custom', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: false },
      mainLabel: { option: 'none' },
      hangTag: { option: 'custom' },
    })).toBe(25);
  });

  it('all options combined', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: true, logoOption: 'my-logo' },
      mainLabel: { option: 'custom', material: 'canvas' },
      hangTag: { option: 'standard' },
    })).toBe(30 + 55 + 15); // care(10+20) + main(45+10) + hang(15)
  });
});

// ═══════════════════════════════
// 7. calcTotal
// ═══════════════════════════════
describe('calcTotal', () => {
  it('returns 0 when qty is 0', () => {
    const s = baseState();
    s.sizes = { S: 0, M: 0 };
    expect(calcTotal(s)).toBe(0);
  });

  it('calculates base price × qty (no extras, no print)', () => {
    const s = baseState();
    // SKU base = sewingPrice + fabric + trim
    const skuBase = getSkuEstPrice(s.sku, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const expected = 40 * Math.round(skuBase);
    expect(calcTotal(s)).toBe(expected);
  });

  it('adds extras cost', () => {
    const s = baseState();
    s.extras = ['double-stitch']; // 30₽
    const skuBase = getSkuEstPrice(s.sku, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const expected = 40 * Math.round(skuBase + 30);
    expect(calcTotal(s)).toBe(expected);
  });

  it('adds print surcharge', () => {
    const s = baseState();
    s.zones = ['front'];
    s.zoneTechs = { front: 'dtf' };
    s.dtfZones = { front: { size: 'A4' } };
    const skuBase = getSkuEstPrice(s.sku, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const techCost = 180 + 50; // dtf base + A4
    const expected = 40 * Math.round(skuBase + techCost);
    expect(calcTotal(s)).toBe(expected);
  });

  it('applies urgent multiplier', () => {
    const s = baseState();
    s.urgentOption = true;
    const skuBase = getSkuEstPrice(s.sku, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const unit = Math.round(skuBase);
    const expected = Math.round(40 * unit * 1.2);
    expect(calcTotal(s)).toBe(expected);
  });

  it('adds pack option', () => {
    const s = baseState();
    s.packOption = true;
    const skuBase = getSkuEstPrice(s.sku, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const expected = 40 * (Math.round(skuBase) + 15);
    expect(calcTotal(s)).toBe(expected);
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
  it('has 5 effects', () => {
    expect(SCREEN_FX).toHaveLength(5);
    expect(SCREEN_FX[0].key).toBe('none');
    expect(SCREEN_FX[0].mult).toBe(1);
    expect(SCREEN_FX[1].mult).toBe(2);
  });
});
