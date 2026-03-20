// ═══════════════════════════════════════════════════════════════
// pricing-extended.test.js — расширенное покрытие pricing.js
// Покрывает: volume discount, скидка+срочность, calcTotal с SKU,
// screen multipliers, flex из getPrices, boundary conditions
// ═══════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import {
  screenLookup, flexLookup, getVolumeDiscount, calcTotal,
  getZoneSurcharge,
  getSkuEstPrice, calcZonePriceDirect, invalidatePricesCache,
} from './utils/pricing';
import { useStore } from './store/useStore';
import { PRICES } from './data/prices';
import { SKU_CATALOG_DEFAULT } from './data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from './data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from './data/extras';
// ── helpers ──────────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    type: 'tee',
    fabric: 'kulirnaya',
    color: '01-01',
    sku: null,
    fit: 'regular',
    sizes: { S: 0, M: 10, L: 10, XL: 5 },
    customSizes: [],
    extras: [],
    zones: [],
    zoneTechs: {},
    zonePrints: {},
    flexZones: {},
    dtgZones: {},
    embZones: {},
    dtfZones: {},
    labelConfig: null,
    packOption: false,
    urgentOption: false,
    fabricsCatalog: FABRICS_CATALOG_DEFAULT,
    trimCatalog: TRIM_CATALOG_DEFAULT,
    extrasCatalog: EXTRAS_CATALOG_DEFAULT,
    usdRate: 92,
    prices: PRICES,
    ...overrides,
  };
}
beforeEach(() => {
  // Убедиться что стор имеет дефолтные цены и кэш сброшен
  useStore.setState({ prices: PRICES });
  invalidatePricesCache();
});
// ════════════════════════════════════════════════
// 1. getVolumeDiscount — не было НИ ОДНОГО теста
// ════════════════════════════════════════════════
describe('getVolumeDiscount', () => {
  it('qty=1 → 0% (tier 1, discount 0)', () => {
    expect(getVolumeDiscount(1)).toBe(0);
  });
  it('qty=49 → 0% (below tier 50)', () => {
    expect(getVolumeDiscount(49)).toBe(0);
  });
  it('qty=50 → 2% (tier boundary)', () => {
    expect(getVolumeDiscount(50)).toBeCloseTo(0.02);
  });
  it('qty=51 → 2%', () => {
    expect(getVolumeDiscount(51)).toBeCloseTo(0.02);
  });
  it('qty=99 → 2% (still in 50-99 band)', () => {
    expect(getVolumeDiscount(99)).toBeCloseTo(0.02);
  });
  it('qty=100 → 3%', () => {
    expect(getVolumeDiscount(100)).toBeCloseTo(0.03);
  });
  it('qty=300 → 5%', () => {
    expect(getVolumeDiscount(300)).toBeCloseTo(0.05);
  });
  it('qty=500 → 8%', () => {
    expect(getVolumeDiscount(500)).toBeCloseTo(0.08);
  });
  it('qty=1000 → 12%', () => {
    expect(getVolumeDiscount(1000)).toBeCloseTo(0.12);
  });
  it('qty=2000 → 12% (max tier)', () => {
    expect(getVolumeDiscount(2000)).toBeCloseTo(0.12);
  });
  it('qty=0 → 0%', () => {
    expect(getVolumeDiscount(0)).toBe(0);
  });
});
// ════════════════════════════════════════════════
// 2. calcTotal — скидка за объём
// ════════════════════════════════════════════════
describe('calcTotal — volume discount', () => {
  it('qty=49 → нет скидки', () => {
    const state = makeState({ sizes: { M: 25, L: 24 } }); // 49 шт
    const noDiscount = calcTotal(state);
    const basePrice = PRICES.type['tee']; // 480
    expect(noDiscount).toBe(49 * basePrice);
  });
  it('qty=50 → скидка 2% на базовую цену', () => {
    const state = makeState({ sizes: { M: 25, L: 25 } }); // 50 шт
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee']; // 480
    const discountedBase = Math.round(basePrice * 0.98); // 470
    expect(total).toBe(50 * discountedBase);
  });
  it('qty=100 → скидка 3%', () => {
    const state = makeState({ sizes: { M: 50, L: 50 } }); // 100 шт
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const discountedBase = Math.round(basePrice * 0.97);
    expect(total).toBe(100 * discountedBase);
  });
  it('скидка НЕ применяется к стоимости печати', () => {
    const state = makeState({
      sizes: { M: 50, L: 50 }, // 100 шт → 3% скидка
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const discountedBase = Math.round(basePrice * 0.97);
    const printPrice = screenLookup('A4', 1, 100);
    expect(total).toBe(100 * (discountedBase + printPrice));
  });
});
// ════════════════════════════════════════════════
// 3. calcTotal — срочность ПОСЛЕ скидки
// ════════════════════════════════════════════════
describe('calcTotal — urgentOption порядок применения', () => {
  it('срочность считается ПОСЛЕ скидки за объём', () => {
    // qty=100 → 3% скидка, затем +20% срочность
    const state = makeState({
      sizes: { M: 50, L: 50 },
      urgentOption: true,
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const discountedBase = Math.round(basePrice * 0.97);
    // urgentSurcharge = unitPrice * 0.2, total = Math.round(qty * (unitPrice + surcharge))
    const urgentSurcharge = discountedBase * 0.2;
    const expected = Math.round(100 * (discountedBase + urgentSurcharge));
    expect(total).toBe(expected);
  });
  it('срочность без скидки (qty=10)', () => {
    const state = makeState({
      sizes: { M: 5, L: 5 },
      urgentOption: true,
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const urgentUnit = Math.round(basePrice * 1.20);
    expect(total).toBe(10 * urgentUnit);
  });
  it('срочность не применяется если urgentOption=false', () => {
    const s1 = makeState({ sizes: { M: 5, L: 5 }, urgentOption: false });
    const s2 = makeState({ sizes: { M: 5, L: 5 }, urgentOption: true });
    expect(calcTotal(s2)).toBeGreaterThan(calcTotal(s1));
  });
});
// ════════════════════════════════════════════════
// 4. calcTotal — с SKU (не type)
// ════════════════════════════════════════════════
describe('calcTotal — с SKU-каталогом', () => {
  const sku = SKU_CATALOG_DEFAULT.find(s => s.code === 'T-001');
  it('calcTotal с SKU считает через getSkuEstPrice', () => {
    const state = makeState({
      sku,
      fabric: 'kulirnaya',
      sizes: { M: 10, L: 10 },
    });
    const total = calcTotal(state);
    const estPrice = getSkuEstPrice(sku, 'kulirnaya', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(total).toBe(20 * estPrice);
  });
  it('разные ткани дают разную цену (т.е. выбор ткани учитывается)', () => {
    const stateKulirnaya = makeState({
      sku,
      fabric: 'kulirnaya',
      sizes: { M: 10 },
    });
    const stateDvunitka = makeState({
      sku,
      fabric: 'dvunitka',
      sizes: { M: 10 },
    });
    const p1 = calcTotal(stateKulirnaya);
    const p2 = calcTotal(stateDvunitka);
    // dvunitka дороже kulirnaya (priceUSD 3.40 vs 2.80)
    expect(p2).toBeGreaterThan(p1);
  });
  it('худи с футером считается дороже футболки с кулиркой', () => {
    const skuHoodie = SKU_CATALOG_DEFAULT.find(s => s.code === 'H-001');
    const stateHoodie = makeState({
      sku: skuHoodie,
      fabric: 'futher-350-petlya',
      sizes: { M: 10 },
    });
    const stateTee = makeState({
      sku,
      fabric: 'kulirnaya',
      sizes: { M: 10 },
    });
    expect(calcTotal(stateHoodie)).toBeGreaterThan(calcTotal(stateTee));
  });
});
// ════════════════════════════════════════════════
// 5. getSkuEstPrice — выбранная ткань
// ════════════════════════════════════════════════
describe('getSkuEstPrice — учёт выбранной ткани', () => {
  const sku = SKU_CATALOG_DEFAULT.find(s => s.code === 'T-001');
  it('разные ткани дают разный fabricCost', () => {
    const p1 = getSkuEstPrice(sku, 'kulirnaya', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const p2 = getSkuEstPrice(sku, 'dvunitka', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(p2).toBeGreaterThan(p1);
  });
  it('fallback на категорию если fabricCode не передан', () => {
    const p1 = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const p2 = getSkuEstPrice(sku, 'kulirnaya', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    // первая ткань категории tshirts = kulirnaya → должны совпасть
    expect(p1).toBe(p2);
  });
  it('usdRate влияет на цену', () => {
    const p1 = getSkuEstPrice(sku, 'kulirnaya', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 80);
    const p2 = getSkuEstPrice(sku, 'kulirnaya', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 100);
    expect(p2).toBeGreaterThan(p1);
  });
  it('неизвестный fabricCode → fallback на категорию', () => {
    const pFallback = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const pUnknown = getSkuEstPrice(sku, 'nonexistent-fabric', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(pFallback).toBe(pUnknown);
  });
});
// ════════════════════════════════════════════════
// 6. Screen — multipliers из prices (не захардкоженные)
// ════════════════════════════════════════════════
describe('screenCalcZone — multipliers из getPrices', () => {
  it('textile=color применяет screenColoredMult из prices', () => {
    const base = getZoneSurcharge('front', makeState({
      sizes: { M: 50, L: 50 },
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const colored = getZoneSurcharge('front', makeState({
      sizes: { M: 50, L: 50 },
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'color', fx: 'none' } },
    }));
    const expectedMult = PRICES.screenColoredMult || 1.3;
    expect(colored).toBe(Math.round(base * expectedMult));
  });
  it('futher ткань применяет screenFutherMult из prices', () => {
    const base = getZoneSurcharge('front', makeState({
      sizes: { M: 50, L: 50 },
      fabric: 'kulirnaya',
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const futher = getZoneSurcharge('front', makeState({
      sizes: { M: 50, L: 50 },
      fabric: 'futher-350-nachers',
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const expectedMult = PRICES.screenFutherMult || 1.5;
    expect(futher).toBe(Math.round(base * expectedMult));
  });
  it('кастомный screenColoredMult из стора применяется', () => {
    // Установить кастомный мультипликатор
    const customPrices = { ...PRICES, screenColoredMult: 1.5 };
    useStore.setState({ prices: customPrices });
    invalidatePricesCache();
    const base = getZoneSurcharge('front', makeState({
      sizes: { M: 50 },
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const colored = getZoneSurcharge('front', makeState({
      sizes: { M: 50 },
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'color', fx: 'none' } },
    }));
    expect(colored).toBe(Math.round(base * 1.5));
    // Восстановить
    useStore.setState({ prices: PRICES });
    invalidatePricesCache();
  });
});
// ════════════════════════════════════════════════
// 7. Flex — из prices (не захардкоженная матрица)
// ════════════════════════════════════════════════
describe('flexLookup — читает из getPrices', () => {
  it('стандартные значения совпадают с захардкоженной матрицей', () => {
    // A4, 1 цвет, 50 штук → должно быть 227 (из дефолтной матрицы)
    expect(flexLookup('A4', 1, 50)).toBe(227);
  });
  it('A3, 3 цвета, 35 штук', () => {
    expect(flexLookup('A3', 3, 35)).toBe(540);
  });
  it('кастомная flexMatrix из стора применяется', () => {
    const customMatrix = {
      'A4': { 1: [999, 888, 777, 666], 2: [999, 888, 777, 666], 3: [999, 888, 777, 666] },
      'A3': { 1: [999, 888, 777, 666], 2: [999, 888, 777, 666], 3: [999, 888, 777, 666] },
      'A5': { 1: [999, 888, 777, 666], 2: [999, 888, 777, 666], 3: [999, 888, 777, 666] },
      'A6': { 1: [999, 888, 777, 666], 2: [999, 888, 777, 666], 3: [999, 888, 777, 666] },
    };
    useStore.setState({ prices: { ...PRICES, flexMatrix: customMatrix } });
    invalidatePricesCache();
    // qty=50 → tierIdx=3 (last) → 666
    expect(flexLookup('A4', 1, 50)).toBe(666);
    useStore.setState({ prices: PRICES });
    invalidatePricesCache();
  });
  it('qty < 20 → возвращает single price', () => {
    expect(flexLookup('A4', 1, 15)).toBe(750); // FLEX_SINGLE_PRICE['A4']
    expect(flexLookup('A6', 1, 1)).toBe(450);
  });
  it('все форматы возвращают значения', () => {
    for (const fmt of ['A6', 'A5', 'A4', 'A3']) {
      expect(flexLookup(fmt, 1, 50)).toBeGreaterThan(0);
    }
  });
});
// ════════════════════════════════════════════════
// 8. Boundary conditions — screenLookup
// ════════════════════════════════════════════════
describe('screenLookup — граничные условия', () => {
  it('qty=1 → использует первый тир (< 50)', () => {
    expect(screenLookup('A4', 1, 1)).toBe(128); // tier[0]
  });
  it('qty=49 → первый тир', () => {
    expect(screenLookup('A4', 1, 49)).toBe(128);
  });
  it('qty=50 → первый тир (tier boundary)', () => {
    expect(screenLookup('A4', 1, 50)).toBe(128);
  });
  it('qty=1000 → последний тир (максимальная скидка)', () => {
    expect(screenLookup('A4', 1, 1000)).toBe(90);
  });
  it('qty=10000 → тот же что 1000 (capped)', () => {
    expect(screenLookup('A4', 1, 10000)).toBe(90);
  });
  it('colors=0 → clamped to 1', () => {
    expect(screenLookup('A4', 0, 100)).toBe(screenLookup('A4', 1, 100));
  });
  it('colors=9 → clamped to 8', () => {
    expect(screenLookup('A4', 9, 100)).toBe(screenLookup('A4', 8, 100));
  });
});
// ════════════════════════════════════════════════
// 9. calcZonePriceDirect — все техники
// ════════════════════════════════════════════════
describe('calcZonePriceDirect — все техники', () => {
  it('screen: A4, 2 цвета, 100 шт', () => {
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 2 }, 100, 'kulirnaya');
    expect(result).toBe(screenLookup('A4', 2, 100));
  });
  it('flex: A4, 1 цвет, 50 шт', () => {
    const result = calcZonePriceDirect('flex', { fmt: 'A4', col: 1 }, 50);
    expect(result).toBe(flexLookup('A4', 1, 50));
  });
  it('dtg: A4, white', () => {
    const result = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'white' }, 50);
    const P = PRICES;
    expect(result).toBe((P.tech.dtg || 280) + (P.dtgFormatAdd?.['A4'] || 0));
  });
  it('dtg: A4, color — добавляет белую подложку', () => {
    const white = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'white' }, 50);
    const color = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'color' }, 50);
    expect(color - white).toBe(PRICES.dtgWhiteUnder || 60);
  });
  it('embroidery: s area, 3 colors', () => {
    const result = calcZonePriceDirect('embroidery', { fmt: 's', col: 3 }, 50);
    const P = PRICES;
    const expected = (P.tech.embroidery || 350) + (P.embAreaAdd?.['s'] || 0) + 2 * (P.embColorAdd || 20);
    expect(result).toBe(expected);
  });
  it('embroidery: больше цветов = дороже', () => {
    const p3 = calcZonePriceDirect('embroidery', { fmt: 's', col: 3 }, 50);
    const p5 = calcZonePriceDirect('embroidery', { fmt: 's', col: 5 }, 50);
    expect(p5).toBeGreaterThan(p3);
  });
  it('dtf: A3', () => {
    const result = calcZonePriceDirect('dtf', { fmt: 'A3' }, 50);
    const P = PRICES;
    expect(result).toBe((P.tech.dtf || 180) + (P.dtfFormatAdd?.['A3'] || 0));
  });
  it('неизвестная техника → 0', () => {
    expect(calcZonePriceDirect('unknown', {}, 50)).toBe(0);
  });
});
// ════════════════════════════════════════════════
// 10. getPrices — кэш корректно сбрасывается
// ════════════════════════════════════════════════
describe('getPrices — инвалидация кэша', () => {
  it('после invalidatePricesCache → читает из стора заново', async () => {
    // Первый вызов — кэшируем дефолт
    const { getPrices } = await import('./utils/pricing');
    const p1 = getPrices();
    expect(p1.type.tee).toBe(480);
    // Меняем цены в сторе
    const newPrices = { ...PRICES, type: { ...PRICES.type, tee: 999 } };
    useStore.setState({ prices: newPrices });
    invalidatePricesCache();
    // Должны получить новые цены
    const p2 = getPrices();
    expect(p2.type.tee).toBe(999);
    // Восстановить
    useStore.setState({ prices: PRICES });
    invalidatePricesCache();
  });
});
