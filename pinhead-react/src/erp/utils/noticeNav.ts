/**
 * ПЕРЕХОД ПО УВЕДОМЛЕНИЮ ИЗ-ВНЕ РЕАКТА (правка 01.10, п. 4).
 *
 * Окно браузера о новом сообщении создаёт стор (`notificationsSlice`), а
 * нажимают его, когда вкладка в фоне: «нажатие на уведомление открывает
 * нужный заказ, вкладку „Чат" и само сообщение». Роутер живёт в оболочке,
 * и стор до него не дотягивается — поэтому оболочка регистрирует здесь свой
 * `navigate`.
 *
 * `location.assign` вместо роутера перезагрузил бы раздел целиком:
 * бутстрап, заказы, подписка — секунды на планшете цеха ради одного
 * перехода. Он остаётся только запасным путём, пока оболочка не смонтирована.
 */
let go: ((to: string) => void) | null = null;

export function setNoticeNavigate(fn: (to: string) => void): () => void {
  go = fn;
  return () => { if (go === fn) go = null; };
}

export function openNoticeLink(link: string): void {
  if (go) go(link);
  else if (typeof window !== 'undefined') window.location.assign(link);
}
