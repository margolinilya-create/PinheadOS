/**
 * Детали из разобранного файла → лекала в мм (веха 5в, Э2б): масштаб по
 * единицам, упрощение (допуск 0,3 мм, ≤ 400 точек), округление до 0,1 мм.
 * Единицы файла неизвестны — их выбирает человек (по умолчанию мм).
 */
import { bbox, simplifyClosed, type Pt } from './geom';
import type { DxfUnits, RawPiece } from './dxf';

export const PATTERN_TOLERANCE_MM = 0.3;
export const PATTERN_MAX_POINTS = 400;

export const UNIT_TO_MM: Record<DxfUnits, number> = { mm: 1, cm: 10, in: 25.4, m: 1000 };

export interface ImportedPiece {
  name: string;
  contour_mm: [number, number][];
  /** Размер детали, мм (рамка) — для подписи «56 × 72 см» */
  width_mm: number;
  height_mm: number;
}

const tenth = (v: number) => Math.round(v * 10) / 10;

export function toPatternPieces(raw: readonly RawPiece[], mmPerUnit: number): ImportedPiece[] {
  return raw.map((p) => {
    const pts = simplifyClosed(p.contour.map(([x, y]) => [x * mmPerUnit, y * mmPerUnit] as Pt), PATTERN_TOLERANCE_MM, PATTERN_MAX_POINTS)
      .map(([x, y]) => [tenth(x), tenth(y)] as [number, number]);
    const b = bbox(pts);
    return { name: p.name, contour_mm: pts, width_mm: tenth(b.w), height_mm: tenth(b.h) };
  }).filter((p) => p.contour_mm.length >= 3 && p.width_mm > 0 && p.height_mm > 0);
}

/** «56 × 72 см» — размер детали для подписи */
export function pieceSizeText(p: Pick<ImportedPiece, 'width_mm' | 'height_mm'>): string {
  const cm = (v: number) => (Math.round(v / 10 * 10) / 10).toLocaleString('ru-RU');
  return `${cm(p.width_mm)} × ${cm(p.height_mm)} см`;
}
