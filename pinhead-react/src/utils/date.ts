/**
 * Календарная дата в ЛОКАЛЬНОМ поясе (YYYY-MM-DD) — один источник на весь проект.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. `d.toISOString().slice(0, 10)` берёт дату из UTC, а не из
 * пояса, в котором живёт человек. В Москве (UTC+3) `new Date('2026-08-10T00:00:00')`
 * — это `2026-08-09T21:00Z`, и «слайс от ISO» отдаёт девятое августа.
 *
 * На доске плана ошибка УДВАИВАЛАСЬ: понедельник недели считался через
 * `toISOString` (сдвиг −1), а потом от него тем же `toISOString` отсчитывались
 * дни (ещё −1). 10 августа 2026, настоящий понедельник, выходил «средой 10.08»,
 * а неделя начиналась с субботы 08.08. Подписи дней при этом расставлялись
 * по индексу в списке, поэтому они не спорили с датами — они лгали вместе с ними.
 *
 * Правило простое: `toISOString()` годится для МОМЕНТА времени (`created_at`,
 * `fact_at`, `shipped_at` — там нужен UTC) и не годится для КАЛЕНДАРНОЙ ДАТЫ.
 * Календарная дата — это «какое сегодня число у человека», и считается она
 * только отсюда. Сторожит `date.test.ts`.
 *
 * Модуль намеренно без зависимостей: им пользуются оба раздела (ERP и Order
 * Studio), и он обязан оставаться листом.
 */

/** Дата как календарный день в поясе браузера: YYYY-MM-DD */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Сегодня в поясе браузера (YYYY-MM-DD) */
export function localToday(): string {
  return isoDate(new Date());
}

/** `YYYY-MM-DD` → локальная полночь того же дня (без UTC-сдвига) */
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Та же дата со сдвигом на `days` суток, локально */
export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * Номер дня недели, где понедельник = 0, воскресенье = 6.
 * `Date.getDay()` считает от воскресенья, и `+6 % 7` тут стоял уже в четырёх
 * местах — каждое со своим комментарием «вс=0 → 6».
 */
export function weekdayIndex(iso: string): number {
  return (parseIsoDate(iso).getDay() + 6) % 7;
}

/** Понедельник недели, в которую попадает дата */
export function mondayOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}
