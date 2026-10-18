/**
 * Чистое превью вида: флэт (+ цвет ткани) и макеты, обрезанные по зонам.
 * Без тех-линий. Перенос DM `lib/export/buildPreviewSvg.ts`.
 * Нужен вкладке «Дизайн» на ≤ 760 px (только просмотр, `<img>`) и снимкам
 * сцены в тестах (проверка скиллами: сцена проверяется снимком строки).
 *
 * Сборка — строкой через `num`/`escAttr` (H1), итог — через `sanitizeSvg`
 * в режиме `scene`: в `<img>` уходит только очищенный SVG.
 */
import type { FlatView, Placement } from '../types';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { recolorGarment } from './flatMarkup';
import { clipRect, placementImage } from './placementSvg';
import { innerSvg, num } from './svgText';

export interface PreviewInput {
  view: FlatView;
  /** Очищенная разметка флэта (`resolveFlat`) */
  flatMarkup: string;
  flatMm: { w: number; h: number };
  garmentColor?: string;
  placements: Placement[];
  /** Картинки нанесений по `print_key` — `data:image/(png|svg+xml);base64,…` */
  images: Record<string, string>;
}

/** SVG превью вида (очищенный) */
export function buildPreviewSvg(input: PreviewInput): string {
  const { view, flatMm, placements, images } = input;
  const W = num(flatMm.w);
  const H = num(flatMm.h);
  const clips = placements.map((p, i) => clipRect(view, p, `pc-${i}`)).join('');
  const art = placements.map((p, i) => placementImage(p, images[p.print_key], `pc-${i}`)).join('');
  const flat = `<g transform="scale(${num(view.scale_mm_per_unit)})">${innerSvg(recolorGarment(input.flatMarkup, input.garmentColor ?? ''))}</g>`;
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>${clips}</defs>${flat}${art}</svg>`;
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new Error(`Превью не собрано: ${clean.error}`);
  return clean.svg;
}
