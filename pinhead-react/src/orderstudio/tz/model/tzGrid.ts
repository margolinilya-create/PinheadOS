/**
 * Сетка ЦВ/РАЗМ ТЗ (спека, раунд 3): колонки 2XS…4XL + ONE всегда; размер
 * вне ряда (3XS, 5XL, детские, свой) — доп. колонкой в конце, если в нём есть
 * штуки; итог — от всех колонок.
 *
 * Считаются только АКТИВНЫЕ размеры позиции (`size_grid.sizes`), как у `gridQty`
 * и ERP: штуки неактивного размера в тираж не входят. Строка — цвет позиции;
 * строка без штук и позиция с пустой сеткой в таблицу не идут (они в группе,
 * но печатать нечего). `only` — размеры нанесения (`print.sizes`); пусто — все.
 */
import type { SalesItem } from '../../model/types';
import { SALES_SIZE_PRESETS } from '../../model/sizes';
import type { TzGrid } from './tzDocTypes';

export const TZ_STANDARD_SIZES: readonly string[] = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'ONE'];

const PRESET_ORDER: readonly string[] = [...SALES_SIZE_PRESETS.adult, ...SALES_SIZE_PRESETS.kids];

function orderOf(size: string): number {
  const i = PRESET_ORDER.indexOf(size);
  return i < 0 ? PRESET_ORDER.length : i;
}

/** Штуки строки по активным размерам позиции (и размерам нанесения, если заданы) */
function rowQty(item: SalesItem, sizes: Record<string, number>, only: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of item.size_grid.sizes) {
    if (only.length > 0 && !only.includes(s)) continue;
    const n = Number(sizes?.[s]) || 0;
    if (n > 0) out[s] = (out[s] ?? 0) + n;
  }
  return out;
}

export function tzGrid(items: readonly SalesItem[], only: readonly string[] = []): TzGrid {
  const raw = items.flatMap((item) => item.size_grid.rows.map((r) => ({ color: r.color.trim(), qty: rowQty(item, r.sizes, only) })))
    .filter((r) => Object.keys(r.qty).length > 0);
  const extra = [...new Set(raw.flatMap((r) => Object.keys(r.qty)))]
    .filter((s) => !TZ_STANDARD_SIZES.includes(s))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => orderOf(a.s) - orderOf(b.s) || a.i - b.i)
    .map((x) => x.s);
  const sizes = [...TZ_STANDARD_SIZES, ...extra];
  const rows = raw.map((r) => {
    const cells = sizes.map((s) => r.qty[s] ?? 0);
    return { color: r.color, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
  const totals = sizes.map((_, i) => rows.reduce((a, r) => a + r.cells[i], 0));
  return { sizes, rows, totals, total: totals.reduce((a, b) => a + b, 0) };
}
