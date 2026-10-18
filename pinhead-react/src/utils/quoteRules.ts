/**
 * Общие правила расчёта рабочего места (`priceOrder`) и экспресса (обход вехи 8):
 * округление цены за штуку (M-3) и минимальный тираж шелкографии (M-4).
 * Отдельный модуль, а не `costRules`/`printRules`: те во входном чанке (стор
 * визарда), а эти правила нужны только ленивым экранам — вход не растёт.
 */

/** Шаг округления цены за штуку ВВЕРХ, ₽ (`PriceRules.roundTo` по умолчанию) */
export const UNIT_PRICE_STEP = 5;

/** Вверх до шага; шаг 0 — до рубля */
export function ceilToStep(v: number, step: number): number {
  return step > 0 ? Math.ceil(v / step) * step : Math.round(v);
}

/** Шелкография — тираж от 50 шт: меньше — по согласованию */
export const SCREEN_MIN_QTY = 50;
