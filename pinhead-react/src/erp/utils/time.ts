import { addDays, diffDays, factoryDate, factoryToday } from '../../utils/date';

/**
 * Дней до срока клиента: 0 = сегодня, отрицательное = просрочен, null = срока нет.
 *
 * Считается от дня ПРОИЗВОДСТВА, а не от дня браузера. Здесь стояла разность
 * местных полуночей: у менеджера, открывшего ERP из другого пояса, «сегодня»
 * было своим, и один и тот же заказ показывался ему «завтра», а цеху —
 * «сегодня». Срок заказа — обязательство фабрики, и меряется он её днями.
 */
export function daysLeft(dueDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  return diffDays(factoryDate(now), dueDate.slice(0, 10));
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
 * Просрочен ли этап по своей плановой дате завершения (правка 8):
 * planned_end раньше сегодня и этап ещё не завершён/не пропущен.
 */
export function stageOverdue(
  plannedEnd: string | null | undefined,
  status: string,
  now: Date = new Date(),
): boolean {
  if (!plannedEnd) return false;
  if (status === 'done' || status === 'skipped') return false;
  const d = daysLeft(plannedEnd, now);
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
 * Дата с месяцем словом: «14 авг. 2026».
 *
 * Нужна как эхо рядом с нативным `<input type="date">`: формат самого поля задаёт
 * локаль браузера, и на машине с en-US оно показывает `mm/dd/yyyy`. Страницей это
 * не переопределяется (ни `lang`, ни атрибутом), поэтому «08/14» читается двояко —
 * а «14 авг.» нельзя понять неправильно.
 */
export function formatDateHuman(d: string | null | undefined): string {
  if (!d) return '';
  const iso = d.length === 10 ? `${d}T00:00:00` : d;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * ISO-дата (YYYY-MM-DD) со сдвигом на `days` от базы; база по умолчанию — сегодня.
 *
 * Раньше здесь считали в UTC-полдне, чтобы переход на летнее время не унёс
 * результат на сутки. Приём был верный, но давал в проекте вторую арифметику
 * дат и последний повод писать `toISOString().slice(0, 10)` — тот самый оборот,
 * который сдвинул доску плана. `addDays` двигает КАЛЕНДАРНЫЕ поля, поэтому
 * перевод часов ему безразличен: сверка по 10 800 парам «дата × сдвиг» в восьми
 * поясах (включая переход в полночь — Сантьяго, Гавана, Чатем) даёт ноль
 * расхождений со старой реализацией.
 */
export function shiftIsoDate(base: string | null | undefined, days: number): string {
  const from = base && base.length >= 10 ? base.slice(0, 10) : factoryToday();
  return addDays(from, days);
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
  phase: string,
  today: string,
): boolean {
  if (!plannedDate || returnedDate) return false;
  /**
   * Терминальные фазы — не просрочка: вернувшаяся вещь подрядчика уже не
   * задерживает, дальше вопрос к складу. Раньше здесь перечислялись значения
   * устаревшего `status`; после волны 3.5 операцию двигает `phase`, и старый
   * список молча перестал бы совпадать хоть с чем-нибудь — просрочка загорелась
   * бы у всего принятого.
   */
  if (phase === 'returned' || phase === 'accepted' || phase === 'closed') return false;
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
