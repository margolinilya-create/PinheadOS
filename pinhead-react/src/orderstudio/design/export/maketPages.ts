/**
 * Листы PDF макета (веха 5а, задача 7): какие виды и какие нанесения идут
 * в PDF, номер нанесения, строка легенды и имя файла.
 *
 * Модуль лёгкий и чистый: его статически читает кнопка «Скачать PDF макета»
 * (доступность, проверка перед сборкой), а движок PDF (`exportPdf`, jsPDF
 * и svg2pdf) грузится только по клику.
 *
 * - лист — на каждый вид флэта с размещениями, перед раньше спины;
 * - номер нанесения — его место в позиции (порядок `prints` = номер в ТЗ),
 *   строки без холста номер не теряют;
 * - нанесение без раскладки, на другом флэте или с битой раскладкой в PDF
 *   не идёт (`placementOf` → `null`) — оно остаётся строкой ТЗ.
 */
import type { SalesItem, SalesOrder, SalesPrint } from '../../model/types';
import { offsetText } from '../../model/printOffset';
import { METHOD_LABELS } from '../../model/printMethods';
import { asciiFileName, translitAscii } from '../../../utils/asciiFileName';
import { DESIGN_VIEWS, type FlatView, type GarmentFlat, type Placement } from '../types';
import { placementOf } from '../model/layout';

/**
 * Отказ сборки PDF, понятный человеку: текст — продолжение фразы «PDF макета
 * не собран: …». Живёт здесь, а не в движке: кнопка отличает его от сбоя
 * библиотеки, не загружая движок
 */
export class MaketPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaketPdfError';
  }
}

/** Размещённое нанесение листа: номер в позиции, нанесение и его размещение */
export interface MaketEntry {
  n: number;
  print: SalesPrint;
  placement: Placement;
}

export interface MaketPage {
  view: FlatView;
  entries: MaketEntry[];
}

/** Все размещения позиции на этом флэте — по порядку нанесений */
export function placedEntries(item: Pick<SalesItem, 'prints'>, flat: GarmentFlat): MaketEntry[] {
  return item.prints.flatMap((print, i) => {
    const placement = placementOf(print, flat);
    return placement ? [{ n: i + 1, print, placement }] : [];
  });
}

/** Листы PDF: вид флэта и его размещения; пусто — PDF собирать не из чего */
export function maketPages(item: Pick<SalesItem, 'prints'>, flat: GarmentFlat): MaketPage[] {
  const entries = placedEntries(item, flat);
  return DESIGN_VIEWS.flatMap((kind) => {
    const view = flat.views.find((v) => v.kind === kind);
    const own = entries.filter((e) => e.placement.view === kind);
    return view && own.length > 0 ? [{ view, entries: own }] : [];
  });
}

/** Строка легенды: «Грудь (перед) — DTF, 120×80 мм, 80 мм ниже шва горловины» */
export function maketCaption(e: MaketEntry): string {
  const p = e.print;
  const size = `${Math.round(e.placement.width_mm)}×${Math.round(e.placement.height_mm)} мм`;
  const parts = [METHOD_LABELS[p.method] ?? p.method, size, offsetText(p)].filter(Boolean);
  return `${p.zone.trim() || '—'} — ${parts.join(', ')}`;
}

/** Часть имени: транслит, всё прочее — «_», без «_.-» по краям (скобка у цвета не липнет к «-») */
function namePart(s: string): string {
  return translitAscii(s.trim()).replace(/[^\w.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
}

/** Имя файла — ASCII (`asciiFileName`): `PH-1234-<модель>-<цвет>-maket.pdf` */
export function maketFileName(
  order: Pick<SalesOrder, 'number'>,
  item: Pick<SalesItem, 'product_type' | 'size_grid'>,
): string {
  const color = item.size_grid.rows.find((r) => r.color.trim())?.color ?? '';
  const parts = [namePart(order.number) || 'PH-draft', namePart(item.product_type) || 'izdelie', namePart(color), 'maket'];
  return asciiFileName(`${parts.filter(Boolean).join('-')}.pdf`, 'maket', 'pdf');
}
