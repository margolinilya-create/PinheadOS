/**
 * Лекало → система мм вида (веха 5в, Э2б). Контур из файла стоит в своих
 * координатах; на лист «Выкройка» он ложится там, где нанесения: по осям и
 * опорам вида. Автовыравнивание ПРИБЛИЗИТЕЛЬНОЕ — точная опора горловины на
 * флэте — центр выреза, а верх лекала — плечевая точка, поэтому верх ставится
 * выше горловины на типовую глубину выреза; дальше — ручной сдвиг
 * (`shiftPattern`) с контуром поверх флэта на холсте редактора.
 */
import type { FlatView, PatternPiece } from '../../design/types';

type Pt = [number, number];

/** Типовая глубина выреза горловины, мм: перед / спина */
export const NECK_DROP_MM = { front: 80, back: 20 } as const;

const box = (pts: readonly Pt[]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const tenth = (v: number) => Math.round(v * 10) / 10;
const moved = (pts: readonly Pt[], dx: number, dy: number): [number, number][] => pts.map(([x, y]) => [tenth(x + dx), tenth(y + dy)]);

/**
 * Половина детали «со сгибом»: зеркально к краю сгиба (`side` — где сгиб).
 * Путь от конца линии сгиба по внешнему краю до её начала, затем его зеркало
 * обратно — контур без самопересечения; точки сгиба общие. Нет точек на
 * сгибе — контур как есть.
 */
export function unfold(pts: readonly Pt[], side: 'right' | 'left'): Pt[] {
  const b = box(pts);
  const edge = side === 'right' ? b.x + b.w : b.x;
  const n = pts.length;
  const on = pts.map((p) => Math.abs(p[0] - edge) < 0.05);
  const s = on.findIndex((v, i) => v && !on[(i + 1) % n]);
  if (s < 0) return [...pts];
  const path: Pt[] = [pts[s]];
  for (let k = 1; k < n; k++) {
    const i = (s + k) % n;
    path.push(pts[i]);
    if (on[i]) break;
  }
  const mirror = path.slice(1, -1).reverse().map(([x, y]) => [2 * edge - x, y] as Pt);
  return [...path, ...mirror];
}

/** Перед/спина: ось — на ось изделия, верх — выше горловины на глубину выреза; рукав: ось и низ рукава */
export function alignToView(contour: readonly Pt[], view: FlatView, count = 1): PatternPiece {
  const b = box(contour);
  const cx = b.x + b.w / 2;
  const a = view.anchors;
  if (view.kind === 'sleeve_left' || view.kind === 'sleeve_right') {
    const axis = a.sleeve_center_x ?? cx;
    const bottom = a.sleeve_bottom_y ?? b.y + b.h;
    return { contour_mm: moved(contour, axis - cx, bottom - (b.y + b.h)), count };
  }
  const axis = a.center_axis_x ?? cx;
  const neck = a.neckline_point?.y;
  const top = neck === undefined ? b.y : neck - (view.kind === 'back' ? NECK_DROP_MM.back : NECK_DROP_MM.front);
  return { contour_mm: moved(contour, axis - cx, top - b.y), count };
}

/** Ручной сдвиг уже выровненного лекала, мм */
export function shiftPattern(p: PatternPiece, dx: number, dy: number): PatternPiece {
  return { ...p, contour_mm: moved(p.contour_mm, dx, dy) };
}
