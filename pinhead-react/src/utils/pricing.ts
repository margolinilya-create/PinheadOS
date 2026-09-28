// ═══════════════════════════════════════════
// Pricing engine — API визарда поверх ядра `pricingCore`
// ═══════════════════════════════════════════
/**
 * Формула живёт в `pricingCore.ts` и принимает цены явно. Здесь — прежние
 * сигнатуры для визарда: каждая обёртка берёт цены из `getPrices()`
 * (стор → localStorage → умолчание) и зовёт ядро. Потребителям визарда
 * и его тестам вынос не виден.
 */
import { PRICES as DEFAULT_PRICES } from '../data';
import { useStore } from '../store/useStore';
import * as core from './pricingCore';
import type { PricesExt, PricingState, ZoneCalcParams } from './pricingCore';
import type { PriceBreakdown } from '../types/pricing';
import type { Fabric, Trim, ExtraItem } from '../types/catalog';

export {
  isAccessory, hasNoPrint, SCREEN_FX, FLEX_FORMATS, FLEX_MAX_COLORS, TECH_TABS,
  getTotalQty, getSkuEstPrice, getLabelConfigPrice, calcExtrasCost,
} from './pricingCore';

// ── Catalogs object for multi-item helpers ──
interface ItemCatalogs {
  fabricsCatalog: Fabric[];
  trimCatalog: Trim[];
  extrasCatalog: ExtraItem[];
  usdRate: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// Приоритет: стор (актуальные) → localStorage → дефолт
let _cachedPrices: PricesExt | null = null;
export function getPrices(): PricesExt {
  if (_cachedPrices) return _cachedPrices;
  // 1) Стор — всегда актуален после сохранения в PriceEditor
  const storePrices = useStore.getState().prices;
  if (storePrices) { _cachedPrices = storePrices as PricesExt; return storePrices as PricesExt; }
  // 2) localStorage — фоллбэк
  try {
    const stored = localStorage.getItem('ph_prices');
    if (stored) {
      _cachedPrices = JSON.parse(stored) as PricesExt;
      return _cachedPrices!;
    }
  } catch { /* ignore */ }
  return DEFAULT_PRICES as PricesExt;
}
// Сбросить кеш (вызывать после сохранения в PriceEditor)
export function invalidatePricesCache(): void {
  _cachedPrices = null;
}

export function screenLookup(format: string, colors: number, qty: number): number {
  return core.screenLookup(getPrices(), format, colors, qty);
}

export function flexLookup(format: string, colors: number, qty: number): number {
  return core.flexLookup(getPrices(), format, colors, qty);
}

export function screenCalcZone(zone: string, state: PricingState): number {
  return core.screenCalcZone(getPrices(), zone, state);
}

export function calcZonePriceDirect(tech: string, params: ZoneCalcParams, qty: number, fabric?: string): number {
  return core.calcZonePriceDirect(getPrices(), tech, params, qty, fabric);
}

export function getZoneSurcharge(zone: string, state: PricingState): number {
  return core.getZoneSurcharge(getPrices(), zone, state);
}

export function getTotalSurcharge(state: PricingState): number {
  return core.getTotalSurcharge(getPrices(), state);
}

// Наценка по тиражу и категории
export function getMarkup(qty: number, category: string): number {
  return core.getMarkup(getPrices(), qty, category);
}

export function calcTotal(state: PricingState, debug = false): number {
  return core.calcTotal(getPrices(), state, debug);
}

// Расчёт с полной разбивкой по компонентам
export function calcTotalBreakdown(state: PricingState): PriceBreakdown {
  return core.calcTotalBreakdown(getPrices(), state);
}

export function getUnitPrice(state: PricingState): number {
  return core.getUnitPrice(getPrices(), state);
}

// ─── Multi-item: расчёт цены одной позиции (из снэпшота item + каталоги) ───
export function calcItemTotal(item: PricingState, catalogs: ItemCatalogs): number {
  const statelike = { ...item, ...catalogs };
  return calcTotal(statelike);
}

export function calcItemBreakdown(item: PricingState, catalogs: ItemCatalogs): PriceBreakdown {
  const statelike = { ...item, ...catalogs };
  return calcTotalBreakdown(statelike);
}

export function getItemUnitPrice(item: PricingState, catalogs: ItemCatalogs): number {
  const statelike = { ...item, ...catalogs };
  return getUnitPrice(statelike);
}

export function getItemTotalQty(item: PricingState): number {
  return core.getTotalQty(item);
}
