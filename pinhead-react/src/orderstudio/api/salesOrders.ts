/**
 * Order v4 ↔ база (срез 1). Таблицы — миграция 20260928213529_orders_v4:
 * `orders` (schema_version = 4) + `order_items` / `order_item_prints` /
 * `order_item_labels`; запись — одним RPC `order_v4_save` (транзакция,
 * RLS вызывающего). Чтение — вложенным select PostgREST.
 *
 * Перевод строк в модель и обратно — чистые функции (`rowToSalesOrder`,
 * `salesOrderToPayload`), вызовы — тонкие обёртки: ошибка Supabase →
 * `toast.error` + `null` (правило проекта).
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../model/factory';
import type {
  SalesDiscount, SalesGrid, SalesItem, SalesLabel, SalesOrder, SalesOrderStatus, SalesPrint,
} from '../model/types';
import type { OrderPrice } from '../pricing/priceOrder';

// ── Строки базы ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any -- строка PostgREST нетипизирована */
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SalesOrderListRow {
  id: string;
  order_number: string | null;
  title: string | null;
  customer: string | null;
  status: SalesOrderStatus;
  price_total: number | null;
  due_date: string | null;
  updated_at: string | null;
}

const LIST_COLUMNS = 'id, order_number, title, customer, status, price_total, due_date, updated_at';
const CARD_SELECT = '*, order_items(*, order_item_prints(*), order_item_labels(*))';

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const bySort = (a: Row, b: Row) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

function gridFromRow(v: unknown): SalesGrid {
  const g = (v ?? {}) as Partial<SalesGrid>;
  return {
    sizes: Array.isArray(g.sizes) ? g.sizes.map(String) : [],
    rows: Array.isArray(g.rows)
      ? g.rows.map((r) => ({ color: str(r?.color), sizes: { ...(r?.sizes ?? {}) } }))
      : [],
  };
}

function printFromRow(r: Row): SalesPrint {
  return newSalesPrint({
    key: r.id,
    method: r.method,
    zone: str(r.zone),
    sizes: r.sizes ?? [],
    width_mm: num(r.width_mm),
    height_mm: num(r.height_mm),
    offset_note: str(r.offset_note),
    pantone: r.pantone ?? [],
    special: str(r.special),
    garment_kind: str(r.garment_kind),
    on: r.print_on === 'cut' ? 'cut' : 'finished',
    comment: str(r.comment),
    colors: Number(r.colors) || 1,
    textile: r.textile === 'color' ? 'color' : 'white',
    fill: Number(r.fill) || 1,
    artwork_url: str(r.artwork_url),
    applied_at: r.applied_at ?? null,
  });
}

function labelFromRow(r: Row): SalesLabel {
  return newSalesLabel({
    key: r.id,
    label_type: str(r.label_type),
    place: str(r.place),
    size: str(r.size),
    comment: str(r.comment),
    variant_id: str(r.variant_id),
  });
}

function itemFromRow(r: Row): SalesItem {
  return newSalesItem({
    key: r.id,
    kind: r.kind ?? 'sku',
    sku_code: str(r.sku_code),
    sku_card_id: str(r.sku_card_id),
    product_type: str(r.product_type),
    fit: str(r.fit),
    fabric_code: str(r.fabric_code),
    client_fabric: !!r.client_fabric,
    main_fabric: str(r.main_fabric),
    color_supplier: str(r.color_supplier),
    trim_material: str(r.trim_material),
    cutting_note: str(r.cutting_note),
    sewing_note: str(r.sewing_note),
    labels_note: str(r.labels_note),
    packaging: str(r.packaging) || 'inherit',
    packaging_size: str(r.packaging_size),
    sticker_place: str(r.sticker_place),
    marking_place: str(r.marking_place),
    packaging_note: str(r.packaging_note),
    packaging_width_mm: num(r.packaging_width_mm),
    packaging_height_mm: num(r.packaging_height_mm),
    size_grid: gridFromRow(r.size_grid),
    prints: [...(r.order_item_prints ?? [])].sort(bySort).map(printFromRow),
    labels: [...(r.order_item_labels ?? [])].sort(bySort).map(labelFromRow),
    extras: r.extras ?? [],
    blank_source: r.blank_source ?? null,
    blank_price: num(r.blank_price),
    brief: str(r.brief),
    manual_unit_price: num(r.manual_unit_price),
  });
}

export function rowToSalesOrder(r: Row): SalesOrder {
  const discount: SalesDiscount | null = r.discount_mode
    ? { mode: r.discount_mode, value: Number(r.discount_value) || 0 }
    : null;
  return newSalesOrder({
    id: r.id,
    number: str(r.order_number),
    kind: r.kind ?? 'run',
    parent_id: r.parent_id ?? null,
    status: r.status ?? 'draft',
    bitrix_id: str(r.bitrix_deal),
    title: str(r.title),
    customer: str(r.customer),
    contact: str(r.contact),
    manager: str(r.manager_name),
    due_date: str(r.due_date),
    packaging: str(r.packaging) || 'none',
    packaging_note: str(r.packaging_note),
    packaging_width_mm: num(r.packaging_width_mm),
    packaging_height_mm: num(r.packaging_height_mm),
    stickers: str(r.stickers) || 'none',
    stickers_note: str(r.stickers_note),
    no_chestny_znak: !!r.no_chestny_znak,
    delivery_method: r.delivery_method ?? '',
    delivery_address: str(r.delivery_address),
    urgent: !!r.urgent,
    discount,
    payments: [],
    items: [...(r.order_items ?? [])].sort(bySort).map(itemFromRow),
    paid_at: r.paid_at ?? null,
    tz_ready_at: r.tz_ready_at ?? null,
    tech_checked_at: r.tech_checked_at ?? null,
    erp_order_id: r.erp_order_id ?? null,
  });
}

/**
 * Заказ → аргумент `order_v4_save`. Цена — снимок расчёта на момент
 * сохранения (для списка и КП); источник правды остаётся `priceOrder`.
 */
export function salesOrderToPayload(order: SalesOrder, price?: OrderPrice | null): Row {
  const byKey = new Map((price?.items ?? []).map((p) => [p.key, p]));
  return {
    id: order.id || null,
    kind: order.kind,
    parent_id: order.parent_id,
    bitrix_id: order.bitrix_id,
    title: order.title,
    customer: order.customer,
    contact: order.contact,
    manager: order.manager,
    due_date: order.due_date,
    delivery_method: order.delivery_method,
    delivery_address: order.delivery_address,
    packaging: order.packaging,
    packaging_note: order.packaging_note,
    packaging_width_mm: order.packaging_width_mm,
    packaging_height_mm: order.packaging_height_mm,
    stickers: order.stickers,
    stickers_note: order.stickers_note,
    no_chestny_znak: order.no_chestny_znak,
    urgent: order.urgent,
    discount: order.discount,
    price_total: price ? price.total : null,
    price_margin_pct: price ? price.margin_pct : null,
    items: order.items.map((it) => {
      const p = byKey.get(it.key);
      return {
        ...it,
        prints: it.prints.map((pr) => ({ ...pr })),
        labels: it.labels.map((l) => ({ ...l })),
        price_unit: p ? p.unit : null,
        price_total: p ? p.total : null,
      };
    }),
  };
}

// ── Вызовы ──────────────────────────────────────────────────────────────────

export async function fetchSalesOrders(): Promise<SalesOrderListRow[] | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(LIST_COLUMNS)
    .eq('schema_version', 4)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('fetchSalesOrders', error);
    toast.error('Не удалось загрузить заказы v4');
    return null;
  }
  return (data ?? []) as SalesOrderListRow[];
}

export async function fetchSalesOrder(id: string): Promise<SalesOrder | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(CARD_SELECT)
    .eq('id', id)
    .eq('schema_version', 4)
    .maybeSingle();
  if (error) {
    console.error('fetchSalesOrder', error);
    toast.error('Не удалось открыть заказ');
    return null;
  }
  if (!data) {
    toast.error('Заказ не найден или недоступен');
    return null;
  }
  return rowToSalesOrder(data as Row);
}

export interface SaveResult {
  id: string;
  order_number: string;
  updated_at: string;
}

/** Без тоста: автосохранение само решает, как показать сбой (статус карточки) */
export async function saveSalesOrder(payload: Row): Promise<SaveResult | null> {
  const { data, error } = await supabase.rpc('order_v4_save', { p_order: payload });
  if (error) {
    console.error('order_v4_save', error);
    return null;
  }
  return data as SaveResult;
}
