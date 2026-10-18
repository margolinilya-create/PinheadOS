/**
 * Модель документа ТЗ (веха 6+7, задача 2) — то, что печатается, уже подписанное
 * для человека. Строит `tzDocument`, раскладывает `layoutTz`, рисует движок PDF.
 *
 * ЦЕН НЕТ: ни одного поля цены, себестоимости, маржи, скидки (К13) — сторож
 * `tzModelGuards.test.ts` обходит документы фикстур и ищет такие ключи.
 *
 * Пути (`stickerImage`, `previews`, `artworkPath`, `image`) — ключи приватного
 * бакета `order-artworks`; картинки по ним скачивает движок.
 */
import type { SalesPrintMethod } from '../../model/types';
import type { TzRow } from '../../catalog/tzRows';
import type { LabelLibrary, PackOption, Supplier, TzSettings } from '../../catalog/types';
import type { GarmentFlatsCatalog, DesignView } from '../../design/types';
import type { TzColumn } from './tzColumns';

/** Справочники, по которым собирается ТЗ (подписи, а не цены) */
export interface TzCatalogs {
  fabricsCatalog: readonly { code: string; name?: string; supplier?: string; density?: number | string | null }[];
  extrasCatalog: readonly { code: string; name: string }[];
  labelLibrary: LabelLibrary | null;
  packOptions: readonly PackOption[];
  zonesCatalog: readonly { id: string; name: string; tz_row?: string }[];
  garmentFlats: GarmentFlatsCatalog | null;
  suppliers: readonly Supplier[];
  tzSettings: TzSettings | null;
}

/** Сетка ЦВ/РАЗМ: стандартный ряд 2XS–4XL + ONE, размеры вне ряда — доп. колонками в конце */
export interface TzGrid {
  sizes: string[];
  rows: { color: string; cells: number[]; total: number }[];
  /** Итог по колонкам */
  totals: number[];
  total: number;
}

/** Мокап страницы нанесения: вид флэта со всеми печатями вида, текущая выделена (рисует движок) */
export interface TzMockupRef {
  view: DesignView;
  flatId: string;
  flatVersion: number;
  printKeys: string[];
  highlight: string;
}

export interface TzMatrixRow {
  row: TzRow;
  /** «Полочка» или «Другое: <зона>» */
  rowLabel: string;
  /** Отмеченные столбцы в порядке таблицы (Ш, В, Т, DTG, П) */
  cols: TzColumn[];
}

export interface TzLabel {
  type: string;
  /** Вид бирки по справочнику («Составник»); нет в справочнике — код */
  kind: string;
  /** Вариант и материал («Своя (дизайн клиента), Тканая») */
  variant: string;
  place: string;
  size: string;
  comment: string;
  blank: boolean;
  previews: string[];
  /** Схема притачивания названием; неизвестная — «<id> (нет в справочнике)» */
  scheme: string;
  /** Картинка схемы — только `attach_image_path` бирки (решение 23) */
  schemeImage: string | null;
}

export interface TzPrintPage {
  /** Номер — место в `prints` первой позиции группы (как у PDF макета) */
  n: number;
  key: string;
  method: SalesPrintMethod;
  methodLabel: string;
  column: TzColumn;
  /** Спецэффект и эффекты списком */
  effects: string;
  /** Ткань — той же подписью, что на странице полотна */
  fabric: string;
  /** «В 40 × Ш 90 мм»; мм нет — пусто */
  sizeText: string;
  zone: string;
  row: TzRow;
  rowLabel: string;
  /** Отступ и текст опоры («70 мм от шва горловины; согласно комментарию») */
  offset: string;
  /** «на крое» / «на готовом» */
  on: string;
  /** Pantone; у цветов группы разный — «Чёрный: …; Белый: …» */
  pantone: string;
  comment: string;
  contractor: string;
  contractorDays: number | null;
  grid: TzGrid;
  mockup: TzMockupRef | null;
  artworkPath: string;
}

export interface TzNoteCard {
  group: string;
  caption: string;
  link: string;
  /** Ссылку можно сделать кликабельной (`isSafeHttpUrl`); иначе — только текстом */
  linkSafe: boolean;
  image: string | null;
}

export interface TzDoc {
  header: {
    orderNumber: string;
    bitrixId: string;
    title: string;
    manager: string;
    /** Дата оформления «дд.мм.гггг» — дата первой сборки версии; в хэш не входит */
    issuedOn: string;
    dueDate: string;
    productTitle: string;
    qty: number;
    packaging: string;
    packagingNote: string;
    packagingSize: string;
    stickers: string;
    stickersNote: string;
    stickerImage: string | null;
    noChestnyZnak: boolean;
    /** `tz_comment` позиций: одинаковый — один раз без подписи, разный — по цветам */
    comments: { label: string | null; text: string }[];
  };
  fabric: {
    main: string;
    trim: string;
    supplier: string;
    colors: { color: string; parts: { part: string; color: string }[] }[];
    matrix: TzMatrixRow[];
    grid: TzGrid;
    modelDescription: string;
    extraProcessing: string[];
  };
  labels: { items: TzLabel[]; none: boolean; sizeBlank: boolean; compositionBlank: boolean };
  prints: TzPrintPage[];
  notes: TzNoteCard[];
  /** Подвал: текст справочника, «PH-… · ТЗ k из m», ссылка на заказ (в хэш не входит) */
  footer: { text: string; group: string; link: string };
  /** Мокапы нарисованы по типовому флэту — пометка «по типовому флэту» */
  typicalFlat: boolean;
}
