/**
 * Мощность производства и загрузка против неё (правки заказчика 10.08, волна 2).
 *
 * Документ: «Добавить настройку общей мощности производства — 10 000 единиц
 * в месяц. Дневная и недельная доступная мощность должны считаться из числа
 * рабочих дней, а не задаваться фиксированным числом на день».
 *
 * ЕДИНИЦА СЧЁТА — ИЗДЕЛИЯ. Одна футболка проходит закрой → нанесение → швейку →
 * ВТО, поэтому сумма «штук по этапам» даёт вчетверо больше единиц, чем реально
 * произведено. 10 000 сравниваются с объёмом ЗАКАЗОВ месяца; поцеховая сетка
 * `/load` считает другое (обязательства цехов по дням) и с мощностью
 * не складывается. Нормы отдельных цехов — следующая задача.
 *
 * ЧТО ВХОДИТ В ОБЪЁМ. Активные заказы со сроком сдачи внутри месяца. Отгруженные
 * из объёма выпадают намеренно: они больше не занимают производство, а их полный
 * список и не загружен (архив идёт постранично). Показатель отвечает на вопрос
 * «сколько работы мы набрали на этот месяц», а не «сколько выпустили».
 */

import { isoDate, parseIsoDate, weekdayIndex } from '../../utils/date';
import { percentUncapped } from './format';
import type { ErpOrderFull } from '../store/types';

/** Настройка мощности; `monthly_units = null` — «не задана» */
export interface CapacitySettings {
  monthly_units: number | null;
  /**
   * Сколько дней в неделе считаются рабочими, начиная с понедельника:
   * 5 — пн–пт, 6 — пн–сб, 7 — без выходных. Праздничного календаря в системе
   * нет, и выдумывать его ради оценки не стоит: погрешность в один-два дня
   * меньше, чем погрешность самого плана.
   */
  work_days_per_week: number;
}

export const CAPACITY_SETTINGS_KEY = 'production_capacity';

export const DEFAULT_CAPACITY: CapacitySettings = {
  monthly_units: null,
  work_days_per_week: 5,
};

/**
 * Разбор значения из `erp_settings.value`. Fail-open: чего не поняли — то
 * «не задано», и интерфейс покажет «—» вместо выдуманного процента.
 */
export function parseCapacitySettings(value: unknown): CapacitySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CAPACITY };
  const raw = value as Record<string, unknown>;
  const units = Number(raw.monthly_units);
  const perWeek = Number(raw.work_days_per_week);
  return {
    monthly_units: Number.isFinite(units) && units > 0 ? Math.round(units) : null,
    work_days_per_week: Number.isFinite(perWeek) && perWeek >= 1 && perWeek <= 7
      ? Math.round(perWeek)
      : DEFAULT_CAPACITY.work_days_per_week,
  };
}

/** Рабочий ли день: понедельник = 1-й, воскресенье = 7-й */
export function isWorkingDay(iso: string, perWeek: number): boolean {
  return weekdayIndex(iso) < perWeek;
}

/** Границы месяца, в который попадает дата: [первое, последнее] */
export function monthRange(iso: string): { from: string; to: string } {
  const d = parseIsoDate(iso);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

/** Даты месяца списком (локально, без UTC-сдвига) */
export function monthDates(iso: string): string[] {
  const { from, to } = monthRange(iso);
  const out: string[] = [];
  const end = parseIsoDate(to);
  for (const cur = parseIsoDate(from); cur <= end; cur.setDate(cur.getDate() + 1)) {
    out.push(isoDate(cur));
  }
  return out;
}

/** Сколько рабочих дней в этих датах */
export function workingDays(dates: string[], perWeek: number): number {
  return dates.filter((d) => isWorkingDay(d, perWeek)).length;
}

/**
 * Дневная мощность: месячная, делённая на рабочие дни ЭТОГО месяца.
 * Число дневное и плавающее — в феврале рабочих дней меньше, чем в марте,
 * и фиксированное значение на день документ запрещает прямо.
 */
export function dailyCapacity(s: CapacitySettings, monthIso: string): number | null {
  if (s.monthly_units === null) return null;
  const days = workingDays(monthDates(monthIso), s.work_days_per_week);
  if (days <= 0) return null;
  return s.monthly_units / days;
}

/**
 * Мощность на произвольный период: сумма дневных по КАЖДОМУ дню.
 *
 * Дневная мощность зависит от месяца (рабочих дней в феврале и марте разное
 * число при одной месячной норме), а неделя может лежать в двух месяцах.
 * Здесь стояло `dailyCapacity(s, dates[0])` — весь период мерился месяцем
 * ПЕРВОГО дня: неделя 31 августа — 6 сентября считалась по августу целиком,
 * и «Загрузка производства» врала каждую неделю на стыке месяцев.
 */
export function capacityForDates(
  s: CapacitySettings,
  dates: string[],
): number | null {
  if (dates.length === 0) return null;
  if (s.monthly_units === null) return null;
  let total = 0;
  for (const day of dates) {
    // Нерабочий день мощности не даёт — считаем по одному дню за раз
    if (workingDays([day], s.work_days_per_week) === 0) continue;
    const perDay = dailyCapacity(s, day);
    if (perDay === null) return null;
    total += perDay;
  }
  return Math.round(total);
}

export interface CapacityReport {
  /** Доступная мощность периода в штуках; `null` — не задана */
  capacity: number | null;
  /** Занято: объём заказов, попавших в период */
  used: number;
  /** Сколько заказов дают этот объём */
  orders: number;
  /** Свободный остаток; 0, когда мощность выбрана целиком */
  left: number;
  /** Превышение сверх мощности; 0, когда влезаем */
  over: number;
  /** Процент загрузки БЕЗ потолка: 130 % — это ответ, а не ошибка */
  percent: number | null;
}

const EMPTY_REPORT: CapacityReport = {
  capacity: null, used: 0, orders: 0, left: 0, over: 0, percent: null,
};

/**
 * Объём активных заказов, попадающих сроком сдачи в период, против мощности.
 *
 * `isDemo` заказы сюда не приходят: они отфильтрованы ещё в запросе (правило
 * проекта), поэтому отдельной проверки здесь нет.
 */
export function capacityReport(
  orders: ErpOrderFull[],
  dates: string[],
  settings: CapacitySettings,
): CapacityReport {
  if (dates.length === 0) return { ...EMPTY_REPORT };
  const from = dates[0];
  const to = dates[dates.length - 1];

  let used = 0;
  let count = 0;
  for (const order of orders) {
    if (order.status !== 'active') continue;
    const due = order.due_date;
    if (!due || due < from || due > to) continue;
    count += 1;
    for (const item of order.items) used += item.qty ?? 0;
  }

  const capacity = capacityForDates(settings, dates);
  return {
    capacity,
    used,
    orders: count,
    left: capacity === null ? 0 : Math.max(0, capacity - used),
    over: capacity === null ? 0 : Math.max(0, used - capacity),
    percent: capacity === null ? null : percentUncapped(used, capacity),
  };
}

/** Отчёт по месяцу, в который попадает дата */
export function monthCapacityReport(
  orders: ErpOrderFull[],
  monthIso: string,
  settings: CapacitySettings,
): CapacityReport {
  return capacityReport(orders, monthDates(monthIso), settings);
}

/** Название месяца в родительном падеже для подписи: «август 2026» */
export function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

