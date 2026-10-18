/**
 * Лист «PDF макета» одним SVG (перенос DM `lib/export/buildSceneSvg.ts`,
 * минимальный тех-лист): шапка заказа, рисунок вида 1:1 в мм (флэт + нанесения
 * + отступ от опоры + плашка Ш×В), крупная метка размера и шкала 1:1.
 *
 * Отличия от DM:
 * - шапка — наш заказ (клиент, номер, позиция, статус подписью), у типового
 *   силуэта — пометка «силуэт типовой, не лекало модели» (проверка скиллами);
 * - сборка строкой только через `num`/`esc`/`escAttr` (H1): клиент
 *   с `"><image onerror>` остаётся текстом; картинки — только data:image base64;
 * - готовая сцена проходит `sanitizeSvg` в режиме `scene` и уходит в PDF
 *   (svg2pdf, задача 7) очищенной; `style` у текста нет — санитайзер его режет.
 *
 * Задача 7 (PDF макета):
 * - легенда внизу листа — строка на нанесение с его номером в позиции (номер
 *   в ТЗ), номер повторяется на плашке Ш×В; строк больше четырёх — лист длиннее;
 * - пометки шапки (`meta.notes`: «логотип N — растр») — одной строкой
 *   с пометкой типового силуэта;
 * - жирный — только словом `bold`: у шрифта PDF два начертания (normal, bold),
 *   а «800» svg2pdf искал бы как отдельное и уходил бы на Times без кириллицы.
 *
 * Веха 6+7, задача 3 (К6) — мокап в ячейке ТЗ:
 * - `outputScale` (мм листа ТЗ на мм сцены) ≠ 1 — режим мокапа: без шапки,
 *   шкалы «1:1» и метки размера (лист уменьшен — «1:1» было бы неправдой),
 *   лист = флэт с полями (`mockupSceneMm`). Подписи разметки крупнее в сцене
 *   ровно настолько, чтобы в PDF выйти не мельче 7 pt, линии — не тоньше 0,25 мм;
 * - `highlight` — `print_key` текущего нанесения: отступ и плашка Ш×В только
 *   у него, рисунки — у всех нанесений вида;
 * - по умолчанию (`outputScale` = 1, без `highlight`) лист макета 5а побайтно
 *   прежний — sha-256 эталона закреплён в тесте.
 */
import type { FlatView, Placement, ProfileOf } from '../types';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { buildDimensionLines, type DimensionScene } from '../geometry/dimensionLines';
import { recolorGarment } from './flatMarkup';
import { clipRect, placementImage } from './placementSvg';
import { esc, escAttr, innerSvg, num } from './svgText';

/**
 * Семейство шрифта листа: под этим именем `exportPdf` регистрирует в jsPDF подмножество
 * Liberation Sans (кириллица). Имя — не «Liberation…»: у изменённой версии шрифта
 * зарезервированное имя по OFL занимать нельзя (`export/fonts/OFL.txt`)
 */
export const PDF_FONT_FAMILY = 'PHMaketSans';

export const TYPICAL_FLAT_NOTE = 'Силуэт типовой, не лекало модели';

export interface SceneMeta {
  client: string;
  orderNumber: string;
  /** Позиция: «Футболка Regular, чёрный» */
  itemTitle: string;
  date: string;
  /** Метка размера под рисунком (M, L, ONE SIZE) */
  size: string;
  /** Статус заказа подписью («Расчёт», «В производстве») */
  statusLabel?: string;
  /** Флэт типовой — пометка в шапке */
  typicalFlat?: boolean;
  /** Пометки шапки: «логотип N — растр» (PDF макета) */
  notes?: string[];
}

/** Строка легенды: нанесение (`print_key`), его номер в позиции и подпись */
export interface LegendRow {
  printKey: string;
  n: number;
  text: string;
}

export interface SceneInput {
  view: FlatView;
  /** Очищенная разметка флэта (`resolveFlat`) */
  flatMarkup: string;
  flatMm: { w: number; h: number };
  garmentColor?: string;
  placements: Placement[];
  /** Картинки нанесений по `print_key` — `data:image/(png|svg+xml);base64,…` */
  images: Record<string, string>;
  meta: SceneMeta;
  /** Профиль техники (`model/printMethods.printMethodProfile`) — режим цвета слоя */
  profileOf?: ProfileOf;
  /** Легенда листа (PDF макета); нет — без легенды и номеров на плашках */
  legend?: LegendRow[];
  /** Мм листа ТЗ на мм сцены (мокап в ячейке); 1 — лист макета 1:1 */
  outputScale?: number;
  /** `print_key` выделенного нанесения: разметка только у него */
  highlight?: string;
}

const PAD = 14;
/** 7 pt в мм: подписи мокапа в PDF не мельче */
const MIN_LABEL_MM = (7 * 25.4) / 72;
/** Линии разметки мокапа в PDF не тоньше, мм */
const MIN_LINE_MM = 0.25;
/** Кегль подписей разметки (число отступа и плашка Ш×В) на листе 1:1 */
const MARK_FONT = 11;

/** Лист мокапа: флэт с полями, без шапки и нижнего блока */
export function mockupSceneMm(flatMm: { w: number; h: number }): { w: number; h: number } {
  return { w: PAD + flatMm.w + PAD, h: PAD + flatMm.h + PAD };
}

/** Размеры разметки: `k` — множитель подписей, `line` — толщина линии в единицах сцены */
interface MarkSize { k: number; line: (v: number) => number }

const SIZE_1_1: MarkSize = { k: 1, line: (v) => v };

/** Вверх до тысячной — `num` округляет до 0,001, и порог не должен уйти вниз */
const ceil3 = (v: number) => Math.ceil(v * 1000 - 1e-9) / 1000;

function markSize(outputScale: number): MarkSize {
  if (outputScale === 1) return SIZE_1_1;
  const font = ceil3(Math.max(MARK_FONT, MIN_LABEL_MM / outputScale));
  return { k: font / MARK_FONT, line: (v) => ceil3(Math.max(v, MIN_LINE_MM / outputScale)) };
}

const C = {
  ink: '#111827', body: '#4b5563', label: '#6b7280', hint: '#9ca3af',
  line: '#e4e7ec', chip: '#eef0f3', zone: '#2563eb', anchor: '#e11d48', halo: '#ffffff',
};

/** Шкала 100 мм для контроля 1:1 линейкой */
function calibrationBar(x: number, y: number): string {
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    const h = i % 5 === 0 ? 5 : 3;
    ticks += `<line x1="${num(x + i * 10)}" y1="${num(y)}" x2="${num(x + i * 10)}" y2="${num(y - h)}" stroke="${C.body}" stroke-width="0.5"/>`;
  }
  return `<g data-calibration-mm="100">`
    + `<text x="${num(x)}" y="${num(y - 8)}" font-size="8" fill="${C.hint}">масштаб 1:1</text>`
    + `<line x1="${num(x)}" y1="${num(y)}" x2="${num(x + 100)}" y2="${num(y)}" stroke="${C.body}" stroke-width="0.75"/>${ticks}`
    + `<text x="${num(x)}" y="${num(y + 9)}" font-size="9" fill="${C.body}">0</text>`
    + `<text x="${num(x + 100)}" y="${num(y + 9)}" font-size="9" fill="${C.body}" text-anchor="end">100 мм</text></g>`;
}

/** Красная линия отступа от опоры (горловина, пояс, верх зоны) с числом */
function offsetMarkup(scene: DimensionScene, sz: MarkSize): string {
  const v = scene.lines.find((l) => l.kind === 'vertical-anchor')!;
  const { aabb, centerX, anchorY } = scene;
  const { k } = sz;
  const label = String(Math.round(v.value));
  const w = (label.length * 3.5 + 6) * k;
  const ly = anchorY + Math.max(9 * k, (aabb.y - anchorY) / 2);
  const dash = k === 1 ? '5 4' : `${num(5 * k)} ${num(4 * k)}`;
  return `<line x1="${num(v.from.x)}" y1="${num(v.from.y)}" x2="${num(v.to.x)}" y2="${num(v.to.y)}" stroke="${C.anchor}" stroke-width="${num(sz.line(1))}" stroke-dasharray="${dash}"/>`
    + `<rect x="${num(centerX - 5 * k - w)}" y="${num(ly - 9 * k)}" width="${num(w)}" height="${num(12 * k)}" rx="${num(2 * k)}" fill="${C.halo}" fill-opacity="0.85"/>`
    + `<text x="${num(centerX - 8 * k)}" y="${num(ly)}" font-size="${num(MARK_FONT * k)}" fill="${C.anchor}" text-anchor="end">${esc(label)}</text>`
    + `<circle cx="${num(centerX)}" cy="${num(anchorY)}" r="${num(3 * k)}" fill="${C.anchor}"/>`;
}

/** Синяя плашка «Ш×В мм» у верха нанесения; с легендой — «N · Ш×В мм» */
function sizePlate(scene: DimensionScene, sz: MarkSize, n?: number): string {
  const { aabb } = scene;
  const { k } = sz;
  const midX = aabb.x + aabb.w / 2;
  const size = `${Math.round(aabb.w)}×${Math.round(aabb.h)} мм`;
  const text = n === undefined ? size : `${n} · ${size}`;
  const half = (text.length * 3.6 + 3) * k;
  return `<rect x="${num(midX - half)}" y="${num(aabb.y + 3 * k)}" width="${num(half * 2)}" height="${num(16 * k)}" rx="${num(2 * k)}" fill="${C.zone}"/>`
    + `<text x="${num(midX)}" y="${num(aabb.y + 14 * k)}" font-size="${num(MARK_FONT * k)}" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(text)}</text>`;
}

/** Шапка: вордмарк, клиент · № заказа · дата, позиция, статус, пометка типового силуэта */
function header(W: number, meta: SceneMeta): string {
  const rx = W - 14;
  const line = `Клиент: ${String(meta.client ?? '').trim() || '—'} · Заказ №: ${String(meta.orderNumber ?? '').trim() || '—'} · ${meta.date}`;
  const chip = meta.statusLabel
    ? `<rect x="${num(rx - 40)}" y="12.5" width="40" height="7" rx="2" fill="${C.chip}"/>`
      + `<text x="${num(rx - 20)}" y="17.5" font-size="5.5" fill="${C.label}" text-anchor="middle">${esc(meta.statusLabel)}</text>`
    : '';
  const marks = [meta.typicalFlat ? TYPICAL_FLAT_NOTE : '', ...(meta.notes ?? [])].filter(Boolean).join(' · ');
  const typical = marks
    ? `<text x="14" y="25" font-size="5.5" fill="${C.anchor}">${esc(marks)}</text>`
    : '';
  return `<g data-order-header="1">`
    + `<text x="14" y="12" font-size="10" font-weight="bold" fill="${C.ink}" letter-spacing="-0.3">PINHEAD</text>`
    + `<text x="14" y="18.5" font-size="5.5" fill="${C.label}">Макет · масштаб 1:1 · мм · ${esc(meta.itemTitle)}</text>`
    + `<text x="${num(rx)}" y="9.5" font-size="6.5" fill="${C.ink}" text-anchor="end">${esc(line)}</text>`
    + `${chip}${typical}`
    + `<line x1="14" y1="28" x2="${num(rx)}" y2="28" stroke="${C.line}" stroke-width="0.6"/></g>`;
}

const LEGEND = { top: 10, lineH: 7, fontSize: 6 };

/** Высота блока под рисунком: метка размера и шкала либо легенда, что выше */
function bottomHeight(rows: number, sizeBlock: number): number {
  return rows > 0 ? Math.max(sizeBlock, LEGEND.top + rows * LEGEND.lineH + 4) : sizeBlock;
}

/** Легенда слева под рисунком; строка длиннее места до метки размера — с многоточием */
function legendMarkup(rows: LegendRow[], top: number, maxWidth: number): string {
  if (rows.length === 0) return '';
  const maxChars = Math.max(16, Math.floor(maxWidth / (LEGEND.fontSize * 0.55)));
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);
  const lines = rows.map((r, i) => `<text x="14" y="${num(top + LEGEND.top + i * LEGEND.lineH)}" font-size="${LEGEND.fontSize}" fill="${C.ink}">${esc(clip(`${r.n}. ${r.text}`))}</text>`);
  return `<g data-legend="1">${lines.join('')}</g>`;
}

/** Слой нанесения: техника и режим цвета — атрибутами данных */
function layerAttrs(p: Placement, profileOf?: ProfileOf): string {
  const mode = profileOf ? ` data-color-mode="${escAttr(profileOf(p.method).colorMode)}"` : '';
  return ` data-layer="production" data-method="${escAttr(p.method)}"${mode}`;
}

/** Разметка нанесений: отступ от опоры и плашка Ш×В; с выделением — только у него */
function marksMarkup(input: SceneInput, sz: MarkSize, numberOf: Map<string, number>): string {
  const own = input.highlight === undefined ? input.placements : input.placements.filter((p) => p.print_key === input.highlight);
  return own.map((p) => {
    const scene = buildDimensionLines(input.view, { x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm }, p.rotation_deg, undefined, p.area_id);
    return offsetMarkup(scene, sz) + sizePlate(scene, sz, numberOf.get(p.print_key));
  }).join('');
}

/** Рисунок вида: флэт в цвете ткани, нанесения, разметка; `top` — отступ сверху */
function drawing(input: SceneInput, top: number, sz: MarkSize, numberOf: Map<string, number>): string {
  const { view, placements, images } = input;
  const clips = placements.map((p, i) => clipRect(view, p, `clip-${i}`)).join('');
  const art = placements.map((p, i) => placementImage(p, images[p.print_key], `clip-${i}`, layerAttrs(p, input.profileOf))).join('');
  const garment = `<g transform="scale(${num(view.scale_mm_per_unit)})">${innerSvg(recolorGarment(input.flatMarkup, input.garmentColor ?? ''))}</g>`;
  const mark = input.highlight === undefined ? '' : ` data-highlight="${escAttr(input.highlight)}"`;
  return `<defs>${clips}</defs>`
    + `@@BG@@`
    + `<g transform="translate(${PAD} ${top})"${mark}>`
    + `<g data-layer="garment">${garment}</g>`
    + `<g data-layer="production-artwork">${art}</g>`
    + `<g data-layer="markup">${marksMarkup(input, sz, numberOf)}</g></g>`;
}

function svgRoot(W: number, H: number, body: string): string {
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}" font-family="${PDF_FONT_FAMILY}, Helvetica, sans-serif">`
    + body.replace('@@BG@@', `<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#ffffff"/>`)
    + '</svg>';
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new Error(`Лист макета не собран: ${clean.error}`);
  return clean.svg;
}

/** Собрать лист вида. Рисунок и страница — в мм. Итог очищен `sanitizeSvg(scene)` */
export function buildSceneSvg(input: SceneInput): string {
  const { flatMm, meta } = input;
  const scale = input.outputScale ?? 1;
  const sz = markSize(scale);
  const legend = input.legend ?? [];
  const numberOf = new Map(legend.map((r) => [r.printKey, r.n]));
  if (scale !== 1) {
    const { w, h } = mockupSceneMm(flatMm);
    return svgRoot(w, h, drawing(input, PAD, sz, numberOf));
  }
  const HEADER_H = 32;
  const SIZE_H = 42;
  const W = PAD + flatMm.w + PAD;
  const H = HEADER_H + flatMm.h + bottomHeight(legend.length, SIZE_H) + PAD;
  const sizeY = HEADER_H + flatMm.h + 30;
  const sizeFs = meta.size.length <= 3 ? 34 : 20;
  const sizeHalf = meta.size.length * sizeFs * 0.35;
  const body = drawing(input, HEADER_H, sz, numberOf).replace('@@BG@@', `@@BG@@${header(W, meta)}`)
    + legendMarkup(legend, HEADER_H + flatMm.h, W / 2 - sizeHalf - PAD - 6)
    + `<g data-size-label="${escAttr(meta.size)}"><text x="${num(W / 2)}" y="${num(sizeY + 4)}" font-size="${sizeFs}" font-weight="bold" fill="${C.ink}" text-anchor="middle">${esc(meta.size)}</text></g>`
    + calibrationBar(W - PAD - 100, sizeY - 4);
  return svgRoot(W, H, body);
}
