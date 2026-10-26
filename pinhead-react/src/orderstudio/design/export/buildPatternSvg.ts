/**
 * Лист «Выкройка» (веха 5в, Э2б): детали кроя позиции рядом в натуральную
 * величину — контур лекала заливкой цвета ткани, зоны печати пунктиром,
 * нанесения (клип по зоне, как в превью), подпись детали и линейка 10 см.
 * Лекало стоит в мм вида, поэтому нанесения ложатся по своим `x_mm/y_mm`.
 *
 * Сборка — строкой через `num`/`esc`/`escAttr`, итог — `sanitizeSvg(…, 'scene')`:
 * в `<img>` уходит только очищенный SVG (как `buildPreviewSvg`).
 */
import type { FlatView, Placement } from '../types';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { validHex } from '../assets/garmentHex';
import { clipRect, placementImage } from './placementSvg';
import { esc, escAttr, num } from './svgText';

export const PIECE_GAP_MM = 40;
const MARGIN_MM = 30;
const LABEL_MM = 24;
const RULER_MM = 100;
/** Подпись — не мельче 1/60 ширины листа: лист вписывается в ширину экрана, мм-шрифт иначе мелок */
const fontFor = (sheetW: number) => Math.max(14, Math.round(sheetW / 60));

export interface PatternPieceInput {
  view: FlatView;
  /** «Перед» */
  title: string;
  placements: Placement[];
  /** Картинки нанесений по `print_key` — `data:image/(png|svg+xml);base64,…` */
  images: Record<string, string | undefined>;
}

export interface PatternSheetInput {
  pieces: PatternPieceInput[];
  garmentColor?: string;
}

const boxOf = (pts: readonly [number, number][]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const cm = (mm: number) => (Math.round(mm) / 10).toLocaleString('ru-RU');

/** Подпись детали: «Перед · 56 × 72 см · крой: 1» */
export function pieceLabel(title: string, w: number, h: number, count: number): string {
  return `${title} · ${cm(w)} × ${cm(h)} см · крой: ${count}`;
}

/** SVG листа (очищенный); деталей с лекалом нет — `null` */
export function buildPatternSvg(input: PatternSheetInput): string | null {
  const pieces = input.pieces.filter((p) => p.view.pattern);
  if (pieces.length === 0) return null;
  const fill = validHex(input.garmentColor) ? input.garmentColor : '#ffffff';
  const widths = pieces.map((p) => boxOf(p.view.pattern!.contour_mm).w);
  const font = fontFor(MARGIN_MM * 2 + widths.reduce((a, w) => a + w, 0) + PIECE_GAP_MM * (pieces.length - 1));
  const labelH = Math.max(LABEL_MM, font + 10);
  let cursor = MARGIN_MM;
  let maxH = 0;
  const parts: string[] = [];
  const defs: string[] = [];
  pieces.forEach((piece, i) => {
    const pattern = piece.view.pattern!;
    const b = boxOf(pattern.contour_mm);
    const dx = cursor - b.x;
    const dy = MARGIN_MM + labelH - b.y;
    const points = pattern.contour_mm.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
    const zones = piece.view.print_areas.filter((a) => a.zone_id !== null)
      .map((a) => `<polygon points="${a.polygon_mm.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}" fill="none" stroke="#2B2BF0" stroke-width="0.8" stroke-dasharray="4 3"/>`).join('');
    piece.placements.forEach((p, k) => defs.push(clipRect(piece.view, p, `pp-${i}-${k}`)));
    const art = piece.placements.map((p, k) => placementImage(p, piece.images[p.print_key], `pp-${i}-${k}`)).join('');
    const label = pieceLabel(piece.title, b.w, b.h, pattern.count);
    parts.push(
      `<g transform="translate(${num(dx)} ${num(dy)})">`
      + `<polygon points="${points}" fill="${escAttr(fill)}" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/>`
      + `${zones}${art}</g>`
      + `<text x="${num(cursor)}" y="${num(MARGIN_MM + labelH - 8)}" font-size="${font}" font-family="sans-serif" fill="#1a1a1a">${esc(label)}</text>`,
    );
    cursor += b.w + PIECE_GAP_MM;
    maxH = Math.max(maxH, b.h);
  });
  const W = cursor - PIECE_GAP_MM + MARGIN_MM;
  const rulerY = MARGIN_MM + labelH + maxH + 30;
  const H = rulerY + font + 20;
  const ruler = `<g stroke="#1a1a1a" stroke-width="1"><line x1="${MARGIN_MM}" y1="${num(rulerY)}" x2="${MARGIN_MM + RULER_MM}" y2="${num(rulerY)}"/>`
    + Array.from({ length: 11 }, (_, k) => `<line x1="${MARGIN_MM + k * 10}" y1="${num(rulerY - (k % 5 === 0 ? 6 : 3))}" x2="${MARGIN_MM + k * 10}" y2="${num(rulerY)}"/>`).join('')
    + `</g><text x="${MARGIN_MM + RULER_MM + 8}" y="${num(rulerY + font / 3)}" font-size="${font}" font-family="sans-serif" fill="#1a1a1a">10 см</text>`;
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}mm" height="${num(H)}mm" viewBox="0 0 ${num(W)} ${num(H)}">`
    + `<defs>${defs.join('')}</defs><rect width="${num(W)}" height="${num(H)}" fill="#ffffff"/>${parts.join('')}${ruler}</svg>`;
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new Error(`Лист выкройки не собран: ${clean.error}`);
  return clean.svg;
}
