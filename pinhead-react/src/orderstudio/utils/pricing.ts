// ═══════════════════════════════════════════
// Pricing engine — чистые функции
// ═══════════════════════════════════════════
import { PRICES as DEFAULT_PRICES } from '../../data';
import { FLEX_MATRIX } from '../../data/prices';
import { useStore } from '../store/useStore';
import type { Prices, PriceBreakdown, ScreenMatrix } from '../types/pricing';
import type { SkuItem, Fabric, Trim, ExtraItem } from '../../types/catalog';
import type { LabelConfig, CustomSize } from '../../types/order';

// ── Extended Prices type (covers optional fields used at runtime) ──
interface PricesExt extends Prices {
  packOptions?: { key: string; price: number }[];
  // Dynamic price keys accessed at runtime (screenFx*, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ── State-like object passed to calc functions ──
// Using a loose record since the full store type isn't defined yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PricingState = Record<string, any>;

// ── Screen FX item ──
interface ScreenFxItem {
  key: string;
  label: string;
  mult: number;
}

// ── Tech tab item ──
interface TechTabItem {
  key: string;
  label: string;
}

// ── Zone calc params for calcZonePriceDirect ──
interface ZoneCalcParams {
  fmt?: string;
  size?: string;
  col?: number | string;
  colors?: number | string;
  textile?: string;
  fx?: string;
  width_mm?: number;
  height_mm?: number;
  fill?: number;
  extra?: string | null;
}

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

const ACCESSORY_TYPES: string[] = ['shopper', 'basecap', 'dad-cap', '5panel', 'socks'];
export const isAccessory = (type: string): boolean => ACCESSORY_TYPES.includes(type);
export const hasNoPrint = (type: string): boolean => type === 'socks';

// Screen printing lookup
const SCREEN_QTY_TIERS: number[] = [50, 100, 300, 500, 700, 1000];
const SCREEN_MAX_COLORS = 8;
const SCREEN_TEXTILE_MULT = 1.3;
const SCREEN_FUTHER_MULT = 1.5;
const isFutherFabric = (code: string | null | undefined): boolean => /futher/i.test(code || '');

const SCREEN_FX_DEFAULTS: Record<string, number> = { stone: 2, puff: 2, metallic: 2, fluor: 2 };
const SCREEN_FX: ScreenFxItem[] = [
  { key: 'none', label: 'Нет', mult: 1 },
  { key: 'stone', label: 'К. база', mult: 2 },
  { key: 'puff', label: 'PUFF', mult: 2 },
  { key: 'metallic', label: 'Металлик', mult: 2 },
  { key: 'fluor', label: 'Флюр', mult: 2 },
];
export { SCREEN_FX };

const SCREEN_FX_PRICE_KEYS: Record<string, string> = {
  stone: 'screenFxStoneMult',
  puff: 'screenFxPuffMult',
  metallic: 'screenFxMetallicMult',
  fluor: 'screenFxFluorMult',
};

function getScreenFxMult(fxKey: string | undefined | null): number {
  if (!fxKey || fxKey === 'none') return 1;
  const p = getPrices();
  const priceKeys: Record<string, string> = { stone: 'screenFxStoneMult', puff: 'screenFxPuffMult', metallic: 'screenFxMetallicMult', fluor: 'screenFxFluorMult' };
  return p[priceKeys[fxKey]] ?? SCREEN_FX_DEFAULTS[fxKey] ?? 1;
}

// Flex printing
const FLEX_QTY_TIERS: number[] = [1, 20, 35, 50];
const FLEX_FORMATS: string[] = ['A6', 'A5', 'A4', 'A3'];
const FLEX_MAX_COLORS = 3;
const FLEX_SINGLE_PRICE: Record<string, number> = { 'A6': 450, 'A5': 600, 'A4': 750, 'A3': 850 };
export { FLEX_FORMATS, FLEX_MAX_COLORS };

export const TECH_TABS: TechTabItem[] = [
  { key: 'screen', label: 'Шелкография' },
  { key: 'flex', label: 'Flex' },
  { key: 'dtg', label: 'DTG' },
  { key: 'embroidery', label: 'Вышивка' },
  { key: 'dtf', label: 'DTF' },
];

export function screenLookup(format: string, colors: number, qty: number): number {
  const fmt = getPrices().screenMatrix?.[format];
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(SCREEN_MAX_COLORS, colors));
  const row = fmt[c];
  if (!row) return 0;
  let tierIdx = 0;
  for (let i = SCREEN_QTY_TIERS.length - 1; i >= 0; i--) {
    if (qty >= SCREEN_QTY_TIERS[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

export function flexLookup(format: string, colors: number, qty: number): number {
  const P = getPrices();
  const fmt = (P.flexMatrix || FLEX_MATRIX)[format];
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(FLEX_MAX_COLORS, colors));
  if (qty < 20) return FLEX_SINGLE_PRICE[format] || fmt[1][0];
  const row = fmt[c];
  if (!row) return 0;
  let tierIdx = 0;
  for (let i = FLEX_QTY_TIERS.length - 1; i >= 0; i--) {
    if (qty >= FLEX_QTY_TIERS[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

export function screenCalcZone(zone: string, state: PricingState): number {
  const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
  const qty = getTotalQty(state) || 1;
  let base = screenLookup(p.size, parseInt(p.colors) || 1, qty);
  if (p.textile === 'color') base = Math.round(base * (getPrices().screenColoredMult || SCREEN_TEXTILE_MULT));
  if (isFutherFabric(state.fabric)) base = Math.round(base * (getPrices().screenFutherMult || SCREEN_FUTHER_MULT));
  const fxMult = getScreenFxMult(p.fx);
  if (fxMult > 1) base = Math.round(base * fxMult);
  return base;
}

export function flexCalcZone(zone: string, state: PricingState): number {
  const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
  const qty = getTotalQty(state) || 1;
  return flexLookup(p.size, parseInt(p.colors) || 1, qty);
}

// Универсальный расчёт наценки за зону по параметрам
// tech: 'screen'|'flex'|'dtg'|'embroidery'|'dtf'
// params: { fmt/size, col/colors, textile, fx }
// qty: тираж, fabric: код ткани (для футерной надбавки screen)
export function calcZonePriceDirect(tech: string, params: ZoneCalcParams, qty: number, fabric?: string): number {
  if (tech === 'screen') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(String(params.col || params.colors)) || 1;
    const textile = params.textile || 'white';
    const fx = params.fx || 'none';
    let base = screenLookup(fmt, col, qty);
    if (textile === 'color') base = Math.round(base * (getPrices().screenColoredMult || SCREEN_TEXTILE_MULT));
    if (isFutherFabric(fabric)) base = Math.round(base * (getPrices().screenFutherMult || SCREEN_FUTHER_MULT));
    const fxMult = getScreenFxMult(fx);
    if (fxMult > 1) base = Math.round(base * fxMult);
    return base;
  }
  if (tech === 'flex') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(String(params.col || params.colors)) || 1;
    return flexLookup(fmt, col, qty);
  }
  if (tech === 'dtg') {
    const P = getPrices();
    const fmt = params.fmt || params.size || 'A4';
    const textile = params.textile || 'white';
    return (P.tech.dtg || 280) + (P.dtgFormatAdd?.[fmt] || 0) + (textile === 'color' ? (P.dtgWhiteUnder || 60) : 0);
  }
  if (tech === 'embroidery') {
    const P = getPrices();
    const width_mm  = params.width_mm  || 50;
    const height_mm = params.height_mm || 50;
    const fill      = params.fill      || 1.0;
    const stitchesPerCm2 = P.embStitchesPerCm2 || 300;
    const area_cm2 = (width_mm / 10) * (height_mm / 10);
    const stitches = Math.round(area_cm2 * stitchesPerCm2 * fill);
    const pricePerThousand = P.embPricePerThousand || 14;
    let price = Math.round(stitches / 1000 * pricePerThousand);
    if (params.extra === 'metallic') price = Math.round(price * (P.embMetallicMult || 1.2));
    if (params.extra === 'puff')     price = Math.round(price * (P.embPuffMult || 1.5));
    return Math.max(price, P.embMinPrice || 50);
  }
  if (tech === 'dtf') {
    const P = getPrices();
    const FMT_SIZES: Record<string, { w: number; h: number }> = {
      'A6':  { w: 105, h: 148 },
      'A5':  { w: 148, h: 210 },
      'A4':  { w: 210, h: 297 },
      'A3':  { w: 297, h: 420 },
      'A3+': { w: 329, h: 483 },
    };
    const width_mm  = params.width_mm  || FMT_SIZES[params.fmt || params.size || 'A4']?.w || 210;
    const height_mm = params.height_mm || FMT_SIZES[params.fmt || params.size || 'A4']?.h || 297;
    const gap        = P.dtfGap           || 10;
    const filmW      = P.dtfFilmWidth     || 550;
    const pricePerM  = P.dtfPricePerMeter || 1400;
    const transfer   = P.dtfTransferPrice || 50;
    // Ориентация 1: макет прямо (ширина = width_mm)
    const cols1 = Math.floor(filmW / (width_mm + gap));
    const cost1 = cols1 > 0
      ? (height_mm + gap) / 1000 * pricePerM / cols1
      : Infinity;
    // Ориентация 2: макет повёрнут 90° (ширина = height_mm)
    const cols2 = Math.floor(filmW / (height_mm + gap));
    const cost2 = cols2 > 0
      ? (width_mm + gap) / 1000 * pricePerM / cols2
      : Infinity;
    // Выбираем наиболее выгодную ориентацию
    const bestCost = Math.min(cost1, cost2);
    if (!isFinite(bestCost)) return transfer;
    return Math.round(bestCost + transfer);
  }
  return 0;
}

export function getZoneSurcharge(zone: string, state: PricingState): number {
  const tech = state.zoneTechs?.[zone] || 'screen';
  const qty = getTotalQty(state) || 1;
  if (tech === 'screen') {
    const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
    return calcZonePriceDirect('screen', { fmt: p.size, col: p.colors, textile: p.textile, fx: p.fx }, qty, state.fabric);
  }
  if (tech === 'flex') {
    const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
    return calcZonePriceDirect('flex', { fmt: p.size, col: p.colors }, qty);
  }
  if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || { size: 'A4', textile: 'white' };
    return calcZonePriceDirect('dtg', { fmt: p.size, textile: p.textile }, qty);
  }
  if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || {};
    return calcZonePriceDirect('embroidery', {
      width_mm:  p.width_mm  || 50,
      height_mm: p.height_mm || 50,
      fill:      p.fill      || 1.0,
      extra:     p.extra     || null,
    }, qty);
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { fmt: 'A4' };
    return calcZonePriceDirect('dtf', {
      fmt: p.fmt || p.size,
      width_mm: p.width_mm,
      height_mm: p.height_mm,
    }, qty);
  }
  return 0;
}

export function getTotalSurcharge(state: PricingState): number {
  if (!state.zones || state.zones.length === 0) return 0;
  return state.zones.reduce((sum: number, z: string) => sum + getZoneSurcharge(z, state), 0);
}

export function getTotalQty(state: PricingState): number {
  const stdQty = Object.values(state.sizes || {}).reduce((a: number, b: unknown) => a + (parseInt(String(b)) || 0), 0);
  const customQty = (state.customSizes || []).reduce((a: number, c: { qty: number | string }) => a + (parseInt(String(c.qty)) || 0), 0);
  return stdQty + customQty;
}

export function getSkuEstPrice(sku: SkuItem, fabricCode: string | null, fabricsCatalog: Fabric[], trimCatalog: Trim[], usdRate: number): number {
  const fabric = fabricCode
    ? fabricsCatalog.find(f => f.code === fabricCode)
    : null;
  const fallbackFabric = fabricsCatalog.find(f =>
    (f.forCategories || []).includes(sku.category));
  const usedFabric = fabric || fallbackFabric;
  const fabricCost = usedFabric ? Math.round(sku.mainFabricUsage * usedFabric.priceUSD * usdRate) : 0;
  const trim = trimCatalog.find(t => t.code === sku.trimCode);
  const trimCost = trim ? Math.round((sku.trimUsage || 0) * trim.priceUSD * usdRate) : 0;
  const baseCost = (sku.sewingPrice || 0) + fabricCost + trimCost;
  // Apply per-SKU price multiplier (e.g. 1.1 = +10%)
  const multiplier = sku.priceMultiplier ?? 1;
  return multiplier !== 1 ? Math.round(baseCost * multiplier) : baseCost;
}

export function getLabelConfigPrice(labelConfig: LabelConfig | null | undefined): number {
  if (!labelConfig) return 0;
  let total = 0;
  // Care label
  if (labelConfig.careLabel?.enabled) {
    const opt = [{ key: 'my-logo', delta: 20 }, { key: 'no-logo', delta: 0 }, { key: 'standard', delta: 0 }]
      .find(o => o.key === labelConfig.careLabel.logoOption);
    total += 10 + (opt?.delta || 0);
  }
  // Main label
  if (labelConfig.mainLabel?.option !== 'none' && labelConfig.mainLabel?.option !== 'send-own') {
    const prices: Record<string, number> = { standard: 30, custom: 45 };
    const matDelta: Record<string, number> = { woven: 0, polyester: -5, canvas: 10 };
    total += (prices[labelConfig.mainLabel.option] || 0) + (matDelta[labelConfig.mainLabel.material] || 0);
  }
  // Hang tag
  if (labelConfig.hangTag?.option !== 'none') {
    const prices: Record<string, number> = { standard: 15, custom: 25 };
    total += prices[labelConfig.hangTag.option] || 0;
  }
  return total;
}

// Наценка по тиражу и категории
export function getMarkup(qty: number, category: string): number {
  const P = getPrices();
  const tiers   = P.markupTiers   || [1, 25, 50, 100, 200, 300, 500, 1000];
  const markups = P.markupByType?.[category] || P.markupDefault || [0.70];
  let markup = markups[0] ?? 0.70;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { markup = markups[i] ?? markups[markups.length - 1]; break; }
  }
  return markup;
}

/**
 * Sum extras prices for a list of extra codes.
 */
export function calcExtrasCost(extras: string[] | null | undefined, catalog: { code: string; price: number }[] | null | undefined): number {
  if (!extras || !catalog) return 0;
  return extras.reduce((sum: number, code: string) => {
    const ex = catalog.find(e => e.code === code);
    return sum + (ex ? ex.price : 0);
  }, 0);
}

export function calcTotal(state: PricingState, debug = false): number {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;

  let basePrice: number;
  if (state.sku) {
    basePrice = getSkuEstPrice(state.sku, state.fabric, state.fabricsCatalog, state.trimCatalog, state.usdRate);
  } else {
    const P = getPrices();
    basePrice = (P.type[state.type] || 480)
      + (!isAccessory(state.type) && P.fit ? (P.fit[state.fit || 'regular'] || 0) : 0)
      + (P.fabric[state.fabric] || 0);
  }

  const extrasPrice = calcExtrasCost(state.extras, state.extrasCatalog);

  const labelsCost = getLabelConfigPrice(state.labelConfig);
  const printPrice = getTotalSurcharge(state);

  const P = getPrices();
  const packType = state.packType || (state.packOption ? 'bopp' : 'none');
  const packOpt = (P.packOptions || []).find((o: { key: string; price: number }) => o.key === packType);
  const packCost = packOpt ? packOpt.price : (state.packOption ? (P.pack || 0) : 0);

  // Наценка на себестоимость
  const category = state.sku?.category || state.type || 'tshirts';
  const markup = getMarkup(totalQty, category);
  const markedUpBase = Math.round(basePrice * (1 + markup));

  const unitPrice = markedUpBase + extrasPrice + labelsCost + printPrice + packCost;

  // Срочность считается ПОСЛЕ наценки
  const urgentSurcharge = state.urgentOption
    ? unitPrice * (P.urgentMult || 0.20)
    : 0;

  const total = Math.round(totalQty * (unitPrice + urgentSurcharge));

  if (debug) {
    console.table({
      basePrice, extrasPrice, printPrice, labelsCost, packCost,
      markup: `+${Math.round(markup * 100)}%`,
      markedUpBase, urgentSurcharge: Math.round(urgentSurcharge),
      unitPrice, total,
    });
  }

  return total;
}

// Расчёт с полной разбивкой по компонентам
export function calcTotalBreakdown(state: PricingState): PriceBreakdown {
  const qty = getTotalQty(state);
  if (qty === 0) return { cost: 0, markup: 0, markupPct: 0, markedBase: 0, base: 0, extras: 0, labels: 0, print: 0, pack: 0, discount: 0, urgent: 0, unitPrice: 0, total: 0, qty: 0 };

  let costPrice: number;
  if (state.sku) {
    costPrice = getSkuEstPrice(state.sku, state.fabric, state.fabricsCatalog, state.trimCatalog, state.usdRate);
  } else {
    const P = getPrices();
    costPrice = (P.type[state.type] || 480)
      + (!isAccessory(state.type) && P.fit ? (P.fit[state.fit || 'regular'] || 0) : 0)
      + (P.fabric[state.fabric] || 0);
  }

  const extras = calcExtrasCost(state.extras, state.extrasCatalog);

  const labels = getLabelConfigPrice(state.labelConfig);
  const print = getTotalSurcharge(state);

  const P = getPrices();
  const packType = state.packType || (state.packOption ? 'bopp' : 'none');
  const packOpt = (P.packOptions || []).find((o: { key: string; price: number }) => o.key === packType);
  const pack = packOpt ? packOpt.price : (state.packOption ? (P.pack || 0) : 0);

  const category = state.sku?.category || state.type || 'tshirts';
  const markupPct = getMarkup(qty, category);
  const markupAmount = markupPct > 0 ? Math.round(costPrice * markupPct) : 0;
  const markedBase = Math.round(costPrice * (1 + markupPct));

  const unitBeforeUrgent = markedBase + extras + labels + print + pack;
  const urgentAmount = state.urgentOption
    ? Math.round(unitBeforeUrgent * (P.urgentMult || 0.20))
    : 0;
  const unitPrice = unitBeforeUrgent + urgentAmount;
  const total = Math.round(qty * (unitBeforeUrgent + (state.urgentOption ? unitBeforeUrgent * (P.urgentMult || 0.20) : 0)));

  return { cost: costPrice, markup: markupAmount, markupPct, markedBase, base: costPrice, extras, labels, print, pack, discount: markupAmount, urgent: urgentAmount, unitPrice, total, qty };
}

export function getUnitPrice(state: PricingState): number {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;
  return Math.round(calcTotal(state) / totalQty);
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
  return getTotalQty(item);
}
