/**
 * Границы производственной даты и проверка выхода за них.
 *
 * H-13 отчёта QA 13.08.2026: нативный `input type="date"` принимает любой год,
 * включая `0002` и `20026`, — обычная опечатка при вводе с клавиатуры. Такая
 * дата уходила в базу молча и ломала все расчёты сроков.
 *
 * Отдельным модулем, а не рядом с компонентом: границы нужны и проверке формы,
 * и самому полю, а смешивать константы с компонентами в одном файле не даёт
 * fast-refresh.
 */

/** Разумные границы: опечатка в годе видна сразу, реальные сроки не задевает */
export const DATE_MIN = '2000-01-01';
export const DATE_MAX = '2100-12-31';

/** Дата за пределами диапазона — почти всегда опечатка в годе */
export function isDateOutOfRange(
  value: string | null | undefined,
  min: string = DATE_MIN,
  max: string = DATE_MAX,
): boolean {
  if (!value) return false;
  return value < min || value > max;
}

/** Начало интервала позже конца — интервал пуст, список всегда будет пустым */
export function isRangeInverted(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return Boolean(from && to && from > to);
}
