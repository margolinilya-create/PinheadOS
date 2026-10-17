/*
 * Диалога «Заказ не сохранён» визарда v3 (`shouldBlockLeave`) больше нет:
 * визард и его черновик убраны в вехе 3. Остался уход с заказа v4.
 */

/**
 * Состояния, при которых уход с карточки внутри приложения теряет правки.
 *
 * `error` — сбой сохранения: повтор при уходе может упасть снова, и правки
 * пропадут молча (поймано обходом 16.10). `outdated` и `conflict` — запись
 * остановлена, правки человека остались только в карточке, `flush()` их не
 * отправит. Несохранённое без сбоя (`dirty`, `saving`) догоняет `flush()`
 * при размонтировании — спрашивать незачем. `locked` — терять нечего.
 */
const LEAVE_BLOCK_STATES: ReadonlySet<string> = new Set(['error', 'outdated', 'conflict']);

/**
 * Уход с карточки заказа v4, чьи правки не уйдут сами.
 * Вложенный адрес того же заказа (`/sales/:id/…`) — не уход.
 */
export function shouldBlockSalesLeave(p: { saveState: string; from: string; to: string }): boolean {
  if (!LEAVE_BLOCK_STATES.has(p.saveState)) return false;
  if (!/^\/sales\/[^/]+$/.test(p.from)) return false;
  return !p.to.startsWith(`${p.from}/`) && p.to !== p.from;
}

/**
 * Текст диалога «Правки заказа не сохранены». После сбоя (`error`) повтор
 * возможен; при `outdated`/`conflict` запись остановлена — спасти правки
 * можно только руками, поэтому и текст другой.
 */
export function salesLeaveDialogText(saveState: string): string {
  if (saveState === 'outdated' || saveState === 'conflict') {
    return 'Правка не сохранена — скопируйте изменения и обновите страницу. Уйти без сохранения?';
  }
  return 'Последнее сохранение не удалось. Если уйти сейчас, правки потеряются — останьтесь и повторите после восстановления связи.';
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
