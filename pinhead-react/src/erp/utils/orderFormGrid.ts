/**
 * Размерная сетка формы заказа: сумма по активным размерам, итог по цвету,
 * эффективное количество, чипсы размеров и сборка payload со склейкой цветов.
 *
 * Вынесено из `orderForm.ts` 26.09 (ратчет размера файла): типы остаются там,
 * `orderForm` реэкспортирует эти функции, поэтому импорты не меняются.
 */

import type { SizeGridRow } from '../types';
import type { DraftGrid, DraftItem } from './orderForm';

/** Сумма количеств по АКТИВНЫМ размерам сетки (убранные чипсы не считаются) */
export function gridTotal(grid: DraftGrid | null | undefined): number {
  const rows = grid?.rows ?? [];
  const active = grid?.sizes ?? [];
  if (rows.length === 0 || active.length === 0) return 0;
  return rows.reduce(
    (sum, row) => sum + active.reduce((s, sz) => s + (Number(row.sizes?.[sz]) || 0), 0),
    0,
  );
}

/**
 * Итог по ОДНОМУ цвету (правки 07.09, п. 6: «Справа показывать итог по цвету,
 * отдельно общий итог по позиции»).
 *
 * Считается по тем же АКТИВНЫМ размерам, что и `gridTotal`: иначе сумма строк
 * не сошлась бы с общим итогом ровно тогда, когда человек снял чипс размера,
 * не обнулив количества.
 */
export function rowTotal(
  row: SizeGridRow | null | undefined,
  sizes: readonly string[] = [],
): number {
  if (!row) return 0;
  return sizes.reduce((s, sz) => s + (Number(row.sizes?.[sz]) || 0), 0);
}

/** Эффективное количество позиции: сетка заполнена → сумма сетки, иначе ручной ввод */
export function effectiveQty(item: Pick<DraftItem, 'qty' | 'size_grid'>): number {
  const total = gridTotal(item.size_grid);
  return total > 0 ? total : Number(item.qty) || 0;
}

/**
 * Добавить/убрать размер-чипс. Количества в rows НЕ теряются:
 * ключ остаётся в row.sizes и вернётся при повторном добавлении размера.
 */
export function toggleSize(grid: DraftGrid | null | undefined, size: string): DraftGrid {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const next = sizes.includes(size) ? sizes.filter((s) => s !== size) : [...sizes, size];
  return { sizes: next, rows };
}

/**
 * size_grid формы → payload: только активные размеры, пустые строки отброшены.
 *
 * ДВЕ СТРОКИ ОДНОГО ЦВЕТА СКЛЕИВАЮТСЯ (правка 21.09, п. 8). Форма их допускает
 * (цвет по умолчанию пуст, то есть «—» у всех новых строк), а вся система
 * адресует ячейку сеткой «цвет × размер»: две строки с одним ключом дают
 * таблицу, где оба поля читают одно значение, а обратная сборка их складывает.
 * Склейка стоит ЗДЕСЬ, на выходе формы, чтобы дубль не попадал в базу вовсе;
 * уже записанные лечит `gridCells` при чтении и разовая миграция. Собирается
 * сразу по цветам, а не «список строк, потом дедупликация»: второй проход
 * по тем же данным — это второе место, где живёт правило склейки.
 *
 * Позвать готовую склейку из `utils/sizeGrid` нельзя: тот модуль импортирует
 * `SIZE_PRESETS` отсюда, и обратный импорт замкнул бы модули кольцом —
 * со шкалой, которая читается на уровне модуля, это не «предупреждение
 * линтера», а падение при инициализации.
 */
export function gridToPayload(grid: DraftGrid | null | undefined): SizeGridRow[] | null {
  const rows = grid?.rows ?? [];
  const active = grid?.sizes ?? [];
  if (rows.length === 0) return null;

  const byColor = new Map<string, Record<string, number>>();
  const order: string[] = [];
  for (const row of rows) {
    if (!row.color.trim() && !active.some((sz) => Number(row.sizes?.[sz]) > 0)) continue;
    const color = row.color.trim() || '—';
    if (!byColor.has(color)) {
      byColor.set(color, {});
      order.push(color);
    }
    const sizes = byColor.get(color)!;
    for (const sz of active) {
      if (row.sizes?.[sz] === undefined) continue;
      // Ноль сохраняется: «размер заведён, количество ещё не проставили»
      sizes[sz] = (sizes[sz] ?? 0) + (Number(row.sizes[sz]) || 0);
    }
  }
  return order.length > 0 ? order.map((color) => ({ color, sizes: byColor.get(color)! })) : null;
}
