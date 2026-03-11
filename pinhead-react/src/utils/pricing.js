// ═══════════════════════════════════════════
// Pricing engine — чистые функции
// ═══════════════════════════════════════════
import { PRICES } from '../data';

const ACCESSORY_TYPES = ['shopper', 'basecap', 'dad-cap', '5panel', 'socks'];
export const isAccessory = (type) => ACCESSORY_TYPES.includes(type);
export const hasNoPrint = (type) => type === 'socks';

// Screen printing lookup
const SCREEN_QTY_TIERS = [50, 100, 300, 500, 700, 1000];
const SCREEN_MATRIX = PRICES.screenMatrix;
const SCREEN_MAX_COLORS = 8;
const SCREEN_TEXTILE_MULT = 1.3;
const SCREEN_FUTHER_MULT = 1.5;
const FUTHER_FABRICS = ['futher-350-nachers', 'futher-350-petlya', 'futher-370-nachers', 'futher-370-petlya', 'futher-470-petlya'];

const SCREEN_FX = [
  { key: 'none', label: 'Нет', mult: 1 },
  { key: 'stone', label: 'К. база', mult: 2 },
  { key: 'puff', label: 'PUFF', mult: 2 },
  { key: 'metallic', label: 'Металлик', mult: 2 },
  { key: 'fluor', label: 'Флюр', mult: 2 },
];
export { SCREEN_FX };

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
  const fmt = SCREEN_MATRIX[format];
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
  const fmt = FLEX_MATRIX[format];
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
  if (p.textile === 'color') base = Math.round(base * SCREEN_TEXTILE_MULT);
  if (FUTHER_FABRICS.includes(state.fabric)) base = Math.round(base * SCREEN_FUTHER_MULT);
  const fx = SCREEN_FX.find(f => f.key === (p.fx || 'none'));
  if (fx && fx.mult > 1) base = Math.round(base * fx.mult);
  return base;
}

export function flexCalcZone(zone, state) {
  const p = state.flexZones?.[zone] || { colors: 1, size: 'A4' };
  const qty = getTotalQty(state) || 1;
  return flexLookup(p.size, parseInt(p.colors) || 1, qty);
}

export function getZoneSurcharge(zone, state) {
  const tech = state.zoneTechs?.[zone] || 'screen';
  if (tech === 'screen') return screenCalcZone(zone, state);
  if (tech === 'flex') return flexCalcZone(zone, state);
  if (tech === 'dtg') {
    const p = state.dtgZones?.[zone] || { size: 'A4', textile: 'white' };
    return (PRICES.tech.dtg || 280) + (PRICES.dtgFormatAdd?.[p.size] || 0) + (p.textile === 'color' ? (PRICES.dtgWhiteUnder || 60) : 0);
  }
  if (tech === 'embroidery') {
    const p = state.embZones?.[zone] || { colors: 3, area: 's' };
    const colors = parseInt(p.colors) || 3;
    return (PRICES.tech.embroidery || 350) + (PRICES.embAreaAdd?.[p.area] || 0) + Math.max(0, colors - 1) * (PRICES.embColorAdd || 20);
  }
  if (tech === 'dtf') {
    const p = state.dtfZones?.[zone] || { size: 'A4' };
    return (PRICES.tech.dtf || 180) + (PRICES.dtfFormatAdd?.[p.size] || 0);
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

export function getSkuEstPrice(sku, fabricsCatalog, trimCatalog, usdRate) {
  const fabric = fabricsCatalog.find(f => (f.forCategories || []).includes(sku.category));
  const fabricCost = fabric ? Math.round(sku.mainFabricUsage * fabric.priceUSD * usdRate) : 0;
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

// Скидка за объём тиража
export function getVolumeDiscount(qty) {
  const tiers = PRICES.volumeTiers || [];
  const discounts = PRICES.volumeDiscounts || [];
  let discount = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { discount = discounts[i] || 0; break; }
  }
  return discount;
}

export function calcTotal(state) {
  const totalQty = getTotalQty(state);
  if (totalQty === 0) return 0;

  let base;
  if (state.sku) {
    base = getSkuEstPrice(state.sku, state.fabricsCatalog, state.trimCatalog, state.usdRate);
  } else {
    base = (PRICES.type[state.type] || 480)
      + (!isAccessory(state.type) && PRICES.fit ? (PRICES.fit[state.fit || 'regular'] || 0) : 0)
      + (PRICES.fabric[state.fabric] || 0);
  }

  // Применяем скидку за объём к базовой стоимости
  const volumeDiscount = getVolumeDiscount(totalQty);
  base = Math.round(base * (1 - volumeDiscount));

  const extrasCost = (state.extras || []).reduce((sum, code) => {
    const ex = state.extrasCatalog.find(e => e.code === code);
    return sum + (ex ? ex.price : 0);
  }, 0);

  const labelsCost = getLabelConfigPrice(state.labelConfig);
  const techSurcharge = getTotalSurcharge(state);
  let unitPrice = Math.round(base + extrasCost + labelsCost + techSurcharge);

  if (state.packOption) unitPrice += PRICES.pack || 0;
  const urgentMult = state.urgentOption ? (PRICES.urgentMult || 0) : 0;

  return Math.round(totalQty * unitPrice * (1 + urgentMult));
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

export function getItemUnitPrice(item, catalogs) {
  const statelike = { ...item, ...catalogs };
  return getUnitPrice(statelike);
}

export function getItemTotalQty(item) {
  return getTotalQty(item);
}
