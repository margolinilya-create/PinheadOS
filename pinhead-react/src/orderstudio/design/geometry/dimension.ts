// Расчёт отступов и полной обвязки (BUILD.md §4, скил merch-geometry).
// Все величины — в мм.

import type { Bbox, Zone } from './coords';

export interface FrontBackAnchors {
  neckline_point: { x: number; y: number };
  center_axis_x: number;
}

export interface SleeveAnchors {
  sleeve_bottom_y: number;
  sleeve_center_x: number;
}

/** Вертикаль от горловины до верха bbox макета (front/back). */
export function verticalFromNeckline(bbox: Bbox, necklineY: number): number {
  return bbox.y - necklineY;
}

/** Горизонталь от оси центра до центра bbox (0 = по центру). */
export function horizontalFromCenter(bbox: Bbox, centerAxisX: number): number {
  return bbox.x + bbox.w / 2 - centerAxisX;
}

/** Вертикаль от нижнего края рукава вверх до низа bbox (sleeve). */
export function verticalFromBottom(bbox: Bbox, sleeveBottomY: number): number {
  return sleeveBottomY - (bbox.y + bbox.h);
}

export interface FullDimensions {
  /** Отступы до краёв зоны (мм). Отрицательный = выход за зону. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Реальный размер печати (мм). */
  printWidth: number;
  printHeight: number;
}

/** Полная обвязка bbox внутри зоны (BUILD.md §4). */
export function fullDimensions(bbox: Bbox, zone: Zone): FullDimensions {
  return {
    left: bbox.x - zone.zx,
    right: zone.zx + zone.zw - (bbox.x + bbox.w),
    top: bbox.y - zone.zy,
    bottom: zone.zy + zone.zh - (bbox.y + bbox.h),
    printWidth: bbox.w,
    printHeight: bbox.h,
  };
}
