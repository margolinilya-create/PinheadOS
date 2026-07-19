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

/**
 * Короткая дата ru-RU (dd.MM.yyyy). Безопасно для null и для дат без времени
 * ('YYYY-MM-DD' парсим как локальную полночь, чтобы не сдвинуть на день).
 */
export function formatDateShort(d: string | null | undefined): string {
  if (!d) return '';
  const iso = d.length === 10 ? `${d}T00:00:00` : d;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * SLA первичной обработки закупки (правка 6): нормативный срок 3 дня.
 * Незаказанный материал (pending) старше 3 дней → 'overdue' («Просрочено»),
 * иначе 'processing' («На обработке»). Уже обработанные статусы → null.
 */
export function procurementSla(
  createdAt: string | null | undefined,
  status: string,
  now: Date = new Date(),
): 'processing' | 'overdue' | null {
  if (status !== 'pending') return null;
  if (!createdAt) return 'processing';
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 'processing';
  const days = Math.floor((now.getTime() - created.getTime()) / 86400000);
  return days > 3 ? 'overdue' : 'processing';
}

/**
 * Операция подряда просрочена (правка 5): план готовности в прошлом, при этом
 * ещё не возвращено и не отменено.
 */
export function subcontractOverdue(
  plannedDate: string | null | undefined,
  returnedDate: string | null | undefined,
  status: string,
  today: string,
): boolean {
  if (!plannedDate || returnedDate) return false;
  if (status === 'returned' || status === 'cancelled') return false;
  return plannedDate < today;
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
