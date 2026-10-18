// Проверка выхода за печатную зону (BUILD.md §4, скил merch-geometry).
// Не блокирует сохранение — только предупреждает.

import type { Bbox, Zone } from './coords';
import { fullDimensions, type FullDimensions } from './dimension';

export interface ZoneCheck {
  out_of_zone: boolean;
  /** Строгая проверка против safe-zone (safe_inset_mm). */
  out_of_safe_zone: boolean;
  dimensions: FullDimensions;
}

/**
 * out_of_zone=true, если любой из отступов left/right/top/bottom < 0.
 * Строгий режим — те же отступы должны быть >= safe_inset_mm.
 */
export function checkZone(
  bbox: Bbox,
  zone: Zone,
  safeInsetMm = 0,
): ZoneCheck {
  const d = fullDimensions(bbox, zone);
  const out_of_zone =
    d.left < 0 || d.right < 0 || d.top < 0 || d.bottom < 0;
  const out_of_safe_zone =
    d.left < safeInsetMm ||
    d.right < safeInsetMm ||
    d.top < safeInsetMm ||
    d.bottom < safeInsetMm;
  return { out_of_zone, out_of_safe_zone, dimensions: d };
}
