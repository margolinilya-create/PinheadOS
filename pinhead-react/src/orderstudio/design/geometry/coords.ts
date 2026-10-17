// Координатные примитивы. Все величины — в мм (BUILD.md §4).
// Пиксели используются только для отрисовки: px = mm * pxPerMM * zoom.

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Zone {
  zx: number;
  zy: number;
  zw: number;
  zh: number;
}

/** Полигон [[x,y],...] → axis-aligned bbox (мм). */
export function polygonToZone(polygon: [number, number][]): Zone {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { zx: minX, zy: minY, zw: maxX - minX, zh: maxY - minY };
}

/**
 * Axis-aligned bbox прямоугольного макета, повёрнутого на rotation_deg
 * вокруг своего центра. Обвязку считаем по этому AABB (BUILD.md §4).
 */
export function rotatedAabb(bbox: Bbox, rotationDeg: number): Bbox {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = bbox.w * cos + bbox.h * sin;
  const h = bbox.w * sin + bbox.h * cos;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
