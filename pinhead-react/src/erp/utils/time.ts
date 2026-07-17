/** Дней до срока клиента: 0 = сегодня, отрицательное = просрочен, null = срока нет */
export function daysLeft(dueDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/**
 * «Горящий» срок: осталось 0–3 дня включительно.
 * Единая логика для KPI-плитки дашборда и фильтр-чипа «Срок ≤ 3 дней».
 */
export function isUrgent(dueDate: string | null | undefined, now: Date = new Date()): boolean {
  const d = daysLeft(dueDate, now);
  return d !== null && d >= 0 && d <= 3;
}

/**
 * Срок просрочен (daysLeft < 0).
 * Единая логика для KPI-плитки дашборда и фильтр-чипа «Просрочено».
 */
export function isOverdue(dueDate: string | null | undefined, now: Date = new Date()): boolean {
  const d = daysLeft(dueDate, now);
  return d !== null && d < 0;
}

/** «Время в этапе» — компактный формат как в kontora24 (мин/ч/дн). */
export function formatTimeIn(since: string | null, nowMs: number = Date.now()): string {
  if (!since) return '';
  const ms = nowMs - new Date(since).getTime();
  if (ms < 60_000) return 'только что';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}
