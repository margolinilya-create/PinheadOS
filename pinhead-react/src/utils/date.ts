/**
 * Календарные даты производства — один источник на весь проект.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. `d.toISOString().slice(0, 10)` берёт дату из UTC, а не из
 * пояса, в котором живёт человек. В Москве (UTC+3) `new Date('2026-08-10T00:00:00')`
 * — это `2026-08-09T21:00Z`, и «слайс от ISO» отдаёт девятое августа.
 *
 * На доске плана ошибка УДВАИВАЛАСЬ: понедельник недели считался через
 * `toISOString` (сдвиг −1), а потом от него тем же `toISOString` отсчитывались
 * дни (ещё −1). 10 августа 2026, настоящий понедельник, выходил «средой 10.08»,
 * а неделя начиналась с субботы. Подписи дней при этом расставлялись по индексу
 * в списке, поэтому они не спорили с датами — они лгали вместе с ними.
 *
 * ЧЕЙ ДЕНЬ СЧИТАЕТСЯ. Пояс производства — московское время (решение заказчика).
 * Не пояс браузера: «сегодня» на фабрике одно для всех, и менеджер, открывший
 * ERP из другого пояса, обязан видеть день ЦЕХА, а не свой. Тот же пояс назван
 * на сервере — `erp_local_date()` (миграция 20260810360000); две стороны одной
 * системы не могут расходиться в том, какое сегодня число.
 *
 * УСТРОЙСТВО. Ровно две разные операции, и путать их нельзя:
 *   · МОМЕНТ → ДЕНЬ (`factoryDate`, `factoryToday`) — единственное место, где
 *     участвует пояс;
 *   · ДЕНЬ → ДЕНЬ (`addDays`, `weekdayIndex`, `mondayOfWeek`, `diffDays`) —
 *     чистая календарная арифметика над `YYYY-MM-DD`. Пояс здесь не участвует
 *     вовсе: 11 августа идёт после 10-го в любом поясе, и незачем строить
 *     `Date` в местной полуночи, чтобы это выяснить.
 *
 * `toISOString()` годится для МОМЕНТА (`created_at`, `fact_at`, `shipped_at` —
 * там нужен UTC) и не годится для календарного дня. Сторожит `date.test.ts`.
 *
 * Модуль намеренно без зависимостей: им пользуются оба раздела (ERP и Order
 * Studio), и он обязан оставаться листом.
 */

/** Пояс производства. Назван здесь и в `erp_local_date()` на сервере — больше нигде */
export const FACTORY_TIMEZONE = 'Europe/Moscow';

/**
 * Запасной сдвиг на случай, если в среде нет часовых зон ICU (обрезанная сборка
 * Node, экзотический webview). Москва живёт по UTC+3 постоянно — переход на
 * летнее время отменён в 2014-м, — поэтому запасной путь даёт ТОТ ЖЕ ответ,
 * а не «примерно тот же». Сменится пояс производства — сменится и эта константа
 * вместе с `FACTORY_TIMEZONE`; несовпадение поймает `date.test.ts`.
 */
const FACTORY_FALLBACK_OFFSET_MIN = 3 * 60;

/**
 * Форматтер создаётся один раз: `Intl.DateTimeFormat` дорог, а зовут его на
 * каждый расчёт «сегодня». `null` = зон в среде нет, работает запасной путь.
 */
const FACTORY_PARTS = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: FACTORY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return null;
  }
})();

const pad = (n: number) => String(n).padStart(2, '0');

/** Календарный день ПРОИЗВОДСТВА, в который попадает этот момент времени */
export function factoryDate(d: Date): string {
  if (FACTORY_PARTS) {
    // Собираем из частей, а не из строки: порядок полей задаёт локаль, и
    // полагаться на то, что en-CA всегда напечатает ISO, нельзя
    const parts = FACTORY_PARTS.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  const shifted = new Date(d.getTime() + FACTORY_FALLBACK_OFFSET_MIN * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Сегодняшний день производства (YYYY-MM-DD) */
export function factoryToday(): string {
  return factoryDate(new Date());
}

/**
 * `YYYY-MM-DD` → момент для АРИФМЕТИКИ, в UTC-полночь.
 * Внутренний: наружу из модуля уходят только строки дат.
 */
function utcMidnight(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Та же дата со сдвигом на `days` календарных суток */
export function addDays(iso: string, days: number): string {
  return fromUtc(utcMidnight(iso) + days * 86_400_000);
}

/** Сколько календарных суток от `from` до `to` (отрицательное — `to` раньше) */
export function diffDays(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

/**
 * Номер дня недели, где понедельник = 0, воскресенье = 6.
 * `Date.getDay()` считает от воскресенья, и `+6 % 7` стоял уже в четырёх
 * местах — каждое со своим комментарием «вс=0 → 6».
 */
export function weekdayIndex(iso: string): number {
  return (new Date(utcMidnight(iso)).getUTCDay() + 6) % 7;
}

/** Понедельник недели, в которую попадает дата */
export function mondayOfWeek(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** Первое и последнее число месяца, в который попадает дата */
export function monthBounds(iso: string): { from: string; to: string } {
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Все даты месяца списком */
export function monthDates(iso: string): string[] {
  const { from, to } = monthBounds(iso);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * `YYYY-MM-DD` → `Date` ДЛЯ ПОКАЗА (`toLocaleDateString`), в местной полуночи.
 *
 * ТОЛЬКО для форматирования: местная полночь всегда попадает в свой же
 * календарный день, поэтому браузер напечатает «10 августа» в любом поясе.
 * В `factoryDate()` результат подавать НЕЛЬЗЯ — это разные операции, и
 * в поясе восточнее Москвы такой круг вернул бы предыдущий день.
 * Арифметика дат живёт выше и `Date` не строит вовсе.
 */
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00`);
}
