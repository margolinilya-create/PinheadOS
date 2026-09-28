/**
 * Цена заказа Order v4 (v4 §4.8, срез 0) — поверх ядра `utils/pricingCore`.
 *
 * Формула позиции прежняя: себестоимость изделия × (1 + наценка по тиражу
 * ПОЗИЦИИ) + обработки + нанесения. Нового v4 добавляет на уровне заказа:
 * - нанесение считается по тиражу СВОЕЙ группы размеров (`SalesPrint.sizes`),
 *   а не всей позиции: шелкография на 30 шт. из 100 стоит по ступени 30;
 * - формат шелкографии/флекса/DTG выводится из мм макета (`fitFormat`) —
 *   в v4 менеджер вводит мм, а матрица цен знает форматы листа;
 * - цена за единицу округляется ВВЕРХ до `roundTo` (5 ₽) — эта цена уходит
 *   в КП и в ERP (v4 §0 п. 14); ручная цена не округляется;
 * - срочность — множитель прайса ко всему заказу, до округления единицы;
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
import type { PricesExt } from '../../utils/pricingCore';
import type { SkuItem, Fabric, Trim } from '../../types/catalog';
import { gridQty } from '../model/factory';
import type { SalesItem, SalesOrder, SalesPrint, SalesPrintMethod } from '../model/types';

export interface PriceCatalogs {
  skuCatalog: SkuItem[];
  fabricsCatalog: Fabric[];
  trimCatalog: Trim[];
  extrasCatalog: { code: string; price: number }[];
  usdRate: number;
}

export interface PriceRules {
  /** Шаг округления цены единицы вверх, ₽ (v4: 5) */
  roundTo: number;
  /** Ставка подготовки на заказ по технике; нет ключа — ставки нет */
  prepFees: Partial<Record<SalesPrintMethod, number>>;
  /** Порог итоговой маржи, доля (0.25 = 25 %); null — порог не задан */
  minMarginPct: number | null;
}

export const DEFAULT_PRICE_RULES: PriceRules = { roundTo: 5, prepFees: {}, minMarginPct: null };

export type PriceIssue =
  | 'no_qty'            // сетка пуста
  | 'sku_not_found'     // код модели не найден в прайс-каталоге
  | 'kind_unpriced'     // тип позиции без формулы (разработка) — нужна ручная цена
  | 'method_unpriced'   // техника без конструктора цен (сублимация, шевроны)
  | 'print_no_size'     // у нанесения нет мм — посчитано по A4
  | 'print_oversize';   // макет больше A3 — посчитано по A3

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

const ceilTo = (v: number, step: number): number => (step > 0 ? Math.ceil(v / step) * step : Math.round(v));

/** Цена одного нанесения за штуку; null — у техники нет конструктора цен */
function printUnitPrice(
  P: PricesExt, print: SalesPrint, qty: number, fabricCode: string,
): { unit: number | null; issue?: PriceIssue } {
  const { fmt, issue } = fitFormat(print.width_mm, print.height_mm);
  const w = print.width_mm ?? undefined;
  const h = print.height_mm ?? undefined;
  switch (print.method) {
    case 'silkscreen':
      return { unit: core.calcZonePriceDirect(P, 'screen', { fmt, col: print.colors, textile: print.textile, fx: print.special || 'none' }, qty, fabricCode), issue };
    case 'heat_transfer':
      return { unit: core.calcZonePriceDirect(P, 'flex', { fmt, col: print.colors }, qty), issue };
    case 'dtg':
      return { unit: core.calcZonePriceDirect(P, 'dtg', { fmt, textile: print.textile }, qty), issue };
    case 'embroidery': {
      const extra = print.special === 'metallic' || print.special === 'puff' ? print.special : null;
      return {
        unit: core.calcZonePriceDirect(P, 'embroidery', { width_mm: w, height_mm: h, fill: print.fill, extra }, qty),
        issue: w && h ? undefined : 'print_no_size',
      };
    }
    case 'dtf':
      return {
        unit: core.calcZonePriceDirect(P, 'dtf', { width_mm: w, height_mm: h }, qty),
        issue: w && h ? undefined : 'print_no_size',
      };
    default:
      return { unit: null, issue: 'method_unpriced' };
  }
}

/** Себестоимость изделия и категория наценки по типу позиции */
function garmentCost(
  item: SalesItem, cat: PriceCatalogs,
): { cost: number; category: string; issue?: PriceIssue } {
  switch (item.kind) {
    case 'sku': {
      const sku = cat.skuCatalog.find((s) => s.code === item.sku_code);
      if (!sku) return { cost: 0, category: 'tshirts', issue: 'sku_not_found' };
      // Ткань клиента — полотно бесплатно: пустой каталог гасит и выбранную ткань, и запасную
      const fabrics = item.client_fabric ? [] : cat.fabricsCatalog;
      const cost = core.getSkuEstPrice(sku, item.fabric_code || null, fabrics, cat.trimCatalog, cat.usdRate);
      return { cost, category: sku.category };
    }
    case 'blank':
      return { cost: item.blank_price ?? 0, category: 'blank' };
    case 'customer':
      // Давальческое: изделие клиента, считаются только нанесения и обработки
      return { cost: 0, category: 'customer' };
    default:
      return { cost: 0, category: 'dev', issue: 'kind_unpriced' };
  }
}

export function priceItem(
  item: SalesItem, P: PricesExt, cat: PriceCatalogs, rules: PriceRules, urgent: boolean,
): ItemPrice {
  const issues: PriceIssue[] = [];
  const qty = gridQty(item.size_grid);
  if (qty === 0) issues.push('no_qty');

  const g = garmentCost(item, cat);
  if (g.issue) issues.push(g.issue);
  const markup = item.kind === 'customer' ? 0 : core.getMarkup(P, qty || 1, g.category);
  const markedBase = Math.round(g.cost * (1 + markup));

  const prints: PrintPrice[] = [];
  let printsPerUnit = 0;
  let printsTotal = 0;
  for (const pr of item.prints) {
    const pq = gridQty(item.size_grid, pr.sizes);
    const { unit, issue } = printUnitPrice(P, pr, pq || 1, item.client_fabric ? '' : item.fabric_code);
    if (issue && !issues.includes(issue)) issues.push(issue);
    const u = unit ?? 0;
    prints.push({ key: pr.key, method: pr.method, qty: pq, unit: u });
    printsTotal += u * pq;
  }
  if (qty > 0) printsPerUnit = printsTotal / qty;

  const extras = core.calcExtrasCost(item.extras, cat.extrasCatalog);
  const rawUnit = markedBase + extras + printsPerUnit;
  const urgentMult = urgent ? (P.urgentMult || 0.20) : 0;
  const calcUnit = qty > 0 ? ceilTo(rawUnit * (1 + urgentMult), rules.roundTo) : 0;

  const manual = item.manual_unit_price != null;
  const unit = manual ? item.manual_unit_price! : calcUnit;
  const costTotal = Math.round(g.cost * qty + extras * qty + printsTotal);

  return {
    key: item.key,
    qty,
    cost_unit: g.cost,
    markup_pct: markup,
    prints,
    calc_unit: calcUnit,
    unit,
    total: Math.round(unit * qty),
    manual,
    cost_total: costTotal,
    issues,
  };
}

const BLOCKING: PriceIssue[] = ['sku_not_found', 'kind_unpriced', 'method_unpriced'];

export function priceOrder(
  order: SalesOrder, P: PricesExt, cat: PriceCatalogs, rules: PriceRules = DEFAULT_PRICE_RULES,
): OrderPrice {
  const items = order.items.map((it) => priceItem(it, P, cat, rules, order.urgent));
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
