/**
 * Показ бизнес-задач списком: счётчики и фильтр вкладки заказа, порядок строк.
 * Чистые функции — модель задачи (статусы, просрочка) живёт в `utils/bizTasks`,
 * здесь только «что показать на экране».
 */

import { BIZ_TASK_ACTIVE, isOverdue } from '../../utils/bizTasks';
import type { BizTaskRow } from '../../store/types';

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

/** Ближайший срок — сверху: список отвечает на «что горит первым» */
export function byDue<T extends Pick<BizTaskRow, 'due_at' | 'id'>>(a: T, b: T): number {
  // Моменты, а не строки: сервер и форма пишут смещение по-разному («+00:00» и «Z»)
  return (Date.parse(a.due_at) - Date.parse(b.due_at)) || a.id.localeCompare(b.id);
}
