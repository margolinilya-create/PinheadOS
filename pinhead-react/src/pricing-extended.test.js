// ═══════════════════════════════════════════════════════════════
// pricing-extended.test.js — расширенное покрытие pricing.js
// Покрывает: volume discount, скидка+срочность, calcTotal с SKU,
// screen multipliers, flex из getPrices, boundary conditions
// ═══════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import { skuCost } from './utils/costRules';
import {
  screenLookup, flexLookup, getMarkup, calcTotal,
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
// 1. getMarkup — наценка по тиражу и категории
// ════════════════════════════════════════════════
describe('getMarkup', () => {
  // Правка 13.10: группы А/Б/В × ступени 25…10000; ниже 25 — ставка первой ступени
  it.each([
    [1, 0.90], [24, 0.90], [25, 0.90], [50, 0.78], [100, 0.70], [200, 0.55], [300, 0.50],
    [500, 0.45], [1000, 0.40], [3000, 0.37], [5000, 0.34], [10000, 0.30], [20000, 0.30],
  ])('группа А (футболки): %i шт. → %f', (qty, rate) => {
    expect(getMarkup(qty, 'tshirts')).toBeCloseTo(rate);
  });
  it('худи — та же группа А', () => {
    expect(getMarkup(50, 'hoodies')).toBeCloseTo(0.78);
  });
  it('поло, штаны — группа Б; шопперы — группа В', () => {
    expect(getMarkup(50, 'polo')).toBeCloseTo(0.73);
    expect(getMarkup(100, 'pants')).toBeCloseTo(0.65);
    expect(getMarkup(50, 'accessories')).toBeCloseTo(0.83);
  });
  it('неизвестная категория — группа А', () => {
    expect(getMarkup(1, 'unknown')).toBeCloseTo(0.90);
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
    // Прежний флажок = 5 дней: +15 % к изделию, после наценки (правка 13.10)
    const expected = 100 * Math.round(basePrice * (1 + markup) * 1.15);
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
    const expected = 10 * Math.round(basePrice * (1 + markup) * 1.15);
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
    // × 1,70 накладных (правка 13.10)
    expect(total).toBe(20 * Math.round(estPrice * 1.7 * (1 + markup)));
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
  it('рублёвые цены курсом не пересчитываются; старая карточка в $ — пересчитывается', () => {
    const p1 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 80);
    const p2 = getSkuEstPrice(sku, 'medas-kulirnaya-100-160', FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, 100);
    expect(p2).toBe(p1);
    const legacy = [{ code: 'old', name: 'x', supplier: '', composition: '', density: null, priceUSD: 3, forCategories: ['tshirts'] }];
    const l1 = getSkuEstPrice(sku, 'old', legacy, TRIM_CATALOG_DEFAULT, 80);
    const l2 = getSkuEstPrice(sku, 'old', legacy, TRIM_CATALOG_DEFAULT, 100);
    expect(l2).toBeGreaterThan(l1);
  });
  it('неизвестный fabricCode → ошибка «ткань не найдена», а не подмена другой тканью', () => {
    const c = skuCost(sku, { fabricCode: 'nonexistent-fabric', fabricsCatalog: FABRICS_CATALOG_DEFAULT, trimCatalog: TRIM_CATALOG_DEFAULT, usdRate: 92 });
    expect(c.fabricMissing).toBe(true);
    expect(c.fabric).toBe(0);
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
    expect(result).toBe(400); // таблица DTG 13.10: А4 белый, 50–99 шт.
  });
  it('dtg: A4, color — своя строка таблицы', () => {
    const color = calcZonePriceDirect('dtg', { fmt: 'A4', textile: 'color' }, 50);
    expect(color).toBe(500);
  });
  it('embroidery: 50x50mm default (stitch pricing)', () => {
    const result = calcZonePriceDirect('embroidery', { width_mm: 50, height_mm: 50, fill: 1.0 }, 50);
    // 25 см² × 300 = 7500 стежков; на крое, 50–99 шт. → 15 ₽/1000 = 112,5
    expect(result).toBe(112.5);
  });
  it('embroidery: larger area = more expensive', () => {
    const small = calcZonePriceDirect('embroidery', { width_mm: 50, height_mm: 50 }, 50);
    const large = calcZonePriceDirect('embroidery', { width_mm: 100, height_mm: 100 }, 50);
    expect(large).toBeGreaterThan(small);
  });
  it('dtf: A3 (film pricing)', () => {
    const result = calcZonePriceDirect('dtf', { fmt: 'A3' }, 50);
    // повёрнутый 430×307: 1 в ряд, 3 в метре → 17 м; непрерывно 50 × 0,307 = 15,35 м → 1400 ₽/м
    // (17 × 1400 + 50 × 50) / 50 = 526
    expect(result).toBe(526);
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
