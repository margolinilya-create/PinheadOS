import { describe, it, expect } from 'vitest';
import * as pr from './printRules';
import * as core from './pricingCore';
import { PRICES } from '../data/prices';

/** Нанесения по документу «правки срм» (13.10), пп. 7–9 */
const P = PRICES as core.PricesExt;

describe('DTF', () => {
  it('контроль документа: 25 × 25 см, 75 шт. → 13 м по 1500 ₽, 310 ₽/шт., 23 250 ₽', () => {
    const l = pr.dtfLayout(core.dtfPrices(P), 250, 250, 75)!;
    expect(l.cols).toBe(2);
    expect(l.perMeter).toBe(6);
    expect(l.billedMeters).toBe(13);
    expect(l.ratePerM).toBe(1500);
    expect(l.total).toBe(23250);
    expect(l.unit).toBe(310);
    expect(core.calcZonePriceDirect(P, 'dtf', { width_mm: 250, height_mm: 250 }, 75)).toBe(310);
  });

  it('ступень — по непрерывному метражу', () => {
    expect(pr.dtfRate({}, 10.99)).toBe(1500);
    expect(pr.dtfRate({}, 11)).toBe(1400);
    expect(pr.dtfRate({}, 50.99)).toBe(1100);
    expect(pr.dtfRate({}, 51)).toBe(900);
    expect(pr.dtfRate({}, 101)).toBe(800);
  });

  it('макет, не помещающийся в плёнку 55 см, блокирует расчёт', () => {
    expect(pr.dtfLayout(core.dtfPrices(P), 600, 600, 10)).toBeNull();
    expect(core.calcZonePriceDirect(P, 'dtf', { width_mm: 600, height_mm: 600 }, 10)).toBe(0);
  });

  it('проверяются обе ориентации', () => {
    // 540 × 100: прямо — 1 в ряд, 9 рядов в метре; повёрнуто не помещается
    const l = pr.dtfLayout(core.dtfPrices(P), 540, 100, 9)!;
    expect(l.billedMeters).toBe(1);
  });
});

describe('DTG', () => {
  it('ставка таблицы по размеру, текстилю и тиражу', () => {
    expect(pr.dtgPrice(P, 'A6', 'white', 1)).toBe(350);
    expect(pr.dtgPrice(P, 'A4', 'color', 50)).toBe(500);
    expect(pr.dtgPrice(P, '40x45', 'color', 100)).toBe(600);
  });

  it('печать по карману или молнии — × 1,2', () => {
    expect(pr.dtgPrice(P, 'A4', 'color', 50, 'pocket')).toBe(600);
    expect(pr.dtgPrice(P, 'A4', 'white', 1, 'zipper')).toBe(690);
  });

  it('размер по мм макета: А4 — 20 × 30, А3 — 30 × 41 см', () => {
    expect(pr.dtgFitSize(200, 300)).toBe('A4');
    expect(pr.dtgFitSize(300, 200)).toBe('A4');
    expect(pr.dtgFitSize(300, 410)).toBe('A3');
    expect(pr.dtgFitSize(410, 450)).toBeNull();
  });
});

describe('вышивка', () => {
  it('тариф по способу и тиражу, надбавки суммируются', () => {
    // 10 000 стежков (≈ 33,3 см²), готовое изделие, 100 шт. → 16 ₽/1000; металлик + пуф = +75 %
    const r = pr.embroideryPrice(P, { width_mm: 100, height_mm: 100 / 3, mode: 'garment', extras: ['metallic', 'puff'], qty: 100 });
    expect(r.stitches).toBe(10000);
    expect(r.rate).toBe(16);
    expect(r.surcharge).toBeCloseTo(0.75, 6);
    expect(r.unit).toBe(280);
  });

  it('на крое дешевле готового; шевроны — по ставке готового', () => {
    const q = { width_mm: 100, height_mm: 100 / 3, qty: 1000 };
    expect(pr.embroideryPrice(P, { ...q, mode: 'cut' }).unit).toBe(50);
    expect(pr.embroideryPrice(P, { ...q, mode: 'garment' }).unit).toBe(80);
    expect(pr.embroideryPrice(P, { ...q, mode: 'patch' }).unit).toBe(80);
  });

  it('ниже 50 шт. — отметка «согласовать», минимума по умолчанию нет', () => {
    const r = pr.embroideryPrice(P, { width_mm: 10, height_mm: 10, qty: 10 });
    expect(r.belowMin).toBe(true);
    expect(r.unit).toBe(4.5); // 1 см² × 300 = 300 стежков × 15 ₽/1000
  });
});

describe('шелкография', () => {
  it('цветной текстиль на футере — большая надбавка (50 %), не произведение', () => {
    const base = core.calcZonePriceDirect(P, 'screen', { fmt: 'A4', col: 1, textile: 'white' }, 100, 'medas-kulirnaya-100-160');
    const both = core.calcZonePriceDirect(P, 'screen', { fmt: 'A4', col: 1, textile: 'color' }, 100, 'medas-futher-diag-65-320');
    expect(both).toBe(Math.round(base * 1.5));
  });

  it('эффект — после надбавки: вытравка × 1,35', () => {
    const base = core.calcZonePriceDirect(P, 'screen', { fmt: 'A4', col: 1, textile: 'color' }, 100, '');
    const fx = core.calcZonePriceDirect(P, 'screen', { fmt: 'A4', col: 1, textile: 'color', fx: 'discharge' }, 100, '');
    expect(fx).toBe(Math.round(core.screenLookup(P, 'A4', 1, 100) * 1.3 * 1.35));
    expect(fx).toBeGreaterThan(base);
  });

  it('макет меньше A4 печатается по ставке A4, а не за 0 ₽', () => {
    expect(core.screenLookup(P, 'A5', 1, 100)).toBe(core.screenLookup(P, 'A4', 1, 100));
    expect(core.screenLookup(P, 'B7', 1, 100)).toBe(0);
  });
});
