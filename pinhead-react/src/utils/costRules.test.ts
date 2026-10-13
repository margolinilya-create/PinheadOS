import { describe, it, expect } from 'vitest';
import * as cost from './costRules';
import * as core from './pricingCore';
import { PRICES } from '../data/prices';
import { SKU_CATALOG_DEFAULT } from '../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../data/extras';
import type { SkuItem } from '../types/catalog';

/** Контрольные примеры документа «правки срм» (13.10) */
const P = PRICES as core.PricesExt;
const SKUS = SKU_CATALOG_DEFAULT as unknown as SkuItem[];
const sku = (code: string) => SKUS.find((s) => s.code === code)!;
const inp = (fabricCode: string | null, over: Partial<cost.SkuCostInput> = {}): cost.SkuCostInput => ({
  fabricCode, fabricsCatalog: FABRICS_CATALOG_DEFAULT, trimCatalog: TRIM_CATALOG_DEFAULT,
  usdRate: 92.7, extras: [], extrasCatalog: EXTRAS_CATALOG_DEFAULT, ...over,
});

describe('единицы материала', () => {
  it('цена за метр в рублях главнее старой цены в $; $ — × курс', () => {
    expect(cost.materialPrice({ priceRub: 307.12, priceUSD: 10.9 }, 92.7)).toBe(307.12);
    expect(cost.materialPrice({ priceUSD: 2 }, 92.7)).toBeCloseTo(185.4, 6);
    expect(cost.materialPrice({ priceUSD: 0 }, 92.7)).toBeNull();
  });

  it('прежняя цена была за кг: 10,9 $ × 92,70 / 3,29 м/кг = 307,12 ₽/м', () => {
    const f = FABRICS_CATALOG_DEFAULT.find((x) => x.code === 'medas-kulirnaya-100-160')!;
    expect(cost.round2(10.9 * 92.7 / f.mPerKg!)).toBe(f.priceRub);
  });
});

describe('себестоимость изделия', () => {
  it('Composite bag: саржа «Зенит» 0,9 м × 324,45 = 292,01 ₽ за изделие', () => {
    const c = cost.skuCost(sku('BAG-002'), inp(null));
    expect(c.fabricCode).toBe('zenit-sarzha-100-270');
    expect(c.fabric).toBe(292.01);
    expect(c.trim).toBe(0);
  });

  it('футболка: рибана ВЫБРАННОГО поставщика, без замены на кашкорсе', () => {
    const c = cost.skuCost(sku('T-003'), inp('tonitex-kulirnaya-100-180'));
    expect(c.trimCode).toBe('ribana-tonitex');
    expect(c.trim).toBe(cost.round2(0.02 * 450.78));
  });

  it('худи: кашкорсе выбранного поставщика (ТониТекс 645,78 ₽/м)', () => {
    const c = cost.skuCost(sku('H-001'), inp('tonitex-futher-100-340'));
    expect(c.trimCode).toBe('kashkorse-tonitex');
    expect(c.trim).toBe(cost.round2(0.2 * 645.78));
  });

  it('у своего поставщика модель остаётся при своей рибане 1×1', () => {
    expect(cost.skuCost(sku('T-003'), inp('medas-kulirnaya-100-180')).trimCode).toBe('ribana-1x1');
  });

  it('поло: воротник в штуках по цене поставщика ткани; доп. материалы — отдельной строкой', () => {
    const cotton = cost.skuCost(sku('PL-001'), inp('cotton-pike-100-215'));
    expect(cotton.trimCode).toBe('collar-cotton');
    expect(cotton.trim).toBe(37.1);
    expect(cotton.extraMaterials).toBe(37.08);
    const toni = cost.skuCost(sku('PL-001'), inp('tonitex-kulirnaya-100-180'));
    expect(toni.trimCode).toBe('collar-tonitex');
    expect(toni.trim).toBe(49.2);
  });

  it('пошив олимпийки и бомберов — по документу', () => {
    expect(sku('OL-001').sewingPrice).toBe(285.9);
    expect(sku('BM-001').sewingPrice).toBe(550);
    expect(sku('BM-002').sewingPrice).toBe(550);
  });

  it('обработка, включённая в цену пошива, не начисляется второй раз', () => {
    const polo = { ...sku('PL-001'), includedExtras: ['double-stitch'] };
    const once = cost.skuCost(polo, inp('cotton-pike-100-215', { extras: ['double-stitch', 'hanger-loop'] }));
    expect(once.extras).toBe(15); // только петля
  });

  it('ткань не найдена — ошибка, а не нулевая стоимость', () => {
    const c = cost.skuCost(sku('T-003'), inp('no-such-fabric'));
    expect(c.fabricMissing).toBe(true);
    expect(c.fabric).toBe(0);
  });
});

describe('накладные и наценка', () => {
  it('отпускная без нанесений: расходы × 1,70 × (1 + наценка)', () => {
    expect(cost.garmentSellPrice(P, 100, 0.65, 0)).toBe(280.5);
  });

  it('группы А/Б/В по тиражу', () => {
    expect(cost.markupFor(P, 25, 'tshirts')).toBe(0.90);
    expect(cost.markupFor(P, 25, 'polo')).toBe(0.85);
    expect(cost.markupFor(P, 25, 'accessories')).toBe(0.95);
    expect(cost.markupFor(P, 100, 'accessories')).toBe(0.65);
    expect(cost.markupFor(P, 10000, 'hoodies')).toBe(0.30);
    expect(cost.markupFor(P, 10000, 'pants')).toBe(0.29);
    expect(cost.markupFor(P, 10, 'tshirts')).toBe(0.90); // ниже первой ступени — её ставка
  });

  it('олимпийка в категории polo — группа А', () => {
    expect(cost.markupFor(P, 25, 'polo', sku('OL-001'))).toBe(0.90);
  });

  it('старый прайс без групп не ломает ступени', () => {
    const old = { markupTiers: [1, 25, 50, 100, 200, 300, 500, 1000] };
    expect(cost.markupFor(old, 100, 'tshirts')).toBe(0.70);
  });
});

describe('срочность пошива', () => {
  it('5 / 10 / 15 дней → 15 / 30 / 50 %; прежний флажок = 5 дней', () => {
    expect(cost.urgentRate(P, 5)).toBe(0.15);
    expect(cost.urgentRate(P, 10)).toBe(0.30);
    expect(cost.urgentRate(P, 15)).toBe(0.50);
    expect(cost.urgentRate(P, 0, true)).toBe(0.15);
    expect(cost.urgentRate(P, 0)).toBe(0);
  });

  it('надбавка — после накладных и наценки, к нанесению не добавляется', () => {
    const base = {
      sku: sku('T-003'), fabric: 'medas-kulirnaya-100-160', sizes: { M: 100 }, customSizes: [],
      extras: [], zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
      fabricsCatalog: FABRICS_CATALOG_DEFAULT, trimCatalog: TRIM_CATALOG_DEFAULT,
      extrasCatalog: EXTRAS_CATALOG_DEFAULT, usdRate: 92.7,
    };
    const plain = core.calcTotalBreakdown(P, base);
    const urgent = core.calcTotalBreakdown(P, { ...base, urgentDays: 10 });
    expect(urgent.print).toBe(plain.print);
    expect(Math.abs(urgent.urgent - plain.markedBase * 0.3)).toBeLessThanOrEqual(1);
  });
});
