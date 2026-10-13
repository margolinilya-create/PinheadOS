/**
 * Сортировка таблиц ERP — чистая логика.
 *
 * Правила, из-за которых это не одна строка `rows.sort()`:
 * - **Пустые ячейки всегда внизу**, при любом направлении. Иначе «по убыванию»
 *   поднимает наверх строки без значения, и таблица выглядит сломанной именно там,
 *   где данных нет: в закупке половина артикулов и планов не заполнена.
 * - **Стабильность**: равные значения держат исходный порядок. Массив уже отсортирован
 *   осмысленно (заказы по сроку, материалы по позиции), и терять это при сортировке
 *   по статусу нельзя.
 * - **Числа сравниваются числами**, строки — русским коллатором с `numeric`, чтобы
 *   «№9» шёл перед «№10», а не после.
 */

import { useCallback, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  /** Ключ колонки; null — сортировка снята, порядок исходный */
  key: string | null;
  dir: SortDir;
}

export const NO_SORT: SortState = { key: null, dir: 'asc' };

/**
 * Клик по заголовку: по возрастанию → по убыванию → без сортировки.
 * Третий шаг возвращает исходный порядок — он бывает осмысленным
 * (очередь по приоритету, материалы по позиции), и отменить сортировку нужно.
 */
export function nextSortState(state: SortState, key: string): SortState {
  if (state.key !== key) return { key, dir: 'asc' };
  if (state.dir === 'asc') return { key, dir: 'desc' };
  return NO_SORT;
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/** Пустое ли значение — такие строки уходят в конец независимо от направления */
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

/** Сравнение двух значений одной колонки (без учёта направления и пустот) */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Отсортированная копия. `valueOf` отдаёт значение колонки по её ключу —
 * сортируем по тому же, что показано в ячейке, иначе порядок не объяснить глазами.
 */
export function sortRows<T>(
  rows: T[],
  state: SortState,
  valueOf: (row: T, key: string) => unknown,
): T[] {
  const { key } = state;
  if (!key) return rows;
  const sign = state.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const a = valueOf(x.row, key);
      const b = valueOf(y.row, key);
      const emptyDiff = Number(isEmpty(a)) - Number(isEmpty(b));
      if (emptyDiff !== 0) return emptyDiff;
      if (isEmpty(a)) return x.index - y.index;
      const cmp = compareValues(a, b) * sign;
      return cmp !== 0 ? cmp : x.index - y.index;
    })
    .map((wrapped) => wrapped.row);
}

/** Значение `aria-sort` для `<th>` */
export function ariaSortFor(state: SortState, key: string): 'ascending' | 'descending' | 'none' {
  if (state.key !== key) return 'none';
  return state.dir === 'asc' ? 'ascending' : 'descending';
}

/**
 * Состояние сортировки таблицы. Живёт рядом с логикой, а не в файле `SortableTh.jsx`:
 * файл с компонентом не должен экспортировать ничего кроме компонентов, иначе
 * ломается fast refresh.
 */
export function useTableSort(initial: SortState = NO_SORT) {
  const [sort, setSort] = useState<SortState>(initial);
  const toggle = useCallback((key: string) => setSort((s) => nextSortState(s, key)), []);
  const reset = useCallback(() => setSort(NO_SORT), []);
  return { sort, toggle, reset };
}
