// ═══════════════════════════════════════════════════════════════
// pricing-extended.test.js — расширенное покрытие pricing.js
// Покрывает: volume discount, скидка+срочность, calcTotal с SKU,
// screen multipliers, flex из getPrices, boundary conditions
// ═══════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import {
  screenLookup, flexLookup, getVolumeDiscount, getMarkup, calcTotal,
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
    fabric: 'medas-kulirnaya-100-160',
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
// 1. getVolumeDiscount — deprecated, always 0
// ════════════════════════════════════════════════
describe('getVolumeDiscount (deprecated)', () => {
  it('always returns 0', () => {
    expect(getVolumeDiscount(1)).toBe(0);
    expect(getVolumeDiscount(100)).toBe(0);
    expect(getVolumeDiscount(1000)).toBe(0);
  });
});
// ════════════════════════════════════════════════
// 1b. getMarkup — наценка по тиражу и категории
// ════════════════════════════════════════════════
describe('getMarkup', () => {
  // markupTiers: [1, 25, 50, 100, 200, 300, 500, 1000]
  // tshirts:     [0.75, 0.75, 0.70, 0.65, 0.55, 0.50, 0.45, 0.40]
  it('qty=1 → 75% для tshirts', () => {
    expect(getMarkup(1, 'tshirts')).toBeCloseTo(0.75);
  });
  it('qty=24 → 75% (tier 1)', () => {
    expect(getMarkup(24, 'tshirts')).toBeCloseTo(0.75);
  });
  it('qty=25 → 75% (tier 25)', () => {
    expect(getMarkup(25, 'tshirts')).toBeCloseTo(0.75);
  });
  it('qty=50 → 70%', () => {
    expect(getMarkup(50, 'tshirts')).toBeCloseTo(0.70);
  });
  it('qty=100 → 65%', () => {
    expect(getMarkup(100, 'tshirts')).toBeCloseTo(0.65);
  });
  it('qty=200 → 55%', () => {
    expect(getMarkup(200, 'tshirts')).toBeCloseTo(0.55);
  });
  it('qty=300 → 50%', () => {
    expect(getMarkup(300, 'tshirts')).toBeCloseTo(0.50);
  });
  it('qty=500 → 45%', () => {
    expect(getMarkup(500, 'tshirts')).toBeCloseTo(0.45);
  });
  it('qty=1000 → 40%', () => {
    expect(getMarkup(1000, 'tshirts')).toBeCloseTo(0.40);
  });
  it('qty=2000 → 40% (max tier)', () => {
    expect(getMarkup(2000, 'tshirts')).toBeCloseTo(0.40);
  });
  it('hoodies have different markup at qty=50', () => {
    // hoodies: [0.75, 0.70, 0.65, ...]  vs tshirts: [0.75, 0.75, 0.70, ...]
    expect(getMarkup(50, 'hoodies')).toBeCloseTo(0.65);
  });
  it('unknown category uses markupDefault', () => {
    expect(getMarkup(1, 'unknown')).toBeCloseTo(0.75);
    expect(getMarkup(50, 'unknown')).toBeCloseTo(0.65);
  });
});
// ════════════════════════════════════════════════
// 2. calcTotal — наценка за объём
// ════════════════════════════════════════════════
describe('calcTotal — markup', () => {
  it('qty=25 → наценка 75% для tee (type-based)', () => {
    const state = makeState({ sizes: { M: 15, L: 10 } }); // 25 шт
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee']; // 480
    const markup = getMarkup(25, 'tee');
    const markedUp = Math.round(basePrice * (1 + markup));
    expect(total).toBe(25 * markedUp);
  });
  it('qty=100 → наценка снижается', () => {
    const state = makeState({ sizes: { M: 50, L: 50 } }); // 100 шт
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const markup = getMarkup(100, 'tee');
    const markedUp = Math.round(basePrice * (1 + markup));
    expect(total).toBe(100 * markedUp);
  });
  it('наценка НЕ применяется к стоимости печати отдельно', () => {
    const state = makeState({
      sizes: { M: 50, L: 50 }, // 100 шт
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const markup = getMarkup(100, 'tee');
    const markedUp = Math.round(basePrice * (1 + markup));
    const printPrice = screenLookup('A4', 1, 100);
    expect(total).toBe(100 * (markedUp + printPrice));
  });
});
// ════════════════════════════════════════════════
// 3. calcTotal — срочность ПОСЛЕ наценки
// ════════════════════════════════════════════════
describe('calcTotal — urgentOption порядок применения', () => {
  it('срочность считается ПОСЛЕ наценки', () => {
    const state = makeState({
      sizes: { M: 50, L: 50 },
      urgentOption: true,
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const markup = getMarkup(100, 'tee');
    const markedUp = Math.round(basePrice * (1 + markup));
    const urgentSurcharge = markedUp * 0.2;
    const expected = Math.round(100 * (markedUp + urgentSurcharge));
    expect(total).toBe(expected);
  });
  it('срочность с наценкой (qty=10)', () => {
    const state = makeState({
      sizes: { M: 5, L: 5 },
      urgentOption: true,
    });
    const total = calcTotal(state);
    const basePrice = PRICES.type['tee'];
    const markup = getMarkup(10, 'tee');
    const markedUp = Math.round(basePrice * (1 + markup));
    const expected = Math.round(10 * markedUp * 1.20);
    expect(total).toBe(expected);
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
  it('calcTotal с SKU считает через getSkuEstPrice + наценка', () => {
    const state = makeState({
      sku,
      fabric: 'medas-kulirnaya-100-160',
      sizes: { M: 10, L: 10 },
    });
    const total = calcTotal(state);
    const estPrice = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const markup = getMarkup(20, sku.category);
    const markedUp = Math.round(estPrice * (1 + markup));
    expect(total).toBe(20 * markedUp);
  });
  it('разные ткани дают разную цену (т.е. выбор ткани учитывается)', () => {
    const stateA = makeState({
      sku,
      fabric: 'medas-kulirnaya-100-160',
      sizes: { M: 10 },
    });
    const stateB = makeState({
      sku,
      fabric: 'medas-kulirnaya-100-300',
      sizes: { M: 10 },
    });
    const p1 = calcTotal(stateA);
    const p2 = calcTotal(stateB);
    // 300g Кулирка $13.50 дороже 160g $10.90
    expect(p2).toBeGreaterThan(p1);
  });
  it('худи с футером считается дороже футболки с кулиркой', () => {
    const skuHoodie = SKU_CATALOG_DEFAULT.find(s => s.code === 'H-001');
    const stateHoodie = makeState({
      sku: skuHoodie,
      fabric: 'medas-futher-petlya-65-320',
      sizes: { M: 10 },
    });
    const stateTee = makeState({
      sku,
      fabric: 'medas-kulirnaya-100-160',
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
    const p1 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const p2 = getSkuEstPrice(sku, 'medas-kulirnaya-100-300', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    expect(p2).toBeGreaterThan(p1);
  });
  it('fallback на категорию если fabricCode не передан', () => {
    const p1 = getSkuEstPrice(sku, null, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    const p2 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 92);
    // первая ткань категории tshirts = medas-kulirnaya-100-160 → должны совпасть
    expect(p1).toBe(p2);
  });
  it('usdRate влияет на цену', () => {
    const p1 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 80);
    const p2 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 100);
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
      fabric: 'medas-kulirnaya-100-160',
      zones: ['front'],
      zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const futher = getZoneSurcharge('front', makeState({
      sizes: { M: 50, L: 50 },
      fabric: 'medas-futher-nachez-65-320',
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
    const result = calcZonePriceDirect('screen', { fmt: 'A4', col: 2 }, 100, 'medas-kulirnaya-100-160');
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
  it('embroidery: 50x50mm default (stitch pricing)', () => {
    const result = calcZonePriceDirect('embroidery', { width_mm: 50, height_mm: 50, fill: 1.0 }, 50);
    // area=25cm², stitches=7500, price=round(7500/1000*14)=105
    expect(result).toBe(105);
  });
  it('embroidery: larger area = more expensive', () => {
    const small = calcZonePriceDirect('embroidery', { width_mm: 50, height_mm: 50 }, 50);
    const large = calcZonePriceDirect('embroidery', { width_mm: 100, height_mm: 100 }, 50);
    expect(large).toBeGreaterThan(small);
  });
  it('dtf: A3 (film pricing)', () => {
    const result = calcZonePriceDirect('dtf', { fmt: 'A3' }, 50);
    // A3: 297x420mm, cols=floor(550/302)=1, row_h=0.425, cost=(0.425*1400/1)+50=645
    expect(result).toBe(645);
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
