/**
 * Показ бизнес-задач списком: счётчики и фильтр вкладки заказа, порядок строк.
 * Чистые функции — модель задачи (статусы, просрочка) живёт в `utils/bizTasks`,
 * здесь только «что показать на экране».
 */

import { BIZ_TASK_ACTIVE, BIZ_TASK_STATUSES, isOverdue } from '../../utils/bizTasks';
import type { BizTaskStatus } from '../../utils/bizTasks';
import type { BizTaskRow } from '../../store/types';

/** Цвет статуса — тот же язык чипов, что у этапов и заказов */
export const STATUS_VARIANT: Record<BizTaskStatus, string> = {
  new: 'info',
  in_progress: 'progress',
  paused: 'waiting',
  review: 'violet',
  done: 'done',
  cancelled: 'skipped',
};

/** Фильтр вкладки заказа: по умолчанию — открытые; закрытые — по запросу */
export type OrderTaskFilter = 'open' | 'overdue' | 'done' | 'cancelled' | 'all';

export interface OrderTaskCounts {
  open: number;
  /** Просроченные среди ОТКРЫТЫХ: сданная поздно и закрытая задача уже не «горит» */
  overdue: number;
  done: number;
  cancelled: number;
}

type Row = Pick<BizTaskRow, 'status' | 'due_at' | 'submitted_at' | 'completed_at'>;

const isOpen = (t: Row) => BIZ_TASK_ACTIVE.includes(t.status);

export function orderTaskCounts(tasks: readonly Row[], now: Date): OrderTaskCounts {
  const out: OrderTaskCounts = { open: 0, overdue: 0, done: 0, cancelled: 0 };
  for (const t of tasks) {
    if (isOpen(t)) {
      out.open += 1;
      if (isOverdue(t, now)) out.overdue += 1;
    } else if (t.status === 'done') {
      out.done += 1;
    } else if (t.status === 'cancelled') {
      out.cancelled += 1;
    }
  }
  return out;
}

export function matchesOrderFilter(t: Row, filter: OrderTaskFilter, now: Date): boolean {
  switch (filter) {
    case 'open': return isOpen(t);
    case 'overdue': return isOpen(t) && isOverdue(t, now);
    case 'done': return t.status === 'done';
    case 'cancelled': return t.status === 'cancelled';
    default: return true;
  }
}

/**
 * Заказ в строке общего раздела: номер ТЗ («PH-1234» — его ищут поиском),
 * иначе № сделки, и название. Тот же текст — у выбора заказа в форме создания.
 */
export function orderLabel(
  order: { bitrix_id?: string | null; title: string; tz_number?: string | null },
): string {
  const num = order.tz_number || (order.bitrix_id ? `№${order.bitrix_id}` : '');
  return `${num ? `${num} · ` : ''}${order.title}`;
}

/** Ближайший срок — сверху: список отвечает на «что горит первым» */
export function byDue<T extends Pick<BizTaskRow, 'due_at' | 'id'>>(a: T, b: T): number {
  // Моменты, а не строки: сервер и форма пишут смещение по-разному («+00:00» и «Z»)
  return (Date.parse(a.due_at) - Date.parse(b.due_at)) || a.id.localeCompare(b.id);
}

/* ─── Общий раздел «Бизнес-задачи»: роль, поиск, фильтры адреса ─── */

/** Вкладки общего раздела — роль текущего пользователя в задаче */
export type ListRole = 'assignee' | 'creator' | 'watcher';

export interface ListFilters {
  q: string;
  kind: string;
  /** Ответственный — user_id; пусто — любой */
  who: string;
  /** `active` (по умолчанию), `all` или код статуса */
  status: string;
  /** '' | 'overdue' (среди открытых) | 'day' | 'week' — ближайшие сутки / неделя */
  due: string;
  /** «Есть непрочитанные» */
  unread: boolean;
}

type ListRow = Row & Pick<BizTaskRow, 'id' | 'title' | 'kind' | 'assignee_id' | 'creator_id'
  | 'watchers' | 'order'>;

export function hasRole(
  t: Pick<BizTaskRow, 'assignee_id' | 'creator_id' | 'watchers'>,
  role: ListRole,
  me: string,
): boolean {
  if (role === 'assignee') return t.assignee_id === me;
  if (role === 'creator') return t.creator_id === me;
  return t.watchers.includes(me);
}

/** Поиск — по названию задачи и номеру заказа (PH-…, № сделки), заодно по названию заказа */
export function matchesTaskQuery(t: Pick<BizTaskRow, 'title' | 'order'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [t.title, t.order?.tz_number, t.order?.bitrix_id, t.order?.title];
  return hay.some((s) => (s ?? '').toLowerCase().includes(q));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function matchesDue(t: Row, due: string, now: Date): boolean {
  if (!due) return true;
  if (due === 'overdue') return isOpen(t) && isOverdue(t, now);
  const left = Date.parse(t.due_at) - now.getTime();
  const span = due === 'day' ? DAY_MS : 7 * DAY_MS;
  // «Ближайшие» — ещё не истёкшие сроки открытых задач
  return isOpen(t) && left >= 0 && left <= span;
}

/**
 * Статусы для запроса списка по фильтру «Статус» из адреса. Фильтр уходит
 * на сервер, а не только на клиент: у списка потолок строк, и без фильтра
 * старые закрытые задачи вытеснили бы из него новые активные.
 * «Все» и неизвестное значение — без фильтра.
 */
export function statusesForQuery(status: string): readonly BizTaskStatus[] | undefined {
  if (status === 'active') return BIZ_TASK_ACTIVE;
  const one = BIZ_TASK_STATUSES.find((s) => s === status);
  return one ? [one] : undefined;
}

function matchesStatus(t: Row, status: string): boolean {
  if (status === 'active') return isOpen(t);
  return status === 'all' || t.status === status;
}

export function matchesListFilters(
  t: ListRow,
  f: ListFilters,
  now: Date,
  unread: Readonly<Record<string, number>>,
): boolean {
  if (!matchesStatus(t, f.status)) return false;
  if (f.kind && t.kind !== f.kind) return false;
  if (f.who && t.assignee_id !== f.who) return false;
  if (f.unread && !((unread[t.id] ?? 0) > 0)) return false;
  return matchesDue(t, f.due, now) && matchesTaskQuery(t, f.q);
}
