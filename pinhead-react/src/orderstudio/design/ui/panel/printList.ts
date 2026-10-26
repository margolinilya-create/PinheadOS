/**
 * Лёгкие операции со списком нанесений (веха 5в, Э2): их читает чанк холста
 * (`useDesignTab`, `ViewTabs`), поэтому они отдельно от `panelOps` — тот
 * со всей геометрией панели статически уходил в чанк холста ради двух функций
 * (потолок 100 кБ gzip). `panelOps` их реэкспортирует.
 */
import type { SalesPrint } from '../../../model/types';
import type { DesignView, Placement } from '../../types';
import { placementOf, type PlaceCtx } from '../../model/layout';

/** Поля строки нанесения (техника, Pantone, цвета…) — без геометрии */
export function patchPrint(prints: SalesPrint[], key: string, patch: Partial<SalesPrint>): SalesPrint[] | null {
  const i = prints.findIndex((p) => p.key === key);
  if (i < 0) return null;
  const cur = prints[i];
  const changed = Object.entries(patch).some(([k, v]) => cur[k as keyof SalesPrint] !== v);
  return changed ? prints.map((p, j) => (j === i ? { ...p, ...patch } : p)) : null;
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

