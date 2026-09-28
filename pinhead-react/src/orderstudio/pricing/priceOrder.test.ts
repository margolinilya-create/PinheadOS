import { describe, it, expect } from 'vitest';
import { priceOrder, priceItem, fitFormat, DEFAULT_PRICE_RULES } from './priceOrder';
import type { PriceCatalogs, PriceRules } from './priceOrder';
import * as core from '../../utils/pricingCore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesItem } from '../model/types';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';
import type { SkuItem } from '../../types/catalog';

const P = PRICES as core.PricesExt;
const CAT: PriceCatalogs = {
  // Каталог по умолчанию — JS: `fit` там string, а не союз SkuItem
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
};
const SKU = CAT.skuCatalog[2];
const FABRIC = 'medas-kulirnaya-100-160';

/** Позиция: 10 S + 20 M + 10 L, одна модель, одна ткань */
const item = (patch: Partial<SalesItem> = {}): SalesItem => newSalesItem({
  kind: 'sku',
  sku_code: SKU.code,
  fabric_code: FABRIC,
  size_grid: { sizes: ['S', 'M', 'L'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 20, L: 10 } }] },
  ...patch,
});

/** То же изделие в форме состояния визарда — для сверки с прежней формулой */
const wizardState = (over: Record<string, unknown> = {}) => ({
  type: 'tee', fabric: FABRIC, fit: 'regular', sku: SKU,
  sizes: { S: 10, M: 20, L: 10 }, customSizes: [], extras: [],
  zones: [], zoneTechs: {}, zonePrints: {}, labelConfig: null,
  packOption: false, urgentOption: false, ...CAT, ...over,
});

const ceil5 = (v: number) => Math.ceil(v / 5) * 5;

describe('fitFormat — формат листа по мм макета', () => {
  it('наименьший формат, в который макет входит в любой ориентации', () => {
    expect(fitFormat(200, 280)).toEqual({ fmt: 'A4' });
    expect(fitFormat(280, 200)).toEqual({ fmt: 'A4' });
    expect(fitFormat(100, 100)).toEqual({ fmt: 'A6' });
    expect(fitFormat(148, 210)).toEqual({ fmt: 'A5' });
  });
  it('без мм — A4 с пометкой, больше A3 — A3 с пометкой', () => {
    expect(fitFormat(null, 100)).toEqual({ fmt: 'A4', issue: 'print_no_size' });
    expect(fitFormat(500, 500)).toEqual({ fmt: 'A3', issue: 'print_oversize' });
  });
});

describe('priceItem — позиция', () => {
  it('без нанесений: цена = прежняя формула, округлённая вверх до 5 ₽', () => {
    const old = core.calcTotalBreakdown(P, wizardState());
    const r = priceItem(item(), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(r.qty).toBe(40);
    expect(r.cost_unit).toBe(old.cost);
    expect(r.markup_pct).toBe(old.markupPct);
    expect(r.calc_unit).toBe(ceil5(old.unitPrice));
    expect(r.calc_unit % 5).toBe(0);
    expect(r.issues).toEqual([]);
  });

  it('нанесение на весь тираж совпадает с зоной прежней формулы', () => {
    const pr = newSalesPrint({ method: 'silkscreen', width_mm: 200, height_mm: 280, colors: 2 });
    const old = core.calcTotalBreakdown(P, wizardState({
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
    }));
    const r = priceItem(item({ prints: [pr] }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(r.prints[0]).toMatchObject({ qty: 40, unit: old.print });
    expect(r.calc_unit).toBe(ceil5(old.unitPrice));
  });

  it('нанесение на группу размеров считается по тиражу группы', () => {
    const pr = newSalesPrint({ method: 'silkscreen', width_mm: 200, height_mm: 280, sizes: ['S'] });
    const r = priceItem(item({ prints: [pr] }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(r.prints[0].qty).toBe(10);
    expect(r.prints[0].unit).toBe(core.calcZonePriceDirect(P, 'screen', { fmt: 'A4', col: 1 }, 10, FABRIC));
  });

  it('срочность — множитель прайса до округления', () => {
    const plain = priceItem(item(), P, CAT, DEFAULT_PRICE_RULES, false);
    const old = core.calcTotalBreakdown(P, wizardState());
    const urgent = priceItem(item(), P, CAT, DEFAULT_PRICE_RULES, true);
    expect(urgent.calc_unit).toBe(ceil5(old.unitPrice * (1 + (P.urgentMult || 0.2))));
    expect(urgent.calc_unit).toBeGreaterThan(plain.calc_unit);
  });

  it('ручная цена идёт в КП как есть, без округления', () => {
    const r = priceItem(item({ manual_unit_price: 1234 }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(r.manual).toBe(true);
    expect(r.unit).toBe(1234);
    expect(r.total).toBe(1234 * 40);
    expect(r.calc_unit).not.toBe(1234);
  });

  it('ткань клиента — полотно в цену не входит', () => {
    const own = priceItem(item(), P, CAT, DEFAULT_PRICE_RULES, false);
    const client = priceItem(item({ client_fabric: true }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(client.cost_unit).toBeLessThan(own.cost_unit);
  });

  it('сублимация и разработка — без формулы, помечаются', () => {
    const sub = priceItem(item({ prints: [newSalesPrint({ method: 'sublimation' })] }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(sub.issues).toContain('method_unpriced');
    const dev = priceItem(item({ kind: 'dev' }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(dev.issues).toContain('kind_unpriced');
  });

  it('неизвестная модель и пустая сетка — помечаются, не падают', () => {
    const r = priceItem(item({ sku_code: 'NOPE', size_grid: { sizes: [], rows: [] } }), P, CAT, DEFAULT_PRICE_RULES, false);
    expect(r.issues).toEqual(expect.arrayContaining(['no_qty', 'sku_not_found']));
    expect(r.total).toBe(0);
  });
});

describe('priceOrder — заказ', () => {
  const rules = (patch: Partial<PriceRules> = {}): PriceRules => ({ ...DEFAULT_PRICE_RULES, ...patch });

  it('итог — сумма позиций', () => {
    const o = newSalesOrder({ items: [item(), item()] });
    const r = priceOrder(o, P, CAT);
    expect(r.subtotal).toBe(r.items[0].total + r.items[1].total);
    expect(r.total).toBe(r.subtotal);
  });

  it('ставка подготовки — один раз на заказ на технику', () => {
    const scr = () => newSalesPrint({ method: 'silkscreen', width_mm: 100, height_mm: 100 });
    const o = newSalesOrder({ items: [item({ prints: [scr(), scr()] }), item({ prints: [scr()] })] });
    const r = priceOrder(o, P, CAT, rules({ prepFees: { silkscreen: 3000, embroidery: 1500 } }));
    expect(r.prep_total).toBe(3000);
    expect(r.total).toBe(r.subtotal + 3000);
  });

  it('скидка: процент от итога, сумма — не больше итога', () => {
    const base = priceOrder(newSalesOrder({ items: [item()] }), P, CAT);
    const pct = priceOrder(newSalesOrder({ items: [item()], discount: { mode: 'pct', value: 10 } }), P, CAT);
    expect(pct.discount_amount).toBe(Math.round(base.total * 0.1));
    const huge = priceOrder(newSalesOrder({ items: [item()], discount: { mode: 'sum', value: 10 ** 9 } }), P, CAT);
    expect(huge.total).toBe(0);
  });

  it('порог — по итоговой марже, после скидки', () => {
    const o = newSalesOrder({ items: [item()] });
    const r = priceOrder(o, P, CAT, rules({ minMarginPct: 0.1 }));
    expect(r.margin).toBe(r.total - r.cost_total);
    expect(r.below_threshold).toBe(r.margin_pct < 0.1);
    const cut = priceOrder({ ...o, discount: { mode: 'pct', value: 90 } }, P, CAT, rules({ minMarginPct: 0.1 }));
    expect(cut.below_threshold).toBe(true);
    expect(priceOrder(o, P, CAT).below_threshold).toBe(false);
  });

  it('без формулы и без ручной цены — заказ не посчитан; ручная цена снимает', () => {
    const dev = item({ kind: 'dev' });
    expect(priceOrder(newSalesOrder({ items: [dev] }), P, CAT).incomplete).toBe(true);
    expect(priceOrder(newSalesOrder({ items: [{ ...dev, manual_unit_price: 900 }] }), P, CAT).incomplete).toBe(false);
  });

  it('считает по ПЕРЕДАННОМУ прайсу', () => {
    const o = newSalesOrder({ items: [item()] });
    const pricier = { ...P, markupTiers: [1], markupByType: {}, markupDefault: [5] };
    expect(priceOrder(o, pricier, CAT).total).toBeGreaterThan(priceOrder(o, P, CAT).total);
  });
});
