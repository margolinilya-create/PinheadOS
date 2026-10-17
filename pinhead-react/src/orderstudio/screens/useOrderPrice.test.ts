import { describe, it, expect } from 'vitest';
import { rulesFromPrices } from './useOrderPrice';
import { DEFAULT_PRICE_RULES } from '../pricing/priceOrder';
import type { PricesExt } from '../../utils/pricingCore';

const P = (extra: Record<string, unknown>) => extra as unknown as PricesExt;

describe('rulesFromPrices — правила цены из прайса (веха 4)', () => {
  it('нет ключей — правила по умолчанию: порога нет, подготовки нет', () => {
    expect(rulesFromPrices(P({}))).toEqual(DEFAULT_PRICE_RULES);
  });

  it('порог маржи в прайсе — ПРОЦЕНТ (проверка сервера 0–100), в расчёте — доля', () => {
    expect(rulesFromPrices(P({ minMarginPct: 25 })).minMarginPct).toBe(0.25);
    expect(rulesFromPrices(P({ minMarginPct: 0 })).minMarginPct).toBe(0);
    expect(rulesFromPrices(P({ minMarginPct: 12.5 })).minMarginPct).toBe(0.125);
  });

  it('пусто или не число — «не предупреждать»', () => {
    expect(rulesFromPrices(P({ minMarginPct: null })).minMarginPct).toBeNull();
    expect(rulesFromPrices(P({ minMarginPct: '20' })).minMarginPct).toBeNull();
    expect(rulesFromPrices(P({ minMarginPct: Number.NaN })).minMarginPct).toBeNull();
    expect(rulesFromPrices(P({ minMarginPct: 150 })).minMarginPct).toBeNull();
    expect(rulesFromPrices(P({ minMarginPct: -5 })).minMarginPct).toBeNull();
  });

  it('подготовка — только методы нанесения v4 и числа не меньше 0', () => {
    const r = rulesFromPrices(P({
      prepFees: { silkscreen: 1500, embroidery: 800, dtf: '300', bogus: 100, dtg: -1, other: 0 },
    }));
    expect(r.prepFees).toEqual({ silkscreen: 1500, embroidery: 800, other: 0 });
  });

  it('подготовка не объект — ставок нет', () => {
    expect(rulesFromPrices(P({ prepFees: [1, 2] })).prepFees).toEqual({});
    expect(rulesFromPrices(P({ prepFees: null })).prepFees).toEqual({});
  });

  it('шаг округления — прежний', () => {
    expect(rulesFromPrices(P({ minMarginPct: 10 })).roundTo).toBe(DEFAULT_PRICE_RULES.roundTo);
  });
});
