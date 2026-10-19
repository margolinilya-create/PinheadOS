import type { ChatContext, ErpChatMessage } from '../types';

/**
 * КОНТЕКСТ ОБСУЖДЕНИЯ — «о чём этот разговор внутри сделки».
 *
 * Документ: «сообщение может относиться ко всей сделке либо к её части —
 * позиции, задаче цеха, разработке… на кнопке „Чат" в сделке показывать
 * общее количество непрочитанных, на кнопке открытия из задачи — количество
 * по её контексту».
 *
 * ЭТО ВИД, А НЕ ПРАВО. Видимость решает участие в разделе (решение владельца
 * 14.09): кто видит сделку, тот видит всю её переписку. Контекст сужает
 * показанное и выбирает, какой счётчик гасить, — не более того. Поэтому
 * функции здесь ничего не проверяют и ни к чему не обращаются: это разбор
 * значения, и он обязан одинаково работать у ленты, у счётчика и у чернового
 * текста, иначе «пустой контекст» в одном месте окажется «всей сделкой»,
 * а в другом — «ничем».
 */

/** Пустой контекст — вся сделка. Один литерал, чтобы не плодить `{}` по коду */

/** Есть ли у контекста хоть один якорь (иначе это «вся сделка») */
export function isWholeDeal(ctx: ChatContext | null | undefined): boolean {
  if (!ctx) return true;
  return !ctx.itemId && !ctx.stageId && !ctx.experimentalId;
}

/**
 * Ключ контекста — им ключуется черновик и сравниваются два контекста.
 *
 * Порядок полей ФИКСИРОВАН и не зависит от порядка в объекте: `JSON.stringify`
 * печатает ключи в порядке вставки, и `{stageId, itemId}` дал бы другой ключ,
 * чем `{itemId, stageId}`, — то есть черновик терялся бы от того, в каком
 * месте кода открыли окно.
 */
export function contextKey(ctx: ChatContext | null | undefined): string {
  if (isWholeDeal(ctx)) return 'all';
  const c = ctx as ChatContext;
  return [
    c.itemId ? `i:${c.itemId}` : '',
    c.stageId ? `s:${c.stageId}` : '',
    c.experimentalId ? `d:${c.experimentalId}` : '',
  ].filter(Boolean).join('|');
}

export function sameContext(
  a: ChatContext | null | undefined,
  b: ChatContext | null | undefined,
): boolean {
  return contextKey(a) === contextKey(b);
}

/**
 * Относится ли сообщение к контексту — для локальной прикидки (например,
 * стоит ли дописывать пришедшее realtime-сообщение в открытую ленту).
 *
 * В режиме «вся сделка» подходит ЛЮБОЕ сообщение: лента сделки показывает
 * и общие, и контекстные — иначе переписка по задаче исчезала бы из общей
 * ленты, и человек считал бы, что её нет.
 */
export function messageInContext(
  message: Pick<ErpChatMessage, 'item_id' | 'stage_id' | 'experimental_id'>,
  ctx: ChatContext | null | undefined,
): boolean {
  if (isWholeDeal(ctx)) return true;
  const c = ctx as ChatContext;
  if (c.stageId) return message.stage_id === c.stageId;
  if (c.experimentalId) return message.experimental_id === c.experimentalId;
  if (c.itemId) return message.item_id === c.itemId;
  return true;
}

/**
 * Непрочитанное ИМЕННО ЭТОГО контекста.
 *
 * Счётчик задачи берётся из разбивки по этапам, счётчик сделки — из общего
 * числа. Формула одна и на сервере (`erp_chat_unread`), и здесь: клиент
 * только выбирает, какое из двух чисел показать, и НЕ складывает их —
 * сумма означала бы, что сообщение задачи посчитано дважды.
 */
export function unreadForContext(
  unread: { total: number; byStage: Record<string, number> } | null | undefined,
  ctx: ChatContext | null | undefined,
): number {
  if (!unread) return 0;
  if (isWholeDeal(ctx)) return unread.total;
  const stageId = (ctx as ChatContext).stageId;
  if (!stageId) return unread.total;
  return unread.byStage[stageId] ?? 0;
}

/**
 * ЯКОРЬ ОБСУЖДЕНИЯ — «сделка с контекстом» ИЛИ «тред бизнес-задачи»
 * (правки 19.10, п. 7). Ключ один на два места: черновик («человек × задача»,
 * `useChatDraft`) и сверка позднего ответа ленты. Префикс `task:`
 * не пересекается с id заказа (uuid), поэтому черновик задачи не всплывёт
 * в сделке — даже в сделке той же задачи.
 */
export function chatAnchorKey(
  orderId: string | null | undefined,
  ctx: ChatContext | null | undefined,
  taskId?: string | null,
): string {
  if (taskId) return `task:${taskId}`;
  return `${orderId ?? ''}|${contextKey(ctx)}`;
}

/**
 * Касается ли звонок realtime треда открытой ленты задачи. Звонок несёт
 * треды серии событий (`'*'` — событие без треда, например реакция).
 * Тред ленты неизвестен (ещё ни одного сообщения) или список пуст —
 * перечитываем: лишний запрос лучше пропущенного сообщения.
 */
export function pingConcernsThread(
  threads: readonly string[] | null | undefined,
  threadId: string | null | undefined,
): boolean {
  if (!threadId || !threads || threads.length === 0) return true;
  return threads.includes('*') || threads.includes(threadId);
}
