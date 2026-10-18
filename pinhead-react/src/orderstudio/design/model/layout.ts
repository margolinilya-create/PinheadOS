/**
 * Нанесение ↔ размещение на холсте (решение 3 плана вехи 5а: одно `SalesPrint`
 * равно одному размещению).
 *
 * Источник правды — заказ: холст выводит размещения из `print.layout`, правка
 * возвращается новым `SalesPrint` (`applyPlacement`). Мм, зона, техника, отступ
 * и файл макета — в стандартных полях нанесения (их читают `priceOrder`,
 * `tzToErpDraft`, ТЗ); в `layout` — только геометрия холста.
 *
 * `parseLayout` — строгий разбор (проверка безопасности H1): конечные числа
 * в границах, перечни, id по регулярке, имя файла ≤ 255, лишние ключи прочь
 * (с задачи 6б — без zod, в `layoutMark.ts`).
 * Битая раскладка — «не размещено» без перезаписи: строка нанесения остаётся.
 */
import { newSalesPrint } from '../../model/factory';
import type { SalesItemKind, SalesPrint, SalesPrintMethod } from '../../model/types';
import type { ZoneDefinition } from '../../../types/catalog';
import { getZoneName } from '../../../utils/skuRules';
import { type AssetMeta, type DesignView, type FlatView, type GarmentFlat, type Placement, type PrintArea, type PrintLayoutV1 } from '../types';
import { parseLayout } from './layoutMark';
import { flatAtVersion } from '../catalog/flatVersion';
import { fitToZone, placementInfo, presetPosition, viewZone, yForNecklineOffset } from '../geometry/view';
import { rotatedAabb } from '../geometry/coords';
import { offsetFor } from './offset';
import { ZONE_ID_RE } from '../../catalog/tzRows';

/**
 * Строгий разбор раскладки — `layoutMark.parseLayout` (без zod: чанк холста
 * и оболочка Order, задача 6б); здесь — реэкспорт для прежних читателей.
 */
export { parseLayout };

/**
 * Геометрия флэта, по которой стоит раскладка (веха 5б, К1, К15): версия
 * раскладки из истории (`flatAtVersion`); версии у флэта нет — текущая
 * (пометка `stale`, как в 5а)
 */
function geometryFor(flat: GarmentFlat, flatVersion: number): GarmentFlat {
  return flatAtVersion(flat, flatVersion) ?? flat;
}

const isSleeveView = (view: FlatView) => view.kind === 'sleeve_left' || view.kind === 'sleeve_right';

/** Вид и зона флэта по раскладке; нет — `null` */
function locate(flat: GarmentFlat, view: DesignView, areaId: string): { view: FlatView; area: PrintArea } | null {
  const v = flat.views.find((x) => x.kind === view);
  const a = v?.print_areas.find((x) => x.id === areaId);
  return v && a ? { view: v, area: a } : null;
}

/**
 * Размещение нанесения на этом флэте; не размещено, другой флэт или битая
 * раскладка — `null`. Зона ищется в геометрии версии раскладки (`flatAtVersion`):
 * нанесение на v1 после выпуска v2 стоит по v1 (`stale`), даже если в v2 его
 * зоны нет
 */
export function placementOf(print: SalesPrint, flat: GarmentFlat): Placement | null {
  const layout = parseLayout(print.layout);
  if (!layout || layout.flat_id !== flat.id) return null;
  if (!locate(geometryFor(flat, layout.flat_version), layout.view, layout.area_id)) return null;
  const width = print.width_mm && print.width_mm > 0 ? print.width_mm : layout.asset.intrinsic_w_mm;
  const height = print.height_mm && print.height_mm > 0 ? print.height_mm : layout.asset.intrinsic_h_mm;
  return {
    print_key: print.key,
    view: layout.view,
    area_id: layout.area_id,
    x_mm: layout.x_mm,
    y_mm: layout.y_mm,
    width_mm: width,
    height_mm: height,
    rotation_deg: layout.rotation_deg,
    flip_h: layout.flip_h,
    flip_v: layout.flip_v,
    method: print.method,
    asset: layout.asset,
    artwork_path: print.artwork_path,
    stale: layout.flat_version !== flat.version,
  };
}

/** Что нужно знать о заказе, чтобы записать размещение в нанесение */
export interface PlaceCtx {
  /**
   * Флэт, на который пишется размещение, — флэт ВЕРСИИ ПОЗИЦИИ
   * (`flatAtVersion(flat, itemFlatVersion(...).version)`, К15): его `version`
   * уходит в `layout.flat_version`
   */
  flat: GarmentFlat;
  /** Справочник зон: имя зоны нанесения берётся по `zone_id` (его читает цена) */
  zonesCatalog: ZoneDefinition[];
  /** Категория модели (`SkuItem.category`) — отступ штанов от пояса */
  category: string;
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const wholeMm = (v: number) => Math.max(1, Math.round(v));
const normDeg = (v: number) => tenth(((v % 360) + 360) % 360);

/**
 * Код зоны нанесения (веха 8, К5): `zone_id` зоны флэта по формату справочника;
 * служебная зона (без связи) или код не по формату — null
 */
export function zoneIdOfArea(area: PrintArea): string | null {
  return area.zone_id && ZONE_ID_RE.test(area.zone_id) ? area.zone_id : null;
}

/** Имя зоны нанесения: по `zone_id` из справочника зон; служебная зона — имя зоны флэта */
export function zoneNameOf(area: PrintArea, zonesCatalog: ZoneDefinition[]): string {
  return area.zone_id ? getZoneName(area.zone_id, zonesCatalog) : area.name;
}

/**
 * Размещение → новое нанесение (зона, мм, техника, отступ, файл, раскладка). Исходное не меняется.
 * Зона не найдена или раскладка не проходит `parseLayout` (например, макет со странным pHYs
 * шире 5 м) — исходное нанесение без изменений: иначе после сохранения разбор отбросил бы
 * раскладку и нанесение молча пропало бы с холста (ревью T3, раунд 1)
 */
export function applyPlacement(print: SalesPrint, pl: Placement, ctx: PlaceCtx): SalesPrint {
  const where = locate(ctx.flat, pl.view, pl.area_id);
  if (!where) return print;
  const width = wholeMm(pl.width_mm);
  const height = wholeMm(pl.height_mm);
  const bbox = { x: pl.x_mm, y: pl.y_mm, w: width, h: height };
  const info = placementInfo(where.view, bbox, pl.rotation_deg, undefined, where.area.id);
  const layout: PrintLayoutV1 = {
    v: 1,
    flat_id: ctx.flat.id,
    flat_version: ctx.flat.version,
    view: pl.view,
    area_id: where.area.id,
    x_mm: tenth(pl.x_mm),
    y_mm: tenth(pl.y_mm),
    rotation_deg: normDeg(pl.rotation_deg),
    flip_h: pl.flip_h,
    flip_v: pl.flip_v,
    asset: pl.asset,
  };
  if (!parseLayout(layout)) return print;
  return {
    ...print,
    zone: zoneNameOf(where.area, ctx.zonesCatalog),
    zone_id: zoneIdOfArea(where.area),
    width_mm: width,
    height_mm: height,
    method: pl.method,
    artwork_path: pl.artwork_path,
    ...offsetFor(info, where.area, ctx.category),
    layout: layout as unknown as Record<string, unknown>,
  };
}

/** Начальная рамка логотипа: свой размер, но не больше зоны; стандартное место по виду */
function initialBox(view: FlatView, area: PrintArea, asset: AssetMeta): { x: number; y: number; w: number; h: number } {
  const { zone, safeInsetMm } = viewZone(view, undefined, area.id);
  let w = asset.intrinsic_w_mm;
  let h = asset.intrinsic_h_mm;
  if (w > zone.zw - 2 * safeInsetMm || h > zone.zh - 2 * safeInsetMm) {
    const fit = fitToZone(view, { x: 0, y: 0, w, h }, 'fit', undefined, area.id);
    w = fit.width_mm;
    h = fit.height_mm;
  }
  const standard = area.zone_id && view.anchors.neckline_point
    ? (view.kind === 'back' ? 'back-standard' : 'chest-standard')
    : 'center-zone';
  const pos = presetPosition(view, { x: 0, y: 0, w, h }, standard, undefined, area.id);
  return { x: pos.x_mm, y: pos.y_mm, w, h };
}

export interface NewPlacedCtx extends PlaceCtx {
  view: DesignView;
  /** Тип позиции: у пошива по модели нанесение на крое, иначе на готовом (как `ItemTab`) */
  itemKind: SalesItemKind;
  /** Техника нового нанесения — `defaultMethod(area, rules)` из `model/printMethods` */
  method: SalesPrintMethod;
  /** Подложка нового нанесения по цвету изделия (`model/garmentTextile`); нет — умолчание фабрики */
  textile?: SalesPrint['textile'];
}

/** Новое нанесение сразу на холсте; зона не найдена или раскладка не по форме (`parseLayout`) — `null` */
export function newPlacedPrint(asset: AssetMeta, artworkPath: string, areaId: string, ctx: NewPlacedCtx): SalesPrint | null {
  const where = locate(ctx.flat, ctx.view, areaId);
  if (!where) return null;
  const box = initialBox(where.view, where.area, asset);
  const base = newSalesPrint({ on: ctx.itemKind === 'sku' ? 'cut' : 'finished', ...(ctx.textile ? { textile: ctx.textile } : {}) });
  const placed = applyPlacement(base, {
    print_key: base.key, view: ctx.view, area_id: areaId, x_mm: box.x, y_mm: box.y,
    width_mm: box.w, height_mm: box.h, rotation_deg: 0, flip_h: false, flip_v: false,
    method: ctx.method, asset, artwork_path: artworkPath, stale: false,
  }, ctx);
  return placed === base ? null : placed;
}

export interface RemapResult {
  prints: SalesPrint[];
  /** Ключи нанесений, перенесённых на новый флэт */
  moved: string[];
  /** Ключи нанесений, снятых с холста (зоны нет на новом флэте); строки остаются */
  dropped: string[];
}

/** Опора отсчёта по вертикали: горловина (пояс) или верх зоны; у рукава — низ рукава */
function anchorY(view: FlatView, areaId: string): number {
  const { zone } = viewZone(view, undefined, areaId);
  if (isSleeveView(view)) return view.anchors.sleeve_bottom_y ?? zone.zy + zone.zh;
  return view.anchors.neckline_point?.y ?? zone.zy;
}

/** Ось отсчёта по горизонтали: ось изделия (у рукава — ось рукава) или центр зоны (как `placementInfo`) */
function axisX(view: FlatView, areaId: string): number {
  const { zone } = viewZone(view, undefined, areaId);
  const axis = isSleeveView(view) ? view.anchors.sleeve_center_x : view.anchors.center_axis_x;
  return axis ?? zone.zx + zone.zw / 2;
}

/**
 * Зона на целевом виде: сначала та же зона (тот же `id` и `zone_id`), затем —
 * по `zone_id`. Служебная зона (`zone_id = null`) переносится только по `id`
 * и только внутри того же флэта (новая версия): на чужом силуэте — не наугад
 */
function targetArea(src: PrintArea, toView: FlatView, sameFlat: boolean): PrintArea | undefined {
  const same = toView.print_areas.find((a) => a.id === src.id && a.zone_id === src.zone_id);
  if (same && (src.zone_id !== null || sameFlat)) return same;
  return src.zone_id ? toView.print_areas.find((a) => a.zone_id === src.zone_id) : undefined;
}

/** Новый y рамки: отступ от опоры сохранён (горловина — `yForNecklineOffset`, рукав — от низа рамки) */
function remappedY(src: FlatView, srcArea: PrintArea, toView: FlatView, toArea: PrintArea, pl: Placement): number {
  const bbox = { x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm };
  const aabb = rotatedAabb(bbox, pl.rotation_deg);
  if (isSleeveView(src) && isSleeveView(toView)) {
    const fromBottom = anchorY(src, srcArea.id) - (aabb.y + aabb.h);
    return bbox.y + (anchorY(toView, toArea.id) - fromBottom - (aabb.y + aabb.h));
  }
  const vertical = aabb.y - anchorY(src, srcArea.id);
  return toView.anchors.neckline_point && !isSleeveView(toView)
    ? yForNecklineOffset(toView, bbox, pl.rotation_deg, vertical, undefined, toArea.id)
    : bbox.y + (anchorY(toView, toArea.id) + vertical - aabb.y);
}

/**
 * Перенос размещений на другой флэт (смена силуэта) или на новую версию того же
 * флэта (`ctx.flat` — флэт версии M): та же зона по `id` и `zone_id`, иначе по
 * `zone_id` в том же виде; размер и отступы от опоры (вертикаль: горловина,
 * у рукава — низ рукава) и оси (горизонталь) сохраняются. Исходная геометрия —
 * версии раскладки (`placementOf`). Зоны нет — `layout = null`, нанесение
 * остаётся строкой.
 */
export function remapToFlat(prints: SalesPrint[], from: GarmentFlat, ctx: PlaceCtx): RemapResult {
  const moved: string[] = [];
  const dropped: string[] = [];
  const next = prints.map((print) => {
    const pl = placementOf(print, from);
    const layout = pl ? parseLayout(print.layout) : null;
    if (!pl || !layout) return print;
    const src = locate(geometryFor(from, layout.flat_version), pl.view, pl.area_id)!;
    const toView = ctx.flat.views.find((v) => v.kind === pl.view);
    const toArea = toView ? targetArea(src.area, toView, from.id === ctx.flat.id) : undefined;
    if (!toView || !toArea) {
      dropped.push(print.key);
      return { ...print, layout: null };
    }
    const aabb = rotatedAabb({ x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm }, pl.rotation_deg);
    const horizontal = aabb.x + aabb.w / 2 - axisX(src.view, src.area.id);
    const y = remappedY(src.view, src.area, toView, toArea, pl);
    const x = axisX(toView, toArea.id) + horizontal - pl.width_mm / 2;
    moved.push(print.key);
    return applyPlacement(print, { ...pl, area_id: toArea.id, x_mm: x, y_mm: y }, ctx);
  });
  return { prints: next, moved, dropped };
}
