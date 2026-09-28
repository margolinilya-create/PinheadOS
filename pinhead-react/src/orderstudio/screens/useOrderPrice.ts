/**
 * Живая цена заказа v4: `priceOrder` по прайсу и каталогам стора визарда.
 *
 * Правила цены (ставка подготовки, порог маржи) — необязательные ключи
 * `prices.prepFees` / `prices.minMarginPct` в `app_config`; нет ключа —
 * `DEFAULT_PRICE_RULES`. Отдельная таблица правил — следующие срезы.
 */
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { getPrices } from '../../utils/pricing';
import type { PricesExt } from '../../utils/pricingCore';
import { priceOrder, DEFAULT_PRICE_RULES } from '../pricing/priceOrder';
import type { OrderPrice, PriceCatalogs, PriceRules } from '../pricing/priceOrder';
import { useSalesStore } from '../store/useSalesStore';
import type { SalesOrder } from '../model/types';

export function rulesFromPrices(P: PricesExt): PriceRules {
  const prep = P.prepFees && typeof P.prepFees === 'object' ? P.prepFees : {};
  const min = typeof P.minMarginPct === 'number' ? P.minMarginPct : null;
  return { ...DEFAULT_PRICE_RULES, prepFees: prep, minMarginPct: min };
}

export function useOrderPrice(order: SalesOrder | null): OrderPrice | null {
  const cat = useStore(useShallow((s) => ({
    prices: s.prices,
    skuCatalog: s.skuCatalog,
    fabricsCatalog: s.fabricsCatalog,
    trimCatalog: s.trimCatalog,
    extrasCatalog: s.extrasCatalog,
    usdRate: s.usdRate,
  })));

  const pricer = useMemo(() => {
    const P = (cat.prices ?? getPrices()) as PricesExt;
    const catalogs = cat as unknown as PriceCatalogs;
    const rules = rulesFromPrices(P);
    return (o: SalesOrder) => priceOrder(o, P, catalogs, rules);
  }, [cat]);

  // Снимок цены при сохранении — тот же расчёт, что видит менеджер
  useEffect(() => {
    useSalesStore.getState().setPricer(pricer);
    return () => useSalesStore.getState().setPricer(null);
  }, [pricer]);

  return useMemo(() => (order ? pricer(order) : null), [order, pricer]);
}
