/**
 * Цена заказа Order v4 (v4 §4.8, срез 0) — поверх ядра `utils/pricingCore`.
 *
 * Формула позиции (правка CRM 13.10 — одна с визардом, `utils/costRules`):
 * (ткань + отделка + пошив + доп. материалы + обработки) × (1 + накладные)
 * × (1 + наценка по группе и тиражу ПОЗИЦИИ) × (1 + срочность пошива)
 * + нанесения. Бланк и давальческое — без накладных и без срочности пошива.
 * Нового v4 добавляет на уровне заказа:
 * - нанесение считается по тиражу СВОЕЙ группы размеров (`SalesPrint.sizes`),
 *   а не всей позиции: шелкография на 30 шт. из 100 стоит по ступени 30;
 * - формат шелкографии/флекса/DTG выводится из мм макета (`fitFormat`) —
 *   в v4 менеджер вводит мм, а матрица цен знает форматы листа;
 * - цена за единицу округляется ВВЕРХ до `roundTo` (5 ₽) — эта цена уходит
 *   в КП и в ERP (v4 §0 п. 14); ручная цена не округляется;
 * - срочность пошива — по дням сокращения срока, только к изделию, не к нанесениям;
 * - ставка подготовки (формы, программа) — один раз на заказ на технику;
 * - скидка заказа (% или сумма) — после всего;
 * - порог — по ИТОГОВОЙ марже заказа (v4 §0 п. 6).
 *
 * Маржа здесь — то, что формула знает: выручка минус себестоимость изделия
 * и прайсовая стоимость нанесений, обработок и подготовки. Себестоимости
 * нанесений у прайса нет, поэтому маржа = наценка + округление + срочность
 * − скидка ± ручные цены. Это допущение до эталонных заказов (срез 0, п. 1).
 */
import * as core from '../../utils/pricingCore';
import * as cost from '../../utils/costRules';
import * as printRules from '../../utils/printRules';
import type { PricesExt } from '../../utils/pricingCore';
import type { SkuItem, Fabric, Trim } from '../../types/catalog';
import { gridQty } from '../model/factory';
import type { SalesItem, SalesLabel, SalesOrder, SalesPrint, SalesPrintMethod } from '../model/types';
import type { LabelLibrary } from '../catalog/types';
import { libraryLabelPrice } from '../catalog/labels';
import { itemPackaging } from '../model/packaging';
import { tzRowOfZone, zoneOfPrint } from '../catalog/tzRows';

export interface PriceCatalogs {
  skuCatalog: SkuItem[];
  fabricsCatalog: Fabric[];
  trimCatalog: Trim[];
  extrasCatalog: { code: string; price: number }[];
  usdRate: number;
  /**
   * Справочники заказа (веха 4). Бирки — по библиотеке `labelLibrary`
   * (`salesLabelPrice`; нет библиотеки, вида или варианта — прежний расчёт).
   * Упаковка отдельного поля не имеет: цена идёт из прайса (`prices.packOptions`
   * → `core.packPrice`), смена прайса и так пересчитывает заказ.
   */
  labelLibrary?: LabelLibrary;
  /**
   * Справочник зон (веха 8): карман DTG — по `zone_id` нанесения и строке ТЗ зоны
   * (`tzRowOfZone`); нет справочника — строка по умолчанию кода
   */
  zonesCatalog?: readonly { id: string; name?: string; tz_row?: string }[];
}

export interface PriceRules {
  /** Шаг округления цены единицы вверх, ₽ (v4: 5) */
  roundTo: number;
  /** Ставка подготовки на заказ по технике; нет ключа — ставки нет */
  prepFees: Partial<Record<SalesPrintMethod, number>>;
  /** Порог итоговой маржи, доля (0.25 = 25 %); null — порог не задан */
  minMarginPct: number | null;
}

export const DEFAULT_PRICE_RULES: PriceRules = { roundTo: cost.UNIT_PRICE_STEP, prepFees: {}, minMarginPct: null };

export type PriceIssue =
  | 'no_qty'            // сетка пуста
  | 'sku_not_found'     // код модели не найден в прайс-каталоге
  | 'kind_unpriced'     // тип позиции без формулы (разработка) — нужна ручная цена
  | 'method_unpriced'   // техника без конструктора цен (сублимация, шевроны, прочее)
  | 'print_no_size'     // у нанесения нет мм — посчитано по A4
  | 'print_oversize'    // макет больше A3 — посчитано по A3
  | 'print_too_big'     // DTF: макет не помещается в плёнку — расчёт заблокирован
  | 'fabric_not_found'  // ткань не найдена или без цены — не ноль, а ошибка
  | 'emb_low_qty';      // вышивка меньше 50 шт. — тариф согласовать отдельно

export interface PrintPrice {
  key: string;
  method: SalesPrintMethod;
  qty: number;
  /** Цена нанесения за штуку (по ступени тиража группы) */
  unit: number;
}

export interface ItemPrice {
  key: string;
  qty: number;
  /** Себестоимость изделия за штуку (ткань + пошив + отделка / бланк) */
  cost_unit: number;
  /** Наценка по тиражу позиции, доля */
  markup_pct: number;
  prints: PrintPrice[];
  /** Бирки за штуку — по библиотеке бирок (`salesLabelPrice`) */
  labels_unit: number;
  /** Упаковка за штуку — по виду позиции или заказа (`packPrice`) */
  pack_unit: number;
  /** Расчётная цена за штуку со срочностью, округлённая вверх */
  calc_unit: number;
  /** Цена за штуку в КП: ручная, если задана, иначе расчётная */
  unit: number;
  total: number;
  manual: boolean;
  /** Прайсовая стоимость без наценки за всю позицию — база маржи */
  cost_total: number;
  issues: PriceIssue[];
}

export interface OrderPrice {
  items: ItemPrice[];
  subtotal: number;
  prep_total: number;
  discount_amount: number;
  total: number;
  cost_total: number;
  margin: number;
  /** Доля маржи в итоге; 0 при нулевом итоге */
  margin_pct: number;
  below_threshold: boolean;
  /** Есть позиция, которую формула не посчитала, а ручной цены нет */
  incomplete: boolean;
}

// ── формат листа по мм макета ─────────────────────────────────────────────

const SHEET_FORMATS = ['A6', 'A5', 'A4', 'A3'] as const;

/** Наименьший формат, в который макет входит (в любой ориентации) */
export function fitFormat(width: number | null, height: number | null): { fmt: string; issue?: PriceIssue } {
  if (!width || !height) return { fmt: 'A4', issue: 'print_no_size' };
  const [a, b] = [Math.min(width, height), Math.max(width, height)];
  for (const f of SHEET_FORMATS) {
    const { w, h } = core.FMT_SIZES[f];
    if (a <= w && b <= h) return { fmt: f };
  }
  return { fmt: 'A3', issue: 'print_oversize' };
}

/**
 * Шелкография знает форматы больше A3 — A3+ и Max (матрица цен, визард).
 * Прежде всё больше A3 считалось по A3 с пометкой, а Max при переносе из
 * визарда (у него нет мм) становился A4 вовсе без пометки: −39 % к цене.
 * Макет больше A3+ — это Max.
 */
export const SCREEN_MAX_MM = { w: 400, h: 500 };

export function screenFormat(width: number | null, height: number | null): { fmt: string; issue?: PriceIssue } {
  const sheet = fitFormat(width, height);
  if (sheet.issue !== 'print_oversize') return sheet;
  const [a, b] = [Math.min(width!, height!), Math.max(width!, height!)];
  const plus = core.FMT_SIZES['A3+'];
  return a <= plus.w && b <= plus.h ? { fmt: 'A3+' } : { fmt: 'Max' };
}

/** Надбавки вышивки — `special` списком через «+» (визард их суммирует) */
export function embroideryExtras(special: string): string[] {
  return (special || '').split('+').filter((x) => x === 'metallic' || x === 'puff');
}


/**
 * Нанесение по карману (веха 8, К5): с кодом зоны — строка ТЗ зоны справочника
 * «Карман» (переименование зоны цену не меняет); без кода (строки до вехи 8,
 * свободный текст) — по названию, как прежде
 */
export function isPocketPrint(print: SalesPrint, zones: PriceCatalogs['zonesCatalog'] = []): boolean {
  if (print.zone_id) return tzRowOfZone(zoneOfPrint(print, zones ?? [])) === 'pocket';
  return /карман|pocket/i.test(print.zone || '');
}

/** Цена одного нанесения за штуку; null — у техники нет конструктора цен */
function printUnitPrice(
  P: PricesExt, print: SalesPrint, qty: number, fabricCode: string, embMode: printRules.EmbMode = 'cut',
  zones: PriceCatalogs['zonesCatalog'] = [],
): { unit: number | null; issue?: PriceIssue } {
  const { fmt, issue } = fitFormat(print.width_mm, print.height_mm);
  const w = print.width_mm ?? undefined;
  const h = print.height_mm ?? undefined;
  switch (print.method) {
    case 'silkscreen': {
      const sf = screenFormat(print.width_mm, print.height_mm);
      return { unit: core.calcZonePriceDirect(P, 'screen', { fmt: sf.fmt, col: print.colors, textile: print.textile, fx: print.special || 'none' }, qty, fabricCode), issue: sf.issue };
    }
    case 'heat_transfer':
      return { unit: core.calcZonePriceDirect(P, 'flex', { fmt, col: print.colors }, qty), issue };
    case 'dtg': {
      // Размеры DTG свои (А4 — 20×30, А3 — 30×41, 40×45 см): подбор по мм макета
      const size = w && h ? printRules.dtgFitSize(w, h) : 'A4';
      // Печать по карману — × 1,2: по коду зоны, без кода — по названию («Карман»)
      const placement = isPocketPrint(print, zones) ? 'pocket' : 'standard';
      return {
        unit: core.calcZonePriceDirect(P, 'dtg', { fmt: size || '40x45', textile: print.textile, placement }, qty),
        issue: !w || !h ? 'print_no_size' : size ? undefined : 'print_oversize',
      };
    }
    case 'embroidery': {
      const extras = embroideryExtras(print.special);
      return {
        unit: core.calcZonePriceDirect(P, 'embroidery', { width_mm: w, height_mm: h, fill: print.fill, extras, mode: embMode }, qty),
        issue: !w || !h ? 'print_no_size' : qty < (P.embTiers?.[0] ?? printRules.EMB_TIERS[0]) ? 'emb_low_qty' : undefined,
      };
    }
    case 'dtf': {
      if (!w || !h) return { unit: core.calcZonePriceDirect(P, 'dtf', {}, qty), issue: 'print_no_size' };
      const layout = printRules.dtfLayout(core.dtfPrices(P), w, h, qty);
      return layout ? { unit: layout.unit } : { unit: null, issue: 'print_too_big' };
    }
    default:
      return { unit: null, issue: 'method_unpriced' };
  }
}

/** Себестоимость изделия (без обработок) и категория наценки по типу позиции */
function garmentCost(
  item: SalesItem, cat: PriceCatalogs,
): { cost: number; extras: number; category: string; sku: SkuItem | null; issue?: PriceIssue } {
  switch (item.kind) {
    case 'sku': {
      const sku = cat.skuCatalog.find((s) => s.code === item.sku_code);
      if (!sku) return { cost: 0, extras: 0, category: 'tshirts', sku: null, issue: 'sku_not_found' };
      // Ткань клиента — полотно бесплатно: пустой каталог гасит и выбранную ткань, и запасную
      const fabrics = item.client_fabric ? [] : cat.fabricsCatalog;
      const c = cost.skuCost(sku, {
        fabricCode: item.fabric_code || null, fabricsCatalog: fabrics, trimCatalog: cat.trimCatalog,
        usdRate: cat.usdRate, extras: item.extras, extrasCatalog: cat.extrasCatalog,
      });
      const mult = sku.priceMultiplier ?? 1;
      const extras = cost.round2(c.extras * mult);
      return {
        cost: cost.round2(c.base - extras), extras, category: sku.category, sku,
        issue: c.fabricMissing ? 'fabric_not_found' : undefined,
      };
    }
    case 'blank':
      return { cost: item.blank_price ?? 0, extras: core.calcExtrasCost(item.extras, cat.extrasCatalog), category: 'blank', sku: null };
    case 'customer':
      // Давальческое: изделие клиента, считаются только нанесения и обработки
      return { cost: 0, extras: core.calcExtrasCost(item.extras, cat.extrasCatalog), category: 'customer', sku: null };
    default:
      return { cost: 0, extras: 0, category: 'dev', sku: null, issue: 'kind_unpriced' };
  }
}

/**
 * Бирка v4 → цена за штуку. Источник — библиотека бирок (`labelLibrary`,
 * веха 4): вариант + надбавка материала (`catalog/labels`). Библиотеки нет
 * или она не знает вида или варианта — прежний расчёт по ставкам визарда
 * (`legacyLabelPrice`); сид библиотеки повторяет его на всех комбинациях.
 */
export function salesLabelPrice(
  label: Pick<SalesLabel, 'label_type' | 'variant_id'>, library?: LabelLibrary | null,
): number {
  return libraryLabelPrice(library, label) ?? legacyLabelPrice(label);
}

/**
 * Прежний расчёт (до библиотеки). Вариант — `variant_id`: составник — логотип
 * (`my-logo` / `no-logo` / `standard`), основная — `вариант[:материал]`
 * (`standard`, `custom:canvas`, `send-own` — бирка клиента), хэнгтег —
 * `standard` / `custom`. Без варианта — стандартная, как в визарде по
 * умолчанию. Остальные типы ставки у визарда не имеют.
 */
export function legacyLabelPrice(label: Pick<SalesLabel, 'label_type' | 'variant_id'>): number {
  const [variant, material] = (label.variant_id || '').split(':');
  switch (label.label_type) {
    case 'composition': return core.careLabelPrice(variant || 'standard');
    case 'brand': return core.mainLabelPrice(variant || 'standard', material);
    case 'hangtag': return core.hangTagPrice(variant || 'standard');
    default: return 0;
  }
}

/** Упаковка позиции живёт в `model/packaging` (её читает и ТЗ); здесь — реэкспорт для прежних импортов */
export { itemPackaging };

/** Дни срочного пошива: новое поле заказа, иначе прежний флажок (= 5 дней) */
export function orderUrgentDays(order: Pick<SalesOrder, 'urgent' | 'urgent_days'>): number {
  if (typeof order.urgent_days === 'number' && order.urgent_days > 0) return order.urgent_days;
  return order.urgent ? 5 : 0;
}

export function priceItem(
  item: SalesItem, P: PricesExt, cat: PriceCatalogs, rules: PriceRules, urgentDays: number | boolean,
  orderPackaging = 'none',
): ItemPrice {
  const issues: PriceIssue[] = [];
  const qty = gridQty(item.size_grid);
  if (qty === 0) issues.push('no_qty');

  const g = garmentCost(item, cat);
  if (g.issue) issues.push(g.issue);
  const days = typeof urgentDays === 'boolean' ? (urgentDays ? 5 : 0) : urgentDays;
  const sewn = item.kind === 'sku';
  const markup = item.kind === 'customer' ? 0 : core.getMarkup(P, qty || 1, g.category, g.sku);
  // Накладные и срочность пошива — только у изделия собственного пошива
  const garment = cost.garmentSellPrice(P, g.cost + g.extras, markup, sewn ? cost.urgentRate(P, days) : 0, sewn);

  const prints: PrintPrice[] = [];
  let printsPerUnit = 0;
  let printsTotal = 0;
  for (const pr of item.prints) {
    const pq = gridQty(item.size_grid, pr.sizes);
    // Способ вышивки: шеврон — по типу; у своего пошива — по «где наносим»
    // (прежде всегда «на крое», и поле на цену не влияло); бланк и
    // давальческое — только на готовом
    const mode: printRules.EmbMode = /шеврон|нашивк|patch/i.test(pr.garment_kind || '')
      ? 'patch'
      : sewn && pr.on === 'cut' ? 'cut' : 'garment';
    const { unit, issue } = printUnitPrice(P, pr, pq || 1, item.client_fabric ? '' : item.fabric_code, mode, cat.zonesCatalog);
    if (issue && !issues.includes(issue)) issues.push(issue);
    const u = unit ?? 0;
    prints.push({ key: pr.key, method: pr.method, qty: pq, unit: u });
    printsTotal += u * pq;
  }
  if (qty > 0) printsPerUnit = printsTotal / qty;

  // Бирки и упаковка — как в визарде: сверху, без накладных, наценки и срочности
  const labelsUnit = item.labels.reduce((sum, l) => sum + salesLabelPrice(l, cat.labelLibrary), 0);
  const packUnit = core.packPrice(P, itemPackaging(item, orderPackaging));
  const rawUnit = garment + printsPerUnit + labelsUnit + packUnit;
  const calcUnit = qty > 0 ? cost.ceilToStep(rawUnit, rules.roundTo) : 0;

  const manual = item.manual_unit_price != null;
  const unit = manual ? item.manual_unit_price! : calcUnit;
  const costTotal = Math.round((g.cost + g.extras + labelsUnit + packUnit) * qty + printsTotal);

  return {
    key: item.key,
    qty,
    cost_unit: g.cost,
    markup_pct: markup,
    prints,
    labels_unit: labelsUnit,
    pack_unit: packUnit,
    calc_unit: calcUnit,
    unit,
    total: Math.round(unit * qty),
    manual,
    cost_total: costTotal,
    issues,
  };
}

const BLOCKING: PriceIssue[] = ['sku_not_found', 'kind_unpriced', 'method_unpriced', 'print_too_big', 'fabric_not_found'];

export function priceOrder(
  order: SalesOrder, P: PricesExt, cat: PriceCatalogs, rules: PriceRules = DEFAULT_PRICE_RULES,
): OrderPrice {
  const days = orderUrgentDays(order);
  const items = order.items.map((it) => priceItem(it, P, cat, rules, days, order.packaging));
  const subtotal = items.reduce((s, i) => s + i.total, 0);

  const methods = new Set(order.items.flatMap((it) => it.prints.map((p) => p.method)));
  const prep = [...methods].reduce((s, m) => s + (rules.prepFees[m] ?? 0), 0);

  const gross = subtotal + prep;
  const d = order.discount;
  const discount = !d || d.value <= 0
    ? 0
    : Math.min(gross, d.mode === 'pct' ? Math.round(gross * d.value / 100) : Math.round(d.value));

  const total = gross - discount;
  const costTotal = items.reduce((s, i) => s + i.cost_total, 0) + prep;
  const margin = total - costTotal;
  const marginPct = total > 0 ? margin / total : 0;

  return {
    items,
    subtotal,
    prep_total: prep,
    discount_amount: discount,
    total,
    cost_total: costTotal,
    margin,
    margin_pct: marginPct,
    below_threshold: rules.minMarginPct != null && marginPct < rules.minMarginPct,
    incomplete: items.some((i) => !i.manual && i.issues.some((x) => BLOCKING.includes(x))),
  };
}
