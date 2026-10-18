// ═══════════════════════════════════════════
// Нанесения по правкам CRM 13.10: шелкография, вышивка, DTF, DTG
// ═══════════════════════════════════════════
/**
 * Чистые функции, прайс — аргументом (как в `pricingCore`). Таблицы-умолчания
 * здесь же: прайс в базе может не иметь новых ключей, и тогда работают они.
 */

// ── Шелкография ─────────────────────────────────────────────────────────

export const SCREEN_FX_MULT: Record<string, number> = {
  none: 1, stone: 2, puff: 1.5, metallic: 1.2, fluor: 1.2, discharge: 1.35,
};

/**
 * Надбавка за текстиль: цветной 30 %, футер 3-нитка 50 %, белый 0 %.
 * Совпали оба условия — берётся БОЛЬШАЯ, не сумма и не произведение.
 */
export function screenTextileRate(colored: number, futer: number, isColored: boolean, isFuter: boolean): number {
  return Math.max(isColored ? colored : 0, isFuter ? futer : 0);
}

// ── Вышивка ─────────────────────────────────────────────────────────────

export type EmbMode = 'cut' | 'garment' | 'patch';

export const EMB_MODE_LABELS: Record<EmbMode, string> = {
  cut: 'На крое и полотне',
  garment: 'На готовом изделии',
  patch: 'Шевроны (нашивки)',
};

/** Шелкография — тираж от 50 шт: меньше — по согласованию (экспресс и рабочее место, обход M-4) */
export const SCREEN_MIN_QTY = 50;

/** Тиражи вышивки: 50–99, 100–499, 500–999, от 1000. Ниже 50 — по согласованию */
export const EMB_TIERS = [50, 100, 500, 1000];

/** ₽ за 1000 стежков по способу и ступени тиража */
export const EMB_RATES: Record<EmbMode, number[]> = {
  cut: [15, 11, 7, 5],
  garment: [21, 16, 11, 8],
  patch: [21, 16, 11, 8],
};

/** Надбавки суммируются: срочность + металлизированная нить + пуф */
export const EMB_SURCHARGES: Record<string, number> = { urgent: 0.50, metallic: 0.35, puff: 0.40 };

export interface EmbPrices {
  embStitchesPerCm2?: number;
  embTiers?: number[];
  embRates?: Partial<Record<EmbMode, number[]>>;
  embSurcharges?: Record<string, number>;
  /** Минимум за нанесение по способу, ₽; 0/нет — без минимума (владелец впишет) */
  embMinByMode?: Partial<Record<EmbMode, number>>;
}

export interface EmbInput {
  width_mm: number;
  height_mm: number;
  fill?: number;
  mode?: EmbMode;
  extras?: string[];
  qty: number;
}

export interface EmbResult {
  stitches: number;
  rate: number;
  surcharge: number;
  unit: number;
  /** Тираж ниже 50 — тариф согласовать отдельно (цена — по первой ступени) */
  belowMin: boolean;
}

export function embroideryPrice(P: EmbPrices, inp: EmbInput): EmbResult {
  const perCm2 = P.embStitchesPerCm2 || 300;
  const area = (inp.width_mm / 10) * (inp.height_mm / 10);
  const stitches = Math.round(area * perCm2 * (inp.fill ?? 1));
  const mode: EmbMode = inp.mode || 'cut';
  const tiers = P.embTiers || EMB_TIERS;
  const rates = { ...EMB_RATES, ...(P.embRates || {}) }[mode];
  let idx = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (inp.qty >= tiers[i]) { idx = i; break; }
  }
  const rate = rates[idx] ?? rates[0];
  const table = { ...EMB_SURCHARGES, ...(P.embSurcharges || {}) };
  const surcharge = [...new Set(inp.extras || [])].reduce((s, k) => s + (table[k] || 0), 0);
  const raw = (stitches / 1000) * rate * (1 + surcharge);
  const min = P.embMinByMode?.[mode] || 0;
  return {
    stitches, rate, surcharge,
    unit: Math.round(Math.max(raw, min) * 100) / 100,
    belowMin: inp.qty < tiers[0],
  };
}

// ── DTF ────────────────────────────────────────────────────────────────

/** Ступени ₽/м по НЕПРЕРЫВНОМУ расчётному метражу: [от, цена] */
export const DTF_STEPS: [number, number][] = [
  [0, 1500], [11, 1400], [21, 1300], [31, 1200], [41, 1100], [51, 900], [101, 800],
];

export interface DtfPrices {
  dtfSteps?: [number, number][];
  dtfTransferPrice?: number;
  /** Ширина плёнки, мм */
  dtfFilmWidth?: number;
  /** Припуск к КАЖДОЙ стороне макета для раскладки, мм */
  dtfPad?: number;
}

export interface DtfLayout {
  /** Макетов в ряду поперёк плёнки */
  cols: number;
  /** Высота ряда с припуском, мм */
  rowMm: number;
  /** Макетов на 1 погонный метр (целые ряды в метре) */
  perMeter: number;
  /** Непрерывный расчётный метраж — по нему ступень цены */
  meters: number;
  /** Оплачиваемые погонные метры — вверх до целого */
  billedMeters: number;
  ratePerM: number;
  transfer: number;
  total: number;
  /** Цена за одно нанесение (плёнка + перенос), ₽ */
  unit: number;
}

export function dtfRate(P: DtfPrices, meters: number): number {
  const steps = P.dtfSteps || DTF_STEPS;
  let rate = steps[0][1];
  for (const [from, price] of steps) if (meters >= from) rate = price;
  return rate;
}

/**
 * Раскладка тиража на плёнке. Обе ориентации, берётся дешёвая. Макет,
 * который не помещается в плёнку ни в одной ориентации, — null: расчёт
 * блокируется, цена не подставляется.
 *
 * Контроль из документа: 25×25 см, 75 шт. → 26×26 с припуском, 2 в ряд,
 * 3 ряда в метре = 6 макетов/м → 13 оплачиваемых метров; непрерывно
 * 38 рядов × 0,26 = 9,88 м → ступень 1500 ₽/м; 13 × 1500 + 75 × 50 = 23 250 ₽.
 */
export function dtfLayout(P: DtfPrices, width_mm: number, height_mm: number, qty: number): DtfLayout | null {
  const film = P.dtfFilmWidth || 550;
  const pad = P.dtfPad ?? 10;
  const transfer = P.dtfTransferPrice ?? 50;
  const n = Math.max(1, Math.floor(qty) || 1);
  const variants: DtfLayout[] = [];
  for (const [w, h] of [[width_mm, height_mm], [height_mm, width_mm]]) {
    const cw = w + pad;
    const rowMm = h + pad;
    const cols = Math.floor(film / cw);
    if (cols < 1 || rowMm <= 0) continue;
    const perMeter = cols * Math.floor(1000 / rowMm);
    const rows = Math.ceil(n / cols);
    const meters = Math.round(rows * rowMm) / 1000;
    // Оплачиваемые метры — по фактической раскладке в метре; ряд выше метра — по непрерывному
    const billedMeters = perMeter > 0 ? Math.ceil(n / perMeter) : Math.ceil(meters);
    const ratePerM = dtfRate(P, meters);
    const total = billedMeters * ratePerM + n * transfer;
    variants.push({ cols, rowMm, perMeter, meters, billedMeters, ratePerM, transfer, total, unit: Math.round(total / n * 100) / 100 });
  }
  if (variants.length === 0) return null;
  return variants.reduce((a, b) => (b.total < a.total ? b : a));
}

// ── DTG ────────────────────────────────────────────────────────────────

export interface DtgSize { key: string; label: string; w: number; h: number }

/** Размеры DTG, мм (А4 — 20×30 см, А3 — 30×41 см) */
export const DTG_SIZES: DtgSize[] = [
  { key: 'A6', label: 'А6 (10×15 см)', w: 100, h: 150 },
  { key: 'A5', label: 'А5 (15×20 см)', w: 150, h: 200 },
  { key: 'A4', label: 'А4 (20×30 см)', w: 200, h: 300 },
  { key: 'A3', label: 'А3 (30×41 см)', w: 300, h: 410 },
  { key: '40x45', label: '40×45 см', w: 400, h: 450 },
];

export const DTG_TIERS = [1, 10, 20, 35, 50, 100];

/** ₽ за нанесение: размер → текстиль → ступень тиража */
export const DTG_TABLE: Record<string, { white: number[]; color: number[] }> = {
  A6: { white: [350, 320, 300, 250, 200, 150], color: [450, 420, 400, 350, 300, 200] },
  A5: { white: [450, 420, 400, 350, 300, 200], color: [575, 550, 500, 450, 400, 300] },
  A4: { white: [575, 550, 500, 450, 400, 300], color: [750, 700, 650, 600, 500, 400] },
  A3: { white: [750, 700, 650, 600, 500, 400], color: [850, 800, 750, 700, 600, 500] },
  '40x45': { white: [850, 800, 750, 700, 600, 500], color: [1050, 1000, 900, 800, 700, 600] },
};

/** Условие печати: стандарт 1, по карманам 1,2, по молниям 1,2 */
export const DTG_PLACEMENT_MULT: Record<string, number> = { standard: 1, pocket: 1.2, zipper: 1.2 };

export interface DtgPrices {
  dtgTiers?: number[];
  dtgTable?: Record<string, { white: number[]; color: number[] }>;
  dtgPlacementMult?: Record<string, number>;
}

/** Старые форматы визарда → размеры DTG: A3+ ближе всего к 40×45 */
const DTG_FMT_ALIAS: Record<string, string> = { 'A3+': '40x45', Max: '40x45' };

export function dtgSizeKey(fmt: string | null | undefined): string {
  const f = fmt || 'A4';
  return DTG_FMT_ALIAS[f] || f;
}

/** Наименьший размер DTG, в который входит макет (любая ориентация); null — больше 40×45 */
export function dtgFitSize(width_mm: number | null, height_mm: number | null): string | null {
  if (!width_mm || !height_mm) return null;
  const [a, b] = [Math.min(width_mm, height_mm), Math.max(width_mm, height_mm)];
  for (const s of DTG_SIZES) {
    if (a <= Math.min(s.w, s.h) && b <= Math.max(s.w, s.h)) return s.key;
  }
  return null;
}

export function dtgPrice(P: DtgPrices, sizeKey: string, textile: string, qty: number, placement: string = 'standard'): number {
  const table = { ...DTG_TABLE, ...(P.dtgTable || {}) };
  const row = table[dtgSizeKey(sizeKey)] || table.A4;
  const prices = textile === 'color' ? row.color : row.white;
  const tiers = P.dtgTiers || DTG_TIERS;
  let idx = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { idx = i; break; }
  }
  const mult = { ...DTG_PLACEMENT_MULT, ...(P.dtgPlacementMult || {}) }[placement] ?? 1;
  return Math.round((prices[idx] ?? prices[0]) * mult * 100) / 100;
}
