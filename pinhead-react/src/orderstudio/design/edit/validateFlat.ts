/**
 * Проверка флэта в редакторе (веха 5б, задача 1): ошибки закрывают сохранение,
 * предупреждения — нет. Каждое замечание несёт адрес (`view`, `areaId`, `field`) —
 * для «Перейти» и `aria-describedby` в `FlatChecks`.
 *
 * Ошибки: замечания схемы; id нового флэта; `zone_id` новой или изменённой
 * зоны — в живом справочнике зон и не снят; имя сохранённой служебной зоны
 * не меняется (решение 5); справочник больше 1 МБ в байтах UTF-8; код модели
 * у двух активных флэтов. У нетронутых зон отсутствие в справочнике или
 * снятие — только предупреждение: иначе снятие зоны закрыло бы даже правку
 * метаданных.
 */
import { getAvailableZonesForSku } from '../../../utils/skuRules';
import { flatSchemaIssues } from '../catalog/flatsSchema';
import { areasOutsideFlat } from '../catalog/zoneFit';
import { FLAT_VIEW_KINDS, type FlatViewKind, type GarmentFlat, type PrintArea } from '../types';
import { isRectArea } from './flatEdit';
import type { ZoneLike } from './flatAreas';
import { idError } from './flatIds';

export interface FlatIssue { text: string; view?: FlatViewKind; areaId?: string; field?: string }
export interface FlatCheck { errors: FlatIssue[]; warnings: FlatIssue[] }

export interface FlatCheckCtx {
  reservedIds: ReadonlySet<string>;
  isNew: boolean;
  base: GarmentFlat | null;
  activeFlats: readonly GarmentFlat[];
  /** `null` — свежий справочник зон не загрузился: одно предупреждение, без ошибок */
  zonesCatalog: readonly ZoneLike[] | null;
  skuCodes: ReadonlySet<string>;
  flatMm: Partial<Record<FlatViewKind, { w: number; h: number }>>;
  /** Размер склеенного справочника, байт UTF-8 (`flatVersion.catalogBytes`) */
  catalogBytes: number;
}

/** Лимит записи справочника, байт UTF-8 — как у сервера */
export const CATALOG_MAX_BYTES = 1048576;
/** Порог предупреждения — 80 % лимита */
export const CATALOG_WARN_BYTES = Math.floor(CATALOG_MAX_BYTES * 0.8);

const kb = (n: number) => Math.ceil(n / 1024);

/** Адрес замечания схемы по пути zod: вид, зона, поле */
function addressOf(flat: GarmentFlat, path: (string | number)[]): Omit<FlatIssue, 'text'> {
  if (path[0] !== 'views' || typeof path[1] !== 'number') return path.length ? { field: String(path[0]) } : {};
  const view = flat.views[path[1]]?.kind;
  const kind = (FLAT_VIEW_KINDS as readonly string[]).includes(view) ? view : undefined;
  if (path[2] === 'print_areas' && typeof path[3] === 'number') {
    const field = path[4] === undefined ? undefined : String(path[4]);
    return { view: kind, areaId: flat.views[path[1]]?.print_areas[path[3]]?.id, field };
  }
  return { view: kind, field: path[2] === undefined ? undefined : String(path[2]) };
}

type Located = { kind: FlatViewKind; area: PrintArea };
const areasOf = (f: GarmentFlat): Located[] => f.views.flatMap((v) => v.print_areas.map((area) => ({ kind: v.kind, area })));
const baseArea = (base: GarmentFlat | null, kind: FlatViewKind, id: string) =>
  base?.views.find((v) => v.kind === kind)?.print_areas.find((a) => a.id === id);

function zoneChecks(flat: GarmentFlat, ctx: FlatCheckCtx, out: FlatCheck): void {
  const zones = ctx.zonesCatalog;
  if (!zones) {
    out.warnings.push({ text: 'Справочник зон не загрузился — привязки зон к справочнику не проверены' });
    return;
  }
  for (const { kind, area } of areasOf(flat)) {
    const was = baseArea(ctx.base, kind, area.id);
    const at = { view: kind, areaId: area.id, field: 'zone_id' };
    if (area.zone_id === null) {
      if (was && was.zone_id === null && was.name !== area.name) {
        out.errors.push({ text: `Название служебной зоны «${was.name}» — ключ нанесений в заказах, его не меняют`, view: kind, areaId: area.id, field: 'name' });
      }
      continue;
    }
    const touched = !was || was.zone_id !== area.zone_id;
    const zone = zones.find((z) => z.id === area.zone_id);
    const text = !zone ? `Зоны «${area.zone_id}» нет в справочнике зон`
      : zone.active === false ? `Зона «${zone.name}» снята с подбора` : null;
    if (text) (touched ? out.errors : out.warnings).push({ text, ...at });
    else if (flat.categories.length > 0 && !flat.categories.some((c) => getAvailableZonesForSku([...zones], c).some((z) => z.id === area.zone_id))) {
      out.warnings.push({ text: `Зона «${zone!.name}» не предлагается категориям флэта`, ...at });
    }
  }
}

function skuChecks(flat: GarmentFlat, ctx: FlatCheckCtx, out: FlatCheck): void {
  for (const code of new Set(flat.sku_codes)) {
    const other = flat.active ? ctx.activeFlats.find((f) => f.id !== flat.id && f.active && f.sku_codes.includes(code)) : undefined;
    if (other) out.errors.push({ text: `Модель ${code} уже у флэта «${other.name}» — снимите её там или снимите флэт с подбора`, field: 'sku_codes' });
    if (!ctx.skuCodes.has(code)) out.warnings.push({ text: `Модели ${code} нет в каталоге моделей`, field: 'sku_codes' });
  }
}

function shapeWarnings(flat: GarmentFlat, ctx: FlatCheckCtx, out: FlatCheck): void {
  for (const v of flat.views) {
    const mm = ctx.flatMm[v.kind];
    if (mm) for (const id of areasOutsideFlat(v, mm)) out.warnings.push({ text: `Зона «${id}» выходит за силуэт`, view: v.kind, areaId: id, field: 'polygon_mm' });
    for (const a of v.print_areas) {
      if (!isRectArea(a)) {
        out.warnings.push({ text: `Зона «${a.name}» — многоугольник: на холсте заказа логотип проверяется по описывающему прямоугольнику`, view: v.kind, areaId: a.id, field: 'polygon_mm' });
      }
    }
  }
}

/** Ошибки и предупреждения флэта перед сохранением */
export function validateFlat(flat: GarmentFlat, ctx: FlatCheckCtx): FlatCheck {
  const out: FlatCheck = { errors: [], warnings: [] };
  for (const i of flatSchemaIssues(flat)) out.errors.push({ text: i.text, ...addressOf(flat, i.path) });
  if (ctx.isNew) {
    const e = idError(flat.id, ctx.reservedIds);
    if (e) out.errors.push({ text: e, field: 'id' });
  }
  zoneChecks(flat, ctx, out);
  skuChecks(flat, ctx, out);
  if (ctx.catalogBytes > CATALOG_MAX_BYTES) {
    out.errors.push({ text: `Справочник флэтов займёт ${kb(ctx.catalogBytes)} КБ — больше лимита 1024 КБ`, field: 'history' });
  } else if (ctx.catalogBytes > CATALOG_WARN_BYTES) {
    out.warnings.push({ text: `Справочник флэтов занимает ${kb(ctx.catalogBytes)} КБ из 1024 КБ`, field: 'history' });
  }
  shapeWarnings(flat, ctx, out);
  return out;
}
