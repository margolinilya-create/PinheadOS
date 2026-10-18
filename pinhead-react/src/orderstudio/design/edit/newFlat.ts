/**
 * Чтение SVG силуэта для редактора флэта (веха 5б, К9 — WYSIWYG через санитайзер;
 * перенос DM `lib/admin/flatDraft.ts`).
 *
 * Порядок проверок:
 * 1. тип по байтам (`sniffArtwork`) — только SVG; не больше 1 МБ (как бакет флэтов);
 *    текст — строгий UTF-8 (`TextDecoder` с `fatal`); UTF-16 (BOM) или
 *    `encoding` не UTF-8 в прологе — «Сохраните SVG в UTF-8»;
 * 2. `sanitizeSvg` — очищенный текст и есть то, что загрузится (К4);
 * 3. группа `<g id="garment">` (иначе силуэт не перекрасится) и `viewBox`.
 *
 * Масштаб: у `width` физическая единица (mm, cm, pt, in) — мм / `vb.w`,
 * иначе 1 (договорённость «viewBox — мм»). Что вырезал санитайзер, показывается
 * человеческими подписями по виду, схлопнуто и не длиннее 20 строк: имена из
 * файла в список не идут (злонамеренный SVG не раздует интерфейс и `aria-live`).
 */
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { sniffArtwork } from '../assets/sniff';
import { FLAT_SVG_MAX_BYTES, MAX_SCALE_MM_PER_UNIT } from '../limits';

export const MSG_ONLY_SVG = 'Силуэт — только SVG: сохраните контур в SVG (Illustrator: «Экспорт» → SVG)';
export const MSG_UTF8 = 'Сохраните SVG в UTF-8';
export const MSG_NO_GARMENT = 'В SVG нет группы силуэта <g id="garment"> — без неё силуэт не перекрасится в цвет ткани';
export const MSG_NO_VIEWBOX = 'В SVG нет viewBox — масштаб не определить';
export const MSG_TOO_BIG = 'Файл силуэта больше 1 МБ — упростите контур или сохраните без встроенных картинок';

/** Что убрано из файла: подпись по виду и сколько раз */
export interface RemovedItem { label: string; count: number }

export type FlatSvgRead =
  | { ok: true; svg: string; removed: RemovedItem[]; vb: { w: number; h: number }; scale: number }
  | { ok: false; error: string };

const MAX_REMOVED_ROWS = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Подпись вырезанного санитайзером (`el@attr (why)`, `<name>`, `#node`) по виду */
export function removedLabel(item: string): string {
  if (/^<script>$/i.test(item)) return 'скрипты';
  if (/\(event\)$/.test(item)) return 'обработчики событий';
  if (/\((href|url|xlink)\)$/.test(item) || /^<use /.test(item)) return 'внешние ссылки';
  if (/^<image>$/i.test(item)) return 'встроенные картинки';
  if (/\(style\)$/.test(item) || /^<(style|font|font-face)>$/i.test(item)) return 'стили и шрифты';
  return 'другое';
}

/** Схлопнуть список санитайзера по подписи, не больше 20 строк */
export function summarizeRemoved(removed: readonly string[]): RemovedItem[] {
  const counts = new Map<string, number>();
  for (const r of removed) {
    const label = removedLabel(r);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].slice(0, MAX_REMOVED_ROWS).map(([label, count]) => ({ label, count }));
}

/** Строка для показа: «обработчики событий ×12» */
export function removedText(item: RemovedItem): string {
  return item.count > 1 ? `${item.label} ×${item.count}` : item.label;
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, pt: 25.4 / 72, in: 25.4 };

/** Масштаб «мм на единицу viewBox» по `width` с физической единицей; иначе 1 */
export function scaleFromWidth(svg: string, vbW: number): number {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const m = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*(mm|cm|pt|in)\s*$/i.exec(root.getAttribute('width') ?? '');
  if (!m) return 1;
  const k = (Number(m[1]) * UNIT_MM[m[2].toLowerCase()]) / vbW;
  return Number.isFinite(k) && k > 0 && k <= MAX_SCALE_MM_PER_UNIT ? k : 1;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes[0] === 0 || bytes[1] === 0;
  if (utf16) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const enc = /^\uFEFF?\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
    return enc && !/^utf-?8$/i.test(enc) ? null : text;
  } catch {
    return null;
  }
}

/** Конечный viewBox с положительными сторонами корня очищенного SVG */
function viewBoxOf(root: Element): { w: number; h: number } | null {
  const p = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0 ? { w: p[2], h: p[3] } : null;
}

/** Прочитать SVG силуэта: очищенный текст, что убрано, viewBox и масштаб; отказ — текстом */
export function readFlatSvg(bytes: Uint8Array, fileName: string): FlatSvgRead {
  if (bytes.length > FLAT_SVG_MAX_BYTES) return { ok: false, error: MSG_TOO_BIG };
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (utf16) return { ok: false, error: MSG_UTF8 };
  const kind = sniffArtwork(bytes, fileName);
  if (!kind.ok || kind.kind !== 'svg') return { ok: false, error: MSG_ONLY_SVG };
  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, error: MSG_UTF8 };
  const clean = sanitizeSvg(text);
  if (!clean.ok) return { ok: false, error: clean.error };
  const root = new DOMParser().parseFromString(clean.svg, 'image/svg+xml').documentElement;
  const hasGarment = Array.from(root.getElementsByTagNameNS(SVG_NS, 'g')).some((g) => g.getAttribute('id') === 'garment');
  if (!hasGarment) return { ok: false, error: MSG_NO_GARMENT };
  const vb = viewBoxOf(root);
  if (!vb) return { ok: false, error: MSG_NO_VIEWBOX };
  return { ok: true, svg: clean.svg, removed: summarizeRemoved(clean.removed), vb, scale: scaleFromWidth(clean.svg, vb.w) };
}
