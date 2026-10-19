/**
 * ЧАТ ВНУТРИ СДЕЛКИ — клиентская половина (правка 14.09, п. 5).
 *
 * ВЕСЬ обмен идёт через четыре RPC: `erp_chat_page` (лента),
 * `erp_chat_send` (единственный писатель), `erp_chat_unread` (счётчики),
 * `erp_chat_mark_read` (отметка; счётчики и отметки — в `chatReadActions`).
 * Прямых обращений к таблицам переписки здесь нет и быть не может: у сообщений нет ни INSERT-, ни UPDATE-,
 * ни DELETE-политики — запрет выражен отсутствием команды.
 *
 * СЛАЙС ДОМЕННЫЙ. Чат открывают из карточки заказа и со страницы задания,
 * то есть с экрана — к этому моменту доменный чанк уже приехал. В ядре
 * остаётся колокол: он считает ПЕРСОНАЛЬНЫЕ уведомления
 * (`notificationsSlice`), а не непрочитанные сообщения, и это разные
 * величины — «вас позвали» против «в сделке написали».
 *
 * ЛЕНТА ОДНА. Окно показывает одно обсуждение за раз, поэтому состояние
 * плоское: заказ, контекст, страница сообщений. Держать карту «ключ →
 * лента» значило бы копить в памяти переписку всех открытых за смену
 * сделок ради экономии одного запроса при возврате.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type {
  ChatContext, ErpChatMessage, ErpChatPerson,
} from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import { chatAnchorKey, isWholeDeal, unreadForContext } from '../../utils/chatContext';
import type { ChatSlice, ErpStore } from '../types';
import { chatReadActions } from './chatReadActions';
import type { ChatReactionPerson, ChatSearchHit } from '../../types';

/** Сколько сообщений в странице. Совпадает с умолчанием `erp_chat_page` */

/** Ответ `erp_chat_page` — ровно то, что собирает функция */
interface ChatPage {
  messages: ErpChatMessage[];
  has_more: boolean;
}

/**
 * Аргументы ленты по ЯКОРЮ (правки 19.10, п. 7). У треда задачи нет ни сделки,
 * ни контекста: `p_order_id = null`, заказ сервер берёт из задачи. Передать
 * сюда заказ значило бы спросить ленту СДЕЛКИ — тред задачи туда не входит.
 */
function pageArgs(orderId: string | null, context: ChatContext, taskId: string | null) {
  if (taskId) return { p_order_id: null as unknown as string, p_task_id: taskId };
  return {
    p_order_id: orderId as string,
    p_item_id: context.itemId ?? null,
    p_stage_id: context.stageId ?? null,
    p_experimental_id: context.experimentalId ?? null,
  };
}

/** Якорь открытой ленты — им сверяется поздний ответ */
const anchorOf = (s: ErpStore) => chatAnchorKey(s.chatOrderId, s.chatContext, s.chatTaskId);

export const chatSlice: StateCreator<ErpStore, [], [], ChatSlice> = (set, get) => ({
  /**
   * Данные объявлены здесь, а стоят в ядре (`domainState.DOMAIN_INITIAL_STATE`).
   * Это ЗЕРКАЛО, а не второй источник: `attachDomainSlices` переносит в стор
   * только функции, а совпадение значений сверяет `domainSlices.test.ts`.
   */
  chatDirectory: [],
  chatDirectoryLoaded: false,
  chatOrderId: null,
  chatTaskId: null,
  chatContext: {},
  chatMessages: [],
  chatHasMore: false,
  chatLoading: false,
  chatError: null,
  chatUnread: {},
  /** Граница «Непрочитанные сообщения» — снимок на момент открытия (20.09, п. 4) */
  chatUnreadAnchor: null,
  chatWindow: null,
  chatPingThreads: [],

  /**
   * Открыть окно чата поверх ERP (правка 20.09, п. 4).
   *
   * Саму ленту грузит `ChatPanel` внутри окна — здесь только «что показать».
   * Разводить это по двум местам нельзя: окно открывают из задачи, из
   * разработки и из списка заказов, и три копии загрузки разошлись бы.
   */
  openChatWindow: (orderId, title, context = {}, contextLabel = null) => set({
    chatWindow: { orderId, title, context, contextLabel, expanded: false },
  }),
  closeChatWindow: () => set({ chatWindow: null }),
  toggleChatWindowSize: () => set((s) => (s.chatWindow
    ? { chatWindow: { ...s.chatWindow, expanded: !s.chatWindow.expanded } }
    : {})),
  chatPing: 0,

  loadChatDirectory: async () => {
    if (get().chatDirectoryLoaded) return;
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_directory'));
    if (error) {
      /**
       * Fail-open и МОЛЧА, как у уведомлений: без справочника лента покажет
       * автора обезличенно, но останется читаемой. Полоса поверх экрана
       * здесь была бы хуже пропущенного имени.
       */
      set({ chatDirectoryLoaded: true });
      return;
    }
    set({
      chatDirectory: (data ?? []) as ErpChatPerson[],
      chatDirectoryLoaded: true,
    });
  },

  /**
   * Открыть обсуждение: последняя страница сверху вниз.
   *
   * Смена контекста — это НОВАЯ лента, а не фильтр поверх старой: сервер
   * отбирает по контексту сам, и локальная фильтрация показала бы «ничего
   * не найдено» там, где сообщения просто не доехали.
   */
  openChat: async (orderId, context = {}, taskId = null) => {
    // Тред задачи — без сделки и контекста: якорь ровно один
    const ctx: ChatContext = taskId ? {} : context;
    const anchor0 = chatAnchorKey(taskId ? null : orderId, ctx, taskId);
    set({
      chatUnreadAnchor: null,
      chatOrderId: taskId ? null : orderId,
      chatTaskId: taskId,
      chatContext: ctx,
      chatMessages: [],
      chatHasMore: false,
      chatLoading: true,
      chatError: null,
    });
    const { data, error } = await erpRead(() => supabase.rpc(
      'erp_chat_page', pageArgs(orderId, ctx, taskId),
    ));
    /**
     * Поздний ответ не затирает уже открытое другое обсуждение: человек
     * успел переключить контекст, пока летел запрос. Тот же приём, что
     * у `arrivedLate` в остальных разделах, — сравнение состояния ДО и ПОСЛЕ
     * ожидания, а не «загружено ли сейчас».
     */
    if (anchorOf(get()) !== anchor0) return;
    if (error) {
      set({ chatLoading: false, chatError: error.message });
      return;
    }
    const page = (data ?? { messages: [], has_more: false }) as ChatPage;
    const rows = page.messages ?? [];
    /**
     * ГРАНИЦА НЕПРОЧИТАННОГО — СНИМОК НА МОМЕНТ ОТКРЫТИЯ (правка 20.09, п. 4).
     *
     * «Граница остаётся ориентиром в текущем сеансе, даже когда видимые
     * сообщения уже отмечены прочитанными». Считать её на каждом кадре
     * из счётчика нельзя: первый же `markChatRead` обнулит счётчик, и черта
     * исчезнет ровно тогда, когда по ней ориентируются.
     *
     * Место ей ЗДЕСЬ, а не в компоненте: панель перерисовывается от каждого
     * realtime-события, а это величина «один раз при открытии».
     *
     * Непрочитанные — последние `count` ЧУЖИХ сообщений: сервер считает
     * их тем же правилом, свои в счётчик не входят.
     */
    // У задачи — свой счётчик (`erp_chat_unread_tasks`), счётчик сделки не трогается
    const unread = taskId
      ? (get().bizTaskUnread[taskId] ?? 0)
      : !isWholeDeal(ctx)
        ? unreadForContext(get().chatUnread[orderId as string], ctx)
        : (get().chatUnread[orderId as string]?.total ?? 0);
    const me = currentUserId();
    const others = unread > 0 ? rows.filter((m) => m.author_id !== me) : [];
    const anchor = others.length > 0
      ? (others[Math.max(others.length - unread, 0)]?.id ?? null)
      : null;

    set({
      chatMessages: rows,
      chatHasMore: Boolean(page.has_more),
      chatLoading: false,
      chatError: null,
      chatUnreadAnchor: anchor,
    });
  },

  /**
   * Дочитать ВВЕРХ. Курсор — пара (момент, id) самого раннего сообщения
   * в ленте: `created_at` не уникален, и страница по одному лишь моменту
   * теряла бы соседей, отправленных в ту же миллисекунду.
   */
  loadMoreChat: async () => {
    const {
      chatOrderId, chatTaskId, chatContext, chatMessages, chatHasMore, chatLoading,
    } = get();
    if ((!chatOrderId && !chatTaskId) || !chatHasMore || chatLoading
      || chatMessages.length === 0) return;
    const oldest = chatMessages[0];
    const anchor0 = anchorOf(get());
    set({ chatLoading: true });
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_page', {
      ...pageArgs(chatOrderId, chatContext, chatTaskId),
      p_before_at: oldest.created_at,
      p_before_id: oldest.id,
    }));
    const s = get();
    if (anchorOf(s) !== anchor0) return;
    if (error) {
      set({ chatLoading: false, chatError: error.message });
      return;
    }
    const page = (data ?? { messages: [], has_more: false }) as ChatPage;
    const known = new Set(s.chatMessages.map((m) => m.id));
    set({
      // Дедуп по id: между запросом и ответом могло прийти realtime-обновление
      chatMessages: [...(page.messages ?? []).filter((m) => !known.has(m.id)), ...s.chatMessages],
      chatHasMore: Boolean(page.has_more),
      chatLoading: false,
    });
  },

  /**
   * Перечитать ленту сверху — после своего сообщения и по звонку realtime.
   *
   * Именно ПЕРЕЧИТАТЬ, а не дописать строку из события: видимость решает
   * серверная функция, и собирать сообщение из `ev.new` значило бы решать
   * её второй раз, на клиенте. Событие говорит только «что-то пришло».
   */
  refreshChat: async () => {
    const { chatOrderId, chatTaskId, chatContext } = get();
    if (!chatOrderId && !chatTaskId) return;
    const anchor0 = anchorOf(get());
    const { data, error } = await erpRead(() => supabase.rpc(
      'erp_chat_page', pageArgs(chatOrderId, chatContext, chatTaskId),
    ));
    if (error) return;
    const s = get();
    if (anchorOf(s) !== anchor0) return;
    const page = (data ?? { messages: [], has_more: false }) as ChatPage;
    const fresh = page.messages ?? [];
    if (fresh.length === 0) {
      set({ chatMessages: [] });
      return;
    }
    /**
     * Догруженное ВВЕРХ не теряется: свежая страница приклеивается к тому,
     * что человек уже пролистал. Иначе каждое новое сообщение сбрасывало бы
     * ленту к последним пятидесяти — то есть к началу чтения.
     */
    const firstFresh = fresh[0].created_at;
    const older = s.chatMessages.filter((m) => m.created_at < firstFresh
      && !fresh.some((f) => f.id === m.id));
    set({
      chatMessages: [...older, ...fresh],
      chatHasMore: older.length > 0 ? s.chatHasMore : Boolean(page.has_more),
    });
  },

  /**
   * Отправить сообщение.
   *
   * `clientKey` обязателен и приходит СНАРУЖИ (`utils/attemptKey`): правило
   * «не изменил ввод — та же попытка» принадлежит форме, а не стору. Повтор
   * с тем же ключом сервер вернёт как `duplicate` — ни второго сообщения,
   * ни второго уведомления.
   */
  sendChatMessage: async ({
    orderId = null, taskId = null, body, clientKey, context = {}, replyTo = null,
    mentions = [], attachments = [],
  }) => {
    /**
     * Сообщение задачи: `p_order_id = null` и без контекста сделки — сервер
     * отвечает 22023 на тред задачи с адресом сделки (правки 19.10, п. 7).
     */
    const { p_order_id: pOrder, ...anchor } = pageArgs(orderId, context, taskId);
    const { data, error } = await erpQuery(() => supabase.rpc('erp_chat_send', {
      p_order_id: pOrder,
      p_item_id: null,
      p_stage_id: null,
      p_experimental_id: null,
      ...anchor,
      p_body: body,
      p_client_key: clientKey,
      p_reply_to: replyTo,
      p_mentions: mentions,
      p_attachments: attachments,
    }));
    if (error) {
      erpError('Не удалось отправить сообщение', error);
      return null;
    }
    const result = (data ?? null) as { message_id: string; mentioned: string[] } | null;
    // Своя лента перечитывается сразу: ждать звонка realtime — значит
    // показывать человеку пустое поле ввода и никакого следа отправки
    await get().refreshChat();
    return result;
  },

  /**
   * ПРАВКА СВОЕГО СООБЩЕНИЯ (вторая очередь чата).
   *
   * Лента перечитывается ответом сервера, а не патчится на месте: правка
   * меняет не только текст — она пересобирает упоминания, а их подсветку
   * лента берёт из `mentions` сообщения. Патч «только body» показал бы
   * подсветку снятого упоминания до следующего звонка realtime.
   */
  editChatMessage: async ({ messageId, body, mentions = [] }) => {
    const { error } = await erpQuery(() => supabase.rpc('erp_chat_edit', {
      p_message_id: messageId,
      p_body: body,
      p_mentions: mentions,
    }));
    if (error) {
      erpError('Не удалось изменить сообщение', error);
      return false;
    }
    await get().refreshChat();
    return true;
  },

  /**
   * УДАЛЕНИЕ СВОЕГО СООБЩЕНИЯ. Не оптимистично — правило раздела: показать
   * «удалено» до ответа сервера значит однажды показать это по ошибке сети,
   * а вернуть текст обратно будет уже неоткуда.
   */
  deleteChatMessage: async (messageId) => {
    const { error } = await erpQuery(
      () => supabase.rpc('erp_chat_delete', { p_message_id: messageId }),
    );
    if (error) {
      erpError('Не удалось удалить сообщение', error);
      return false;
    }
    await get().refreshChat();
    /**
     * Счётчики трогаем тоже: удалённое перестаёт быть непрочитанным
     * (`erp_chat_unread` его не считает), и бейдж, оставшийся висеть,
     * звал бы читать пустое место.
     */
    set({ chatPing: get().chatPing + 1 });
    return true;
  },

  /**
   * РЕАКЦИЯ — ПЕРЕКЛЮЧАТЕЛЬ, И РЕШАЕТ ЕГО СЕРВЕР.
   *
   * Клиент не спрашивает «стоит ли уже моя»: лента могла устареть на секунду,
   * а два быстрых нажатия по такой проверке оставляют реакцию включённой
   * через раз. `erp_chat_react` сначала пробует удалить строку и по факту
   * удаления решает, что произошло.
   *
   * Лента перечитывается ответом: сводка `{emoji, count, mine}` считается
   * там же, где хранится, и собирать её второй раз на клиенте значило бы
   * завести второй ответ на вопрос «сколько пальцев у этого сообщения».
   */
  toggleChatReaction: async (messageId, emoji) => {
    const { error } = await erpQuery(() => supabase.rpc('erp_chat_react', {
      p_message_id: messageId,
      p_emoji: emoji,
    }));
    if (error) {
      erpError('Не удалось поставить реакцию', error);
      return false;
    }
    await get().refreshChat();
    return true;
  },

  /** Кто поставил — по требованию: имена нужны ровно тогда, когда навели */
  loadChatReactionPeople: async (messageId) => {
    const { data, error } = await erpRead(
      () => supabase.rpc('erp_chat_reaction_people', { p_message_id: messageId }),
    );
    if (error) {
      erpError('Не удалось узнать, кто поставил реакцию', error);
      return [];
    }
    return (data ?? []) as ChatReactionPerson[];
  },

  /**
   * ПОИСК ПО ПЕРЕПИСКЕ (вторая очередь чата).
   *
   * Спрашивает СЕРВЕР, а не фильтрует загруженное: лента держит последнюю
   * страницу, а ищут обычно то, что выше неё, — локальный фильтр отвечал бы
   * «ничего не найдено» там, где сообщение просто не доехало.
   *
   * Ответ не кладётся в стор: находки живут ровно столько, сколько открыто
   * поле поиска, и класть их рядом с лентой значило бы завести второе
   * состояние переписки, которое надо не забыть погасить.
   */
  searchChat: async (orderId, query) => {
    const text = (query ?? '').trim();
    // Один символ ищет всё подряд; порог тот же, что на сервере
    if (!orderId || text.length < 2) return [];
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_search', {
      p_order_id: orderId,
      p_query: text,
    }));
    if (error) {
      erpError('Не удалось выполнить поиск по переписке', error);
      return [];
    }
    return ((data as { messages?: ChatSearchHit[] } | null)?.messages ?? []);
  },

  ...chatReadActions(set, get),

  closeChat: () => set({
    chatOrderId: null,
    chatTaskId: null,
    chatContext: {} as ChatContext,
    chatMessages: [],
    chatHasMore: false,
    chatLoading: false,
    chatError: null,
  }),
});
