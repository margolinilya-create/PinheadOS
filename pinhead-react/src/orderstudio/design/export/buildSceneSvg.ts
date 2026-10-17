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
 */
import type { FlatView, Placement, ProfileOf } from '../types';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { buildDimensionLines, type DimensionScene } from '../geometry/dimensionLines';
import { recolorGarment } from './flatMarkup';
import { clipRect, placementImage } from './placementSvg';
import { esc, escAttr, innerSvg, num } from './svgText';

/** Семейство шрифта листа: jsPDF регистрирует LiberationSans (кириллица), задача 7 */
export const PDF_FONT_FAMILY = 'LiberationSans';

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
function offsetMarkup(scene: DimensionScene): string {
  const v = scene.lines.find((l) => l.kind === 'vertical-anchor')!;
  const { aabb, centerX, anchorY } = scene;
  const label = String(Math.round(v.value));
  const w = label.length * 3.5 + 6;
  const ly = anchorY + Math.max(9, (aabb.y - anchorY) / 2);
  return `<line x1="${num(v.from.x)}" y1="${num(v.from.y)}" x2="${num(v.to.x)}" y2="${num(v.to.y)}" stroke="${C.anchor}" stroke-width="1" stroke-dasharray="5 4"/>`
    + `<rect x="${num(centerX - 5 - w)}" y="${num(ly - 9)}" width="${num(w)}" height="12" rx="2" fill="${C.halo}" fill-opacity="0.85"/>`
    + `<text x="${num(centerX - 8)}" y="${num(ly)}" font-size="11" fill="${C.anchor}" text-anchor="end">${esc(label)}</text>`
    + `<circle cx="${num(centerX)}" cy="${num(anchorY)}" r="3" fill="${C.anchor}"/>`;
}

/** Синяя плашка «Ш×В мм» у верха нанесения */
function sizePlate(scene: DimensionScene): string {
  const { aabb } = scene;
  const midX = aabb.x + aabb.w / 2;
  const text = `${Math.round(aabb.w)}×${Math.round(aabb.h)} мм`;
  const half = text.length * 3.6 + 3;
  return `<rect x="${num(midX - half)}" y="${num(aabb.y + 3)}" width="${num(half * 2)}" height="16" rx="2" fill="${C.zone}"/>`
    + `<text x="${num(midX)}" y="${num(aabb.y + 14)}" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(text)}</text>`;
}

/** Шапка: вордмарк, клиент · № заказа · дата, позиция, статус, пометка типового силуэта */
function header(W: number, meta: SceneMeta): string {
  const rx = W - 14;
  const line = `Клиент: ${String(meta.client ?? '').trim() || '—'} · Заказ №: ${String(meta.orderNumber ?? '').trim() || '—'} · ${meta.date}`;
  const chip = meta.statusLabel
    ? `<rect x="${num(rx - 40)}" y="12.5" width="40" height="7" rx="2" fill="${C.chip}"/>`
      + `<text x="${num(rx - 20)}" y="17.5" font-size="5.5" fill="${C.label}" text-anchor="middle">${esc(meta.statusLabel)}</text>`
    : '';
  const typical = meta.typicalFlat
    ? `<text x="14" y="25" font-size="5.5" fill="${C.anchor}">${esc(TYPICAL_FLAT_NOTE)}</text>`
    : '';
  return `<g data-order-header="1">`
    + `<text x="14" y="12" font-size="10" font-weight="800" fill="${C.ink}" letter-spacing="-0.3">PINHEAD</text>`
    + `<text x="14" y="18.5" font-size="5.5" fill="${C.label}">Макет · масштаб 1:1 · мм · ${esc(meta.itemTitle)}</text>`
    + `<text x="${num(rx)}" y="9.5" font-size="6.5" fill="${C.ink}" text-anchor="end">${esc(line)}</text>`
    + `${chip}${typical}`
    + `<line x1="14" y1="28" x2="${num(rx)}" y2="28" stroke="${C.line}" stroke-width="0.6"/></g>`;
}

/** Слой нанесения: техника и режим цвета — атрибутами данных */
function layerAttrs(p: Placement, profileOf?: ProfileOf): string {
  const mode = profileOf ? ` data-color-mode="${escAttr(profileOf(p.method).colorMode)}"` : '';
  return ` data-layer="production" data-method="${escAttr(p.method)}"${mode}`;
}

/** Собрать лист вида. Рисунок и страница — в мм. Итог очищен `sanitizeSvg(scene)` */
export function buildSceneSvg(input: SceneInput): string {
  const { view, flatMm, placements, images, meta } = input;
  const PAD = 14;
  const HEADER_H = 32;
  const SIZE_H = 42;
  const W = PAD + flatMm.w + PAD;
  const H = HEADER_H + flatMm.h + SIZE_H + PAD;

  const clips = placements.map((p, i) => clipRect(view, p, `clip-${i}`)).join('');
  const art = placements.map((p, i) => placementImage(p, images[p.print_key], `clip-${i}`, layerAttrs(p, input.profileOf))).join('');
  const marks = placements.map((p) => {
    const scene = buildDimensionLines(view, { x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm }, p.rotation_deg, undefined, p.area_id);
    return offsetMarkup(scene) + sizePlate(scene);
  }).join('');
  const garment = `<g transform="scale(${num(view.scale_mm_per_unit)})">${innerSvg(recolorGarment(input.flatMarkup, input.garmentColor ?? ''))}</g>`;

  const sizeY = HEADER_H + flatMm.h + 30;
  const sizeFs = meta.size.length <= 3 ? 34 : 20;
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}" font-family="${PDF_FONT_FAMILY}, Helvetica, sans-serif">`
    + `<defs>${clips}</defs>`
    + `<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="#ffffff"/>`
    + header(W, meta)
    + `<g transform="translate(${PAD} ${HEADER_H})">`
    + `<g data-layer="garment">${garment}</g>`
    + `<g data-layer="production-artwork">${art}</g>`
    + `<g data-layer="markup">${marks}</g></g>`
    + `<g data-size-label="${escAttr(meta.size)}"><text x="${num(W / 2)}" y="${num(sizeY + 4)}" font-size="${sizeFs}" font-weight="800" fill="${C.ink}" text-anchor="middle">${esc(meta.size)}</text></g>`
    + calibrationBar(W - PAD - 100, sizeY - 4)
    + '</svg>';
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new Error(`Лист макета не собран: ${clean.error}`);
  return clean.svg;
}
