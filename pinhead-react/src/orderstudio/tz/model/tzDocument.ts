/**
 * Документ ТЗ группы позиций (веха 6+7, задача 2): заказ v4 + справочники →
 * всё, что печатается, уже подписанным. Чистая функция без React и сети.
 *
 * Источники полей — одна функция на поле (план, «Источники полей»):
 *  - ткань — `fabricDisplayName` везде (страница полотна и страницы нанесений);
 *  - упаковка — `itemPackaging` (`model/packaging`) → `packName` из `packOptions`;
 *  - бирка — `findLabelKind`, `shownVariantId`, схема из `labelLibrary.schemes`;
 *  - строка матрицы — К7 (`tzRowOfArea` по флэту версии раскладки, иначе
 *    `tzRowOfZone` по имени зоны), столбец — `tzColumnOf`;
 *  - отступ — `offsetText` (`model/printOffset`);
 *  - срок — `parseDateLocal`; дата оформления и адрес — аргументом.
 *
 * Цены сюда не попадают: модуль не читает полей цены позиции и заказа
 * (сторож `tzModelGuards.test.ts`).
 */
import type { SalesItem, SalesOrder, SalesPrint } from '../../model/types';
import { METHOD_LABELS } from '../../model/printMethods';
import { offsetText } from '../../model/printOffset';
import { itemPackaging } from '../../model/packaging';
import { TZ_MATRIX_ROWS, TZ_ROW_LABELS, tzRowOfArea, tzRowOfZone, type TzRow } from '../../catalog/tzRows';
import { UNKNOWN_MARK, findLabelKind, parseLabelVariant, shownVariantId } from '../../catalog/labels';
import { parseLayout } from '../../design/model/layoutMark';
import { flatAtVersion } from '../../design/catalog/flatVersion';
import { fabricDisplayName, packName } from '../../../utils/displayNames';
import { parseDateLocal } from '../../../utils/date';
import { TZ_COLUMNS, tzColumnOf, type TzColumn } from './tzColumns';
import { isSafeHttpUrl } from './safeUrl';
import { tzGrid } from './tzGrid';
import type { TzGroup } from './tzGroups';
import type { TzCatalogs, TzDoc, TzLabel, TzMatrixRow, TzMockupRef, TzNoteCard, TzPrintPage } from './tzDocTypes';

export interface TzDocOpts {
  /** Дата первой сборки версии, `YYYY-MM-DD` (решение 21) */
  issuedOn: string;
  /** `APP_ORIGIN` (`VITE_APP_ORIGIN`), не `location.origin` (К9) */
  appOrigin: string;
}

/** Эффекты шелкографии и вышивки — подписи как на экране (`screens/labels`, паритет — тест) */
export const SPECIAL_LABELS: Partial<Record<SalesPrint['method'], Record<string, string>>> = {
  silkscreen: { stone: 'Каменная база', puff: 'PUFF', metallic: 'Металлик', fluor: 'Флюр' },
  embroidery: { metallic: 'Металлизированная', puff: 'Объёмная (3D)' },
};

const STICKER_LABELS: Record<string, string> = { none: 'Нет', blank: 'Бланк', other: 'Другое' };

const trim = (s: string | null | undefined): string => (s ?? '').trim();

/** «дд.мм.гггг»; не дата — пусто */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseDateLocal(iso);
  if (!d) return '';
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Цвета позиции по строкам сетки, без пустых и повторов */
export function itemColors(item: SalesItem): string[] {
  return [...new Set(item.size_grid.rows.map((r) => r.color.trim()).filter(Boolean))];
}

/** Значение по цветам: у всех одно — один раз; разное — «Чёрный: …; Белый: …» (пустые пропускаются) */
export function byColor(entries: { item: SalesItem; text: string }[]): { label: string | null; text: string }[] {
  const filled = entries.map((e) => ({ ...e, text: trim(e.text) })).filter((e) => e.text);
  const distinct = [...new Set(filled.map((e) => e.text))];
  if (distinct.length <= 1) return distinct.map((text) => ({ label: null, text }));
  return filled.map((e) => ({ label: itemColors(e.item).join(', ') || null, text: e.text }));
}

function joinByColor(entries: { item: SalesItem; text: string }[]): string {
  return byColor(entries).map((c) => (c.label ? `${c.label}: ${c.text}` : c.text)).join('; ');
}

function fabricName(item: SalesItem, cat: TzCatalogs): string {
  if (item.client_fabric || !item.fabric_code) return trim(item.main_fabric);
  return fabricDisplayName(item.fabric_code, cat.fabricsCatalog as { code: string }[]) || trim(item.main_fabric);
}

function supplierName(item: SalesItem, cat: TzCatalogs): string {
  if (trim(item.supplier)) return trim(item.supplier);
  return trim(cat.fabricsCatalog.find((f) => f.code === item.fabric_code)?.supplier);
}

/** Строка матрицы нанесения: по флэту версии раскладки, иначе по имени зоны справочника */
function printRow(print: SalesPrint, cat: TzCatalogs): TzRow {
  const layout = parseLayout(print.layout);
  const flat = layout ? cat.garmentFlats?.flats.find((f) => f.id === layout.flat_id) : undefined;
  const atVersion = flat && layout ? flatAtVersion(flat, layout.flat_version) : null;
  const area = atVersion?.views.find((v) => v.kind === layout?.view)?.print_areas.find((a) => a.id === layout?.area_id);
  if (area) return tzRowOfArea(area, cat.zonesCatalog);
  const name = trim(print.zone).toLowerCase();
  return tzRowOfZone(name ? cat.zonesCatalog.find((z) => trim(z.name).toLowerCase() === name) : undefined);
}

const rowLabel = (row: TzRow, zone: string): string => (row === 'other' ? `${TZ_ROW_LABELS.other}: ${trim(zone) || '—'}` : TZ_ROW_LABELS[row]);

function matrixOf(prints: SalesPrint[], rows: TzRow[]): TzMatrixRow[] {
  const cols = (match: (i: number) => boolean): TzColumn[] => {
    const set = new Set(prints.filter((_, i) => match(i)).map((p) => tzColumnOf(p.method, p.contractor)));
    return TZ_COLUMNS.filter((c) => set.has(c));
  };
  const fixed = TZ_MATRIX_ROWS.map((row) => ({ row, rowLabel: TZ_ROW_LABELS[row], cols: cols((i) => rows[i] === row) }));
  const otherZones = [...new Set(prints.filter((_, i) => rows[i] === 'other').map((p) => trim(p.zone)))];
  const other = otherZones.map((zone) => ({
    row: 'other' as const, rowLabel: rowLabel('other', zone), cols: cols((i) => rows[i] === 'other' && trim(prints[i].zone) === zone),
  }));
  return [...fixed, ...other];
}

function mockupOf(print: SalesPrint, all: SalesPrint[]): TzMockupRef | null {
  const l = parseLayout(print.layout);
  if (!l) return null;
  const printKeys = all.filter((p) => {
    const o = parseLayout(p.layout);
    return o && o.flat_id === l.flat_id && o.view === l.view;
  }).map((p) => p.key);
  return { view: l.view, flatId: l.flat_id, flatVersion: l.flat_version, printKeys, highlight: print.key };
}

function effectsOf(p: SalesPrint): string {
  const special = p.special ? (SPECIAL_LABELS[p.method]?.[p.special] ?? p.special) : '';
  return [special, ...p.effects.map(trim)].filter(Boolean).join(', ');
}

function printPage(n: number, items: SalesItem[], cat: TzCatalogs, rows: TzRow[]): TzPrintPage {
  const first = items[0];
  const p = first.prints[n - 1];
  const same = (pick: (x: SalesPrint) => string) =>
    joinByColor(items.map((item) => ({ item, text: pick(item.prints[n - 1] ?? p) })));
  return {
    n,
    key: p.key,
    method: p.method,
    methodLabel: METHOD_LABELS[p.method] ?? p.method,
    column: tzColumnOf(p.method, p.contractor),
    effects: effectsOf(p),
    fabric: fabricName(first, cat),
    sizeText: p.height_mm && p.width_mm ? `В ${p.height_mm} × Ш ${p.width_mm} мм` : '',
    zone: trim(p.zone),
    row: rows[n - 1],
    rowLabel: rowLabel(rows[n - 1], p.zone),
    offset: [offsetText(p), trim(p.offset_note)].filter(Boolean).join('; '),
    on: p.on === 'cut' ? 'на крое' : 'на готовом',
    pantone: same((x) => x.pantone.map(trim).filter(Boolean).join(', ')),
    comment: same((x) => x.comment),
    contractor: trim(p.contractor),
    contractorDays: p.contractor_days ?? null,
    grid: tzGrid(items, p.sizes),
    mockup: mockupOf(p, first.prints),
    artworkPath: p.artwork_path || '',
  };
}

function labelOf(l: SalesItem['labels'][number], cat: TzCatalogs): TzLabel {
  const kind = findLabelKind(cat.labelLibrary, l.label_type);
  const { variant, material } = parseLabelVariant(l.variant_id);
  const vId = shownVariantId(kind, variant);
  const vName = kind?.variants.find((v) => v.id === vId)?.name ?? '';
  const mName = material ? (kind?.materials.find((m) => m.key === material)?.name ?? material) : '';
  const schemeId = trim(l.attach_scheme);
  const scheme = schemeId
    ? (cat.labelLibrary?.schemes.find((s) => s.id === schemeId)?.name ?? `${schemeId} (${UNKNOWN_MARK})`)
    : '';
  return {
    type: l.label_type,
    kind: kind?.name ?? l.label_type,
    variant: [vName, mName].filter(Boolean).join(', '),
    place: trim(l.place),
    size: trim(l.size),
    comment: trim(l.comment),
    blank: l.blank,
    previews: l.preview_paths.filter(Boolean),
    scheme,
    schemeImage: l.attach_image_path || null,
  };
}

function notesOf(order: SalesOrder, keys: Set<string>): TzNoteCard[] {
  return order.notes_cards
    .filter((c) => c.item_key === null || keys.has(c.item_key))
    .map((c) => ({
      group: trim(c.group_title), caption: trim(c.caption), link: trim(c.link),
      linkSafe: isSafeHttpUrl(trim(c.link)), image: c.image_path || null,
    }));
}

function typicalOf(first: SalesItem, cat: TzCatalogs): boolean {
  const ids = [first.flat_id, ...first.prints.map((p) => parseLayout(p.layout)?.flat_id ?? '')].filter(Boolean);
  return ids.some((id) => cat.garmentFlats?.flats.find((f) => f.id === id)?.typical === true);
}

export function tzDocument(order: SalesOrder, group: TzGroup, cat: TzCatalogs, opts: TzDocOpts): TzDoc {
  const items = group.items;
  const first = items[0];
  const rows = first.prints.map((p) => printRow(p, cat));
  const grid = tzGrid(items);
  const pack = itemPackaging(first, order.packaging);
  const ownPack = !!first.packaging && first.packaging !== 'inherit';
  const packW = ownPack ? first.packaging_width_mm : order.packaging_width_mm;
  const packH = ownPack ? first.packaging_height_mm : order.packaging_height_mm;
  const labels = first.labels.map((l) => labelOf(l, cat));
  const number = trim(order.number) || 'PH-черновик';
  return {
    header: {
      orderNumber: trim(order.number),
      bitrixId: trim(order.bitrix_id),
      title: trim(order.title),
      manager: trim(order.manager),
      issuedOn: fmtDate(opts.issuedOn),
      dueDate: fmtDate(order.due_date),
      productTitle: trim(first.client_pattern) || trim(first.product_type),
      qty: grid.total,
      packaging: packName(pack, cat.packOptions),
      packagingNote: trim(ownPack ? first.packaging_note : order.packaging_note),
      packagingSize: [trim(first.packaging_size), packW && packH ? `${packW} × ${packH} мм` : ''].filter(Boolean).join(', '),
      stickers: STICKER_LABELS[order.stickers] ?? trim(order.stickers),
      stickersNote: trim(order.stickers_note),
      stickerImage: order.sticker_preview_path || null,
      noChestnyZnak: order.no_chestny_znak,
      comments: byColor(items.map((item) => ({ item, text: item.tz_comment }))),
    },
    fabric: {
      main: fabricName(first, cat),
      trim: trim(first.trim_material),
      supplier: supplierName(first, cat),
      colors: [...new Set(items.flatMap(itemColors))].map((color) => ({
        color, parts: Object.entries(first.part_colors ?? {}).map(([part, c]) => ({ part, color: c })),
      })),
      matrix: matrixOf(first.prints, rows),
      grid,
      modelDescription: trim(first.model_description),
      extraProcessing: [
        ...first.extras.map((code) => cat.extrasCatalog.find((e) => e.code === code)?.name ?? code),
        trim(first.extra_processing_note),
      ].filter(Boolean),
    },
    labels: {
      items: labels,
      none: labels.length === 0,
      sizeBlank: labels.some((l) => l.type === 'size' && l.blank),
      compositionBlank: labels.some((l) => l.type === 'composition' && l.blank),
    },
    prints: first.prints.map((_, i) => printPage(i + 1, items, cat, rows)),
    notes: notesOf(order, new Set(items.map((i) => i.key))),
    footer: {
      text: trim(cat.tzSettings?.footerText),
      group: `${number} · ТЗ ${group.index} из ${group.total}`,
      link: `${opts.appOrigin.replace(/\/+$/, '')}/sales/${order.id}`,
    },
    typicalFlat: typicalOf(first, cat),
  };
}
