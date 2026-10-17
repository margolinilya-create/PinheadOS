/**
 * Типы вкладки «Дизайн» (веха 5а, задача 3): справочник флэтов, геометрия
 * размещения и раскладка нанесения (`SalesPrint.layout`).
 *
 * Перенесено из дизайн-мейкера (DM, `types/index.ts`) с тремя отличиями:
 * - флэт — запись справочника `app_config.garmentFlats`, а не SKU DM: у него
 *   версия, точные модели (`sku_codes`) и типовой подбор (`categories`, `fits`);
 * - у зоны флэта `zone_id` — связь с `zonesCatalog` (имя зоны нанесения берётся
 *   оттуда, его читают цена и ТЗ); `null` — служебная зона (этикетка);
 * - техники — наши 8 (`SalesPrintMethod`), а не три DM.
 *
 * Все длины — в миллиметрах флэта.
 */
import type { SalesPrintMethod } from '../model/types';

// ── Справочник флэтов ─────────────────────────────────────────────────────

/** Тип изделия DM — ключ подбора категории (`catalog/categoryMap.ts`) */
export const GARMENT_TYPES = [
  'tshirt', 'polo', 'longsleeve', 'sweatshirt', 'hoodie', 'zip_hoodie',
  'half_zip', 'bomber', 'olympic', 'pants', 'shopper',
] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

/**
 * Виды флэта в справочнике. Перечень совпадает с формой пути в бакете
 * `garment-flats` (миграция H): рукава — под веху 5б.
 */
export const FLAT_VIEW_KINDS = ['front', 'back', 'sleeve_left', 'sleeve_right'] as const;
export type FlatViewKind = (typeof FLAT_VIEW_KINDS)[number];

/** Виды холста вехи 5а — только перед и спина (решение владельца 3) */
export const DESIGN_VIEWS = ['front', 'back'] as const;
export type DesignView = (typeof DESIGN_VIEWS)[number];

/** Именованная вертикальная ось изделия (выточка, рельеф, шов) */
export interface NamedAxis {
  id: string;
  name: string;
  x: number;
}

/** Якоря вида, привязанные к изделию. Координаты — мм флэта */
export interface ViewAnchors {
  /** Нижняя точка горловины по центру; у штанов — середина пояса */
  neckline_point?: { x: number; y: number };
  center_axis_x?: number;
  sleeve_bottom_y?: number;
  sleeve_center_x?: number;
  /** Доп. оси. Якоря размера (`size_anchors`) заменяют объект целиком — оси повторять */
  axes?: NamedAxis[];
}

/** Дельта якоря на шаг размера — ростовка (веха 5б; в 5а не читается) */
export interface AnchorDelta {
  dx?: number;
  dy?: number;
}

/** Правило ростовки — веха 5б; хранится, в 5а не применяется */
export interface GradeRule {
  neckline?: AnchorDelta;
  center_axis_dx?: number;
  sleeve_bottom_dy?: number;
  sleeve_center_dx?: number;
}

/** Печатная зона флэта */
export interface PrintArea {
  id: string;
  name: string;
  /** Зона нанесения `zonesCatalog` (её имя уходит в `SalesPrint.zone`); `null` — служебная */
  zone_id: string | null;
  /** Строка ТЗ, куда ложится нанесение (под ТЗ-PDF) */
  tz_row?: string;
  polygon_mm: [number, number][];
  safe_inset_mm: number;
  default_method?: SalesPrintMethod;
  /** Допустимые техники; нет или пусто — все */
  methods?: SalesPrintMethod[];
  max_print_mm?: { width: number; height: number };
  min_print_mm?: { width: number; height: number };
}

export interface FlatView {
  kind: FlatViewKind;
  /** Путь в бакете `garment-flats`: `flats/<id>/v<версия>/<вид>.svg` */
  svg_path: string;
  /** Единица SVG → мм (1 — viewBox в мм) */
  scale_mm_per_unit: number;
  anchors: ViewAnchors;
  /** Якоря по размеру (веха 5б); нет размера — базовые `anchors` */
  size_anchors?: Record<string, ViewAnchors>;
  grade_rule?: GradeRule;
  print_areas: PrintArea[];
}

export interface GarmentFlat {
  id: string;
  name: string;
  garment_type: GarmentType;
  /** Типовой силуэт (подходит многим моделям), а не лекало конкретной модели */
  typical: boolean;
  /** Снятый флэт не подбирается; значения отключаются, а не удаляются */
  active: boolean;
  /** Версия геометрии; новая версия — новый путь в бакете */
  version: number;
  /** Точные модели прайс-каталога (`SkuItem.code`) */
  sku_codes: string[];
  /** Категории прайс-каталога для типового подбора */
  categories: string[];
  /** Посадки (`SkuItem.fit`) для типового подбора; пусто — любая */
  fits: string[];
  base_size: string;
  sizes: string[];
  views: FlatView[];
}

export interface GarmentFlatsCatalog {
  version: 1;
  flats: GarmentFlat[];
}

// ── Раскладка нанесения ───────────────────────────────────────────────────

/**
 * Файл макета в той мере, в какой его знает раскладка. `type: 'png'` — любой
 * растр (PNG, JPEG, WEBP): холст и PDF различают только «вектор / растр».
 */
export interface AssetMeta {
  type: 'svg' | 'png';
  source_file: string;
  intrinsic_w_mm: number;
  intrinsic_h_mm: number;
  px_w?: number;
  px_h?: number;
  dpi?: number;
  /** Физический размер не выведен из файла, а взят по умолчанию */
  size_estimated: boolean;
  /** PDF/AI: растр лежит рядом с исходником (`<artwork_path>.preview.png`) */
  has_preview: boolean;
}

/**
 * `SalesPrint.layout` — только геометрия холста. Мм, зона, техника, отступ
 * и файл макета живут в стандартных полях нанесения (их читают цена и ТЗ).
 * Путей в раскладке нет: превью PDF/AI лежит по выводимому пути.
 */
export interface PrintLayoutV1 {
  v: 1;
  flat_id: string;
  flat_version: number;
  view: DesignView;
  area_id: string;
  /** Левый верх рамки до поворота, мм флэта, шаг 0,1 */
  x_mm: number;
  y_mm: number;
  rotation_deg: number;
  flip_h: boolean;
  flip_v: boolean;
  asset: AssetMeta;
}

/**
 * Размещение — модель холста, выведенная из нанесения (`model/layout.placementOf`).
 * Ключ — `print_key` нанесения: одно нанесение = одно размещение.
 */
export interface Placement {
  print_key: string;
  view: DesignView;
  area_id: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  rotation_deg: number;
  flip_h: boolean;
  flip_v: boolean;
  method: SalesPrintMethod;
  asset: AssetMeta;
  artwork_path: string;
  /** Раскладка сделана на прежней версии флэта — пометка «флэт обновлён» */
  stale: boolean;
}

// ── Профиль техники ───────────────────────────────────────────────────────

/**
 * Профиль техники в той мере, в какой его читает дизайн. Источник —
 * `model/printMethods.ts` (`printMethodProfile`, задача 1): модули дизайна
 * получают его аргументом и своих профилей не держат.
 */
export interface MethodProfileLike {
  id: SalesPrintMethod;
  label: string;
  colorMode: 'cmyk' | 'spot';
  dpi?: { good: number; min: number };
  detail?: { minLineMm: number; minTextMm: number };
}

export type ProfileOf = (method: SalesPrintMethod) => MethodProfileLike;
