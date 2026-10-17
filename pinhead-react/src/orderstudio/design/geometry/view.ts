// Связка вида флэта ↔ геометрия размещения. Перенос DM `lib/geometry/view.ts`.
// Отличия от DM: вид — `FlatView` справочника (без размерных флэтов и зон
// по размеру — их нет в 5а); ростовка (`regradePosition`, `grading`) не
// переносится — веха 5б (проверка скиллами, техдолг).
import type { DesignView, FlatView, GarmentFlat, PrintArea, ViewAnchors } from '../types';
import { polygonToZone, rotatedAabb, type Bbox, type Zone } from './coords';
import {
  fullDimensions,
  horizontalFromCenter,
  verticalFromBottom,
  verticalFromNeckline,
  type FullDimensions,
} from './dimension';
import { checkZone, type ZoneCheck } from './zone';

export interface PlacementInfo {
  /** AABB макета с учётом поворота (мм) */
  aabb: Bbox;
  zone: Zone;
  safeInsetMm: number;
  dimensions: FullDimensions;
  check: ZoneCheck;
  /** Привязка к якорю изделия */
  anchor:
    | { kind: 'neckline'; vertical: number; horizontal: number }
    | { kind: 'sleeve'; vertical: number; horizontal: number }
    | { kind: 'panel'; vertical: number; horizontal: number };
}

const isSleeve = (view: Pick<FlatView, 'kind'>) =>
  view.kind === 'sleeve_left' || view.kind === 'sleeve_right';

/** Якоря вида для размера (нет размера — базовые) */
export function anchorsForSize(view: FlatView, size?: string): ViewAnchors {
  return (size && view.size_anchors?.[size]) || view.anchors;
}

export type PositionPreset =
  | 'center-x'
  | 'center-zone'
  | 'top'
  | 'bottom'
  | 'chest-standard'
  | 'left-chest'
  | 'back-standard';

/**
 * Отраслевые нормы размещения от якорей изделия (мм, ≈ дюймовые нормы):
 * центр груди ~75 мм (3") ниже горловины; левая грудь ~60 мм ниже и ~89 мм
 * (3,5") от центра. Центр спины — те же 75 мм от шва горловины спинки.
 */
export const STANDARD_PLACEMENT = {
  chestBelowNecklineMm: 75,
  leftChestBelowNecklineMm: 60,
  leftChestFromCenterMm: 89,
  backBelowNecklineMm: 75,
} as const;

/**
 * Готовая позиция по пресету (мм). Горизонталь — по оси изделия, верх/низ —
 * с отступом safe-inset зоны; стандартные пресеты — от горловины.
 */
export function presetPosition(
  view: FlatView,
  bbox: Bbox,
  preset: PositionPreset,
  size?: string,
  areaId?: string,
): { x_mm: number; y_mm: number } {
  const { zone, safeInsetMm } = viewZone(view, size, areaId);
  const anchors = anchorsForSize(view, size);
  const axis = isSleeve(view)
    ? (anchors.sleeve_center_x ?? zone.zx + zone.zw / 2)
    : (anchors.center_axis_x ?? zone.zx + zone.zw / 2);
  const necklineY = anchors.neckline_point?.y ?? zone.zy;
  switch (preset) {
    case 'center-x':
      return { x_mm: axis - bbox.w / 2, y_mm: bbox.y };
    case 'center-zone':
      return { x_mm: axis - bbox.w / 2, y_mm: zone.zy + (zone.zh - bbox.h) / 2 };
    case 'top':
      return { x_mm: bbox.x, y_mm: zone.zy + safeInsetMm };
    case 'bottom':
      return { x_mm: bbox.x, y_mm: zone.zy + zone.zh - bbox.h - safeInsetMm };
    case 'chest-standard':
      return { x_mm: axis - bbox.w / 2, y_mm: necklineY + STANDARD_PLACEMENT.chestBelowNecklineMm };
    case 'left-chest':
      // Левая грудь владельца изделия — справа на рисунке переда
      return {
        x_mm: axis + STANDARD_PLACEMENT.leftChestFromCenterMm - bbox.w / 2,
        y_mm: necklineY + STANDARD_PLACEMENT.leftChestBelowNecklineMm,
      };
    case 'back-standard':
      return { x_mm: axis - bbox.w / 2, y_mm: necklineY + STANDARD_PLACEMENT.backBelowNecklineMm };
  }
}

/** Центровка по именованной оси; `null` — оси нет. Y не меняется */
export function positionOnAxis(
  view: FlatView,
  bbox: Bbox,
  axisId: string,
  size?: string,
): { x_mm: number; y_mm: number } | null {
  const axis = anchorsForSize(view, size).axes?.find((a) => a.id === axisId);
  if (!axis) return null;
  return { x_mm: axis.x - bbox.w / 2, y_mm: bbox.y };
}

/**
 * Обратная задача к `verticalFromNeckline`: y рамки, при котором верх
 * ПОВЁРНУТОГО AABB отстоит от горловины на `offsetMm` (знаковое: минус — выше).
 */
export function yForNecklineOffset(
  view: FlatView,
  bbox: Bbox,
  rotationDeg: number,
  offsetMm: number,
  size?: string,
  areaId?: string,
): number {
  const { zone } = viewZone(view, size, areaId);
  const necklineY = anchorsForSize(view, size).neckline_point?.y ?? zone.zy;
  const aabb = rotatedAabb(bbox, rotationDeg);
  return bbox.y + (necklineY + offsetMm - aabb.y);
}

/**
 * Вписать (fit) или заполнить (fill) нанесение по зоне с учётом safe-inset,
 * сохраняя пропорции. fit — целиком внутри; fill — покрывает зону.
 */
export function fitToZone(
  view: FlatView,
  bbox: Bbox,
  mode: 'fit' | 'fill',
  size?: string,
  areaId?: string,
): { x_mm: number; y_mm: number; width_mm: number; height_mm: number } {
  const { zone, safeInsetMm } = viewZone(view, size, areaId);
  const availW = Math.max(1, zone.zw - 2 * safeInsetMm);
  const availH = Math.max(1, zone.zh - 2 * safeInsetMm);
  const aspect = bbox.h / bbox.w || 1;
  const sByW = availW;
  const sByH = availH / aspect;
  const w = mode === 'fit' ? Math.min(sByW, sByH) : Math.max(sByW, sByH);
  const h = w * aspect;
  return {
    width_mm: w,
    height_mm: h,
    x_mm: zone.zx + (zone.zw - w) / 2,
    y_mm: zone.zy + (zone.zh - h) / 2,
  };
}

/** Есть ли у вида зона с таким id */
export function viewHasZone(view: FlatView, areaId: string): boolean {
  return view.print_areas.some((a) => a.id === areaId);
}

/** Зона по id; нет такой — первая */
export function findPrintArea(view: FlatView, areaId?: string): PrintArea {
  const areas = view.print_areas;
  return (areaId && areas.find((a) => a.id === areaId)) || areas[0];
}

/**
 * Печатная зона вида по id (или первая). `size` сохранён в подписи ради
 * совместимости с DM: зоны по размеру появятся в 5б.
 */
export function viewZone(
  view: FlatView,
  _size?: string,
  areaId?: string,
): { zone: Zone; safeInsetMm: number } {
  const area = findPrintArea(view, areaId);
  return { zone: polygonToZone(area.polygon_mm), safeInsetMm: area.safe_inset_mm };
}

/** Полная геометрия размещения по рамке (левый верх, мм) и повороту */
export function placementInfo(
  view: FlatView,
  bbox: Bbox,
  rotationDeg: number,
  size?: string,
  areaId?: string,
): PlacementInfo {
  const aabb = rotatedAabb(bbox, rotationDeg);
  const { zone, safeInsetMm } = viewZone(view, size, areaId);
  const dimensions = fullDimensions(aabb, zone);
  const check = checkZone(aabb, zone, safeInsetMm);
  const anchors = anchorsForSize(view, size);
  const base = { aabb, zone, safeInsetMm, dimensions, check };

  if (isSleeve(view)) {
    const sb = anchors.sleeve_bottom_y ?? zone.zy + zone.zh;
    const sc = anchors.sleeve_center_x ?? zone.zx + zone.zw / 2;
    return {
      ...base,
      anchor: { kind: 'sleeve', vertical: verticalFromBottom(aabb, sb), horizontal: horizontalFromCenter(aabb, sc) },
    };
  }

  const centerX = anchors.center_axis_x ?? zone.zx + zone.zw / 2;
  if (anchors.neckline_point == null) {
    // Изделие без горловины (шоппер): вертикаль — от верха зоны
    return {
      ...base,
      anchor: { kind: 'panel', vertical: aabb.y - zone.zy, horizontal: horizontalFromCenter(aabb, centerX) },
    };
  }
  return {
    ...base,
    anchor: {
      kind: 'neckline',
      vertical: verticalFromNeckline(aabb, anchors.neckline_point.y),
      horizontal: horizontalFromCenter(aabb, centerX),
    },
  };
}

/** Зона для нового логотипа на виде; вида нет — `null` */
export function defaultAreaId(flat: GarmentFlat, view: DesignView): string | null {
  const areas = flat.views.find((v) => v.kind === view)?.print_areas ?? [];
  return (areas.find((a) => a.zone_id) ?? areas[0])?.id ?? null;
}
