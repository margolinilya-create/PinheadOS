// ═══════════════════════════════════════════
// Себестоимость изделия и отпускная цена без нанесений (правки CRM 13.10)
// ═══════════════════════════════════════════
/**
 * Формула владельца (документ «правки срм», п. 6):
 *   (основная ткань + отделка + пошив + доп. материалы + выбранные обработки)
 *     × (1 + накладные) × (1 + наценка по группе и тиражу) × (1 + срочность пошива)
 * Каждый расход — один раз. Нанесения, бирки и упаковка в эту часть не входят.
 *
 * ЕДИНИЦЫ. До правки ткань хранила `priceUSD` — цену ЗА КИЛОГРАММ, а формула
 * множила её на расход в метрах: кулирка 160 г/м² шла как 10,9 $ × 92 ≈ 1003 ₽/м
 * вместо 307 ₽/м (= 1003 / 3,29 м/кг), изделие дорожало втрое. Теперь цена
 * материала — `priceRub` за единицу `unit` (метр или штука); `mPerKg` хранится
 * для пересчёта при закупке в кг и в цену не входит. `priceUSD` читается
 * только у карточек без `priceRub` (старые данные), как и прежде.
 *
 * Модуль не импортирует стор (как и `pricingCore`).
 */
import type { SkuItem, Fabric, Trim } from '../types/catalog';

export type TrimKind = 'ribana' | 'kashkorse' | 'collar';
export type MarkupGroup = 'A' | 'B' | 'C';

/** Поля прайса, которые читает этот модуль (все необязательны — умолчания ниже) */
export interface CostPrices {
  overhead?: number;
  markupTiers?: number[];
  markupGroups?: Partial<Record<MarkupGroup, number[]>>;
  markupGroupOf?: Record<string, MarkupGroup>;
  markupByType?: Record<string, number[]>;
  markupDefault?: number[];
  urgentByDays?: Record<string, number>;
  urgentMult?: number;
}

export const DEFAULT_OVERHEAD = 0.70;

/** Ступени тиража наценки, шт. Ниже первой ступени — её ставка */
export const MARKUP_TIERS = [25, 50, 100, 200, 300, 500, 1000, 3000, 5000, 10000];

export const MARKUP_GROUPS: Record<MarkupGroup, number[]> = {
  A: [0.90, 0.78, 0.70, 0.55, 0.50, 0.45, 0.40, 0.37, 0.34, 0.30],
  B: [0.85, 0.73, 0.65, 0.55, 0.50, 0.45, 0.40, 0.35, 0.32, 0.29],
  C: [0.95, 0.83, 0.65, 0.60, 0.50, 0.45, 0.40, 0.35, 0.32, 0.29],
};

/**
 * Группа А: футболки, лонгсливы, свитшоты, худи, худи-зипы, халф-зипы,
 * олимпийки, бомберы. Б: поло, регбийки, штаны, шорты. В: шопперы.
 * Олимпийка лежит в категории `polo`, поэтому её группа — полем SKU
 * `markupGroup`, а не по категории.
 */
export const MARKUP_GROUP_OF: Record<string, MarkupGroup> = {
  tshirts: 'A', longsleeves: 'A', sweatshirts: 'A', hoodies: 'A', ziphoodies: 'A',
  halfzips: 'A', bombers: 'A',
  polo: 'B', pants: 'B', shorts: 'B',
  accessories: 'C',
};

/** Срочность пошива: сокращение срока, дней → надбавка */
export const URGENT_BY_DAYS: Record<string, number> = { 5: 0.15, 10: 0.30, 15: 0.50 };
export const URGENT_DAY_OPTIONS = [0, 5, 10, 15] as const;

// ── Материалы ────────────────────────────────────────────────────────────

/** Цена материала за его единицу, ₽; null — цены нет */
export function materialPrice(m: Pick<Fabric, 'priceUSD'> & { priceRub?: number | null } | null | undefined, usdRate: number): number | null {
  if (!m) return null;
  if (typeof m.priceRub === 'number' && m.priceRub > 0) return m.priceRub;
  if (typeof m.priceUSD === 'number' && m.priceUSD > 0) return m.priceUSD * usdRate;
  return null;
}

/** Вид отделки по карточке: поле `kind`, иначе по названию */
export function trimKindOf(t: Pick<Trim, 'name'> & { kind?: TrimKind | null }): TrimKind | null {
  if (t.kind) return t.kind;
  const n = (t.name || '').toLowerCase();
  if (n.includes('воротник')) return 'collar';
  if (n.includes('кашкорсе')) return 'kashkorse';
  if (n.includes('рибана')) return 'ribana';
  return null;
}

/**
 * Отделка изделия. Вид задаёт модель (`trimCode` → его вид): футболкам и
 * лонгам — рибана, худи и свитшотам — кашкорсе, поло — воротник; рибану
 * на кашкорсе не меняем. Поставщик — как у выбранной ткани, если у него
 * есть отделка того же вида; иначе карточка модели как есть.
 * `chosenCode` — отделка, выбранная явно, если она того же вида.
 */
export function resolveTrim(
  sku: Pick<SkuItem, 'trimCode' | 'trimUsage'>, fabric: Fabric | null, trims: Trim[], chosenCode?: string | null,
): Trim | null {
  if (!sku.trimCode || !(sku.trimUsage > 0)) return null;
  const own = trims.find((t) => t.code === sku.trimCode) || null;
  const kind = own ? trimKindOf(own) : null;
  if (chosenCode) {
    const chosen = trims.find((t) => t.code === chosenCode);
    if (chosen && (!kind || trimKindOf(chosen) === kind)) return chosen;
  }
  if (own && kind && fabric?.supplier) {
    // Рибана 1×1 / 2×2 — свои карточки: у своего поставщика модель остаётся при своей
    if (own.supplier !== fabric.supplier) {
      const same = trims.find((t) => t.supplier === fabric.supplier && trimKindOf(t) === kind);
      if (same) return same;
    }
  }
  return own;
}

// ── Себестоимость ───────────────────────────────────────────────────────

export interface SkuCost {
  fabric: number;
  trim: number;
  sewing: number;
  extraMaterials: number;
  extras: number;
  /** Сумма расходов до накладных (× priceMultiplier модели) */
  base: number;
  fabricCode: string | null;
  trimCode: string | null;
  /** Ткань нужна, но не найдена или без цены — стоимость НЕ ноль, а ошибка */
  fabricMissing: boolean;
}

export interface SkuCostInput {
  fabricCode: string | null;
  fabricsCatalog: Fabric[];
  trimCatalog: Trim[];
  usdRate: number;
  extras?: string[] | null;
  extrasCatalog?: { code: string; price: number }[] | null;
  trimCode?: string | null;
}

/** Обработки к оплате: без включённых в цену пошива модели */
export function chargeableExtras(sku: Pick<SkuItem, 'includedExtras'> | null | undefined, extras: string[] | null | undefined): string[] {
  const included = new Set(sku?.includedExtras || []);
  return [...new Set(extras || [])].filter((c) => !included.has(c));
}

export function skuCost(sku: SkuItem, inp: SkuCostInput): SkuCost {
  const fabricCode = inp.fabricCode;
  const chosen = fabricCode ? inp.fabricsCatalog.find((f) => f.code === fabricCode) || null : null;
  const fallback = fabricCode ? null : inp.fabricsCatalog.find((f) => (f.forCategories || []).includes(sku.category)) || null;
  const fabric = chosen || fallback;
  const needsFabric = (sku.mainFabricUsage || 0) > 0;
  const fPrice = materialPrice(fabric, inp.usdRate);
  const fabricMissing = needsFabric && inp.fabricsCatalog.length > 0 && fPrice == null;
  const fabricCost = needsFabric && fPrice != null ? round2(sku.mainFabricUsage * fPrice) : 0;

  const trim = resolveTrim(sku, fabric, inp.trimCatalog, inp.trimCode);
  const tPrice = materialPrice(trim, inp.usdRate);
  const trimCost = trim && tPrice != null ? round2((sku.trimUsage || 0) * tPrice) : 0;

  const sewing = sku.sewingPrice || 0;
  const extraMaterials = sku.extraMaterials || 0;
  const extras = sumExtras(chargeableExtras(sku, inp.extras), inp.extrasCatalog);
  const mult = sku.priceMultiplier ?? 1;
  const base = round2((fabricCost + trimCost + sewing + extraMaterials + extras) * mult);

  return {
    fabric: fabricCost, trim: trimCost, sewing, extraMaterials, extras, base,
    fabricCode: fabric?.code ?? null, trimCode: trim?.code ?? null, fabricMissing,
  };
}

function sumExtras(codes: string[], catalog: { code: string; price: number }[] | null | undefined): number {
  if (!catalog) return 0;
  return codes.reduce((s, c) => s + (catalog.find((e) => e.code === c)?.price || 0), 0);
}

// ── Накладные, наценка, срочность ───────────────────────────────────────

export function overheadOf(P: CostPrices): number {
  return typeof P.overhead === 'number' ? P.overhead : DEFAULT_OVERHEAD;
}

export function markupGroupFor(P: CostPrices, category: string, sku?: Pick<SkuItem, 'markupGroup'> | null): MarkupGroup {
  return sku?.markupGroup || (P.markupGroupOf || MARKUP_GROUP_OF)[category] || 'A';
}

/** Наценка по группе и тиражу. Ниже первой ступени — ставка первой */
export function markupFor(P: CostPrices, qty: number, category: string, sku?: Pick<SkuItem, 'markupGroup'> | null): number {
  // Ступени — из прайса, только если прайс уже знает группы: у старого прайса
  // markupTiers — восемь ступеней прежней сетки, к новым ставкам они не подходят
  const tiers = P.markupTiers && P.markupGroups ? P.markupTiers : MARKUP_TIERS;
  const groups = { ...MARKUP_GROUPS, ...(P.markupGroups || {}) };
  const row = groups[markupGroupFor(P, category, sku)];
  let idx = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (qty >= tiers[i]) { idx = i; break; }
  }
  return row[idx] ?? row[row.length - 1] ?? 0;
}

/**
 * Надбавка за срочный пошив. `days` — на сколько дней сокращён срок;
 * `legacyUrgent` — прежний флажок «срочно» без дней: читается как 5 дней.
 */
export function urgentRate(P: CostPrices, days: number | null | undefined, legacyUrgent = false): number {
  const table = { ...URGENT_BY_DAYS, ...(P.urgentByDays || {}) };
  const d = days && days > 0 ? days : legacyUrgent ? 5 : 0;
  if (!d) return 0;
  return table[String(d)] ?? 0;
}

/** Отпускная цена изделия без нанесений, ₽ за штуку */
export function garmentSellPrice(P: CostPrices, base: number, markup: number, urgent: number, withOverhead = true): number {
  const oh = withOverhead ? overheadOf(P) : 0;
  return round2(base * (1 + oh) * (1 + markup) * (1 + urgent));
}

/** До копеек. Через toFixed: 0,9 × 324,45 = 292,005 в double — 292,00499…, а не 292,01 */
export function round2(v: number): number {
  return Math.round(Number((v * 100).toFixed(6))) / 100;
}
