/**
 * Справочники заказа v4 (веха 4, миграция G `…_order_catalogs`).
 *
 * Где лежат (ключи уникальны по двум таблицам — сторож `catalogKeys.test.ts`):
 *   · `catalog_config.suppliers` — поставщики с палитрами внутри (`Supplier[]`);
 *   · `app_config.labelLibrary` — бирки: виды, варианты, материалы, схемы притачивания;
 *   · `app_config.tzSettings` — настройки ТЗ (подвал);
 *   · правила цены — ключи прайса `app_config.prices`: `packOptions`, `prepFees`, `minMarginPct`.
 *
 * Пишутся только RPC `catalog_put` / `prices_patch` (`orderstudio/api/catalogAdmin.ts`):
 * форму записи проверяет сервер, и эти типы — её зеркало. Справочник — подсказка:
 * значение снимается с продажи (`active: false`), а не удаляется — заказ, где
 * оно уже стоит, показывает его как есть.
 *
 * Все типы справочников объявлены ЗДЕСЬ; остальные модули вехи 4 их импортируют.
 */

/** Группа палитры — только для показа; `id` уникален внутри палитры */
export interface PaletteGroup {
  id: string;
  label: string;
}

/** Цвет палитры. `code` уникален по ВСЕМ палитрам, `hex` — строго `#RRGGBB` */
export interface PaletteColor {
  code: string;
  name: string;
  hex: string;
  /** id группы палитры; пусто — без группы */
  group: string;
  /** false — снят с продажи: в заказ не предлагается, в старых заказах остаётся */
  active: boolean;
}

export interface Palette {
  groups: PaletteGroup[];
  colors: PaletteColor[];
}

/**
 * Поставщик ткани с палитрой. Ровно один — `isDefault`: его палитру получает
 * ткань, чей поставщик ни к кому не привязан (сегодня — Коттонпром).
 */
export interface Supplier {
  /** Устойчивый id: `medastex`, `cottonprom`… — его пишет буфер позиции */
  id: string;
  name: string;
  isDefault: boolean;
  /** Имена поставщика у тканей (`fabricsCatalog[].supplier`), чья палитра — эта */
  fabricSupplierNames: string[];
  active: boolean;
  palette: Palette;
}

/** Материал бирки с надбавкой к цене варианта, ₽/шт (может быть отрицательной) */
export interface LabelMaterial {
  key: string;
  name: string;
  priceDelta: number;
  active: boolean;
}

/** Вариант бирки; id — нынешние `variant_id` позиции (`standard`, `my-logo`…) */
export interface LabelVariant {
  id: string;
  name: string;
  /** Цена за штуку, ₽ */
  price: number;
  /** Цена складывается с надбавкой материала вида */
  withMaterial: boolean;
  active: boolean;
}

/** Вид бирки — код `order_item_labels.label_type` (`composition`, `brand`, `hangtag`…) */
export interface LabelKind {
  type: string;
  name: string;
  variants: LabelVariant[];
  materials: LabelMaterial[];
  active: boolean;
}

/** Схема притачивания бирки — отдельный набор, общий для всех видов */
export interface AttachScheme {
  id: string;
  name: string;
  active: boolean;
}

export interface LabelLibrary {
  kinds: LabelKind[];
  schemes: AttachScheme[];
}

/** Настройки ТЗ */
export interface TzSettings {
  /** Подвал ТЗ — печатается под позициями */
  footerText: string;
}

/** Вид упаковки — ключи совпадают с CHECK упаковки ERP (none/bopp/zip/other) */
export type PackKey = 'none' | 'bopp' | 'zip' | 'other';

export interface PackOption {
  key: PackKey;
  name: string;
  /** ₽ за штуку */
  price: number;
}

/** Ключи прайса, которые правит руководство продаж (rop — только они) */
export interface PriceRulesPatch {
  packOptions?: PackOption[];
  prepFees?: Record<string, number>;
  /** Порог маржи, %; null — не предупреждать */
  minMarginPct?: number | null;
}
