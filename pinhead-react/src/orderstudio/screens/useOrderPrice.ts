/**
 * Живая цена заказа v4: `priceOrder` по прайсу и каталогам стора визарда.
 *
 * Правила цены (ставка подготовки, порог маржи в процентах) — ключи
 * `prices.prepFees` / `prices.minMarginPct` в `app_config`, их правит вкладка
 * «Правила цены» экрана «Справочники заказа» (веха 4); нет ключа —
 * `DEFAULT_PRICE_RULES`.
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
import { SALES_PRINT_METHODS } from '../model/types';

/**
 * Правила цены из прайса. Порог маржи в прайсе — ПРОЦЕНТ (так его вводит
 * «Справочники заказа» и проверяет `prices_patch`: 0–100 или пусто), расчёт
 * сравнивает долю — делим на 100. Подготовка — только методы нанесения v4
 * и числа не меньше 0; всё прочее — как будто ключа нет.
 */
export function rulesFromPrices(P: PricesExt): PriceRules {
  const raw = P.prepFees && typeof P.prepFees === 'object' && !Array.isArray(P.prepFees)
    ? P.prepFees as Record<string, unknown>
    : {};
  const prep: PriceRules['prepFees'] = {};
  for (const m of SALES_PRINT_METHODS) {
    const v = raw[m];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) prep[m] = v;
  }
  const pct = P.minMarginPct;
  const min = typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : null;
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
    // Библиотека бирок (веха 4): цена бирки считается по ней (`salesLabelPrice`),
    // её правка пересчитывает заказ. Упаковка — внутри `prices`, отдельно не нужна
    labelLibrary: s.labelLibrary,
  })));

  const pricer = useMemo(() => makeOrderPricer(cat as unknown as PricerSource), [cat]);

  // Снимок цены при сохранении — тот же расчёт, что видит менеджер.
  // При размонтировании расчёт НЕ снимается: очистка этого эффекта идёт
  // раньше `flush()` карточки (порядок объявления), и сохранение последней
  // правки при уходе уходило с `price_total: null`, затирая сумму в базе.
  // Расчёт чистый (прайс и каталоги), прежний годен до замены новым.
  useEffect(() => {
    useSalesStore.getState().setPricer(pricer);
  }, [pricer]);

  return useMemo(() => (order ? pricer(order) : null), [order, pricer]);
}
