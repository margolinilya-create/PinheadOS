/**
 * Мост Order → ERP, контракт (срез 0 Order v4, спека п. 2.4).
 *
 * Чистая функция: заказ v4 → форма производственного заказа ERP
 * (`DraftForm` + `DraftItem[]` из `erp/utils/orderForm.ts`) плюс связь
 * `tz_order_id`/`tz_number`, которую `erp_create_order` принимает с 18.08
 * (миграция 20260818203459), а клиент до сих пор не слал.
 *
 * ERP НЕ МЕНЯЕТСЯ: мост только читает её типы и чистые хелперы. Кнопка
 * запуска (срез 2) либо предзаполняет форму ERP этим черновиком, либо зовёт
 * тот же RPC — решение среза 2.
 *
 * Правила маппинга — ДАННЫМИ (`ITEM_KIND_ROUTE`, `METHOD_TO_ERP`), а у каждого
 * поля формы ERP есть запись в `ITEM_FIELD_SOURCES`/`FORM_FIELD_SOURCES`:
 * либо откуда оно берётся, либо почему Order его не заполняет. Тип записей —
 * `Record<keyof DraftItem, …>`, поэтому новое поле ERP без решения роняет
 * typecheck, а сторож `tzToErpDraft.test.ts` — тест.
 */
import { emptyOrderForm, newDraftItem, normalizeBrandingOn } from '../../erp/utils/orderForm';
import type { DraftForm, DraftItem, DraftLabel, DraftPrint } from '../../erp/utils/orderForm';
import { itemNeedsPurchase } from '../../erp/utils/garmentSource';
import type { BrandingMethod, GarmentSource, ProductionType } from '../../erp/types';
import { gridQty } from '../model/factory';
import type {
  SalesItem, SalesItemKind, SalesLabel, SalesOrder, SalesPrint, SalesPrintMethod,
} from '../model/types';

// ── Источник каждого поля формы ERP ─────────────────────────────────────────

/** `order` — берётся из заказа Order; `not_from_order` — Order его не заполняет */
export type FieldSource =
  | { from: 'order'; note: string }
  | { from: 'not_from_order'; reason: string };

const o = (note: string): FieldSource => ({ from: 'order', note });
const skip = (reason: string): FieldSource => ({ from: 'not_from_order', reason });

export const ITEM_FIELD_SOURCES: Record<keyof DraftItem, FieldSource> = {
  id: skip('id позиции ERP — только в режиме правки заказа ERP'),
  key: o('ключ позиции Order'),
  product_type: o('как есть'),
  variant: o('цвета строк сетки через запятую'),
  fit: o('как есть'),
  qty: o('сумма сетки'),
  main_fabric: o('как есть'),
  color_supplier: o('как есть'),
  trim_material: o('как есть'),
  cutting_note: o('как есть'),
  sewing_note: o('как есть'),
  labels_note: o('как есть'),
  packaging: o('как есть'),
  packaging_size: o('как есть'),
  sticker_place: o('как есть'),
  marking_place: o('как есть'),
  packaging_note: o('как есть'),
  packaging_width_mm: o('мм; null → пусто'),
  packaging_height_mm: o('мм; null → пусто'),
  production_type: o('ITEM_KIND_ROUTE по типу позиции; образец и разработка — samples'),
  garment_source: o('ITEM_KIND_ROUTE: бланк со склада — stock, сторонний — purchased, давальческое — customer'),
  sku_card_id: o('как есть'),
  branding_on: o('из `on` нанесений; разные — cut и предупреждение'),
  has_branding: o('есть ли нанесения'),
  subcontract_kind: skip('подряд целиком — решение производства, у Order такого типа позиции нет'),
  material_source: skip('подряд целиком — решение производства'),
  subcontract_operation: skip('подрядная операция — решение производства'),
  needs_further: skip('подрядная операция — решение производства'),
  return_dept: skip('подрядная операция — решение производства'),
  prints: o('METHOD_TO_ERP; pantone одной строкой; группа размеров — в комментарий'),
  labels: o('как есть, без варианта библиотеки'),
  size_grid: o('как есть'),
  route: skip('маршрут строит ERP автоматически (undefined — «не трогали»)'),
};

export const FORM_FIELD_SOURCES: Record<keyof DraftForm, FieldSource> = {
  bitrix_id: o('как есть'),
  title: o('как есть'),
  customer: o('как есть'),
  manager: o('как есть'),
  launch_date: skip('дату запуска ставит производство; умолчание формы ERP — сегодня'),
  due_date: o('как есть — дата, которую видел клиент в КП'),
  packaging: o('как есть'),
  packaging_note: o('как есть'),
  packaging_width_mm: o('мм; null → пусто'),
  packaging_height_mm: o('мм; null → пусто'),
  stickers: o('как есть'),
  stickers_note: o('как есть'),
  no_chestny_znak: o('как есть'),
  purchase_required: o('есть позиция, которой нужна закупка (`itemNeedsPurchase` ERP)'),
};

export const PRINT_FIELD_SOURCES: Record<keyof DraftPrint, FieldSource> = {
  key: o('ключ нанесения Order'),
  id: skip('id нанесения ERP — только в режиме правки'),
  method: o('METHOD_TO_ERP'),
  zone: o('как есть'),
  width_mm: o('мм; null → пусто'),
  height_mm: o('мм; null → пусто'),
  offset_note: o('как есть'),
  pantone: o('список через запятую'),
  special: o('только у шелкографии, как требует форма ERP'),
  garment_kind: o('только у вышивки, как требует форма ERP'),
  comment: o('комментарий + группа размеров + техника без кода ERP'),
};

export const LABEL_FIELD_SOURCES: Record<keyof DraftLabel, FieldSource> = {
  key: o('ключ бирки Order'),
  id: skip('id бирки ERP — только в режиме правки'),
  label_type: o('как есть'),
  place: o('как есть'),
  size: o('как есть'),
  comment: o('как есть'),
};

// ── Правила — данными ──────────────────────────────────────────────────────

interface KindRoute {
  production_type: ProductionType;
  garment_source: GarmentSource;
}

/** Тип позиции Order → тип производства и источник изделия ERP */
export const ITEM_KIND_ROUTE: Record<SalesItemKind, (item: SalesItem) => KindRoute> = {
  sku: () => ({ production_type: 'sewing', garment_source: 'purchased' }),
  blank: (it) => ({
    production_type: 'ready_garment',
    garment_source: it.blank_source === 'stock' ? 'stock' : 'purchased',
  }),
  customer: () => ({ production_type: 'ready_garment', garment_source: 'customer' }),
  dev: () => ({ production_type: 'samples', garment_source: 'purchased' }),
};

/**
 * Техника Order → метод ERP. `sublimation` и `patch` своего кода у ERP нет:
 * `other` (пришив/прочее) с названием техники в комментарии. `dtg` ERP читает,
 * но этапа не строит (правка 07.09) — мост предупреждает.
 */
export const METHOD_TO_ERP: Record<SalesPrintMethod, BrandingMethod> = {
  silkscreen: 'silkscreen',
  embroidery: 'embroidery',
  dtf: 'dtf',
  heat_transfer: 'heat_transfer',
  dtg: 'dtg',
  sublimation: 'other',
  patch: 'other',
};

const METHOD_LABEL: Record<SalesPrintMethod, string> = {
  silkscreen: 'Шелкография',
  embroidery: 'Вышивка',
  dtf: 'DTF',
  heat_transfer: 'Термоперенос',
  dtg: 'DTG',
  sublimation: 'Сублимация',
  patch: 'Шеврон / нашивка',
};

// ── Результат ──────────────────────────────────────────────────────────────

export type BridgeWarning =
  | { kind: 'branding_on_mixed'; item: string }
  | { kind: 'dtg_no_stage'; item: string }
  | { kind: 'method_as_other'; item: string; method: SalesPrintMethod }
  | { kind: 'empty_grid'; item: string };

export interface ErpDraft {
  form: DraftForm;
  items: DraftItem[];
  /** Связь в обе стороны — `payload.order` RPC `erp_create_order` */
  link: { tz_order_id: string | null; tz_number: string | null };
  warnings: BridgeWarning[];
}

const mm = (v: number | null): string | number => (v == null ? '' : v);

function mapPrint(p: SalesPrint): DraftPrint {
  const notes: string[] = [];
  if (METHOD_TO_ERP[p.method] === 'other') notes.push(METHOD_LABEL[p.method]);
  if (p.sizes.length > 0) notes.push(`Размеры: ${p.sizes.join(', ')}`);
  if (p.comment.trim()) notes.push(p.comment.trim());
  return {
    key: p.key,
    method: METHOD_TO_ERP[p.method],
    zone: p.zone,
    width_mm: mm(p.width_mm),
    height_mm: mm(p.height_mm),
    offset_note: p.offset_note,
    pantone: p.pantone.join(', '),
    special: p.method === 'silkscreen' ? p.special : '',
    garment_kind: p.method === 'embroidery' ? p.garment_kind : '',
    comment: notes.join('. '),
  };
}

function mapLabel(l: SalesLabel): DraftLabel {
  return { key: l.key, label_type: l.label_type, place: l.place, size: l.size, comment: l.comment };
}

function mapItem(item: SalesItem, order: SalesOrder, warnings: BridgeWarning[]): DraftItem {
  const route = ITEM_KIND_ROUTE[item.kind](item);
  // Образец и разработка как ТИП ЗАКАЗА — тоже образцы, какой бы ни была позиция
  const productionType: ProductionType =
    order.kind === 'sample' || order.kind === 'dev' ? 'samples' : route.production_type;

  const ons = [...new Set(item.prints.map((p) => p.on))];
  if (ons.length > 1) warnings.push({ kind: 'branding_on_mixed', item: item.key });
  const brandingOn = normalizeBrandingOn(productionType, ons.length === 1 ? ons[0] : 'cut');

  for (const p of item.prints) {
    if (p.method === 'dtg') warnings.push({ kind: 'dtg_no_stage', item: item.key });
    if (METHOD_TO_ERP[p.method] === 'other') warnings.push({ kind: 'method_as_other', item: item.key, method: p.method });
  }

  const qty = gridQty(item.size_grid);
  if (qty === 0) warnings.push({ kind: 'empty_grid', item: item.key });

  return newDraftItem({
    key: item.key,
    product_type: item.product_type,
    variant: [...new Set(item.size_grid.rows.map((r) => r.color.trim()).filter(Boolean))].join(', '),
    fit: item.fit,
    qty: qty || '',
    main_fabric: item.main_fabric,
    color_supplier: item.color_supplier,
    trim_material: item.trim_material,
    cutting_note: item.cutting_note,
    sewing_note: item.sewing_note,
    labels_note: item.labels_note,
    packaging: item.packaging,
    packaging_size: item.packaging_size,
    sticker_place: item.sticker_place,
    marking_place: item.marking_place,
    packaging_note: item.packaging_note,
    packaging_width_mm: mm(item.packaging_width_mm),
    packaging_height_mm: mm(item.packaging_height_mm),
    production_type: productionType,
    garment_source: route.garment_source,
    sku_card_id: item.sku_card_id,
    branding_on: brandingOn,
    has_branding: item.prints.length > 0,
    prints: item.prints.map(mapPrint),
    labels: item.labels.map(mapLabel),
    size_grid: {
      sizes: [...item.size_grid.sizes],
      rows: item.size_grid.rows.map((r) => ({ color: r.color, sizes: { ...r.sizes } })),
    },
  });
}

export function tzToErpDraft(order: SalesOrder, launchDate?: string): ErpDraft {
  const warnings: BridgeWarning[] = [];
  const items = order.items.map((it) => mapItem(it, order, warnings));
  const base = emptyOrderForm(launchDate);
  const form: DraftForm = {
    ...base,
    bitrix_id: order.bitrix_id,
    title: order.title,
    customer: order.customer,
    manager: order.manager,
    due_date: order.due_date,
    packaging: order.packaging,
    packaging_note: order.packaging_note,
    packaging_width_mm: mm(order.packaging_width_mm),
    packaging_height_mm: mm(order.packaging_height_mm),
    stickers: order.stickers,
    stickers_note: order.stickers_note,
    no_chestny_znak: order.no_chestny_znak,
    purchase_required: items.some((it) => itemNeedsPurchase(it)),
  };
  return {
    form,
    items,
    link: { tz_order_id: order.id || null, tz_number: order.number || null },
    warnings,
  };
}
