/**
 * «Мои раскладки» (веха 5в, Э8): раскладка позиции без файлов и без абсолютных
 * координат — на нанесение вид, зона (`area_id` + `zone_id`), техника, ширина
 * видимой рамки и отступы от опоры и оси (те же, что у «Стандартов Pinhead»
 * и копии на вид). Поэтому раскладка ложится и на другой силуэт — по зоне.
 * Только для ленивых чанков (`import()` из панели): холст не растёт.
 *
 * Применение — к выбранному нанесению с файлом: первое место раскладки двигает
 * его самого (тот же ключ и файл), остальные — новые строки с тем же файлом
 * сразу после него — без заметок исходного (отступ словами, комментарий):
 * они про его место. Зона — правило переноса `targetArea` (служебная — только
 * по id и на том же силуэте), доступная модели; техника, которой в зоне нет, —
 * пропуск. Пропуски с причиной — в ответе.
 */
import type { SalesPrint } from '../../../model/types';
import { newSalesPrint } from '../../../model/factory';
import type { Placement } from '../../types';
import { MAX_TEMPLATE_PRINTS, type LayoutTemplateData, type TemplatePrint } from '../../model/layoutTemplate';
import { applyPlacement, placementOf, targetArea, type PlaceCtx } from '../../model/layout';
import { methodAllowedInZone } from '../../../model/printMethods';
import { rotatedAabb } from '../../geometry/coords';
import { horizontalOffset, verticalOffset, whereOf, withHorizontalOffset, withVerticalOffset } from './panelOps';
import { clampedToZone, scaledTo } from './presetOps';

const round1 = (n: number) => Math.round(n * 10) / 10;
const visibleWidth = (pl: Placement) => rotatedAabb({ x: pl.x_mm, y: pl.y_mm, w: pl.width_mm, h: pl.height_mm }, pl.rotation_deg).w;

/** Снимок размещённых нанесений позиции на этом силуэте, по порядку; нет ни одного — `null` */
export function templateFromPrints(prints: readonly SalesPrint[], ctx: Pick<PlaceCtx, 'flat'>): LayoutTemplateData | null {
  const out: TemplatePrint[] = [];
  for (const p of prints) {
    const pl = placementOf(p, ctx.flat);
    const where = pl ? whereOf(pl, ctx) : null;
    if (!pl || !where) continue;
    out.push({
      view: pl.view,
      area_id: pl.area_id,
      zone_id: where.area.zone_id,
      method: p.method,
      width_mm: round1(visibleWidth(pl)),
      down_mm: round1(verticalOffset(where.view, where.area, pl)),
      dx_mm: round1(horizontalOffset(where.view, where.area, pl)),
      rotation_deg: round1(pl.rotation_deg),
    });
    if (out.length === MAX_TEMPLATE_PRINTS) break;
  }
  return out.length ? { kind: 'layout', v: 1, flat_id: ctx.flat.id, prints: out } : null;
}

// ── применение ──────────────────────────────────────────────────────────

type Skip = 'zone' | 'method';

function placedBy(print: SalesPrint, pl: Placement, e: TemplatePrint, sameFlat: boolean, ctx: PlaceCtx): SalesPrint | Skip {
  const view = ctx.flat.views.find((v) => v.kind === e.view);
  const area = view ? targetArea({ id: e.area_id, zone_id: e.zone_id }, view, sameFlat) : undefined;
  if (!view || !area || (ctx.areaAllowed && !ctx.areaAllowed(area))) return 'zone';
  if (!methodAllowedInZone(area, e.method)) return 'method';
  const base: Placement = { ...pl, print_key: print.key, view: e.view, area_id: area.id, rotation_deg: e.rotation_deg, method: e.method };
  const sized = scaledTo(view, area, base, e.width_mm);
  const moved = clampedToZone(view, area, withHorizontalOffset(view, area, withVerticalOffset(view, area, sized, e.down_mm), e.dx_mm));
  const styled = { ...print, method: e.method };
  const placed = applyPlacement(styled, { ...base, ...moved }, ctx);
  return placed === styled ? 'zone' : placed;
}

export interface ApplyTemplateResult {
  prints: SalesPrint[];
  /** Ключ исходного нанесения (оно — на первом подошедшем месте раскладки) */
  key: string;
  placed: number;
  /** Пропуски: нет такой зоны на силуэте / техника в зоне не разрешена */
  skipped: Record<Skip, number>;
}

/** Разложить нанесение `sourceKey` по раскладке; не размещено или ни одно место не подошло — `null` */
export function applyTemplate(
  prints: SalesPrint[], sourceKey: string, tpl: LayoutTemplateData, ctx: PlaceCtx,
): ApplyTemplateResult | null {
  const i = prints.findIndex((p) => p.key === sourceKey);
  const source = i >= 0 ? prints[i] : null;
  const pl = source ? placementOf(source, ctx.flat) : null;
  if (!source || !pl) return null;
  const sameFlat = tpl.flat_id === ctx.flat.id;
  const out: SalesPrint[] = [];
  const skipped: Record<Skip, number> = { zone: 0, method: 0 };
  for (const e of tpl.prints) {
    const row = out.length === 0
      ? source
      : { ...source, key: newSalesPrint().key, offset_note: '', comment: '', applied_at: null };
    const res = placedBy(row, pl, e, sameFlat, ctx);
    if (typeof res === 'string') skipped[res] += 1;
    else out.push(res);
  }
  if (out.length === 0) return null;
  return { prints: [...prints.slice(0, i), ...out, ...prints.slice(i + 1)], key: source.key, placed: out.length, skipped };
}
