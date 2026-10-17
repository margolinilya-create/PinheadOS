/*
 * Диалога «Заказ не сохранён» визарда v3 (`shouldBlockLeave`) больше нет:
 * визард и его черновик убраны в вехе 3. Остался уход с заказа v4.
 */

/**
 * Уход с карточки заказа v4, чьё последнее сохранение УПАЛО.
 *
 * Несохранённое без сбоя (`dirty`, `saving`) догоняет `flush()` при
 * размонтировании — спрашивать незачем. После сбоя повтор при уходе может
 * упасть снова, и правки пропадут молча (поймано обходом 16.10), поэтому
 * спрашиваем. Вложенный адрес того же заказа (`/sales/:id/…`) — не уход.
 */
export function shouldBlockSalesLeave(p: { saveState: string; from: string; to: string }): boolean {
  if (p.saveState !== 'error') return false;
  if (!/^\/sales\/[^/]+$/.test(p.from)) return false;
  return !p.to.startsWith(`${p.from}/`) && p.to !== p.from;
}

/**
 * Закрытие вкладки и F5: правка ещё не ушла в базу или ушла с ошибкой.
 * `outdated` и `conflict` — тоже: правки человека остались только в карточке
 * (запись остановлена), и браузер должен спросить, прежде чем их выбросить.
 * `locked` — нет: правка закрыта, в карточке версия сервера.
 */
const UNSAVED_STATES: ReadonlySet<string> = new Set(['dirty', 'saving', 'error', 'outdated', 'conflict']);

export function salesHasUnsaved(saveState: string): boolean {
  return UNSAVED_STATES.has(saveState);
}
