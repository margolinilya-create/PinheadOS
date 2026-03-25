// ═══════════════════════════════════════════
// Pricing engine — чистые функции
// ═══════════════════════════════════════════
import { PRICES as DEFAULT_PRICES } from '../data';
import { useStore } from '../store/useStore';

// Приоритет: стор (актуальные) → localStorage → дефолт
let _cachedPrices = null;
export function getPrices() {
  if (_cachedPrices) return _cachedPrices;
  // 1) Стор — всегда актуален после сохранения в PriceEditor
  const storePrices = useStore.getState().prices;
  if (storePrices) { _cachedPrices = storePrices; return storePrices; }
  // 2) localStorage — фоллбэк
  try {
    const stored = localStorage.getItem('ph_prices');
    if (stored) {
      _cachedPrices = JSON.parse(stored);
      return _cachedPrices;
    }
  } catch { /* ignore */ }
  return DEFAULT_PRICES;
}
// Сбросить кеш (вызывать после сохранения в PriceEditor)
export function invalidatePricesCache() {
  _cachedPrices = null;
}

const ACCESSORY_TYPES = ['shopper', 'basecap', 'dad-cap', '5panel', 'socks'];
export const isAccessory = (type) => ACCESSORY_TYPES.includes(type);
export const hasNoPrint = (type) => type === 'socks';

// Screen printing lookup
const SCREEN_QTY_TIERS = [50, 100, 300, 500, 700, 1000];
const SCREEN_MAX_COLORS = 8;
const SCREEN_TEXTILE_MULT = 1.3;
const SCREEN_FUTHER_MULT = 1.5;
const FUTHER_FABRICS = ['futher-350-nachers', 'futher-350-petlya', 'futher-370-nachers', 'futher-370-petlya', 'futher-470-petlya'];

const SCREEN_FX_DEFAULTS = { stone: 2, puff: 2, metallic: 2, fluor: 2 };
const SCREEN_FX = [
  { key: 'none', label: 'Нет', mult: 1 },
  { key: 'stone', label: 'К. база', mult: 2 },
  { key: 'puff', label: 'PUFF', mult: 2 },
  { key: 'metallic', label: 'Металлик', mult: 2 },
  { key: 'fluor', label: 'Флюр', mult: 2 },
];
export { SCREEN_FX };

function getScreenFxMult(fxKey) {
  if (!fxKey || fxKey === 'none') return 1;
  const p = getPrices();
  const priceKeys = { stone: 'screenFxStoneMult', puff: 'screenFxPuffMult', metallic: 'screenFxMetallicMult', fluor: 'screenFxFluorMult' };
  return p[priceKeys[fxKey]] ?? SCREEN_FX_DEFAULTS[fxKey] ?? 1;
}

// Flex printing
const FLEX_QTY_TIERS = [1, 20, 35, 50];
const FLEX_FORMATS = ['A6', 'A5', 'A4', 'A3'];
const FLEX_MAX_COLORS = 3;
const FLEX_SINGLE_PRICE = { 'A6': 450, 'A5': 600, 'A4': 750, 'A3': 850 };
const FLEX_MATRIX = {
  'A6': { 1: [450, 159, 141, 128], 2: [450, 206, 177, 148], 3: [450, 238, 203, 188] },
  'A5': { 1: [600, 238, 203, 172], 2: [600, 285, 244, 204], 3: [600, 316, 270, 227] },
  'A4': { 1: [750, 316, 270, 227], 2: [750, 405, 345, 291], 3: [750, 475, 405, 341] },
  'A3': { 1: [850, 423, 352, 296], 2: [850, 519, 443, 374], 3: [850, 632, 540, 454] },
};
export { FLEX_FORMATS, FLEX_MAX_COLORS };

export const TECH_TABS = [
  { key: 'screen', label: 'Шелкография' },
  { key: 'flex', label: 'Flex' },
  { key: 'dtg', label: 'DTG' },
  { key: 'embroidery', label: 'Вышивка' },
  { key: 'dtf', label: 'DTF' },
];

export function screenLookup(format, colors, qty) {
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

export function flexLookup(format, colors, qty) {
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

export function screenCalcZone(zone, state) {
  const p = state.zonePrints?.[zone] || { colors: 1, size: 'A4', textile: 'white', fx: 'none' };
  const qty = getTotalQty(state) || 1;
  let base = screenLookup(p.size, parseInt(p.colors) || 1, qty);
  if (p.textile === 'color') base = Math.round(base * (getPrices().screenColoredMult || SCREEN_TEXTILE_MULT));
  if (FUTHER_FABRICS.includes(state.fabric)) base = Math.round(base * (getPrices().screenFutherMult || SCREEN_FUTHER_MULT));
  const fxMult = getScreenFxMult(p.fx);
  if (fxMult > 1) base = Math.round(base * fxMult);
  return base;
}

export function flexCalcZone(zone, state) {
  const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
  const qty = getTotalQty(state) || 1;
  return flexLookup(p.size, parseInt(p.colors) || 1, qty);
}

// Универсальный расчёт наценки за зону по параметрам
// tech: 'screen'|'flex'|'dtg'|'embroidery'|'dtf'
// params: { fmt/size, col/colors, textile, fx }
// qty: тираж, fabric: код ткани (для футерной надбавки screen)
export function calcZonePriceDirect(tech, params, qty, fabric) {
  if (tech === 'screen') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(params.col || params.colors) || 1;
    const textile = params.textile || 'white';
    const fx = params.fx || 'none';
    let base = screenLookup(fmt, col, qty);
    if (textile === 'color') base = Math.round(base * (getPrices().screenColoredMult || SCREEN_TEXTILE_MULT));
    if (FUTHER_FABRICS.includes(fabric)) base = Math.round(base * (getPrices().screenFutherMult || SCREEN_FUTHER_MULT));
    const fxMult = getScreenFxMult(fx);
    if (fxMult > 1) base = Math.round(base * fxMult);
    return base;
  }
  if (tech === 'flex') {
    const fmt = params.fmt || params.size || 'A4';
    const col = parseInt(params.col || params.colors) || 1;
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
    const area = params.fmt || params.area || 's';
    const colors = parseInt(params.col || params.colors) || 3;
    return (P.tech.embroidery || 350) + (P.embAreaAdd?.[area] || 0) + Math.max(0, colors - 1) * (P.embColorAdd || 20);
  }
  if (tech === 'dtf') {
    const P = getPrices();
    const fmt = params.fmt || params.size || 'A4';
    return (P.tech.dtf || 180) + (P.dtfFormatAdd?.[fmt] || 0);
  }
  return 0;
}

export function getZoneSurcharge(zone, state) {
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
    const p = state.embZones?.[zone] || { colors: 3, area: 's' };
    return calcZonePriceDirect('embroidery', { fmt: p.area, col: p.colors }, qty);
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { size: 'A4' };
    return calcZonePriceDirect('dtf', { fmt: p.size }, qty);
  }
  return 0;
}

export function getTotalSurcharge(state) {
  if (!state.zones || state.zones.length === 0) return 0;
  return state.zones.reduce((sum, z) => sum + getZoneSurcharge(z, state), 0);
}

export function getTotalQty(state) {
  const stdQty = Object.values(state.sizes || {}).reduce((a, b) => a + (parseInt(b) || 0), 0);
  const customQty = (state.customSizes || []).reduce((a, c) => a + (parseInt(c.qty) || 0), 0);
  return stdQty + customQty;
}

export function getSkuEstPrice(sku, fabricCode, fabricsCatalog, trimCatalog, usdRate) {
  const fabric = fabricCode
    ? fabricsCatalog.find(f => f.code === fabricCode)
    : null;
  const fallbackFabric = fabricsCatalog.find(f =>
    (f.forCategories || []).includes(sku.category));
  const usedFabric = fabric || fallbackFabric;
  const fabricCost = usedFabric ? Math.round(sku.mainFabricUsage * usedFabric.priceUSD * usdRate) : 0;
  const trim = trimCatalog.find(t => t.code === sku.trimCode);
  const trimCost = trim ? Math.round((sku.trimUsage || 0) * trim.priceUSD * usdRate) : 0;
  return (sku.sewingPrice || 0) + fabricCost + trimCost;
}

export function getLabelConfigPrice(labelConfig) {
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
    const prices = { standard: 30, custom: 45 };
    const matDelta = { woven: 0, polyester: -5, canvas: 10 };
    total += (prices[labelConfig.mainLabel.option] || 0) + (matDelta[labelConfig.mainLabel.material] || 0);
  }
  // Hang tag
  if (labelConfig.hangTag?.option !== 'none') {
    const prices = { standard: 15, custom: 25 };
    total += prices[labelConfig.hangTag.option] || 0;
  }
  return total;
}

// Наценка по тиражу и категории
export function getMarkup(qty, category) {
  const P = getPrices();
  const tiers   = P.markupTiers   || [1, 25, 50, 100, 200, 300, 500, 1000];
  const markups = P.markupByType?.[category] || P.markupDefault || [0.70];
  let markup = markups[0] ?? 0.70;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { markup = markups[i] ?? markups[markups.length - 1]; break; }
  }
  return markup;
}

// deprecated — use getMarkup()
export function getVolumeDiscount() {
  return 0;
}

export function calcTotal(state, debug = false) {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;

  let basePrice;
  if (state.sku) {
    basePrice = getSkuEstPrice(state.sku, state.fabric, state.fabricsCatalog, state.trimCatalog, state.usdRate);
  } else {
    const P = getPrices();
    basePrice = (P.type[state.type] || 480)
      + (!isAccessory(state.type) && P.fit ? (P.fit[state.fit || 'regular'] || 0) : 0)
      + (P.fabric[state.fabric] || 0);
  }

  const extrasPrice = (state.extras || []).reduce((sum, code) => {
    const ex = state.extrasCatalog.find(e => e.code === code);
    return sum + (ex ? ex.price : 0);
  }, 0);

  const labelsCost = getLabelConfigPrice(state.labelConfig);
  const printPrice = getTotalSurcharge(state);

  const P = getPrices();
  const packCost = state.packOption ? (P.pack || 0) : 0;

  // Наценка на себестоимость
  const category = state.sku?.category || state.type || 'tshirts';
  const markup = getMarkup(totalQty, category);
  const markedUpBase = Math.round(basePrice * (1 + markup));

  let unitPrice = markedUpBase + extrasPrice + labelsCost + printPrice + packCost;

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
export function calcTotalBreakdown(state) {
  const qty = getTotalQty(state);
  if (qty === 0) return { cost: 0, markup: 0, markupPct: 0, markedBase: 0, base: 0, extras: 0, labels: 0, print: 0, pack: 0, discount: 0, urgent: 0, unitPrice: 0, total: 0, qty: 0 };

  let costPrice;
  if (state.sku) {
    costPrice = getSkuEstPrice(state.sku, state.fabric, state.fabricsCatalog, state.trimCatalog, state.usdRate);
  } else {
    const P = getPrices();
    costPrice = (P.type[state.type] || 480)
      + (!isAccessory(state.type) && P.fit ? (P.fit[state.fit || 'regular'] || 0) : 0)
      + (P.fabric[state.fabric] || 0);
  }

  const extras = (state.extras || []).reduce((sum, code) => {
    const ex = state.extrasCatalog.find(e => e.code === code);
    return sum + (ex ? ex.price : 0);
  }, 0);

  const labels = getLabelConfigPrice(state.labelConfig);
  const print = getTotalSurcharge(state);

  const P = getPrices();
  const pack = state.packOption ? (P.pack || 0) : 0;

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

export function getUnitPrice(state) {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;
  return Math.round(calcTotal(state) / totalQty);
}

// ─── Multi-item: расчёт цены одной позиции (из снэпшота item + каталоги) ───
export function calcItemTotal(item, catalogs) {
  const statelike = { ...item, ...catalogs };
  return calcTotal(statelike);
}

export function calcItemBreakdown(item, catalogs) {
  const statelike = { ...item, ...catalogs };
  return calcTotalBreakdown(statelike);
}

export function getItemUnitPrice(item, catalogs) {
  const statelike = { ...item, ...catalogs };
  return getUnitPrice(statelike);
}

export function getItemTotalQty(item) {
  return getTotalQty(item);
}
