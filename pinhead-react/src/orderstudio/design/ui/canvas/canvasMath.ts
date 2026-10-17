/**
 * Математика холста «Дизайн» (веха 5а, задача 6а) — чистые функции без React
 * и без konva: развёртка мм → px стейджа, узел konva ↔ размещение, привязка
 * при перетаскивании, зум к точке, попадание точки сброса в зону, наконечник
 * размерной линии и яркость ткани.
 *
 * Перенос DM `components/editor/EditorCanvas.tsx` (расчёт `t`, `onDragEnd`,
 * `onTransformEnd`, `snapX`, `onWheel`, `handleDrop`) с двумя отличиями:
 * - наконечник стрелки считается здесь и рисуется фигурой `Line` — фигура
 *   `Arrow` тянет `Path` и +8,5 кБ gzip в чанк холста (замер задачи 0);
 * - попадание точки сброса — по многоугольнику зоны, а не по её рамке.
 *
 * Метрика мм неизменна: экранный зум и панорама живут в сторе дизайна
 * отдельно (масштаб и положение стейджа), `pxPerMM` от них не зависит.
 */
import type { FlatView, Placement } from '../../types';
import { anchorsForSize, placementInfo, viewZone } from '../../geometry/view';
import { ZOOM_MAX, ZOOM_MIN } from '../../store/useDesignStore';

/** Габарит флэта, пока картинка не пришла (как в DM) */
export const FLAT_MM_FALLBACK = { w: 600, h: 760 } as const;
/** Поля вокруг флэта на стейдже, px */
export const CANVAS_PAD = 48;
/** Порог магнита при перетаскивании, мм */
export const SNAP_MM = 5;

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface MmPoint { x_mm: number; y_mm: number }

/** Линейная развёртка мм → px стейджа (до зума) */
export interface Transform {
  pxPerMM: number;
  px: (xMm: number) => number;
  py: (yMm: number) => number;
  s: (mm: number) => number;
}

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;

/** Флэт вписан в стейдж с полями `CANVAS_PAD` и стоит по центру */
export function makeTransform(size: Size, flatMm: { w: number; h: number }): Transform {
  const fm = finitePositive(flatMm.w) && finitePositive(flatMm.h) ? flatMm : FLAT_MM_FALLBACK;
  const pxPerMM = Math.max(0.05, Math.min((size.width - 2 * CANVAS_PAD) / fm.w, (size.height - 2 * CANVAS_PAD) / fm.h));
  const ox = (size.width - fm.w * pxPerMM) / 2;
  const oy = (size.height - fm.h * pxPerMM) / 2;
  return { pxPerMM, px: (x) => ox + x * pxPerMM, py: (y) => oy + y * pxPerMM, s: (mm) => mm * pxPerMM };
}

/** Атрибуты узла konva: центр-ориджин, поворот и отражение — вокруг центра нанесения */
export interface NodeAttrs {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type Geometry = Pick<Placement, 'x_mm' | 'y_mm' | 'width_mm' | 'height_mm' | 'rotation_deg' | 'flip_h' | 'flip_v'>;

export function toNode(pl: Geometry, t: Transform): NodeAttrs {
  const w = t.s(pl.width_mm);
  const h = t.s(pl.height_mm);
  return {
    x: t.px(pl.x_mm) + w / 2,
    y: t.py(pl.y_mm) + h / 2,
    width: w,
    height: h,
    offsetX: w / 2,
    offsetY: h / 2,
    rotation: pl.rotation_deg,
    scaleX: pl.flip_h ? -1 : 1,
    scaleY: pl.flip_v ? -1 : 1,
  };
}

/** Узел после перетаскивания или трансформера → геометрия в мм (знак масштаба — отражение) */
export function fromNode(n: Pick<NodeAttrs, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY'>, t: Transform): Geometry {
  const w = Math.abs(n.width * n.scaleX) / t.pxPerMM;
  const h = Math.abs(n.height * n.scaleY) / t.pxPerMM;
  const cx = (n.x - t.px(0)) / t.pxPerMM;
  const cy = (n.y - t.py(0)) / t.pxPerMM;
  return {
    x_mm: cx - w / 2,
    y_mm: cy - h / 2,
    width_mm: w,
    height_mm: h,
    rotation_deg: n.rotation,
    flip_h: n.scaleX < 0,
    flip_v: n.scaleY < 0,
  };
}

/** Цели магнита: ось изделия, именованные оси, центр зоны (мм) */
export interface SnapTargets {
  axisX: number;
  namedAxes: number[];
  zoneCx: number;
  zoneCy: number;
}

export function snapTargets(view: FlatView, areaId: string): SnapTargets {
  const { zone } = viewZone(view, undefined, areaId);
  const a = anchorsForSize(view);
  const sleeve = view.kind === 'sleeve_left' || view.kind === 'sleeve_right';
  const zoneCx = zone.zx + zone.zw / 2;
  return {
    axisX: (sleeve ? a.sleeve_center_x : a.center_axis_x) ?? zoneCx,
    namedAxes: (a.axes ?? []).map((ax) => ax.x),
    zoneCx,
    zoneCy: zone.zy + zone.zh / 2,
  };
}

export interface Snapped {
  cx: number;
  cy: number;
  /** Гайд выравнивания (мм), если сработал магнит */
  guideX: number | undefined;
  guideY: number | undefined;
}

/** Магнит центра нанесения: X — к осям и центру зоны, Y — к центру зоны */
export function snapCenter(cx: number, cy: number, tg: SnapTargets): Snapped {
  const guideX = [tg.axisX, ...tg.namedAxes, tg.zoneCx].find((x) => Math.abs(cx - x) < SNAP_MM);
  const guideY = Math.abs(cy - tg.zoneCy) < SNAP_MM ? tg.zoneCy : undefined;
  return { cx: guideX ?? cx, cy: guideY ?? cy, guideX, guideY };
}

/** Рамка нанесения (с учётом поворота) выходит за его зону */
export function isOutOfZone(view: FlatView, pl: Geometry & Pick<Placement, 'area_id'>): boolean {
  const bbox = { x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm };
  return placementInfo(view, bbox, pl.rotation_deg, undefined, pl.area_id).check.out_of_zone;
}

/** Сдвиг стрелками, мм */
export function nudged<T extends Pick<Placement, 'x_mm' | 'y_mm'>>(pl: T, dx: number, dy: number): T {
  return { ...pl, x_mm: pl.x_mm + dx, y_mm: pl.y_mm + dy };
}

/** Зум в пределах стора дизайна; не число — 1 */
export function clampZoom(z: number): number {
  return Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : 1;
}

/** Новая панорама: точка `pointer` (px контейнера) остаётся под курсором при смене зума */
export function zoomAround(pointer: Point, oldZoom: number, newZoom: number, pan: Point): Point {
  const lx = (pointer.x - pan.x) / oldZoom;
  const ly = (pointer.y - pan.y) / oldZoom;
  return { x: pointer.x - lx * newZoom, y: pointer.y - ly * newZoom };
}

/** Точка экрана → мм флэта (рамка контейнера, панорама, зум, развёртка) */
export function clientToMm(client: Point, rect: { left: number; top: number }, pan: Point, zoom: number, t: Transform): MmPoint {
  const lx = (client.x - rect.left - pan.x) / zoom;
  const ly = (client.y - rect.top - pan.y) / zoom;
  return { x_mm: (lx - t.px(0)) / t.pxPerMM, y_mm: (ly - t.py(0)) / t.pxPerMM };
}

/** Точка внутри многоугольника (лучом) */
function inPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Зона вида под точкой (мм); мимо всех — `undefined` (зона по умолчанию решается при постановке) */
export function areaAt(view: FlatView, x: number, y: number): string | undefined {
  return view.print_areas.find((a) => inPolygon(x, y, a.polygon_mm))?.id;
}

/** Наконечник размерной линии в точке (x2, y2): треугольник для `Line closed`; нулевая длина — `[]` */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, len: number, width: number): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [];
  const ux = dx / d;
  const uy = dy / d;
  const bx = x2 - ux * len;
  const by = y2 - uy * len;
  const hw = width / 2;
  return [x2, y2, bx - uy * hw, by + ux * hw, bx + uy * hw, by - ux * hw];
}

/** Тёмная ли ткань (относительная яркость < 0,3): обводка зоны светлая; не hex — светлая ткань */
export function isDarkHex(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum < 0.3;
}
