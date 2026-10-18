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
 * Уход с карточки заказа v4, чьи правки не уйдут сами, — или пока идёт
 * «Отправить в работу» (`sending`, веха 6+7): цепочка ещё грузит ТЗ и ждёт ответа.
 * Вложенный адрес того же заказа (`/sales/:id/…`) — не уход.
 */
export function shouldBlockSalesLeave(p: { saveState: string; sending?: boolean; from: string; to: string }): boolean {
  if (!p.sending && !LEAVE_BLOCK_STATES.has(p.saveState)) return false;
  if (!/^\/sales\/[^/]+$/.test(p.from)) return false;
  return !p.to.startsWith(`${p.from}/`) && p.to !== p.from;
}

/** Уход во время отправки в работу */
export const SENDING_LEAVE_TEXT = 'Идёт отправка в работу — дождитесь окончания';

/** Заголовок диалога ухода */
export function salesLeaveDialogTitle(sending = false): string {
  return sending ? 'Заказ отправляется в работу' : 'Правки заказа не сохранены';
}

/**
 * Текст диалога «Правки заказа не сохранены». После сбоя (`error`) повтор
 * возможен; при `outdated`/`conflict` запись остановлена — спасти правки
 * можно только руками, поэтому и текст другой.
 */
export function salesLeaveDialogText(saveState: string, sending = false): string {
  if (sending) return SENDING_LEAVE_TEXT;
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

export function salesHasUnsaved(saveState: string, sending = false): boolean {
  return sending || UNSAVED_STATES.has(saveState);
}

/*
 * Справочники заказа (веха 4): редактор с несохранёнными правками.
 *
 * Блокировщик перехода у роутера ОДИН (`useBlocker` в `OrderStudioApp`), а
 * редакторов справочников на экране — по вкладке. Поэтому редактор не
 * заводит свой блокировщик, а отмечается здесь (`useCatalogEditor`), и общий
 * блокировщик спрашивает об уходе со страницы. Смену вкладки того же экрана
 * (`?tab=`) спрашивает сам экран (`OrderSettings`): адрес тот же, роутер её
 * уходом не считает.
 */
const unsavedCatalogs = new Set<string>();

/** Редактор `id` отмечает, есть ли у него несохранённые правки */
export function setCatalogUnsaved(id: string, unsaved: boolean): void {
  if (unsaved) unsavedCatalogs.add(id);
  else unsavedCatalogs.delete(id);
}

/** Хоть один редактор справочника держит несохранённые правки */
export function catalogHasUnsaved(): boolean {
  return unsavedCatalogs.size > 0;
}

/** Уход со страницы справочников с несохранёнными правками; смена `?tab=` — не уход */
export function shouldBlockCatalogLeave(p: { from: string; to: string }): boolean {
  return catalogHasUnsaved() && p.from !== p.to;
}

/** Текст подтверждения ухода и смены вкладки с несохранённым справочником */
export const CATALOG_LEAVE_TEXT = 'Правки справочника не сохранены. Если уйти, они пропадут.';
