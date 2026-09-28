/**
 * Модель заказа Order v4 (срез 0) — `docs/erp/2026-09-27-order-v4-structure.md` §4–5.
 *
 * ИМЕНА ПОЛЕЙ ПОЗИЦИИ — КАК В `DraftItem`/`DraftForm` ERP (`erp/utils/orderForm.ts`):
 * тогда мост `tzToErpDraft` почти тождественный, и новое поле ERP без решения
 * видно сразу (сторож `bridge/tzToErpDraft.test.ts`). Поля, которых у ERP нет
 * (продажные: цена, наценка, варианты, оплаты), живут рядом и в мост не едут.
 *
 * Заказ — строка `public.orders` (расширяется в срезе 1): именно на неё ссылается
 * `erp_orders.tz_order_id` (миграция 20260818203459). Код ERP модель НЕ меняет —
 * только читает его типы.
 */
import type { SizeGridRow } from '../../erp/types';

/** Тип заказа (v4 §4.1) */
export type SalesOrderKind = 'run' | 'sample' | 'dev' | 'rework';

/** Статусы (v4 §4.7). `paid`/`tz_ready` — признаки (`paid_at`, `tz_ready_at`), а не статусы */
export type SalesOrderStatus =
  | 'draft' | 'price_review' | 'quoted' | 'ready_to_launch'
  | 'production' | 'done' | 'cancel_requested' | 'archived';

/** Тип позиции — шаг 1 визарда (v4 §4.2) */
export type SalesItemKind = 'sku' | 'blank' | 'customer' | 'dev';

/** Чей бланк: наш со склада или сторонний под заказ */
export type BlankSource = 'stock' | 'third_party';

/**
 * Техники нанесения Order (v4 §4.2 п. 4) — набор фиксирован.
 * Коды совпадают с `BrandingMethod` ERP там, где техника у ERP есть;
 * `sublimation` и `patch` у ERP отдельного кода не имеют (см. мост).
 */
export type SalesPrintMethod =
  | 'silkscreen' | 'embroidery' | 'dtf' | 'heat_transfer' | 'dtg'
  | 'sublimation' | 'patch';

/** Где наносится — у Order на нанесении, у ERP на позиции (`branding_on`) */
export type PrintOn = 'cut' | 'finished';

export interface SalesPrint {
  key: string;
  method: SalesPrintMethod;
  zone: string;
  /**
   * Размеры группы, к которой относится нанесение (v4 §4.3: «зона × группа»).
   * Пусто — на всех размерах позиции. Тираж нанесения — сумма сетки по ним.
   */
  sizes: string[];
  width_mm: number | null;
  height_mm: number | null;
  offset_note: string;
  /** Pantone из справочника — списком; ERP хранит одной строкой */
  pantone: string[];
  /** Эффект шелкографии (ключ `print_effect`: stone/puff/metallic/fluor) */
  special: string;
  /** Тип изделия у вышивки (как `DraftPrint.garment_kind`) */
  garment_kind: string;
  on: PrintOn;
  comment: string;
  // ── параметры цены (конструктор цен нанесений) ──
  /** Число цветов — шелкография и флекс */
  colors: number;
  /** Цветное изделие — подложка у шелкографии и DTG */
  textile: 'white' | 'color';
  /** Заполнение вышивки, 0–1 */
  fill: number;
  /** Макет: ссылка на сервер (обязателен перед ТЗ) */
  artwork_url: string;
  /** Когда раскладка применена к ТЗ (v4 §0 п. 4); null — не применялась */
  applied_at: string | null;
}

export interface SalesLabel {
  key: string;
  label_type: string;
  place: string;
  size: string;
  comment: string;
  /** Вариант из библиотеки бирок; пусто — конструктор */
  variant_id: string;
}

export interface SalesGrid {
  sizes: string[];
  rows: SizeGridRow[];
}

export interface SalesItem {
  key: string;
  kind: SalesItemKind;
  /** Модель прайс-каталога визарда (`app_config.sku_catalog`, связь по `code`) */
  sku_code: string;
  /** Карточка модели ERP — ссылка, как `DraftItem.sku_card_id` */
  sku_card_id: string;
  product_type: string;
  fit: string;
  /** Код ткани прайс-каталога (`catalog_config.fabricsCatalog`) — для цены */
  fabric_code: string;
  /** Ткань клиента — цена полотна 0 */
  client_fabric: boolean;
  // ── поля ТЗ — имена как в DraftItem ──
  main_fabric: string;
  color_supplier: string;
  trim_material: string;
  cutting_note: string;
  sewing_note: string;
  labels_note: string;
  packaging: string;
  packaging_size: string;
  sticker_place: string;
  marking_place: string;
  packaging_note: string;
  packaging_width_mm: number | null;
  packaging_height_mm: number | null;
  size_grid: SalesGrid;
  prints: SalesPrint[];
  labels: SalesLabel[];
  // ── продажные ──
  /** Обработки по категории — коды `extrasCatalog` */
  extras: string[];
  blank_source: BlankSource | null;
  /** Цена бланка за штуку (закупочная) — для `kind = 'blank'` */
  blank_price: number | null;
  /** Описание давальческого изделия / анкета разработки — свободным текстом до среза 3 */
  brief: string;
  /** Ручная цена за единицу; null — расчётная */
  manual_unit_price: number | null;
}

export interface SalesPayment {
  kind: 'prepay' | 'final';
  amount: number;
  paid_on: string;
}

export interface SalesDiscount {
  mode: 'pct' | 'sum';
  value: number;
}

export interface SalesOrder {
  /** `orders.id`; пусто у ещё не сохранённого */
  id: string;
  /** PH-XXXX */
  number: string;
  kind: SalesOrderKind;
  parent_id: string | null;
  status: SalesOrderStatus;
  // ── шапка — имена как в DraftForm ──
  /** Сделка Bitrix, `[NNNNN]` */
  bitrix_id: string;
  title: string;
  customer: string;
  contact: string;
  manager: string;
  due_date: string;
  packaging: string;
  packaging_note: string;
  packaging_width_mm: number | null;
  packaging_height_mm: number | null;
  stickers: string;
  stickers_note: string;
  no_chestny_znak: boolean;
  // ── продажные ──
  delivery_method: 'pickup' | 'courier' | 'carrier' | '';
  delivery_address: string;
  /** Срочность: +`urgentMult` прайса (по умолчанию 20 %) ко всему заказу */
  urgent: boolean;
  discount: SalesDiscount | null;
  payments: SalesPayment[];
  items: SalesItem[];
  paid_at: string | null;
  tz_ready_at: string | null;
  tech_checked_at: string | null;
  /** Производственный заказ после запуска */
  erp_order_id: string | null;
}
