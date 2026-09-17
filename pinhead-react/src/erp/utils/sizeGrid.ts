/**
 * РАЗМЕРНАЯ СЕТКА В ХРАНИМОМ ВИДЕ (правки заказчика 16.09, пп. 1, 2, 4, 6).
 *
 * `SizeGridRow[]` — это `[{color, sizes: {XS: 10, S: 20}}]`, и с 16.09 в этом
 * формате живут ТРИ вещи: состав позиции (`erp_order_items.size_grid`),
 * разбивка закупки готового изделия (`erp_materials.size_grid`) и факт
 * прихода (`erp_material_receipts.size_grid`). Четвёртая — размерный
 * результат этапа — хранится строками таблицы, но на экран приезжает и
 * уезжает тем же набором ячеек.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ `utils/orderForm.ts`. Тамошние `gridTotal`/`rowTotal`
 * работают с ЧЕРНОВИКОМ формы (`DraftGrid` — это `{sizes: string[], rows}`,
 * где список активных размеров ведётся отдельно от данных). Здесь — хранимый
 * вид, у которого активных размеров нет вовсе: размеры это КЛЮЧИ объекта.
 * Дать одной функции оба вида значило бы развилку внутри каждой, а разойтись
 * им достаточно в одном слагаемом: на этих числах стоят тираж закупки
 * и потолок приёмки.
 *
 * ВСЁ ЧИТАЕТСЯ FAIL-SAFE. Сетка приезжает из базы, из урезанной выборки,
 * из офлайн-очереди и из заказов, заведённых до всех этих правок. Ноль
 * честнее падения: пустая сетка означает «позиция без размеров», и такие
 * позиции на бою составляют почти половину.
 */

import type { SizeGridRow } from '../types';
import { SIZE_PRESETS } from './orderForm';

/** Одна ячейка сетки: цвет × размер × количество */
export interface SizeCell {
  color: string;
  size: string;
  qty: number;
}

/** Цвет строки без цветового деления — то же значение, что пишет форма заказа */
export const NO_COLOR = '—';

/**
 * Порядок шкалы: взрослая, затем детская, затем всё незнакомое.
 *
 * Пресет можно менять без миграции (записанное решение `SizeGridEditor`),
 * поэтому у старых заказов встречаются свои размеры. Незнакомый размер
 * обязан остаться видимым — иначе его количество исчезнет с экрана,
 * оставшись в данных.
 */
const SCALE: readonly string[] = [...SIZE_PRESETS.adult, ...SIZE_PRESETS.kids];

/** Место размера в шкале. Незнакомые — после известных, между собой по алфавиту */
export function sizeOrderIndex(size: string): number {
  const at = SCALE.indexOf(size);
  return at >= 0 ? at : SCALE.length;
}

function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const byScale = sizeOrderIndex(a) - sizeOrderIndex(b);
    if (byScale !== 0) return byScale;
    // Оба незнакомы шкале: числовые сравниваем числами («98» < «104»),
    // прочие — по алфавиту. Устойчивый порядок важнее «правильного»:
    // строки формы не должны прыгать между отрисовками
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b, 'ru');
  });
}

function rowsOf(grid: SizeGridRow[] | null | undefined): SizeGridRow[] {
  return Array.isArray(grid) ? grid : [];
}

/** Количество ячейки: отрицательные и нечисловые читаются нулём */
function qtyOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function colorOf(row: SizeGridRow | null | undefined): string {
  const raw = typeof row?.color === 'string' ? row.color.trim() : '';
  return raw || NO_COLOR;
}

/** Все размеры сетки в порядке шкалы, без повторов */
export function gridSizes(grid: SizeGridRow[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const row of rowsOf(grid)) {
    const sizes = row?.sizes;
    if (!sizes || typeof sizes !== 'object') continue;
    for (const size of Object.keys(sizes)) if (size.trim()) seen.add(size);
  }
  return sortSizes([...seen]);
}

/** Сетка, развёрнутая в строки «цвет × размер». Нулевые ячейки не строки */
export function gridCells(grid: SizeGridRow[] | null | undefined): SizeCell[] {
  const out: SizeCell[] = [];
  for (const row of rowsOf(grid)) {
    const sizes = row?.sizes;
    if (!sizes || typeof sizes !== 'object') continue;
    const color = colorOf(row);
    for (const size of sortSizes(Object.keys(sizes))) {
      const qty = qtyOf(sizes[size]);
      if (qty > 0) out.push({ color, size, qty });
    }
  }
  return out;
}

/** Тираж по сетке. Зеркало серверной `erp_size_grid_total(jsonb)` */
export function gridRowsTotal(grid: SizeGridRow[] | null | undefined): number {
  return gridCells(grid).reduce((sum, cell) => sum + cell.qty, 0);
}

/** Строки формы обратно в сетку. Пустые ячейки не сохраняются */
export function cellsToGrid(cells: readonly SizeCell[] | null | undefined): SizeGridRow[] {
  const byColor = new Map<string, Record<string, number>>();
  const order: string[] = [];
  for (const cell of cells ?? []) {
    const qty = qtyOf(cell?.qty);
    const size = typeof cell?.size === 'string' ? cell.size.trim() : '';
    if (qty <= 0 || !size) continue;
    const color = (typeof cell?.color === 'string' && cell.color.trim()) || NO_COLOR;
    if (!byColor.has(color)) {
      byColor.set(color, {});
      order.push(color);
    }
    const sizes = byColor.get(color)!;
    sizes[size] = (sizes[size] ?? 0) + qty;
  }
  return order.map((color) => ({ color, sizes: byColor.get(color)! }));
}

/**
 * Сумма двух сеток по ячейкам.
 *
 * Приёмка бывает частичной, и вторая поставка ДОБАВЛЯЕТ к первой: 40 + 60
 * это сто, а не шестьдесят. Тем же сложением собирается «принято всего»
 * из журнала приходов — по одной строке на поставку.
 */
export function mergeGrids(
  a: SizeGridRow[] | null | undefined,
  b: SizeGridRow[] | null | undefined,
): SizeGridRow[] {
  return cellsToGrid([...gridCells(a), ...gridCells(b)]);
}
