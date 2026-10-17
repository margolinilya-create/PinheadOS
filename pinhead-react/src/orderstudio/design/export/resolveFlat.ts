/**
 * Флэт для холста, превью и PDF: текст SVG из бакета → очищенная разметка
 * и габарит в мм. Перенос DM `lib/export/resolveFlat.ts` без растровых флэтов
 * (у нас флэт — только SVG справочника) и без сети.
 *
 * Санитайзер — повторно перед показом (защита в глубину, решение 10 плана):
 * сид чистит флэт при загрузке, но admin может положить объект мимо сида.
 */
import type { FlatView } from '../types';
import { parseViewBox } from '../catalog/svgMeta';
import { sanitizeSvg } from '../assets/sanitizeSvg';

export interface ResolvedFlat {
  /** Очищенная разметка `<svg>…</svg>` */
  markup: string;
  /** Габарит флэта, мм (viewBox × `scale_mm_per_unit`) */
  flatMm: { w: number; h: number };
  /** Что санитайзер вырезал (у сида — пусто) */
  removed: string[];
}

/** Флэт вида; битый SVG или без viewBox — `null` (показать ошибку, а не рисовать наугад) */
export function resolveFlat(svgText: string, view: Pick<FlatView, 'scale_mm_per_unit'>): ResolvedFlat | null {
  const clean = sanitizeSvg(svgText);
  if (!clean.ok) return null;
  const vb = parseViewBox(clean.svg);
  if (!vb || !(vb.w > 0) || !(vb.h > 0)) return null;
  const k = view.scale_mm_per_unit;
  return { markup: clean.svg, flatMm: { w: vb.w * k, h: vb.h * k }, removed: clean.removed };
}
