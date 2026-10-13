/**
 * Карты участков по id — ОДНА на массив (обзор 26.09, п. 10).
 *
 * `new Map(departments.map((d) => [d.id, d]))` стояла в шестнадцати местах,
 * в том числе в `OrderRow` и `OrderCardMobile` — то есть по карте НА СТРОКУ
 * списка заказов, и каждая перестраивалась на любом рендере строки.
 * Массив участков приезжает из стора и меняется редко; `WeakMap` по самому
 * массиву отдаёт ту же карту, пока ссылка на массив та же, — без `useMemo`
 * в каждом компоненте и без утечки, когда массив заменён.
 *
 * Чистые функции, без React: годятся и в утилитах (`queueEntries`, `gantt`).
 */

import type { ErpDepartment } from '../types';

type DeptLike = Pick<ErpDepartment, 'id' | 'name'>;

const byIdCache = new WeakMap<readonly DeptLike[], Map<string, DeptLike>>();
const nameCache = new WeakMap<readonly DeptLike[], Map<string, string>>();

/** `id → участок`; для одного массива всегда одна и та же `Map` */
export function deptById<T extends DeptLike>(departments: readonly T[]): Map<string, T> {
  let map = byIdCache.get(departments) as Map<string, T> | undefined;
  if (!map) {
    map = new Map(departments.map((d) => [d.id, d]));
    byIdCache.set(departments, map);
  }
  return map;
}

/** `id → имя участка`; та же карта на тот же массив */
export function deptNameById(departments: readonly DeptLike[]): Map<string, string> {
  let map = nameCache.get(departments);
  if (!map) {
    map = new Map(departments.map((d) => [d.id, d.name]));
    nameCache.set(departments, map);
  }
  return map;
}
