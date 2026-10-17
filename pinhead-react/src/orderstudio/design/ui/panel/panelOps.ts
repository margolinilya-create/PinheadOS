/**
 * Правки нанесений из панели вкладки «Дизайн» — чистые функции (веха 5а,
 * задача 6б; перенос действий DM `SidePanel`/`PlacementInspector`/`LayerRow`).
 *
 * Все функции получают СВЕЖИЕ нанесения позиции (их даёт `useDesignStore.commit`)
 * и возвращают новые — либо `null`, если ничего не изменилось: тогда `commit`
 * не пишет и не копит историю. Геометрия идёт через `applyCanvasChange` —
 * тот же путь, что у холста: зона, мм, отступ и раскладка пишутся одним
 * `applyPlacement`, и цена (мм в стандартных полях) не расходится с холстом.
 *
 * Порядок слоёв = порядок `prints` (номер нанесения в ТЗ): «выше» и «ниже»
 * меняют местами нанесения одного вида во всём списке позиции.
 */
import type { SalesPrint, SalesPrintMethod } from '../../../model/types';
import { newSalesPrint } from '../../../model/factory';
import type { DesignView, FlatView, Placement, PrintArea } from '../../types';
import { placementOf, type PlaceCtx } from '../../model/layout';
import { presetPosition, viewZone, type PositionPreset } from '../../geometry/view';
import { rotatedAabb } from '../../geometry/coords';
import { applyCanvasChange } from '../canvas/canvasChange';
import type { Geometry } from '../canvas/canvasMath';

/** Шаг дубля: копия сдвигается вниз-вправо, чтобы не лечь ровно на исходное */
export const DUPLICATE_SHIFT_MM = 10;
const MIN_MM = 1;

const bboxOf = (g: Geometry) => ({ x: g.x_mm, y: g.y_mm, w: g.width_mm, h: g.height_mm });

/** Вид и зона размещения на флэте */
export function whereOf(pl: Placement, ctx: Pick<PlaceCtx, 'flat'>): { view: FlatView; area: PrintArea } | null {
  const view = ctx.flat.views.find((v) => v.kind === pl.view);
  const area = view?.print_areas.find((a) => a.id === pl.area_id);
  return view && area ? { view, area } : null;
}

/** Новая геометрия нанесения; ничего не изменилось — `null` */
export function placeGeometry(prints: SalesPrint[], key: string, geometry: Geometry, ctx: PlaceCtx): SalesPrint[] | null {
  return applyCanvasChange(prints, { kind: 'place', key, geometry, label: '' }, ctx);
}

/** Ш или В с центром на месте; `locked` — вторая сторона по пропорции */
export function resized(pl: Geometry, size: { width?: number; height?: number }, locked: boolean): Geometry {
  const ratio = pl.height_mm / pl.width_mm || 1;
  let w = pl.width_mm;
  let h = pl.height_mm;
  if (size.width !== undefined) {
    w = Math.max(MIN_MM, size.width);
    if (locked) h = Math.max(MIN_MM, w * ratio);
  }
  if (size.height !== undefined) {
    h = Math.max(MIN_MM, size.height);
    if (locked) w = Math.max(MIN_MM, h / ratio);
  }
  const cx = pl.x_mm + pl.width_mm / 2;
  const cy = pl.y_mm + pl.height_mm / 2;
  return { ...pl, width_mm: w, height_mm: h, x_mm: cx - w / 2, y_mm: cy - h / 2 };
}

/**
 * Опора вертикального отступа: служебная зона (этикетка) — верх зоны, иначе
 * горловина (у штанов это пояс), у изделия без горловины — верх зоны
 * (как `model/offset.offsetFor`).
 */
function refY(view: FlatView, area: PrintArea): number {
  const { zone } = viewZone(view, undefined, area.id);
  if (area.zone_id === null) return zone.zy;
  return view.anchors.neckline_point?.y ?? zone.zy;
}

/** Ось горизонтального отступа: ось изделия или центр зоны */
function axisX(view: FlatView, area: PrintArea): number {
  const { zone } = viewZone(view, undefined, area.id);
  return view.anchors.center_axis_x ?? zone.zx + zone.zw / 2;
}

/** Отступ верха нанесения (с поворотом) от опоры, мм; минус — выше опоры */
export function verticalOffset(view: FlatView, area: PrintArea, pl: Geometry): number {
  return rotatedAabb(bboxOf(pl), pl.rotation_deg).y - refY(view, area);
}

export function withVerticalOffset(view: FlatView, area: PrintArea, pl: Geometry, mm: number): Geometry {
  return { ...pl, y_mm: pl.y_mm + (refY(view, area) + mm - rotatedAabb(bboxOf(pl), pl.rotation_deg).y) };
}

/** Смещение центра нанесения от оси, мм; плюс — вправо на рисунке */
export function horizontalOffset(view: FlatView, area: PrintArea, pl: Geometry): number {
  return pl.x_mm + pl.width_mm / 2 - axisX(view, area);
}

export function withHorizontalOffset(view: FlatView, area: PrintArea, pl: Geometry, mm: number): Geometry {
  return { ...pl, x_mm: axisX(view, area) + mm - pl.width_mm / 2 };
}

/** Подпись опоры вертикального отступа */
export function verticalLabel(view: FlatView, area: PrintArea, category: string): string {
  if (area.zone_id === null || !view.anchors.neckline_point) return 'От верха зоны, мм';
  return category === 'pants' ? 'От пояса, мм' : 'От горловины, мм';
}

export interface PresetOption {
  key: PositionPreset;
  label: string;
}

/** Пресеты одной кнопкой (проверка скиллами): центр груди, левая грудь, центр спины, центр зоны */
export function presetsFor(view: FlatView, area: PrintArea): PresetOption[] {
  const garment = area.zone_id !== null && !!view.anchors.neckline_point;
  const list: PresetOption[] = [];
  if (garment && view.kind === 'front') {
    list.push({ key: 'chest-standard', label: 'Центр груди' }, { key: 'left-chest', label: 'Левая грудь' });
  }
  if (garment && view.kind === 'back') list.push({ key: 'back-standard', label: 'Центр спины' });
  list.push({ key: 'center-zone', label: 'Центр зоны' });
  return list;
}

export function withPreset(view: FlatView, area: PrintArea, pl: Geometry, preset: PositionPreset): Geometry {
  const pos = presetPosition(view, bboxOf(pl), preset, undefined, area.id);
  return { ...pl, x_mm: pos.x_mm, y_mm: pos.y_mm };
}

/** Поворот на шаг (±90°) в пределах 0…360 */
export function rotated(pl: Geometry, deltaDeg: number): Geometry {
  return { ...pl, rotation_deg: (((pl.rotation_deg + deltaDeg) % 360) + 360) % 360 };
}

/** Поля строки нанесения (техника, Pantone, цвета…) — без геометрии */
export function patchPrint(prints: SalesPrint[], key: string, patch: Partial<SalesPrint>): SalesPrint[] | null {
  const i = prints.findIndex((p) => p.key === key);
  if (i < 0) return null;
  const cur = prints[i];
  const changed = Object.entries(patch).some(([k, v]) => cur[k as keyof SalesPrint] !== v);
  return changed ? prints.map((p, j) => (j === i ? { ...p, ...patch } : p)) : null;
}

export function setMethod(prints: SalesPrint[], key: string, method: SalesPrintMethod): SalesPrint[] | null {
  return patchPrint(prints, key, { method });
}

/** Нанесения вида на холсте — в порядке позиции */
export function viewPlacements(prints: SalesPrint[], ctx: Pick<PlaceCtx, 'flat'>, view: DesignView): { print: SalesPrint; index: number; pl: Placement }[] {
  const out: { print: SalesPrint; index: number; pl: Placement }[] = [];
  prints.forEach((print, index) => {
    const pl = placementOf(print, ctx.flat);
    if (pl && pl.view === view) out.push({ print, index, pl });
  });
  return out;
}

/**
 * Слой выше (`+1`) или ниже (`-1`) среди нанесений своего вида: меняются
 * местами два нанесения в общем списке позиции (и номера в ТЗ)
 */
export function moveLayer(prints: SalesPrint[], key: string, dir: 1 | -1, ctx: Pick<PlaceCtx, 'flat'>): SalesPrint[] | null {
  const pl = prints.map((p) => placementOf(p, ctx.flat)).find((x) => x?.print_key === key);
  if (!pl) return null;
  const same = viewPlacements(prints, ctx, pl.view);
  const at = same.findIndex((x) => x.print.key === key);
  const other = same[at + dir];
  if (!other) return null;
  const a = same[at].index;
  const b = other.index;
  return prints.map((p, j) => (j === a ? prints[b] : j === b ? prints[a] : p));
}

/** Дубль нанесения рядом с исходным (новый ключ, сдвиг); не на холсте — `null` */
export function duplicateLayer(prints: SalesPrint[], key: string, ctx: PlaceCtx): { prints: SalesPrint[]; key: string } | null {
  const i = prints.findIndex((p) => p.key === key);
  const src = i >= 0 ? prints[i] : null;
  const pl = src ? placementOf(src, ctx.flat) : null;
  if (!src || !pl) return null;
  const copy = { ...src, key: newSalesPrint().key };
  const withCopy = [...prints.slice(0, i + 1), copy, ...prints.slice(i + 1)];
  const shifted = placeGeometry(withCopy, copy.key, { ...pl, x_mm: pl.x_mm + DUPLICATE_SHIFT_MM, y_mm: pl.y_mm + DUPLICATE_SHIFT_MM }, ctx);
  return { prints: shifted ?? withCopy, key: copy.key };
}
