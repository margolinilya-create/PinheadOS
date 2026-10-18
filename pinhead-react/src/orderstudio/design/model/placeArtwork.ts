/**
 * Логотип → нанесение на холсте (веха 5а, задача 5). Чистая функция: файл
 * уже в бакете, здесь только новая позиция нанесений.
 *
 * - зона по умолчанию — первая зона вида со связью со справочником зон
 *   (`zone_id`); служебная (этикетка) — только если других нет;
 * - размер — свой размер файла, ужатый до зоны; место — стандартное
 *   (`STANDARD_PLACEMENT`: центр груди, центр спины) либо точка сброса при
 *   перетаскивании файла на холст (центр в точке, рамка внутри зоны);
 * - **без задвоения** (проверка скиллами, архитектура): если в зоне уже есть
 *   строка нанесения с тем же именем зоны, НЕ размещённая на этом флэте,
 *   раскладка, файл, мм и отступ дописываются ей — новое нанесение не
 *   создаётся, цена та же. Техника и прочие поля строки (Pantone, цвета,
 *   комментарий) — её. «Не размещена на этом флэте» = нет раскладки по форме
 *   с этим `flat_id` ЛЮБОЙ версии (веха 5б, задача 5): раскладки нет, она
 *   битая или стоит на другом/снятом флэте. Раскладка прежней версии этого
 *   флэта, чья зона пропала в новой, — своё нанесение, а не свободная строка:
 *   иначе она приняла бы чужой логотип.
 */
import type { SalesPrint } from '../../model/types';
import type { AssetMeta, DesignView, GarmentFlat } from '../types';
import { viewZone } from '../geometry/view';
import { applyPlacement, newPlacedPrint, placementOf, zoneNameOf, type NewPlacedCtx } from './layout';
import { hasPlacedLayout } from './layoutMark';

export type PlaceArtworkCtx = NewPlacedCtx;

export interface PlaceArtworkResult {
  prints: SalesPrint[];
  /** Ключ поставленного нанесения (новое или дописанная строка) */
  key: string;
}

export interface PlaceArtworkOpts {
  /** Точка сброса файла на холст, мм флэта */
  at?: { x_mm: number; y_mm: number };
}

/* Зона для нового логотипа — в `geometry/view` (её читает и холст; конвейер логотипа — ленивый чанк) */
export { defaultAreaId } from '../geometry/view';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

/** Строка той же зоны без раскладки на этом флэте (любой версии): сначала без файла или с тем же файлом */
function unplacedRow(prints: SalesPrint[], zone: string, artworkPath: string, flat: GarmentFlat): SalesPrint | undefined {
  const free = prints.filter((p) => !hasPlacedLayout(p.layout, flat.id) && p.zone.trim() === zone);
  return free.find((p) => !p.artwork_path || p.artwork_path === artworkPath) ?? free[0];
}

/** Перенести рамку центром в точку, не выходя за зону */
function moveTo(print: SalesPrint, at: { x_mm: number; y_mm: number }, ctx: PlaceArtworkCtx): SalesPrint {
  const pl = placementOf(print, ctx.flat);
  const view = ctx.flat.views.find((v) => v.kind === ctx.view);
  if (!pl || !view) return print;
  const { zone } = viewZone(view, undefined, pl.area_id);
  const x = clamp(at.x_mm - pl.width_mm / 2, zone.zx, zone.zx + zone.zw - pl.width_mm);
  const y = clamp(at.y_mm - pl.height_mm / 2, zone.zy, zone.zy + zone.zh - pl.height_mm);
  return applyPlacement(print, { ...pl, x_mm: x, y_mm: y }, ctx);
}

/** Поставить файл в зону вида. Зоны нет или раскладка не по форме — `null` */
export function placeArtwork(
  prints: SalesPrint[],
  asset: AssetMeta,
  artworkPath: string,
  areaId: string,
  ctx: PlaceArtworkCtx,
  opts: PlaceArtworkOpts = {},
): PlaceArtworkResult | null {
  const area = ctx.flat.views.find((v) => v.kind === ctx.view)?.print_areas.find((a) => a.id === areaId);
  if (!area) return null;
  const row = unplacedRow(prints, zoneNameOf(area, ctx.zonesCatalog), artworkPath, ctx.flat);
  const created = newPlacedPrint(asset, artworkPath, areaId, row ? { ...ctx, method: row.method } : ctx);
  if (!created) return null;
  const placed = opts.at ? moveTo(created, opts.at, ctx) : created;
  if (!row) return { prints: [...prints, placed], key: placed.key };
  const merged: SalesPrint = {
    ...row,
    zone: placed.zone,
    width_mm: placed.width_mm,
    height_mm: placed.height_mm,
    artwork_path: placed.artwork_path,
    offset_mm: placed.offset_mm,
    offset_from: placed.offset_from,
    offset_dir: placed.offset_dir,
    layout: placed.layout,
  };
  return { prints: prints.map((p) => (p === row ? merged : p)), key: row.key };
}
