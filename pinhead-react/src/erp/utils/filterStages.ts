/**
 * Фильтры и сортировка производственных заданий (правка 9).
 *
 * Одна чистая реализация на все экраны, где показываются задания: очередь цеха,
 * производственный канбан, производственный план. Состояние фильтров кладётся в URL
 * (see filtersFromParams/filtersToParams) — так возврат из карточки заказа
 * восстанавливает подбор, а ссылкой на отфильтрованную очередь можно поделиться.
 */

import type { ErpItemStage, ErpOrderItem, StageStatus } from '../types';
import { matchesOrderQuery } from './orderSearch';
import { daysLeft, stageOverdue } from './time';

/** Группа задания в очереди — вычисляется экраном (routes.isStageReady и статус этапа) */
export type QueueGroup =
  | 'awaiting_materials' | 'ready' | 'in_progress' | 'waiting' | 'blocked' | 'done';

export interface QueueEntry {
  order: {
    id: string;
    title?: string | null;
    customer?: string | null;
    manager?: string | null;
    bitrix_id?: string | null;
    due_date?: string | null;
    items?: unknown[];
    materials?: unknown[];
  };
  item: Pick<ErpOrderItem, 'id' | 'product_type' | 'variant' | 'qty'>;
  stage: Pick<ErpItemStage, 'id' | 'department_id' | 'status'> & {
    assignee?: string | null;
    planned_end?: string | null;
    qty_rework?: number | null;
    queue_position?: number | null;
  };
  group: QueueGroup;
  reason?: string | null;
  /** Чего именно ждёт группа «Ожидают материалы» — для карточки задания */
  missingMaterials?: unknown[];
}

export type StageSort = 'priority' | 'due' | 'overdue';

export interface StageFilters {
  /** Поиск: номер/название заказа, клиент, менеджер, изделие, материал */
  q: string;
  /** id цеха; '' — все цеха */
  dept: string;
  /** группа задания; '' — любая */
  status: QueueGroup | '';
  /** имя исполнителя; NO_ASSIGNEE — только незакреплённые; '' — любой */
  assignee: string;
  /** срок клиента от / до (YYYY-MM-DD) */
  dueFrom: string;
  dueTo: string;
  /** только просроченные (по сроку клиента или плану этапа) */
  overdue: boolean;
  /** только готовые к запуску */
  readyOnly: boolean;
  /** только с проблемой: блокировка или возвращённый брак */
  problem: boolean;
  sort: StageSort;
}

/** Значение фильтра «исполнитель» для незакреплённых заданий */
export const NO_ASSIGNEE = '__none__';

export const EMPTY_FILTERS: StageFilters = {
  q: '', dept: '', status: '', assignee: '',
  dueFrom: '', dueTo: '',
  overdue: false, readyOnly: false, problem: false,
  sort: 'priority',
};

export const SORT_LABELS: Record<StageSort, string> = {
  priority: 'По приоритету',
  due: 'По ближайшему сроку',
  overdue: 'По величине просрочки',
};

export const GROUP_FILTER_LABELS: Record<QueueGroup, string> = {
  awaiting_materials: 'Ожидают материалы',
  ready: 'Готово к запуску',
  in_progress: 'В работе',
  waiting: 'Ожидает',
  blocked: 'Заблокировано',
  done: 'Завершено',
};

/** Есть ли у задания проблема: ручная блокировка цехом или возвращённый брак */
export function hasProblem(entry: QueueEntry): boolean {
  return entry.group === 'blocked' || (entry.stage.qty_rework ?? 0) > 0;
}

/** Просрочено ли задание: срок клиента в прошлом или план этапа сорван */
export function isEntryOverdue(entry: QueueEntry, now: Date = new Date()): boolean {
  if (entry.group === 'done') return false;
  const d = daysLeft(entry.order.due_date, now);
  if (d !== null && d < 0) return true;
  return stageOverdue(entry.stage.planned_end, entry.stage.status as StageStatus, now);
}

/** Насколько просрочено (дней); 0 — не просрочено. Для сортировки «по величине просрочки» */
export function overdueDays(entry: QueueEntry, now: Date = new Date()): number {
  if (entry.group === 'done') return 0;
  const byDue = daysLeft(entry.order.due_date, now);
  const byPlan = daysLeft(entry.stage.planned_end, now);
  const worst = Math.min(byDue ?? 0, byPlan ?? 0);
  return worst < 0 ? -worst : 0;
}

export function filterEntries(
  entries: QueueEntry[],
  filters: StageFilters,
  now: Date = new Date(),
): QueueEntry[] {
  const f = { ...EMPTY_FILTERS, ...filters };
  return entries.filter((e) => {
    if (f.q && !matchesOrderQuery(e.order, f.q)) return false;
    if (f.dept && e.stage.department_id !== f.dept) return false;
    if (f.status && e.group !== f.status) return false;
    if (f.assignee) {
      if (f.assignee === NO_ASSIGNEE) {
        if (e.stage.assignee) return false;
      } else if (e.stage.assignee !== f.assignee) return false;
    }
    const due = e.order.due_date || '';
    if (f.dueFrom && (!due || due < f.dueFrom)) return false;
    if (f.dueTo && (!due || due > f.dueTo)) return false;
    if (f.overdue && !isEntryOverdue(e, now)) return false;
    if (f.readyOnly && e.group !== 'ready') return false;
    if (f.problem && !hasProblem(e)) return false;
    return true;
  });
}

/** Сортировка заданий; исходный массив не мутируется */
export function sortEntries(
  entries: QueueEntry[],
  sort: StageSort = 'priority',
  now: Date = new Date(),
): QueueEntry[] {
  const byDue = (a: QueueEntry, b: QueueEntry) =>
    (a.order.due_date || '9999-12-31').localeCompare(b.order.due_date || '9999-12-31');
  const list = [...entries];
  if (sort === 'due') return list.sort(byDue);
  if (sort === 'overdue') {
    return list.sort((a, b) => overdueDays(b, now) - overdueDays(a, now) || byDue(a, b));
  }
  // Приоритет: ручной порядок очереди, затем срок (у этапов без позиции — только срок)
  return list.sort((a, b) => {
    const pa = a.stage.queue_position;
    const pb = b.stage.queue_position;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return byDue(a, b);
  });
}

/** Применить фильтры и сортировку разом */
export function applyStageFilters(
  entries: QueueEntry[],
  filters: StageFilters,
  now: Date = new Date(),
): QueueEntry[] {
  return sortEntries(filterEntries(entries, filters, now), filters.sort, now);
}

/** Активен ли хоть один фильтр (для кнопки «Сбросить») */
export function hasActiveFilters(filters: StageFilters): boolean {
  return (
    Boolean(filters.q || filters.dept || filters.status || filters.assignee
      || filters.dueFrom || filters.dueTo)
    || filters.overdue || filters.readyOnly || filters.problem
    || filters.sort !== EMPTY_FILTERS.sort
  );
}

// --- Синхронизация с URL (правка 6: возврат из заказа сохраняет подбор) ---------

const FLAGS = ['overdue', 'readyOnly', 'problem'] as const;
const TEXTS = ['q', 'dept', 'status', 'assignee', 'dueFrom', 'dueTo'] as const;

export function filtersFromParams(params: URLSearchParams): StageFilters {
  const out = { ...EMPTY_FILTERS };
  for (const key of TEXTS) {
    const v = params.get(key);
    if (v) (out as Record<string, unknown>)[key] = v;
  }
  for (const key of FLAGS) out[key] = params.get(key) === '1';
  const sort = params.get('sort');
  if (sort === 'due' || sort === 'overdue' || sort === 'priority') out.sort = sort;
  return out;
}

/**
 * Фильтры → плоский объект для setSearchParams. Значения по умолчанию не пишутся,
 * чтобы адрес не зарастал (`?sort=priority&overdue=0&...`).
 */
export function filtersToParams(filters: StageFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TEXTS) {
    const v = filters[key];
    if (v) out[key] = v;
  }
  for (const key of FLAGS) if (filters[key]) out[key] = '1';
  if (filters.sort !== EMPTY_FILTERS.sort) out.sort = filters.sort;
  return out;
}
