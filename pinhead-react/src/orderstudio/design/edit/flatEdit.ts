/**
 * Чистые операции редактора флэта (веха 5б, задача 1; перенос DM
 * `lib/admin/skuEdit.ts` в нашу форму `GarmentFlat`). Все функции возвращают
 * НОВЫЙ флэт; отказ — тот же объект (вызывающий сравнивает по ссылке).
 *
 * Инварианты: вид не меньше одного, `kind` вида после создания не меняется;
 * зона в виде не меньше одной, id зоны неизменен; многоугольник — 3…256 точек;
 * `default_method` вне `methods` сбрасывается. Пути SVG проставит выпуск
 * версии (`catalog/flatVersion.releaseFlat`), здесь — путь текущей версии.
 */
import { MAX_POLYGON_POINTS, flatSvgPathOf } from '../limits';
import type { FlatView, FlatViewKind, GarmentFlat, GarmentType, NamedAxis, PrintArea, ViewAnchors } from '../types';
import { META_KEYS, pickKeys } from '../catalog/flatVersion';
import { VIEW_LABELS } from '../catalog/flatLabels';

export interface Rect { x: number; y: number; w: number; h: number }
export interface FlatMm { w: number; h: number }

const tenth = (v: number) => Math.round(v * 10) / 10;
const isSleeve = (k: FlatViewKind) => k === 'sleeve_left' || k === 'sleeve_right';

/** Якоря нового вида: перед/спина — горловина (центр; 12 % высоты) и ось; рукав — низ 92 % и центр */
export function defaultAnchors(kind: FlatViewKind, flatMm: FlatMm, accessory: boolean): ViewAnchors {
  const cx = tenth(flatMm.w / 2);
  if (isSleeve(kind)) return { sleeve_bottom_y: tenth(flatMm.h * 0.92), sleeve_center_x: cx };
  return accessory ? { center_axis_x: cx } : { neckline_point: { x: cx, y: tenth(flatMm.h * 0.12) }, center_axis_x: cx };
}

/** Прямоугольная зона */
export function rectArea(id: string, name: string, zone_id: string | null, r: Rect, safe_inset_mm: number): PrintArea {
  return { id, name, zone_id, polygon_mm: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], safe_inset_mm };
}

/** Описывающий прямоугольник зоны */
export function areaRect(area: Pick<PrintArea, 'polygon_mm'>): Rect {
  const xs = area.polygon_mm.map((p) => p[0]);
  const ys = area.polygon_mm.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Зона — прямоугольник по осям: 4 разные точки, каждая — угол описывающего прямоугольника */
export function isRectArea(area: Pick<PrintArea, 'polygon_mm'>): boolean {
  if (area.polygon_mm.length !== 4) return false;
  const r = areaRect(area);
  const corners = new Set(area.polygon_mm.map(([x, y]) => `${x === r.x ? 0 : x === r.x + r.w ? 1 : 'x'}${y === r.y ? 0 : y === r.y + r.h ? 1 : 'y'}`));
  return r.w > 0 && r.h > 0 && corners.size === 4 && ![...corners].some((c) => /[xy]/.test(c));
}

/** Служебная зона вида по центру — когда зон по умолчанию не передали */
function serviceArea(kind: FlatViewKind, flatMm: FlatMm): PrintArea {
  const r = { x: tenth(flatMm.w * 0.25), y: tenth(flatMm.h * 0.25), w: tenth(flatMm.w * 0.5), h: tenth(flatMm.h * 0.5) };
  return rectArea(kind, VIEW_LABELS[kind], null, r, tenth(Math.min(10, Math.min(r.w, r.h) / 4)));
}

export interface ViewInit {
  scale_mm_per_unit: number;
  flatMm: FlatMm;
  /** Зоны нового вида (`flatAreas.defaultAreas`); нет — служебная зона по центру */
  areas?: PrintArea[];
  accessory?: boolean;
}

function newView(id: string, version: number, kind: FlatViewKind, init: ViewInit): FlatView {
  return {
    kind,
    svg_path: flatSvgPathOf(id, version, kind),
    scale_mm_per_unit: init.scale_mm_per_unit,
    anchors: defaultAnchors(kind, init.flatMm, !!init.accessory),
    print_areas: init.areas?.length ? init.areas : [serviceArea(kind, init.flatMm)],
  };
}

/**
 * Новый флэт из одного вида: версия 1, снят с подбора, пока администратор
 * не включит; путь SVG — по формуле (файл загрузится при сохранении, К4)
 */
export function emptyFlat(id: string, name: string, type: GarmentType, kind: FlatViewKind, view: ViewInit): GarmentFlat {
  return {
    id, name, garment_type: type, typical: false, active: false, version: 1,
    sku_codes: [], categories: [], fits: [], base_size: 'M', sizes: [],
    views: [newView(id, 1, kind, view)],
  };
}

function mapView(flat: GarmentFlat, kind: FlatViewKind, fn: (v: FlatView) => FlatView): GarmentFlat {
  const v = flat.views.find((x) => x.kind === kind);
  if (!v) return flat;
  const next = fn(v);
  return next === v ? flat : { ...flat, views: flat.views.map((x) => (x === v ? next : x)) };
}

function mapArea(flat: GarmentFlat, kind: FlatViewKind, id: string, fn: (a: PrintArea) => PrintArea): GarmentFlat {
  return mapView(flat, kind, (v) => {
    const a = v.print_areas.find((x) => x.id === id);
    if (!a) return v;
    const next = fn(a);
    return next === a ? v : { ...v, print_areas: v.print_areas.map((x) => (x === a ? next : x)) };
  });
}

/** Добавить вид (нет такого) */
export function addView(flat: GarmentFlat, kind: FlatViewKind, init: ViewInit): GarmentFlat {
  if (flat.views.some((v) => v.kind === kind)) return flat;
  return { ...flat, views: [...flat.views, newView(flat.id, flat.version, kind, init)] };
}

/** Удалить вид; последний — отказ */
export function removeView(flat: GarmentFlat, kind: FlatViewKind): GarmentFlat {
  if (flat.views.length <= 1 || !flat.views.some((v) => v.kind === kind)) return flat;
  return { ...flat, views: flat.views.filter((v) => v.kind !== kind) };
}

/** Новый файл вида: масштаб (путь проставит выпуск версии) */
export function setViewFile(flat: GarmentFlat, kind: FlatViewKind, file: { scale_mm_per_unit: number }): GarmentFlat {
  if (!(file.scale_mm_per_unit > 0)) return flat;
  return mapView(flat, kind, (v) => ({ ...v, scale_mm_per_unit: file.scale_mm_per_unit }));
}

/** Якоря вида: ключ со значением `undefined` убирается */
export function setAnchors(flat: GarmentFlat, kind: FlatViewKind, patch: Partial<ViewAnchors>): GarmentFlat {
  return mapView(flat, kind, (v) => {
    const anchors: Record<string, unknown> = { ...v.anchors, ...patch };
    for (const k of Object.keys(anchors)) if (anchors[k] === undefined) delete anchors[k];
    return { ...v, anchors: anchors as ViewAnchors };
  });
}

/** Оси вида; пустой список — осей нет */
export function setAxes(flat: GarmentFlat, kind: FlatViewKind, axes: NamedAxis[]): GarmentFlat {
  return setAnchors(flat, kind, { axes: axes.length ? axes : undefined });
}

/** Добавить зону (id не занят в виде) */
export function addArea(flat: GarmentFlat, kind: FlatViewKind, area: PrintArea): GarmentFlat {
  return mapView(flat, kind, (v) => (v.print_areas.some((a) => a.id === area.id) || v.print_areas.length >= 32
    ? v : { ...v, print_areas: [...v.print_areas, area] }));
}

/** Удалить зону; последняя в виде — отказ */
export function removeArea(flat: GarmentFlat, kind: FlatViewKind, id: string): GarmentFlat {
  return mapView(flat, kind, (v) => (v.print_areas.length <= 1 || !v.print_areas.some((a) => a.id === id)
    ? v : { ...v, print_areas: v.print_areas.filter((a) => a.id !== id) }));
}

/** Сдвинуть зону вверх или вниз по списку; на краю — отказ */
export function moveArea(flat: GarmentFlat, kind: FlatViewKind, id: string, dir: -1 | 1): GarmentFlat {
  return mapView(flat, kind, (v) => {
    const i = v.print_areas.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= v.print_areas.length) return v;
    const list = [...v.print_areas];
    [list[i], list[j]] = [list[j], list[i]];
    return { ...v, print_areas: list };
  });
}

/** Правка полей зоны (id неизменен); `default_method` вне `methods` сбрасывается */
export function updateArea(flat: GarmentFlat, kind: FlatViewKind, id: string, patch: Partial<PrintArea>): GarmentFlat {
  const { id: _keep, ...rest } = patch;
  return mapArea(flat, kind, id, (a) => {
    const next: Record<string, unknown> = { ...a, ...rest };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const n = next as unknown as PrintArea;
    if (n.default_method && n.methods?.length && !n.methods.includes(n.default_method)) delete next.default_method;
    return next as unknown as PrintArea;
  });
}

/** Зона — прямоугольник `r` (стороны больше 0) */
export function setAreaRect(flat: GarmentFlat, kind: FlatViewKind, id: string, r: Rect): GarmentFlat {
  if (!(r.w > 0) || !(r.h > 0)) return flat;
  return mapArea(flat, kind, id, (a) => ({ ...a, polygon_mm: rectArea(a.id, a.name, a.zone_id, r, a.safe_inset_mm).polygon_mm }));
}

const okPoints = (n: number) => n >= 3 && n <= MAX_POLYGON_POINTS;

/** Многоугольник зоны целиком (3…256 точек) */
export function setAreaPolygon(flat: GarmentFlat, kind: FlatViewKind, id: string, pts: [number, number][]): GarmentFlat {
  if (!okPoints(pts.length)) return flat;
  return mapArea(flat, kind, id, (a) => ({ ...a, polygon_mm: pts.map(([x, y]) => [x, y] as [number, number]) }));
}

/** Сдвинуть вершину `index` */
export function movePoint(flat: GarmentFlat, kind: FlatViewKind, id: string, index: number, p: [number, number]): GarmentFlat {
  return mapArea(flat, kind, id, (a) => (index < 0 || index >= a.polygon_mm.length
    ? a : { ...a, polygon_mm: a.polygon_mm.map((q, i) => (i === index ? [p[0], p[1]] as [number, number] : q)) }));
}

/** Вставить вершину после `index` — посередине ребра к следующей; больше 256 — отказ */
export function insertPoint(flat: GarmentFlat, kind: FlatViewKind, id: string, index: number): GarmentFlat {
  return mapArea(flat, kind, id, (a) => {
    const n = a.polygon_mm.length;
    if (index < 0 || index >= n || !okPoints(n + 1)) return a;
    const [p, q] = [a.polygon_mm[index], a.polygon_mm[(index + 1) % n]];
    const mid: [number, number] = [tenth((p[0] + q[0]) / 2), tenth((p[1] + q[1]) / 2)];
    return { ...a, polygon_mm: [...a.polygon_mm.slice(0, index + 1), mid, ...a.polygon_mm.slice(index + 1)] };
  });
}

/** Удалить вершину; меньше трёх — отказ */
export function removePoint(flat: GarmentFlat, kind: FlatViewKind, id: string, index: number): GarmentFlat {
  return mapArea(flat, kind, id, (a) => (index < 0 || index >= a.polygon_mm.length || !okPoints(a.polygon_mm.length - 1)
    ? a : { ...a, polygon_mm: a.polygon_mm.filter((_, i) => i !== index) }));
}

/** Метаданные флэта, правимые редактором (размеры — `flatSizes`) */
export type FlatMetaPatch = Partial<Pick<GarmentFlat, 'name' | 'garment_type' | 'typical' | 'active' | 'sku_codes' | 'categories' | 'fits'>>;
const META_PATCH_KEYS = ['name', 'garment_type', 'typical', 'active', 'sku_codes', 'categories', 'fits'] as const;

/** Правка метаданных; прочие ключи патча игнорируются */
export function updateMeta(flat: GarmentFlat, patch: FlatMetaPatch): GarmentFlat {
  const clean: Record<string, unknown> = {};
  for (const k of META_PATCH_KEYS) if (patch[k] !== undefined) clean[k] = patch[k];
  return Object.keys(clean).length ? { ...flat, ...clean } : flat;
}

/**
 * «Отменить правки силуэта» (решение 22): геометрия базы, метаданные черновика —
 * флэта и зон, которые есть в базе (по виду и id)
 */
export function revertGeometry(base: GarmentFlat, draft: GarmentFlat): GarmentFlat {
  const views = base.views.map((v) => {
    const dv = draft.views.find((x) => x.kind === v.kind);
    return {
      ...v,
      print_areas: v.print_areas.map((a) => {
        const da = dv?.print_areas.find((x) => x.id === a.id);
        if (!da) return a;
        const out: Record<string, unknown> = { ...a };
        for (const k of META_KEYS.area) delete out[k];
        return { ...out, ...pickKeys(da, META_KEYS.area) } as unknown as PrintArea;
      }),
    };
  });
  return { ...base, ...pickKeys(draft, META_KEYS.flat), views };
}
