/**
 * «Зеркальная копия» рукава (веха 5б, К10; перенос DM `mirrorSleeveView`
 * с исправлением дефекта 1: ширина — из viewBox × масштаб, а не `naturalWidth`).
 *
 * - **Файл** — отражённый SVG: содержимое корня оборачивается в
 *   `<g transform="matrix(-1 0 0 1 (2·vb.x + vb.w) 0)">`, затем снова
 *   санитайзер. `transform` санитайзер пропускает, `<g id="garment">` остаётся.
 *   Неконечный или неположительный viewBox — отказ (`null`), в выход не идут
 *   `NaN`/`Infinity` (проверка безопасности, п. 6).
 * - **Геометрия** — `x' = W − x` у якорей (`sleeve_center_x`, `center_axis_x`,
 *   `neckline_point.x`, оси), якорей размеров и точек зон; у `grade_rule`
 *   x-дельты меняют знак.
 * - **Зоны** — id прежние (уникальность нужна только внутри вида); `zone_id`
 *   `sleeve-l` ↔ `sleeve-r`, `tz_row` `sleeve_l` ↔ `sleeve_r`, имя меняется,
 *   если совпадало с именем зоны справочника.
 */
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { flatSvgPathOf } from '../limits';
import { SWAP_ZONE } from '../catalog/sleeveZones';
import type { FlatView, FlatViewKind, GarmentFlat, GradeRule, PrintArea, ViewAnchors } from '../types';
import type { TzRow } from '../../catalog/tzRows';
import type { ZoneLike } from './flatAreas';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Предел сдвига отражения в единицах SVG: дальше — не силуэт, а порча */
const MAX_SHIFT = 1e7;

/** viewBox корня — 4 конечных числа, ширина и высота больше 0; иначе `null` */
function rootViewBox(root: Element): { x: number; w: number } | null {
  const parts = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, , w, h] = parts;
  return w > 0 && h > 0 ? { x, w } : null;
}

/** Отражённый по горизонтали SVG силуэта; нет viewBox или `garment`, неконечные числа — `null` */
export function mirrorSvg(svg: string): string | null {
  const clean = sanitizeSvg(svg);
  if (!clean.ok) return null;
  const doc = new DOMParser().parseFromString(clean.svg, 'image/svg+xml');
  const root = doc.documentElement;
  const vb = rootViewBox(root);
  const garment = Array.from(root.getElementsByTagNameNS(SVG_NS, 'g')).some((g) => g.getAttribute('id') === 'garment');
  if (!vb || !garment) return null;
  const shift = 2 * vb.x + vb.w;
  if (!Number.isFinite(shift) || Math.abs(shift) > MAX_SHIFT) return null;
  const wrap = doc.createElementNS(SVG_NS, 'g');
  wrap.setAttribute('transform', `matrix(-1 0 0 1 ${Number(shift.toFixed(6))} 0)`);
  while (root.firstChild) wrap.appendChild(root.firstChild);
  root.appendChild(wrap);
  const out = sanitizeSvg(new XMLSerializer().serializeToString(root));
  return out.ok ? out.svg : null;
}

const SWAP_ROW: Partial<Record<TzRow, TzRow>> = { sleeve_l: 'sleeve_r', sleeve_r: 'sleeve_l' };

const mx = (W: number, x: number) => Math.round((W - x) * 1000) / 1000;

function mirrorAnchors(a: ViewAnchors, W: number): ViewAnchors {
  const out: ViewAnchors = { ...a };
  if (a.sleeve_center_x !== undefined) out.sleeve_center_x = mx(W, a.sleeve_center_x);
  if (a.center_axis_x !== undefined) out.center_axis_x = mx(W, a.center_axis_x);
  if (a.neckline_point) out.neckline_point = { x: mx(W, a.neckline_point.x), y: a.neckline_point.y };
  if (a.axes) out.axes = a.axes.map((ax) => ({ ...ax, x: mx(W, ax.x) }));
  return out;
}

function mirrorGrade(g: GradeRule): GradeRule {
  const out: GradeRule = { ...g };
  if (g.sleeve_center_dx !== undefined) out.sleeve_center_dx = -g.sleeve_center_dx;
  if (g.center_axis_dx !== undefined) out.center_axis_dx = -g.center_axis_dx;
  if (g.neckline?.dx !== undefined) out.neckline = { ...g.neckline, dx: -g.neckline.dx };
  return out;
}

function mirrorArea(a: PrintArea, W: number, zones: readonly ZoneLike[]): PrintArea {
  const out: PrintArea = { ...a, polygon_mm: a.polygon_mm.map(([x, y]) => [mx(W, x), y] as [number, number]) };
  const swapped = a.zone_id ? SWAP_ZONE[a.zone_id] : undefined;
  if (swapped) {
    out.zone_id = swapped;
    const from = zones.find((z) => z.id === a.zone_id);
    const to = zones.find((z) => z.id === swapped);
    if (from && to && a.name === from.name) out.name = to.name;
  }
  const row = a.tz_row ? SWAP_ROW[a.tz_row] : undefined;
  if (row) out.tz_row = row;
  return out;
}

/**
 * Противоположный рукав из рукава `from`. `flatMmW` — ширина силуэта в мм
 * (viewBox × масштаб). Целевой вид уже есть — замена только с `replace: true`
 * (в интерфейсе — подтверждение «Заменить правый рукав?»); иначе отказ
 */
export function mirrorSleeveView(
  flat: GarmentFlat, from: 'sleeve_left' | 'sleeve_right', flatMmW: number,
  zones: readonly ZoneLike[], opts: { replace?: boolean } = {},
): GarmentFlat {
  const src = flat.views.find((v) => v.kind === from);
  if (!src || !Number.isFinite(flatMmW) || !(flatMmW > 0)) return flat;
  const kind: FlatViewKind = from === 'sleeve_left' ? 'sleeve_right' : 'sleeve_left';
  const exists = flat.views.some((v) => v.kind === kind);
  if (exists && !opts.replace) return flat;
  const W = flatMmW;
  const view: FlatView = {
    ...src,
    kind,
    svg_path: flatSvgPathOf(flat.id, flat.version, kind),
    anchors: mirrorAnchors(src.anchors, W),
    print_areas: src.print_areas.map((a) => mirrorArea(a, W, zones)),
  };
  if (src.size_anchors) view.size_anchors = Object.fromEntries(Object.entries(src.size_anchors).map(([s, a]) => [s, mirrorAnchors(a, W)]));
  if (src.grade_rule) view.grade_rule = mirrorGrade(src.grade_rule);
  const views = exists ? flat.views.map((v) => (v.kind === kind ? view : v)) : [...flat.views, view];
  return { ...flat, views };
}
