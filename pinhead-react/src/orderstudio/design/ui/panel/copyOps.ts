/**
 * Копия нанесения на другой вид и вставка скопированного слоя (веха 5в, Э2).
 * Только для ленивых чанков (панель, обработчик вставки по `import()`):
 * `panelOps` статически в чанке холста, сюда новое не кладётся.
 *
 * - Зона цели: у рукава — парная (`SWAP_ZONE`: `sleeve-l` ↔ `sleeve-r`), иначе
 *   тот же `zone_id`, иначе первая зона вида, доступная модели (`areaAllowed`).
 * - Рукав ↔ рукав — зеркально по осям ОБОИХ рукавов: `x' = axisS + axisT − x − w`,
 *   отступ от низа рукава сохраняется, поворот зеркальный, рисунок не отражается
 *   (`flip_h` как был: логотип на правом рукаве читается так же).
 * - Прочие виды — отступы от опоры и оси переносятся, затем прижим к зоне.
 * - Копия — новая строка с новым ключом сразу после исходной: та же техника,
 *   файл и размер (одна цена со строкой).
 */
import type { SalesPrint } from '../../../model/types';
import { newSalesPrint } from '../../../model/factory';
import type { DesignView, FlatView, GarmentFlat, Placement, PrintArea } from '../../types';
import { applyPlacement, parseLayout, placementOf, remapToFlat, type PlaceCtx } from '../../model/layout';
import { toast } from '../../../../store/useToastStore';
import { useDesignStore } from '../../store/useDesignStore';
import { MSG_ADD_BLOCKED_MISMATCH } from '../useArtworkActions';
import { viewZone } from '../../geometry/view';
import { SWAP_ZONE } from '../../catalog/sleeveZones';
import {
  DUPLICATE_SHIFT_MM, duplicateLayer, horizontalOffset, verticalOffset, whereOf, withHorizontalOffset, withVerticalOffset,
} from './panelOps';
import { clampedToZone } from './presetOps';

type Where = { view: FlatView; area: PrintArea };

const isSleeve = (v: FlatView) => v.kind === 'sleeve_left' || v.kind === 'sleeve_right';
const usable = (ctx: PlaceCtx, a: PrintArea) => a.zone_id !== null && (!ctx.areaAllowed || ctx.areaAllowed(a));

function targetArea(from: PrintArea, to: FlatView, ctx: PlaceCtx): PrintArea | null {
  const ok = to.print_areas.filter((a) => usable(ctx, a));
  const pair = from.zone_id ? SWAP_ZONE[from.zone_id] : undefined;
  return ok.find((a) => pair && a.zone_id === pair) ?? ok.find((a) => from.zone_id && a.zone_id === from.zone_id) ?? ok[0] ?? null;
}

function sleeveLine(v: FlatView, area: PrintArea) {
  const { zone } = viewZone(v, undefined, area.id);
  return { axis: v.anchors.sleeve_center_x ?? zone.zx + zone.zw / 2, bottom: v.anchors.sleeve_bottom_y ?? zone.zy + zone.zh };
}

function movedTo(pl: Placement, from: Where, to: Where): Placement {
  const base = { ...pl, view: to.view.kind, area_id: to.area.id };
  if (isSleeve(from.view) && isSleeve(to.view)) {
    const s = sleeveLine(from.view, from.area);
    const t = sleeveLine(to.view, to.area);
    return {
      ...base,
      x_mm: s.axis + t.axis - pl.x_mm - pl.width_mm,
      y_mm: pl.y_mm + (t.bottom - s.bottom),
      rotation_deg: (360 - pl.rotation_deg) % 360,
    };
  }
  const v = withVerticalOffset(to.view, to.area, base, verticalOffset(from.view, from.area, pl));
  const h = withHorizontalOffset(to.view, to.area, v, horizontalOffset(from.view, from.area, pl));
  return { ...base, ...clampedToZone(to.view, to.area, h) };
}

/** Виды силуэта, куда нанесение можно скопировать (есть зона, доступная модели) */
export function copyTargets(pl: Placement, ctx: PlaceCtx): DesignView[] {
  const from = whereOf(pl, ctx);
  if (!from) return [];
  return ctx.flat.views.filter((v) => v.kind !== pl.view && targetArea(from.area, v, ctx)).map((v) => v.kind);
}

/** Строка-копия `print` на виде `target` (новый ключ); нельзя — `null` */
function placedCopy(print: SalesPrint, pl: Placement, target: DesignView, ctx: PlaceCtx): SalesPrint | null {
  const from = whereOf(pl, ctx);
  const view = ctx.flat.views.find((v) => v.kind === target);
  const area = from && view ? targetArea(from.area, view, ctx) : null;
  if (!from || !view || !area) return null;
  const copy = { ...print, key: newSalesPrint().key };
  const placed = applyPlacement(copy, { ...movedTo(pl, from, { view, area }), print_key: copy.key }, ctx);
  return placed === copy ? null : placed;
}

/** Копия нанесения `key` на другой вид — сразу после исходного */
export function copyToView(prints: SalesPrint[], key: string, target: DesignView, ctx: PlaceCtx): { prints: SalesPrint[]; key: string } | null {
  const i = prints.findIndex((p) => p.key === key);
  const pl = i >= 0 ? placementOf(prints[i], ctx.flat) : null;
  if (!pl || pl.view === target) return null;
  const copy = placedCopy(prints[i], pl, target, ctx);
  return copy ? { prints: [...prints.slice(0, i + 1), copy, ...prints.slice(i + 1)], key: copy.key } : null;
}

/**
 * Вставка скопированного нанесения (Ctrl+V) в конец позиции на вид `view`:
 * тот же силуэт и вид — рядом со сдвигом, как дубль; другой вид — как «На другой
 * вид»; другой силуэт (`from` — его флэт) — по зонам (`remapToFlat`). Не нашлось — `null`.
 */
export function pasteLayer(
  prints: SalesPrint[], copied: SalesPrint, view: DesignView, ctx: PlaceCtx, from: GarmentFlat | null,
): { prints: SalesPrint[]; key: string } | null {
  const pl = placementOf(copied, ctx.flat);
  let next: SalesPrint | null = null;
  if (pl && pl.view === view) {
    const copy = { ...copied, key: newSalesPrint().key };
    const shifted = { ...pl, print_key: copy.key, x_mm: pl.x_mm + DUPLICATE_SHIFT_MM, y_mm: pl.y_mm + DUPLICATE_SHIFT_MM };
    const placed = applyPlacement(copy, shifted, ctx);
    next = placed === copy ? null : placed;
  } else if (pl) {
    next = placedCopy(copied, pl, view, ctx);
  } else if (from) {
    const res = remapToFlat([{ ...copied, key: newSalesPrint().key }], from, ctx);
    next = res.dropped.length === 0 && placementOf(res.prints[0], ctx.flat) ? res.prints[0] : null;
  }
  return next ? { prints: [...prints, next], key: next.key } : null;
}

export const MSG_PASTE_NOWHERE = 'Скопированное нанесение некуда поставить на этом виде';

export interface PasteOpts {
  orderId: string;
  ctx: PlaceCtx;
  /** Силуэт другой модели (Э1): новые нанесения не ставятся */
  blocked: boolean;
  flats: readonly GarmentFlat[];
  commitPrints: (label: string, fn: (prints: SalesPrint[]) => SalesPrint[] | null) => boolean;
}

/**
 * Ctrl+V слоя с холста: вставка только по метке своего копирования «заказ:строка»
 * (после копирования текста в другом окне метки нет — старый слой не вставится);
 * силуэт другой модели — отказ тостом, как у нового логотипа. Вставленное — выбрано.
 */
export function pasteFromToken(token: string, o: PasteOpts): void {
  const s = useDesignStore.getState();
  const clip = s.clipboard;
  if (!clip || token !== `${o.orderId}:${clip.key}`) return;
  if (o.blocked) {
    toast.error(MSG_ADD_BLOCKED_MISMATCH);
    return;
  }
  const fromId = parseLayout(clip.layout)?.flat_id;
  const from = o.flats.find((f) => f.id === fromId) ?? null;
  let next: string | null = null;
  o.commitPrints('Вставка', (prints) => {
    const res = pasteLayer(prints, clip, s.view, o.ctx, from);
    next = res?.key ?? null;
    return res?.prints ?? null;
  });
  if (next) useDesignStore.getState().select(next);
  else toast.error(MSG_PASTE_NOWHERE);
}

/** Действие холста со слоем (Ctrl+D — `duplicate` по ключу, Ctrl+V — `paste` по метке) */
export function layerOp(op: 'duplicate' | 'paste', arg: string, o: PasteOpts): void {
  if (op === 'paste') {
    pasteFromToken(arg, o);
    return;
  }
  let next: string | null = null;
  o.commitPrints('Дубль', (prints) => {
    const res = duplicateLayer(prints, arg, o.ctx);
    next = res?.key ?? null;
    return res?.prints ?? null;
  });
  if (next) useDesignStore.getState().select(next);
}

