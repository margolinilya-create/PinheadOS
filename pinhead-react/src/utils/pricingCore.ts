// ═══════════════════════════════════════════
// Ядро расчёта цены — без стора (срез 0 Order v4)
// ═══════════════════════════════════════════
/**
 * Та же формула, что в `utils/pricing.ts`, но ЦЕНЫ ПЕРЕДАЮТСЯ ЯВНО первым
 * аргументом. До выноса каждая функция сама звала `getPrices()`, а тот
 * читает `useStore` → localStorage → умолчание: посчитать заказ по чужому
 * прайсу (эталонный заказ, КП по ценам на дату) было нельзя, а модуль
 * тянул за собой весь стор визарда.
 *
 * `utils/pricing.ts` остаётся прежним API для визарда — тонкие обёртки
 * `f(...args) = core.f(getPrices(), ...args)`. Его тесты — регресс выноса:
 * тексты формул здесь перенесены без правок.
 *
 * Модуль НЕ импортирует стор (сторож — `pricingCore.test.ts`).
 */
import { FLEX_MATRIX } from '../data/prices';
import type { Prices, PriceBreakdown } from '../types/pricing';
import type { SkuItem, Fabric, Trim } from '../types/catalog';
import * as cost from './costRules';
import * as prints from './printRules';

// ── Extended Prices type (covers optional fields used at runtime) ──
export interface PricesExt extends Prices {
  packOptions?: { key: string; price: number }[];
  // Dynamic price keys accessed at runtime (screenFx*, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ── State-like object passed to calc functions ──
// Using a loose record since the full store type isn't defined yet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PricingState = Record<string, any>;

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
export interface ZoneCalcParams {
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
  /** Надбавки вышивки: 'metallic' | 'puff' | 'urgent' — суммируются */
  extras?: string[];
  /** Способ вышивки: на крое / на готовом / шевроны */
  mode?: prints.EmbMode;
  /** Условие печати DTG: standard | pocket | zipper */
  placement?: string;
}

const ACCESSORY_TYPES: string[] = ['shopper', 'basecap', 'dad-cap', '5panel', 'socks'];
export const isAccessory = (type: string): boolean => ACCESSORY_TYPES.includes(type);
export const hasNoPrint = (type: string): boolean => type === 'socks';

// Screen printing lookup
const SCREEN_QTY_TIERS: number[] = [50, 100, 300, 500, 700, 1000];
export const SCREEN_MAX_COLORS = 8;
const SMALL_SHEETS = ['A5', 'A6'];
const SCREEN_TEXTILE_MULT = 1.3;
const SCREEN_FUTHER_MULT = 1.5;
const isFutherFabric = (code: string | null | undefined): boolean => /futher/i.test(code || '');

const SCREEN_FX_DEFAULTS: Record<string, number> = prints.SCREEN_FX_MULT;
export const SCREEN_FX: ScreenFxItem[] = [
  { key: 'none', label: 'Нет', mult: 1 },
  { key: 'stone', label: 'К. база', mult: 2 },
  { key: 'puff', label: 'PUFF', mult: 1.5 },
  { key: 'metallic', label: 'Металлик', mult: 1.2 },
  { key: 'fluor', label: 'Флюр', mult: 1.2 },
  { key: 'discharge', label: 'Вытравка', mult: 1.35 },
];

const SCREEN_FX_PRICE_KEYS: Record<string, string> = {
  stone: 'screenFxStoneMult',
  puff: 'screenFxPuffMult',
  metallic: 'screenFxMetallicMult',
  fluor: 'screenFxFluorMult',
  discharge: 'screenFxDischargeMult',
};

function getScreenFxMult(P: PricesExt, fxKey: string | undefined | null): number {
  if (!fxKey || fxKey === 'none') return 1;
  return P[SCREEN_FX_PRICE_KEYS[fxKey]] ?? SCREEN_FX_DEFAULTS[fxKey] ?? 1;
}

/**
 * Шелкография: ставка матрицы × (1 + большая из надбавок «цветной» и «футер»)
 * × коэффициент эффекта. Надбавки не перемножаются (правка 13.10, п. 7).
 */
function screenPrice(P: PricesExt, fmt: string, colors: number, qty: number, textile: string, fabric: string | null | undefined, fx: string | null | undefined): number {
  const base = screenLookup(P, fmt, colors, qty);
  const colored = (P.screenColoredMult || SCREEN_TEXTILE_MULT) - 1;
  const futer = (P.screenFutherMult || SCREEN_FUTHER_MULT) - 1;
  const rate = prints.screenTextileRate(colored, futer, textile === 'color', isFutherFabric(fabric));
  return Math.round(base * (1 + rate) * getScreenFxMult(P, fx));
}

// Flex printing
const FLEX_QTY_TIERS: number[] = [1, 20, 35, 50];
export const FLEX_FORMATS: string[] = ['A6', 'A5', 'A4', 'A3'];
export const FLEX_MAX_COLORS = 3;
const FLEX_SINGLE_PRICE: Record<string, number> = { 'A6': 450, 'A5': 600, 'A4': 750, 'A3': 850 };

export const TECH_TABS: TechTabItem[] = [
  { key: 'screen', label: 'Шелкография' },
  { key: 'flex', label: 'Flex' },
  { key: 'dtg', label: 'DTG' },
  { key: 'embroidery', label: 'Вышивка' },
  { key: 'dtf', label: 'DTF' },
];

/** Форматы листа, мм — общие для DTF и подбора формата по размеру макета */
export const FMT_SIZES: Record<string, { w: number; h: number }> = {
  'A6':  { w: 105, h: 148 },
  'A5':  { w: 148, h: 210 },
  'A4':  { w: 210, h: 297 },
  'A3':  { w: 297, h: 420 },
  'A3+': { w: 329, h: 483 },
};

export function screenLookup(P: PricesExt, format: string, colors: number, qty: number): number {
  // Макет меньше A4 (A5/A6 — формат Order v4 по мм) печатается по ставке A4:
  // своей строки у матрицы нет, и раньше такое нанесение стоило 0 ₽
  const fmt = P.screenMatrix?.[format] ?? (SMALL_SHEETS.includes(format) ? P.screenMatrix?.A4 : undefined);
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(SCREEN_MAX_COLORS, colors));
  const row = fmt[c];
  if (!row) return 0;
  // Ступени — из прайса (редактор показывает именно их), иначе умолчание
  const tiers = Array.isArray(P.screenTiers) && P.screenTiers.length === row.length ? P.screenTiers : SCREEN_QTY_TIERS;
  let tierIdx = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

export function flexLookup(P: PricesExt, format: string, colors: number, qty: number): number {
  // Матрица приходит либо из каталога (Record), либо из константы с ключами
  // A6/A5/A4/A3 — у объединения этих типов нет общей индексной сигнатуры,
  // и strict справедливо не даёт индексировать его строкой.
  const matrix = (P.flexMatrix || FLEX_MATRIX) as Record<string, Record<number, number[]>>;
  const fmt = matrix[format];
  if (!fmt) return 0;
  const c = Math.max(1, Math.min(FLEX_MAX_COLORS, colors));
  if (qty < 20) return (FLEX_SINGLE_PRICE as Record<string, number>)[format] || fmt[1][0];
  const row = fmt[c];
  if (!row) return 0;
  let tierIdx = 0;
  for (let i = FLEX_QTY_TIERS.length - 1; i >= 0; i--) {
    if (qty >= FLEX_QTY_TIERS[i]) { tierIdx = i; break; }
  }
  return row[tierIdx] || row[0];
}

export function screenCalcZone(P: PricesExt, zone: string, state: PricingState): number {
  const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
  const qty = getTotalQty(state) || 1;
  return screenPrice(P, p.size, parseInt(p.colors) || 1, qty, p.textile, state.fabric, p.fx);
}

// Универсальный расчёт наценки за зону по параметрам
// tech: 'screen'|'flex'|'dtg'|'embroidery'|'dtf'
// params: { fmt/size, col/colors, textile, fx }
// qty: тираж, fabric: код ткани (для футерной надбавки screen)
export function calcZonePriceDirect(P: PricesExt, tech: string, params: ZoneCalcParams, qty: number, fabric?: string): number {
  if (tech === 'screen') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(String(params.col || params.colors)) || 1;
    const textile = params.textile || 'white';
    const fx = params.fx || 'none';
    return screenPrice(P, fmt, col, qty, textile, fabric, fx);
  }
  if (tech === 'flex') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(String(params.col || params.colors)) || 1;
    return flexLookup(P, fmt, col, qty);
  }
  if (tech === 'dtg') {
    const fmt = params.fmt || params.size || 'A4';
    const textile = params.textile || 'white';
    // Таблица «размер × текстиль × тираж» × коэффициент условия печати (13.10, п. 9)
    return prints.dtgPrice(P, fmt, textile, qty, params.placement || 'standard');
  }
  if (tech === 'embroidery') {
    // Тариф за 1000 стежков по способу и тиражу, надбавки суммируются (13.10, п. 7)
    const extras = [...(params.extras || []), ...(params.extra ? [params.extra] : [])];
    return prints.embroideryPrice(P, {
      width_mm: params.width_mm || 50,
      height_mm: params.height_mm || 50,
      fill: params.fill ?? 1,
      mode: params.mode,
      extras,
      qty,
    }).unit;
  }
  if (tech === 'dtf') {
    // Раскладка ВСЕГО тиража на плёнке: ступень по непрерывному метражу,
    // к оплате — целые метры (13.10, п. 8). Не помещается в плёнку — 0 и отказ
    // в интерфейсе (`dtfLayout` → null), а не цена по случайной формуле
    const width_mm  = params.width_mm  || FMT_SIZES[params.fmt || params.size || 'A4']?.w || 210;
    const height_mm = params.height_mm || FMT_SIZES[params.fmt || params.size || 'A4']?.h || 297;
    const layout = prints.dtfLayout(dtfPrices(P), width_mm, height_mm, qty);
    return layout ? layout.unit : 0;
  }
  return 0;
}

/** Прайс DTF: новые ключи, иначе прежние (`dtfGap` — тот же припуск, мм) */
export function dtfPrices(P: PricesExt): prints.DtfPrices {
  return {
    dtfSteps: P.dtfSteps,
    dtfTransferPrice: P.dtfTransferPrice ?? 50,
    dtfFilmWidth: P.dtfFilmWidth || 550,
    dtfPad: P.dtfPad ?? P.dtfGap ?? 10,
  };
}

export function getZoneSurcharge(P: PricesExt, zone: string, state: PricingState): number {
  const tech = state.zoneTechs?.[zone] || 'screen';
  const qty = getTotalQty(state) || 1;
  if (tech === 'screen') {
    const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
    return calcZonePriceDirect(P, 'screen', { fmt: p.size, col: p.colors, textile: p.textile, fx: p.fx }, qty, state.fabric);
  }
  if (tech === 'flex') {
    const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
    return calcZonePriceDirect(P, 'flex', { fmt: p.size, col: p.colors }, qty);
  }
  if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || { size: 'A4', textile: 'white' };
    // Зона «Карман» — печать по карману (×1,2); молния — явным выбором в зоне
    const placement = p.placement || (zone === 'pocket' ? 'pocket' : 'standard');
    return calcZonePriceDirect(P, 'dtg', { fmt: p.size, textile: p.textile, placement }, qty);
  }
  if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || {};
    return calcZonePriceDirect(P, 'embroidery', {
      width_mm:  p.width_mm  || 50,
      height_mm: p.height_mm || 50,
      fill:      p.fill      || 1.0,
      extra:     p.extra     || null,
      extras:    p.extras    || [],
      mode:      p.mode      || 'cut',
    }, qty);
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { fmt: 'A4' };
    return calcZonePriceDirect(P, 'dtf', {
      fmt: p.fmt || p.size,
      width_mm: p.width_mm,
      height_mm: p.height_mm,
    }, qty);
  }
  return 0;
}

export function getTotalSurcharge(P: PricesExt, state: PricingState): number {
  if (!state.zones || state.zones.length === 0) return 0;
  return state.zones.reduce((sum: number, z: string) => sum + getZoneSurcharge(P, z, state), 0);
}

export function getTotalQty(state: PricingState): number {
  const stdQty = Object.values(state.sizes || {}).reduce((a: number, b: unknown) => a + (parseInt(String(b)) || 0), 0);
  const customQty = (state.customSizes || []).reduce((a: number, c: { qty: number | string }) => a + (parseInt(String(c.qty)) || 0), 0);
  return stdQty + customQty;
}

/**
 * Себестоимость изделия без обработок, ₽: ткань + отделка + пошив + доп. материалы
 * (× priceMultiplier модели). Разбивка и признак «ткань не найдена» — `skuCostOf`.
 */
export function getSkuEstPrice(sku: SkuItem, fabricCode: string | null, fabricsCatalog: Fabric[], trimCatalog: Trim[], usdRate: number): number {
  return cost.skuCost(sku, { fabricCode, fabricsCatalog, trimCatalog, usdRate }).base;
}

/**
 * «от … ₽» в списке моделей — НИЖНЯЯ цена продажи изделия: себестоимость
 * × накладные × наценка крупнейшей ступени тиража, без срочности, нанесений
 * и обработок. Прежде список показывал себестоимость с копейками («от 398,7 ₽»
 * при цене 1 334 ₽/шт на том же шаге, обход 16.10).
 */
export function getSkuFromPrice(P: PricesExt, sku: SkuItem, fabricCode: string | null, fabricsCatalog: Fabric[], trimCatalog: Trim[], usdRate: number): number {
  const base = getSkuEstPrice(sku, fabricCode, fabricsCatalog, trimCatalog, usdRate);
  const markup = cost.markupFor(P, Number.MAX_SAFE_INTEGER, sku.category, sku);
  return Math.round(cost.garmentSellPrice(P, base, markup, 0));
}

export function skuCostOf(sku: SkuItem, state: PricingState): cost.SkuCost {
  return cost.skuCost(sku, {
    fabricCode: state.fabric || null,
    fabricsCatalog: state.fabricsCatalog || [],
    trimCatalog: state.trimCatalog || [],
    usdRate: state.usdRate,
    extras: state.extras,
    extrasCatalog: state.extrasCatalog,
    trimCode: state.trim || null,
  });
}

/**
 * Бирки, ₽ за штуку — прежние ставки визарда. Читают их Order v4 (`priceOrder`,
 * запасной путь `legacyLabelPrice` для бирки вне библиотеки) и сид библиотеки
 * бирок (`catalog/seeds.ts`). Расчёт бирок визарда v3 по `labelConfig`
 * (`getLabelConfigPrice`) удалён в вехе 8 (задача 4): UI бирок визарда убран
 * в вехе 3, и мёртвое поле буфера не должно менять цену.
 */
const CARE_LABEL_BASE = 10;
const CARE_LOGO_DELTA: Record<string, number> = { 'my-logo': 20, 'no-logo': 0, standard: 0 };
const MAIN_LABEL_PRICE: Record<string, number> = { standard: 30, custom: 45 };
const MAIN_LABEL_MATERIAL_DELTA: Record<string, number> = { woven: 0, polyester: -5, canvas: 10 };
const HANG_TAG_PRICE: Record<string, number> = { standard: 15, custom: 25 };

export function careLabelPrice(logoOption?: string): number {
  return CARE_LABEL_BASE + (CARE_LOGO_DELTA[logoOption ?? ''] || 0);
}

/** `none` и `send-own` (бирка клиента) — бесплатно */
export function mainLabelPrice(option?: string, material?: string): number {
  if (option === 'none' || option === 'send-own') return 0;
  return (MAIN_LABEL_PRICE[option ?? ''] || 0) + (MAIN_LABEL_MATERIAL_DELTA[material ?? ''] || 0);
}

export function hangTagPrice(option?: string): number {
  return HANG_TAG_PRICE[option ?? ''] || 0;
}

/** Упаковка, ₽ за штуку, по виду (`packOptions`: none/bopp/zip); `other` — по договорённости, 0 */
export function packPrice(P: PricesExt, packType: string): number {
  const opt = (P.packOptions || []).find((o: { key: string; price: number }) => o.key === packType);
  return opt ? opt.price : 0;
}

// Наценка по группе изделия (А/Б/В) и тиражу — правка 13.10, п. 6
export function getMarkup(P: PricesExt, qty: number, category: string, sku?: SkuItem | null): number {
  return cost.markupFor(P, qty, category, sku);
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

export function calcTotal(P: PricesExt, state: PricingState, debug = false): number {
  const b = calcTotalBreakdown(P, state);
  if (debug) console.table(b);
  return b.total;
}

/**
 * Цена с разбивкой. Одна функция на обе (`calcTotal` — её итог), чтобы
 * формулы не разъезжались, как было до правки.
 *
 * Изделие с моделью: (ткань + отделка + пошив + доп. материалы + обработки)
 *   × (1 + накладные) × (1 + наценка) × (1 + срочность пошива).
 * Нанесения и упаковка — сверху, без накладных, наценки и срочности
 * (бирки визарда v3 в цене не участвуют с вехи 8; бирки v4 считает `priceOrder`).
 * Без модели (старый путь по типу) — прежняя база без накладных.
 */
export function calcTotalBreakdown(P: PricesExt, state: PricingState): PriceBreakdown {
  const qty = getTotalQty(state);
  const urgentPct = cost.urgentRate(P, state.urgentDays, !!state.urgentOption);
  const empty: PriceBreakdown = {
    cost: 0, markup: 0, markupPct: 0, markedBase: 0, base: 0, extras: 0, print: 0, pack: 0,
    discount: 0, urgent: 0, unitPrice: 0, total: 0, qty: 0,
    fabric: 0, trim: 0, sewing: 0, extraMaterials: 0, overhead: 0, overheadPct: 0, urgentPct, fabricMissing: false,
  };
  if (qty === 0) return empty;

  const category = state.sku?.category || state.type || 'tshirts';
  const markupPct = getMarkup(P, qty, category, state.sku);

  let parts: { fabric: number; trim: number; sewing: number; extraMaterials: number; extras: number; fabricMissing: boolean };
  let costPrice: number;
  let overheadPct: number;
  if (state.sku) {
    const c = skuCostOf(state.sku, state);
    parts = c;
    costPrice = cost.round2(c.base - c.extras * (state.sku.priceMultiplier ?? 1));
    overheadPct = cost.overheadOf(P);
  } else {
    const legacy = (P.type[state.type] || 480)
      + (!isAccessory(state.type) && P.fit ? (P.fit[state.fit || 'regular'] || 0) : 0)
      + (P.fabric[state.fabric] || 0);
    const extras = calcExtrasCost(state.extras, state.extrasCatalog);
    parts = { fabric: 0, trim: 0, sewing: 0, extraMaterials: 0, extras, fabricMissing: false };
    costPrice = legacy;
    overheadPct = 0;
  }
  const mult = state.sku?.priceMultiplier ?? 1;
  const extras = cost.round2(parts.extras * mult);
  const base = costPrice + extras;
  const overhead = cost.round2(base * overheadPct);
  const withOverhead = base + overhead;
  const markupAmount = cost.round2(withOverhead * markupPct);
  const garment = withOverhead + markupAmount;
  const urgent = cost.round2(garment * urgentPct);
  const garmentFinal = Math.round(garment + urgent);

  const print = getTotalSurcharge(P, state);
  const packType = state.packType || (state.packOption ? 'bopp' : 'none');
  const hasOpt = (P.packOptions || []).some((o: { key: string }) => o.key === packType);
  const pack = hasOpt ? packPrice(P, packType) : (state.packOption ? (P.pack || 0) : 0);

  const unitPrice = garmentFinal + print + pack;
  return {
    cost: costPrice, base: costPrice,
    markup: markupAmount, discount: markupAmount, markupPct,
    markedBase: Math.round(garment),
    extras, print, pack,
    urgent: Math.round(urgent), urgentPct,
    unitPrice, total: Math.round(qty * unitPrice), qty,
    fabric: parts.fabric, trim: parts.trim, sewing: parts.sewing, extraMaterials: parts.extraMaterials,
    overhead, overheadPct, fabricMissing: parts.fabricMissing,
  };
}

export function getUnitPrice(P: PricesExt, state: PricingState): number {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;
  return Math.round(calcTotal(P, state) / totalQty);
}
