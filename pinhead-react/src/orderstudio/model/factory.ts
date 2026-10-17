/**
 * Пустые объекты модели Order v4 и счёт сетки. Функции, а не константы:
 * у каждой позиции, нанесения и бирки свой ключ (тот же довод, что у
 * `newDraftItem`/`emptyPrint` ERP: общий объект дал бы всем один ключ).
 */
import type {
  SalesGrid, SalesItem, SalesLabel, SalesNoteCard, SalesOrder, SalesPrint,
} from './types';

const key = (): string => crypto.randomUUID();

export function newSalesPrint(patch: Partial<SalesPrint> = {}): SalesPrint {
  return {
    key: key(),
    method: 'silkscreen',
    zone: '',
    sizes: [],
    width_mm: null,
    height_mm: null,
    offset_note: '',
    pantone: [],
    special: '',
    garment_kind: '',
    on: 'finished',
    comment: '',
    colors: 1,
    textile: 'white',
    fill: 1,
    artwork_url: '',
    applied_at: null,
    layout: null,
    artwork_path: '',
    offset_mm: null,
    offset_from: '',
    offset_dir: '',
    effects: [],
    contractor: '',
    contractor_days: null,
    ...patch,
  };
}

export function newSalesLabel(patch: Partial<SalesLabel> = {}): SalesLabel {
  return {
    key: key(), label_type: '', place: '', size: '', comment: '', variant_id: '',
    blank: false, preview_paths: [], attach_scheme: '', attach_image_path: '',
    ...patch,
  };
}

export function newSalesNoteCard(patch: Partial<SalesNoteCard> = {}): SalesNoteCard {
  return { key: key(), item_key: null, group_title: '', caption: '', link: '', image_path: '', ...patch };
}

export function newSalesItem(patch: Partial<SalesItem> = {}): SalesItem {
  return {
    key: key(),
    kind: 'sku',
    sku_code: '',
    sku_card_id: '',
    product_type: '',
    fit: '',
    fabric_code: '',
    client_fabric: false,
    main_fabric: '',
    color_supplier: '',
    trim_material: '',
    cutting_note: '',
    sewing_note: '',
    labels_note: '',
    packaging: 'inherit',
    packaging_size: '',
    sticker_place: '',
    marking_place: '',
    packaging_note: '',
    packaging_width_mm: null,
    packaging_height_mm: null,
    size_grid: { sizes: [], rows: [] },
    prints: [],
    labels: [],
    extras: [],
    blank_source: null,
    blank_price: null,
    brief: '',
    manual_unit_price: null,
    supplier: '',
    model_description: '',
    extra_processing_note: '',
    client_pattern: '',
    part_colors: {},
    tz_comment: '',
    tz_pdf_path: '',
    flat_id: '',
    ...patch,
  };
}

export function newSalesOrder(patch: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: '',
    number: '',
    kind: 'run',
    parent_id: null,
    status: 'draft',
    bitrix_id: '',
    title: '',
    customer: '',
    contact: '',
    manager: '',
    due_date: '',
    packaging: 'none',
    packaging_note: '',
    packaging_width_mm: null,
    packaging_height_mm: null,
    stickers: 'none',
    stickers_note: '',
    no_chestny_znak: false,
    delivery_method: '',
    delivery_address: '',
    urgent: false,
    discount: null,
    payments: [],
    items: [],
    paid_at: null,
    tz_ready_at: null,
    tech_checked_at: null,
    erp_order_id: null,
    sticker_preview_path: '',
    notes_cards: [],
    paid_kind: null,
    paid_override_reason: null,
    sent_at: null,
    launch_started_at: null,
    launch_by: null,
    launched_at: null,
    launched_by: null,
    updated_at: null,
    ...patch,
  };
}

/**
 * Тираж по сетке: сумма по АКТИВНЫМ размерам, как `gridTotal` ERP.
 * `only` — размеры группы нанесения; пусто — все активные.
 */
export function gridQty(grid: SalesGrid | null | undefined, only: readonly string[] = []): number {
  const active = grid?.sizes ?? [];
  const sizes = only.length > 0 ? active.filter((s) => only.includes(s)) : active;
  return (grid?.rows ?? []).reduce(
    (sum, row) => sum + sizes.reduce((s, sz) => s + (Number(row.sizes?.[sz]) || 0), 0),
    0,
  );
}
