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

type PricerSource = PriceCatalogs & { prices?: unknown };

/**
 * Расчёт цены заказа по прайсу и каталогам стора визарда. Вне хука — для
 * «Оформить как заказ v4»: первое сохранение нового заказа уходит до того,
 * как карточка смонтируется и поставит свой расчёт.
 */
export function makeOrderPricer(src: PricerSource): (o: SalesOrder) => OrderPrice {
  const P = (src.prices ?? getPrices()) as PricesExt;
  const rules = rulesFromPrices(P);
  return (o: SalesOrder) => priceOrder(o, P, src, rules);
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

  const pricer = useMemo(() => makeOrderPricer(cat as unknown as PricerSource), [cat]);

  // Снимок цены при сохранении — тот же расчёт, что видит менеджер
  useEffect(() => {
    useSalesStore.getState().setPricer(pricer);
    return () => useSalesStore.getState().setPricer(null);
  }, [pricer]);

  return useMemo(() => (order ? pricer(order) : null), [order, pricer]);
}
