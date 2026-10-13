/**
 * КОАЛЕСЦЕНЦИЯ СОБЫТИЙ REALTIME (обзор 26.09, сессия 69, пп. 3–5).
 *
 * Событие `postgres_changes` приходит ПО СТРОКЕ, а перечитывание идёт
 * ПО СУЩНОСТИ: применение маршрута заводит N этапов — и до этого модуля
 * `INSERT erp_item_stages` N раз подряд перезагружал один и тот же заказ
 * полным `erp_order_detail`; каждое событие задачи разработки перечитывало
 * всю таблицу `erp_experimental`; каждое сообщение чата дёргало четырёх
 * подписчиков `chatPing` без паузы, а собственная отправка считалась дважды —
 * своим инкрементом и эхом канала.
 *
 * Здесь один приём для всех: последнее событие серии выигрывает, серия
 * закрывается таймером. Таймер на ЗАКАЗ — свой (Map по id): события двух
 * заказов не должны глушить друг друга. Модуль отдельный, а не строки
 * в `realtimeSlice`: тот стоит ровно на потолке ратчета размера.
 *
 * Только сеть и таймеры, без стора: тестируется fake-таймерами
 * (`realtimeCoalesce.test.ts`), слайс лишь подставляет колбэки.
 */

import { FULL_RELOAD_DEBOUNCE_MS } from './shared';

/** Пауза после последнего INSERT этапа перед перечитыванием заказа */
export const ORDER_RELOAD_DEBOUNCE_MS = 200;
/** Пауза после последнего события разработки перед перечитыванием доски ЭКС */
export const EXPERIMENTAL_RELOAD_DEBOUNCE_MS = 300;
/** Пауза между событиями чата и одним «звонком» подписчикам */
export const CHAT_PING_DEBOUNCE_MS = 250;

type Timer = ReturnType<typeof setTimeout>;

let fullTimer: Timer | null = null;
let experimentalTimer: Timer | null = null;
let pingTimer: Timer | null = null;
const orderTimers = new Map<string, Timer>();

function restart(current: Timer | null, ms: number, fn: () => void): Timer {
  if (current) clearTimeout(current);
  return setTimeout(fn, ms);
}

/** Последний fallback — полная перезагрузка, одна на серию событий */
export function scheduleFullReload(fn: () => void, ms: number = FULL_RELOAD_DEBOUNCE_MS): void {
  fullTimer = restart(fullTimer, ms, () => {
    fullTimer = null;
    fn();
  });
}

/** Перечитать один заказ после серии событий по его строкам */
export function scheduleOrderReload(
  orderId: string, fn: () => void, ms: number = ORDER_RELOAD_DEBOUNCE_MS,
): void {
  const timer = restart(orderTimers.get(orderId) ?? null, ms, () => {
    orderTimers.delete(orderId);
    fn();
  });
  orderTimers.set(orderId, timer);
}

/** Перечитать доску разработок после серии событий её таблиц */
export function scheduleExperimentalReload(
  fn: () => void, ms: number = EXPERIMENTAL_RELOAD_DEBOUNCE_MS,
): void {
  experimentalTimer = restart(experimentalTimer, ms, () => {
    experimentalTimer = null;
    fn();
  });
}

/** Один «звонок» подписчикам чата на серию сообщений и реакций */
export function schedulePing(fn: () => void, ms: number = CHAT_PING_DEBOUNCE_MS): void {
  pingTimer = restart(pingTimer, ms, () => {
    pingTimer = null;
    fn();
  });
}

/** Снять все отложенные перечитывания — при отписке канала */
export function clearRealtimeTimers(): void {
  if (fullTimer) clearTimeout(fullTimer);
  if (experimentalTimer) clearTimeout(experimentalTimer);
  if (pingTimer) clearTimeout(pingTimer);
  for (const t of orderTimers.values()) clearTimeout(t);
  fullTimer = null;
  experimentalTimer = null;
  pingTimer = null;
  orderTimers.clear();
}
