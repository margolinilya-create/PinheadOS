// Обвязка как структурный объект. Перенос DM `lib/geometry/dimensionLines.ts`.
// Каждая линия ссылается на две точки изделия или зоны, а её число ВЫЧИСЛЯЕТСЯ
// из геометрии (мм): холст и PDF берут одни и те же значения.
import type { FlatView } from '../types';
import type { Bbox, Zone } from './coords';
import { placementInfo, anchorsForSize } from './view';

export type DimensionKind =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'vertical-anchor'
  | 'horizontal-anchor';

export interface DimensionLine {
  kind: DimensionKind;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Значение, мм (отрицательное — выход за зону) */
  value: number;
  danger: boolean;
}

export interface DimensionScene {
  aabb: Bbox;
  zone: Zone;
  /** Ось отсчёта по горизонтали */
  centerX: number;
  /** Точка отсчёта по вертикали (горловина / низ рукава / верх зоны) */
  anchorY: number;
  anchorKind: 'neckline' | 'sleeve' | 'panel';
  printWidth: number;
  printHeight: number;
  lines: DimensionLine[];
}

/** Обвязка нанесения набором размерных линий (значения — из `placementInfo`) */
export function buildDimensionLines(
  view: FlatView,
  bbox: Bbox,
  rotationDeg: number,
  size?: string,
  areaId?: string,
): DimensionScene {
  const { aabb, zone, dimensions: d, anchor } = placementInfo(view, bbox, rotationDeg, size, areaId);
  const midX = aabb.x + aabb.w / 2;
  const midY = aabb.y + aabb.h / 2;
  const anchors = anchorsForSize(view, size);

  const centerX =
    anchor.kind === 'sleeve'
      ? (anchors.sleeve_center_x ?? midX)
      : anchor.kind === 'panel'
        ? (anchors.center_axis_x ?? zone.zx + zone.zw / 2)
        : (anchors.center_axis_x ?? midX);
  const anchorY =
    anchor.kind === 'sleeve'
      ? (anchors.sleeve_bottom_y ?? zone.zy + zone.zh)
      : anchor.kind === 'panel'
        ? zone.zy
        : (anchors.neckline_point?.y ?? zone.zy);

  const edge = (kind: DimensionKind, from: DimensionLine['from'], to: DimensionLine['to'], value: number): DimensionLine =>
    ({ kind, from, to, value, danger: value < 0 });

  const lines: DimensionLine[] = [
    edge('left', { x: zone.zx, y: midY }, { x: aabb.x, y: midY }, d.left),
    edge('right', { x: aabb.x + aabb.w, y: midY }, { x: zone.zx + zone.zw, y: midY }, d.right),
    edge('top', { x: midX, y: zone.zy }, { x: midX, y: aabb.y }, d.top),
    edge('bottom', { x: midX, y: aabb.y + aabb.h }, { x: midX, y: zone.zy + zone.zh }, d.bottom),
    {
      kind: 'vertical-anchor',
      from: { x: centerX, y: anchorY },
      to: { x: centerX, y: midY },
      value: Math.abs(anchor.vertical),
      danger: false,
    },
    {
      kind: 'horizontal-anchor',
      from: { x: centerX, y: midY },
      to: { x: midX, y: midY },
      value: anchor.horizontal,
      danger: false,
    },
  ];

  return {
    aabb,
    zone,
    centerX,
    anchorY,
    anchorKind: anchor.kind,
    printWidth: d.printWidth,
    printHeight: d.printHeight,
    lines,
  };
}
