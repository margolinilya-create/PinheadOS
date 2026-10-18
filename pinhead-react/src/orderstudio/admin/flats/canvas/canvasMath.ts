/**
 * Математика холста редактора флэта (веха 5б, задача 6а) — чистые функции без
 * React и без konva: вписывание флэта в стейдж, мм ↔ px, рамка зоны ↔ узел
 * konva, сдвиг стрелками, ограничение перетаскивания ручек по оси.
 *
 * Свой модуль, а не `design/ui/canvas/useCanvasViewport` 5а: тот держит зум
 * и панораму в сторе дизайна (позиции заказа) — редактору флэта они не нужны,
 * а стор втянул бы код вкладки «Дизайн» в чанк редактора. Развёртка та же:
 * флэт по центру с полями, метрика мм от размера контейнера.
 *
 * Координаты зон в мм округляются до 0,1 (как `flatEdit`); минимальная
 * сторона зоны с холста — 5 мм (`MIN_AREA_MM`).
 */
import type { Rect } from '../../../design/edit/flatEdit';

export interface Size { width: number; height: number }
export interface FlatMm { w: number; h: number }
export interface Point { x: number; y: number }

/** Поля вокруг флэта на стейдже, px */
export const CANVAS_PAD = 40;
/** Минимальная сторона зоны, которую можно получить рамкой на холсте, мм */
export const MIN_AREA_MM = 5;
/** Шаг стрелок, мм: обычный и с Shift */
export const NUDGE_MM = 1;
export const NUDGE_BIG_MM = 10;
/** Габарит, пока флэта нет или он битый (как у холста 5а) */
export const FLAT_MM_FALLBACK: FlatMm = { w: 600, h: 760 };

/** Развёртка мм → px стейджа и обратно */
export interface Fit {
  pxPerMm: number;
  ox: number;
  oy: number;
}

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;
const tenth = (v: number) => Math.round(v * 10) / 10;

/** Флэт вписан в стейдж с полями `pad` и стоит по центру */
export function fit(size: Size, flatMm: FlatMm, pad: number = CANVAS_PAD): Fit {
  const fm = finitePositive(flatMm.w) && finitePositive(flatMm.h) ? flatMm : FLAT_MM_FALLBACK;
  const pxPerMm = Math.max(0.02, Math.min((size.width - 2 * pad) / fm.w, (size.height - 2 * pad) / fm.h));
  return { pxPerMm, ox: (size.width - fm.w * pxPerMm) / 2, oy: (size.height - fm.h * pxPerMm) / 2 };
}

export const toPx = (f: Fit, p: Point): Point => ({ x: f.ox + p.x * f.pxPerMm, y: f.oy + p.y * f.pxPerMm });
export const toMm = (f: Fit, p: Point): Point => ({ x: (p.x - f.ox) / f.pxPerMm, y: (p.y - f.oy) / f.pxPerMm });
/** Длина в мм → px */
export const lenPx = (f: Fit, mm: number): number => mm * f.pxPerMm;

/** Точка в мм с шагом 0,1 */
export function toMmTenth(f: Fit, p: Point): [number, number] {
  const m = toMm(f, p);
  return [tenth(m.x), tenth(m.y)];
}

/** Атрибуты узла konva прямоугольной зоны */
export interface RectNode { x: number; y: number; width: number; height: number }

export function rectToNode(f: Fit, r: Rect): RectNode {
  const p = toPx(f, { x: r.x, y: r.y });
  return { x: p.x, y: p.y, width: lenPx(f, r.w), height: lenPx(f, r.h) };
}

/**
 * Узел после перетаскивания или трансформера → рамка в мм. Масштаб узла
 * (трансформер растягивает `scaleX/Y`) входит в размер; сторона не меньше `MIN_AREA_MM`
 */
export function nodeToRect(f: Fit, n: RectNode & { scaleX?: number; scaleY?: number }): Rect {
  const tl = toMm(f, { x: n.x, y: n.y });
  const w = Math.abs(n.width * (n.scaleX ?? 1)) / f.pxPerMm;
  const h = Math.abs(n.height * (n.scaleY ?? 1)) / f.pxPerMm;
  return { x: tenth(tl.x), y: tenth(tl.y), w: tenth(Math.max(MIN_AREA_MM, w)), h: tenth(Math.max(MIN_AREA_MM, h)) };
}

/** Сдвиг рамки на (dx, dy) мм */
export function nudgeRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: tenth(r.x + dx), y: tenth(r.y + dy) };
}

/** Сдвиг стрелкой: направление клавиши → (dx, dy) мм; не стрелка — `null` */
export function arrowDelta(key: string, shift: boolean): Point | null {
  const s = shift ? NUDGE_BIG_MM : NUDGE_MM;
  switch (key) {
    case 'ArrowLeft': return { x: -s, y: 0 };
    case 'ArrowRight': return { x: s, y: 0 };
    case 'ArrowUp': return { x: 0, y: -s };
    case 'ArrowDown': return { x: 0, y: s };
    default: return null;
  }
}

/** По какой оси двигается ручка якоря: только X, только Y или обе */
export type HandleAxis = 'x' | 'y' | 'xy';

/**
 * Ограничение перетаскивания ручки (konva `dragBoundFunc`, координаты стейджа):
 * запертая ось остаётся на месте (дефект 8 DM: ось изделия «уезжала» по Y)
 */
export function lockAxis(axis: HandleAxis, fixed: Point, pos: Point): Point {
  if (axis === 'x') return { x: pos.x, y: fixed.y };
  if (axis === 'y') return { x: fixed.x, y: pos.y };
  return pos;
}

/** Длина отрезка между двумя точками, мм (калибровка) */
export function distanceMm(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Соседняя зона по кругу: `dir` = 1 — следующая, −1 — предыдущая; ничего не выбрано — первая/последняя */
export function neighborId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}
