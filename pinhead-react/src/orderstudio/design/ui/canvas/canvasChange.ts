/**
 * Правка с холста — контракт `EditorCanvas.onCommit` (веха 5а, задача 6а).
 *
 * Холст ничего не пишет сам и не знает справочника зон и категории модели:
 * он сообщает, ЧТО сделал человек, а панель (задача 6б) применяет это к
 * свежим нанесениям позиции внутри `useDesignStore.commit`:
 *
 * ```js
 * onCommit={(change) => commit(change.label, (item) => {
 *   const prints = applyCanvasChange(item.prints, change, ctx);
 *   return prints ? { prints } : null;
 * }, change.coalesceKey)}
 * ```
 *
 * - `place` — новая геометрия после перетаскивания или трансформера
 *   (абсолютная: человек видел именно её); центр рамки попал в другую зону
 *   того же вида — нанесение переходит в неё (веха 5в: до того зона оставалась
 *   прежней, и картинка обрезалась по старой зоне);
 * - `nudge` — сдвиг стрелками: ДЕЛЬТА к свежему нанесению, чтобы две стрелки
 *   до перерисовки не схлопнулись в одну; `coalesceKey` сливает серию в один
 *   шаг отмены (800 мс, стор дизайна);
 * - `unplace` — «Снять с изделия» (Delete на холсте): `layout = null`,
 *   строка нанесения с зоной, мм и файлом остаётся (проверка скиллами: без
 *   подтверждения, тост «Вернуть» — у панели; удаление строки — только во
 *   вкладке «Изделие»).
 *
 * Ничего не изменилось, нанесения нет или оно не на холсте — `null`: тогда
 * `commit` ничего не пишет и не копит историю.
 */
import type { SalesPrint } from '../../../model/types';
import { applyPlacement, parseLayout, placementOf, type PlaceCtx } from '../../model/layout';
import { areaAt, inArea, nudged, type Geometry } from './canvasMath';
import type { Placement } from '../../types';

/** Подписи шагов отмены («Отменить: …») */
export const CANVAS_LABELS = {
  move: 'Перемещение',
  transform: 'Размер и поворот',
  nudge: 'Сдвиг',
  unplace: 'Снять с изделия',
} as const;

export type CanvasChange =
  | { kind: 'place'; key: string; geometry: Geometry; label: string; coalesceKey?: string }
  | { kind: 'nudge'; key: string; dx_mm: number; dy_mm: number; label: string; coalesceKey: string }
  | { kind: 'unplace'; key: string; label: string; coalesceKey?: undefined };

/**
 * Зона под центром рамки. Центр ещё в текущей зоне — она и остаётся (зоны
 * редактора 5б могут перекрываться); вне зон — прежняя; зоны, недоступные
 * модели (`areaAllowed`, тот же фильтр, что у нового логотипа), не берутся —
 * от зоны зависят цена кармана и строка ТЗ
 */
function withAreaAtCenter(pl: Placement, ctx: PlaceCtx): Placement {
  const view = ctx.flat.views.find((v) => v.kind === pl.view);
  if (!view) return pl;
  const cx = pl.x_mm + pl.width_mm / 2;
  const cy = pl.y_mm + pl.height_mm / 2;
  if (inArea(view, pl.area_id, cx, cy)) return pl;
  const id = areaAt(view, cx, cy, ctx.areaAllowed);
  return id ? { ...pl, area_id: id } : pl;
}

function nextPrint(print: SalesPrint, change: CanvasChange, ctx: PlaceCtx): SalesPrint | null {
  if (change.kind === 'unplace') return parseLayout(print.layout) ? { ...print, layout: null } : null;
  const pl = placementOf(print, ctx.flat);
  if (!pl) return null;
  const geometry = change.kind === 'nudge' ? nudged(pl, change.dx_mm, change.dy_mm) : withAreaAtCenter({ ...pl, ...change.geometry }, ctx);
  const next = applyPlacement(print, geometry, ctx);
  if (next === print || JSON.stringify(next) === JSON.stringify(print)) return null;
  return next;
}

/** Нанесения позиции после правки с холста; ничего не изменилось — `null` */
export function applyCanvasChange(prints: SalesPrint[], change: CanvasChange, ctx: PlaceCtx): SalesPrint[] | null {
  const i = prints.findIndex((p) => p.key === change.key);
  if (i < 0) return null;
  const next = nextPrint(prints[i], change, ctx);
  return next ? prints.map((p, j) => (j === i ? next : p)) : null;
}
