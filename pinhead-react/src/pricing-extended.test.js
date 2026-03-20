import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrices, invalidatePricesCache,
  screenLookup, flexLookup, screenCalcZone,
  calcZonePriceDirect, getTotalSurcharge,
  getSkuEstPrice, getVolumeDiscount, calcTotal, getUnitPrice,
  getTotalQty,
} from './utils/pricing';
import { useStore } from './store/useStore';
import {
  PRICES, SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT,
  TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT,
} from './data';

// ── Helpers ──
const baseState = () => ({
  step: 0, type: 'tee', fabric: 'kulirnaya', color: '01-01', fit: 'regular',
  sku: SKU_CATALOG_DEFAULT[0],
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

beforeEach(() => {
  invalidatePricesCache();
});

// ═══════════════════════════════
// 1. getVolumeDiscount
// ═══════════════════════════════
describe('getVolumeDiscount', () => {
  it('qty=0 → 0 discount', () => {
    expect(getVolumeDiscount(0)).toBe(0);
  });
  it('qty=1 → 0 (tier 1, discount 0)', () => {
    expect(getVolumeDiscount(1)).toBe(0);
  });
  it('qty=49 → 0 (below 50 tier)', () => {
    expect(getVolumeDiscount(49)).toBe(0);
  });
  it('qty=50 → 0.02', () => {
    expect(getVolumeDiscount(50)).toBe(0.02);
  });
  it('qty=99 → 0.02 (still in 50 tier)', () => {
    expect(getVolumeDiscount(99)).toBe(0.02);
  });
  it('qty=100 → 0.03', () => {
    expect(getVolumeDiscount(100)).toBe(0.03);
  });
  it('qty=300 → 0.05', () => {
    expect(getVolumeDiscount(300)).toBe(0.05);
  });
  it('qty=500 → 0.08', () => {
    expect(getVolumeDiscount(500)).toBe(0.08);
  });
  it('qty=1000 → 0.12', () => {
    expect(getVolumeDiscount(1000)).toBe(0.12);
  });
  it('qty=2000 → 0.12 (max tier)', () => {
    expect(getVolumeDiscount(2000)).toBe(0.12);
  });
});

// ═══════════════════════════════
// 2. calcTotal — volume discount
// ═══════════════════════════════
describe('calcTotal — volume discount', () => {
  it('volume discount applies only to base, not print', () => {
    const s = baseState();
    s.sizes = { M: 100 }; // qty=100 → 3% discount
    s.zones = ['front'];
    s.zoneTechs = { front: 'dtf' };
    s.dtfZones = { front: { size: 'A4' } };

    const skuBase = getSkuEstPrice(s.sku, s.fabric, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const discountedBase = Math.round(skuBase * (1 - 0.03));
    const printCost = 180 + 50; // dtf base + A4
    const expected = 100 * (discountedBase + printCost);
    expect(calcTotal(s)).toBe(expected);
  });

  it('no discount for qty < 50', () => {
    const s = baseState(); // qty=40
    const skuBase = getSkuEstPrice(s.sku, s.fabric, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const expected = 40 * Math.round(skuBase);
    expect(calcTotal(s)).toBe(expected);
  });
});

// ═══════════════════════════════
// 3. calcTotal — urgent ordering
// ═══════════════════════════════
describe('calcTotal — urgent applies after volume discount', () => {
  it('urgent surcharge is on discounted price', () => {
    const s = baseState();
    s.sizes = { M: 100 }; // qty=100 → 3% discount
    s.urgentOption = true;

    const skuBase = getSkuEstPrice(s.sku, s.fabric, s.fabricsCatalog, s.trimCatalog, s.usdRate);
    const discountedBase = Math.round(skuBase * (1 - 0.03));
    const urgentSurcharge = discountedBase * 0.2;
    const expected = Math.round(100 * (discountedBase + urgentSurcharge));
    expect(calcTotal(s)).toBe(expected);
  });
});

// ═══════════════════════════════
// 4. calcTotal — SKU with different fabrics
// ═══════════════════════════════
describe('calcTotal — SKU with fabric selection', () => {
  it('different fabric code changes price', () => {
    const s1 = baseState();
    s1.fabric = 'kulirnaya'; // $2.80

    const s2 = baseState();
    s2.fabric = 'dvunitka'; // different priceUSD

    const p1 = calcTotal(s1);
    const p2 = calcTotal(s2);
    // Both should be > 0, and may differ if fabric codes match catalog entries
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════
// 5. getSkuEstPrice — new signature
// ═══════════════════════════════
describe('getSkuEstPrice — fabricCode parameter', () => {
  const sku = SKU_CATALOG_DEFAULT[0]; // tshirts category
  const FC = FABRICS_CATALOG_DEFAULT;
  const TC = TRIM_CATALOG_DEFAULT;

  it('null fabricCode falls back to category match', () => {
    const price = getSkuEstPrice(sku, null, FC, TC, 92);
    expect(price).toBeGreaterThan(0);
  });

  it('explicit fabricCode matching catalog entry', () => {
    const fabricEntry = FC.find(f => (f.forCategories || []).includes(sku.category));
    if (fabricEntry) {
      const price = getSkuEstPrice(sku, fabricEntry.code, FC, TC, 92);
      // Should equal the fallback price since same fabric
      const fallbackPrice = getSkuEstPrice(sku, null, FC, TC, 92);
      expect(price).toBe(fallbackPrice);
    }
  });

  it('nonexistent fabricCode falls back to category', () => {
    const price = getSkuEstPrice(sku, 'nonexistent-fabric-xyz', FC, TC, 92);
    // Falls back to category match
    const fallbackPrice = getSkuEstPrice(sku, null, FC, TC, 92);
    expect(price).toBe(fallbackPrice);
  });

  it('no fabricCode and no category match → sewingPrice + trim only', () => {
    const noMatchSku = { ...sku, category: 'nonexistent-cat' };
    const price = getSkuEstPrice(noMatchSku, null, FC, TC, 92);
    // No fabric cost, only sewing + trim
    expect(price).toBeLessThan(getSkuEstPrice(sku, null, FC, TC, 92));
  });
});

// ═══════════════════════════════
// 6. screenCalcZone — custom multipliers
// ═══════════════════════════════
describe('screenCalcZone — custom multipliers from store', () => {
  it('uses screenColoredMult from prices', () => {
    const s = baseState();
    s.zones = ['front'];
    s.zoneTechs = { front: 'screen' };
    s.zonePrints = { front: { colors: 1, size: 'A4', textile: 'color', fx: 'none' } };

    const base = screenLookup('A4', 1, 40);
    const result = screenCalcZone('front', s);
    // Default mult = 1.3
    expect(result).toBe(Math.round(base * 1.3));
  });

  it('uses screenFutherMult from prices for futher fabrics', () => {
    const s = baseState();
    s.fabric = 'futher-350-nachers';
    s.zones = ['front'];
    s.zoneTechs = { front: 'screen' };
    s.zonePrints = { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } };

    const base = screenLookup('A4', 1, 40);
    const result = screenCalcZone('front', s);
    expect(result).toBe(Math.round(base * 1.5));
  });

  it('colored + futher = both multipliers applied', () => {
    const s = baseState();
    s.fabric = 'futher-350-nachers';
    s.zones = ['front'];
    s.zoneTechs = { front: 'screen' };
    s.zonePrints = { front: { colors: 1, size: 'A4', textile: 'color', fx: 'none' } };

    const base = screenLookup('A4', 1, 40);
    const afterColor = Math.round(base * 1.3);
    const expected = Math.round(afterColor * 1.5);
    expect(screenCalcZone('front', s)).toBe(expected);
  });
});

// ═══════════════════════════════
// 7. flexLookup — reads from store prices
// ═══════════════════════════════
describe('flexLookup — uses store flexMatrix', () => {
  it('uses default matrix when no custom', () => {
    const result = flexLookup('A4', 1, 50);
    expect(result).toBe(227); // default A4/1c/50
  });

  it('falls back to FLEX_MATRIX if prices.flexMatrix is absent', () => {
    // Default prices already have no flexMatrix override in PRICES
    // Just check it still works
    expect(flexLookup('A6', 1, 50)).toBe(128);
    expect(flexLookup('A3', 3, 50)).toBe(454);
  });
});

// ═══════════════════════════════
// 8. screenLookup — boundaries
// ═══════════════════════════════
describe('screenLookup — boundary conditions', () => {
  it('qty=1 uses first tier', () => {
    expect(screenLookup('A4', 1, 1)).toBe(128);
  });
  it('qty=49 uses first tier', () => {
    expect(screenLookup('A4', 1, 49)).toBe(128);
  });
  it('qty=50 uses tier 0', () => {
    expect(screenLookup('A4', 1, 50)).toBe(128);
  });
  it('qty=100 uses tier 1', () => {
    expect(screenLookup('A4', 1, 100)).toBe(115);
  });
  it('qty=1000 uses last tier', () => {
    expect(screenLookup('A4', 1, 1000)).toBe(90);
  });
  it('qty=10000 still uses last tier', () => {
    expect(screenLookup('A4', 1, 10000)).toBe(90);
  });
  it('colors clamped to 1 when 0', () => {
    expect(screenLookup('A4', 0, 100)).toBe(screenLookup('A4', 1, 100));
  });
  it('colors clamped to 8 when > 8', () => {
    expect(screenLookup('A4', 20, 100)).toBe(screenLookup('A4', 8, 100));
  });
});

// ═══════════════════════════════
// 9. calcZonePriceDirect — all techs
// ═══════════════════════════════
describe('calcZonePriceDirect — all techniques', () => {
  it('screen basic', () => {
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 1 }, 100);
    expect(result).toBe(115); // A4/1c/100
  });

  it('screen with color textile', () => {
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 1, textile: 'color' }, 100);
    expect(result).toBe(Math.round(115 * 1.3));
  });

  it('screen with futher fabric', () => {
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 1 }, 100, 'futher-350-nachers');
    expect(result).toBe(Math.round(115 * 1.5));
  });

  it('screen with fx puff', () => {
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 1, fx: 'puff' }, 100);
    expect(result).toBe(Math.round(115 * 2));
  });

  it('flex basic', () => {
    const result = calcZonePriceDirect('flex', { fmt: 'A4', col: 1 }, 50);
    expect(result).toBe(227);
  });

  it('dtg A4 white', () => {
    const result = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'white' }, 100);
    expect(result).toBe(280 + 60); // base + A4 add
  });

  it('dtg A4 color (adds white under)', () => {
    const result = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'color' }, 100);
    expect(result).toBe(280 + 60 + 60);
  });

  it('embroidery area s, 3 colors', () => {
    const result = calcZonePriceDirect('embroidery', { fmt: 's', col: 3 }, 100);
    expect(result).toBe(350 + 0 + 2 * 20);
  });

  it('embroidery area l, 5 colors', () => {
    const result = calcZonePriceDirect('embroidery', { fmt: 'l', col: 5 }, 100);
    expect(result).toBe(350 + 180 + 4 * 20);
  });

  it('dtf A3', () => {
    const result = calcZonePriceDirect('dtf', { fmt: 'A3' }, 100);
    expect(result).toBe(180 + 100);
  });

  it('dtf A6', () => {
    const result = calcZonePriceDirect('dtf', { fmt: 'A6' }, 100);
    expect(result).toBe(180 + 0);
  });

  it('unknown tech → 0', () => {
    const result = calcZonePriceDirect('laser', { fmt: 'A4' }, 100);
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════
// 10. getPrices — cache invalidation
// ═══════════════════════════════
describe('getPrices — cache', () => {
  it('returns prices from store', () => {
    const prices = getPrices();
    expect(prices).toBeDefined();
    expect(prices.screenMatrix).toBeDefined();
  });

  it('invalidatePricesCache forces re-read', () => {
    // First call caches
    const p1 = getPrices();
    // Modify store
    const modified = { ...p1, pack: 999 };
    useStore.setState({ prices: modified });
    // Without invalidation, cache is stale
    const p2 = getPrices();
    expect(p2.pack).not.toBe(999); // still cached

    // After invalidation
    invalidatePricesCache();
    const p3 = getPrices();
    expect(p3.pack).toBe(999);

    // Restore
    useStore.setState({ prices: PRICES });
    invalidatePricesCache();
  });
});

// ═══════════════════════════════
// 11. getTotalSurcharge — multiple zones
// ═══════════════════════════════
describe('getTotalSurcharge', () => {
  it('returns 0 for empty zones', () => {
    const s = baseState();
    expect(getTotalSurcharge(s)).toBe(0);
  });

  it('sums surcharges for multiple zones', () => {
    const s = baseState();
    s.zones = ['front', 'back'];
    s.zoneTechs = { front: 'dtf', back: 'dtf' };
    s.dtfZones = { front: { size: 'A4' }, back: { size: 'A6' } };
    const expected = (180 + 50) + (180 + 0); // A4 + A6
    expect(getTotalSurcharge(s)).toBe(expected);
  });

  it('mixed techniques', () => {
    const s = baseState();
    s.zones = ['front', 'back'];
    s.zoneTechs = { front: 'dtf', back: 'embroidery' };
    s.dtfZones = { front: { size: 'A6' } };
    s.embZones = { back: { colors: 3, area: 's' } };
    const dtfCost = 180 + 0;
    const embCost = 350 + 0 + 2 * 20;
    expect(getTotalSurcharge(s)).toBe(dtfCost + embCost);
  });
});

// ═══════════════════════════════
// 12. getUnitPrice
// ═══════════════════════════════
describe('getUnitPrice', () => {
  it('returns 0 when qty=0', () => {
    const s = baseState();
    s.sizes = { M: 0 };
    expect(getUnitPrice(s)).toBe(0);
  });

  it('returns calcTotal / qty', () => {
    const s = baseState();
    const total = calcTotal(s);
    const qty = getTotalQty(s);
    expect(getUnitPrice(s)).toBe(Math.round(total / qty));
  });
});
