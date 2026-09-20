/**
 * ЧАТ ВНУТРИ СДЕЛКИ — клиентская половина (правка 14.09, п. 5).
 *
 * ВЕСЬ обмен идёт через четыре RPC: `erp_chat_page` (лента),
 * `erp_chat_send` (единственный писатель), `erp_chat_unread` (счётчики),
 * `erp_chat_mark_read` (отметка). Прямых обращений к таблицам переписки
 * здесь нет и быть не может: у сообщений нет ни INSERT-, ни UPDATE-,
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
  ChatContext, ChatUnread, ErpChatMessage, ErpChatPerson,
} from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import { contextKey, isWholeDeal, unreadForContext } from '../../utils/chatContext';
import type { ChatSlice, ErpStore } from '../types';
import type { ChatReadReceipt } from '../../types';

/** Сколько сообщений в странице. Совпадает с умолчанием `erp_chat_page` */
export const CHAT_PAGE_SIZE = 50;

/** Ответ `erp_chat_page` — ровно то, что собирает функция */
interface ChatPage {
  messages: ErpChatMessage[];
  has_more: boolean;
}

export const chatSlice: StateCreator<ErpStore, [], [], ChatSlice> = (set, get) => ({
  /**
   * Данные объявлены здесь, а стоят в ядре (`domainState.DOMAIN_INITIAL_STATE`).
   * Это ЗЕРКАЛО, а не второй источник: `attachDomainSlices` переносит в стор
   * только функции, а совпадение значений сверяет `domainSlices.test.ts`.
   */
  chatDirectory: [],
  chatDirectoryLoaded: false,
  chatOrderId: null,
  chatContext: {},
  chatMessages: [],
  chatHasMore: false,
  chatLoading: false,
  chatError: null,
  chatUnread: {},
  /** Граница «Непрочитанные сообщения» — снимок на момент открытия (20.09, п. 4) */
  chatUnreadAnchor: null,
  chatWindow: null,

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
  openChat: async (orderId, context = {}) => {
    set({
      chatUnreadAnchor: null,
      chatOrderId: orderId,
      chatContext: context,
      chatMessages: [],
      chatHasMore: false,
      chatLoading: true,
      chatError: null,
    });
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_page', {
      p_order_id: orderId,
      p_item_id: context.itemId ?? null,
      p_stage_id: context.stageId ?? null,
      p_experimental_id: context.experimentalId ?? null,
    }));
    /**
     * Поздний ответ не затирает уже открытое другое обсуждение: человек
     * успел переключить контекст, пока летел запрос. Тот же приём, что
     * у `arrivedLate` в остальных разделах, — сравнение состояния ДО и ПОСЛЕ
     * ожидания, а не «загружено ли сейчас».
     */
    const s = get();
    if (s.chatOrderId !== orderId || contextKey(s.chatContext) !== contextKey(context)) return;
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
    const unread = !isWholeDeal(context)
      ? unreadForContext(get().chatUnread[orderId], context)
      : (get().chatUnread[orderId]?.total ?? 0);
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
    const { chatOrderId, chatContext, chatMessages, chatHasMore, chatLoading } = get();
    if (!chatOrderId || !chatHasMore || chatLoading || chatMessages.length === 0) return;
    const oldest = chatMessages[0];
    set({ chatLoading: true });
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_page', {
      p_order_id: chatOrderId,
      p_item_id: chatContext.itemId ?? null,
      p_stage_id: chatContext.stageId ?? null,
      p_experimental_id: chatContext.experimentalId ?? null,
      p_before_at: oldest.created_at,
      p_before_id: oldest.id,
    }));
    const s = get();
    if (s.chatOrderId !== chatOrderId || contextKey(s.chatContext) !== contextKey(chatContext)) {
      return;
    }
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
    const { chatOrderId, chatContext } = get();
    if (!chatOrderId) return;
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_page', {
      p_order_id: chatOrderId,
      p_item_id: chatContext.itemId ?? null,
      p_stage_id: chatContext.stageId ?? null,
      p_experimental_id: chatContext.experimentalId ?? null,
    }));
    if (error) return;
    const s = get();
    if (s.chatOrderId !== chatOrderId || contextKey(s.chatContext) !== contextKey(chatContext)) {
      return;
    }
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
    orderId, body, clientKey, context = {}, replyTo = null,
    mentions = [], attachments = [],
  }) => {
    const { data, error } = await erpQuery(() => supabase.rpc('erp_chat_send', {
      p_order_id: orderId,
      p_body: body,
      p_client_key: clientKey,
      p_item_id: context.itemId ?? null,
      p_stage_id: context.stageId ?? null,
      p_experimental_id: context.experimentalId ?? null,
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

  loadChatUnread: async (orderId) => {
    if (!currentUserId()) return;
    const { data, error } = await erpRead(() => supabase.rpc('erp_chat_unread', {
      p_order_id: orderId,
    }));
    if (error) return;
    const row = (data ?? { total: 0, by_stage: {} }) as {
      total: number;
      by_stage: Record<string, number>;
      mentions?: number;
      first_unread_id?: string | null;
    };
    set({
      chatUnread: {
        ...get().chatUnread,
        [orderId]: {
          total: row.total ?? 0,
          byStage: row.by_stage ?? {},
          // Упоминания считаются отдельно (правка 20.09, п. 4): значок @
          // без числа не отвечает на «сколько их»
          mentions: row.mentions ?? 0,
        } as ChatUnread,
      },
    });
  },

  /**
   * Отметить прочитанным. Оптимистично гасим ТОЛЬКО тот счётчик, который
   * человек действительно закрыл: у сделки — общий, у задачи — её.
   * Просмотр задачи не гасит сделку (требование документа), и клиент
   * не имеет права решить иначе, чем сервер.
   */
  /**
   * ПРОСМОТРЕННЫЕ СООБЩЕНИЯ (правка 20.09, п. 4) — пачкой, по видимой области.
   *
   * Счётчик после этого НЕ правится оптимистично: сколько из отправленного
   * сервер счёл новым, знает только он (повтор той же пачки не считается),
   * и вычесть длину списка значило бы показать меньше, чем есть.
   * Актуальное число приезжает следующим `loadChatUnread`.
   */
  markChatSeen: async (messageIds) => {
    const ids = (messageIds ?? []).filter(Boolean);
    if (ids.length === 0 || !currentUserId()) return 0;
    const { data, error } = await erpQuery(
      () => supabase.rpc('erp_chat_mark_seen', { p_message_ids: ids }),
    );
    // Молча: отметка о просмотре — фон, и полоса поверх переписки на каждый
    // промах сети была бы хуже пропущенного счётчика
    if (error) return 0;
    return Number(data ?? 0);
  },

  /**
   * КТО ПРОЧИТАЛ (правка 20.09, п. 4) — для «Прочитали N» с именами
   * и временем. Точечно, по требованию: список читателей нужен ровно тогда,
   * когда на счётчик нажали, и возить его вместе с лентой незачем.
   */
  loadChatReadReceipts: async (messageIds) => {
    const ids = (messageIds ?? []).filter(Boolean);
    if (ids.length === 0) return [];
    const { data, error } = await erpRead(
      () => supabase.rpc('erp_chat_read_receipts', { p_message_ids: ids }),
    );
    if (error) {
      erpError('Не удалось узнать, кто прочитал', error);
      return [];
    }
    return (data ?? []) as ChatReadReceipt[];
  },

  /** Текущий режим уведомлений по заказу; сервер по умолчанию отдаёт `mentions` */
  loadChatMode: async (orderId) => {
    const { data, error } = await erpRead(
      () => supabase.rpc('erp_chat_mode', { p_order_id: orderId }),
    );
    // Fail-open: не узнали — показываем умолчание, а не пустой селект.
    // Полоса поверх окна ради подписи в шапке была бы хуже
    if (error) return 'mentions';
    return (data as string) ?? 'mentions';
  },

  setChatMode: async (orderId, mode) => {
    const { error } = await erpQuery(
      () => supabase.rpc('erp_chat_set_mode', { p_order_id: orderId, p_mode: mode }),
    );
    if (error) {
      erpError('Не удалось изменить режим уведомлений', error);
      return false;
    }
    return true;
  },

  loadChatUnreadMany: async (orderIds) => {
    const ids = (orderIds ?? []).filter(Boolean);
    if (ids.length === 0 || !currentUserId()) return;
    const { data, error } = await erpRead(
      () => supabase.rpc('erp_chat_unread_many', { p_order_ids: ids }),
    );
    // Fail-open и молча: счётчик в списке — подсказка, а не работа.
    // Полоса поверх списка заказов из-за неё была бы хуже её отсутствия
    if (error) return;
    const rows = (data ?? {}) as Record<string, number>;
    const next = { ...get().chatUnread };
    for (const id of ids) {
      const total = rows[id] ?? 0;
      // Разбивку по задачам здесь НЕ трогаем: её считает `loadChatUnread`
      // для открытой сделки, и обнулять её списком значило бы стереть
      // счётчики задач у открытой рядом карточки
      next[id] = { ...(next[id] ?? { byStage: {} }), total } as ChatUnread;
    }
    set({ chatUnread: next });
  },

  markChatRead: async (orderId, stageId = null) => {
    if (!currentUserId()) return;
    const before = get().chatUnread[orderId];
    if (before) {
      set({
        chatUnread: {
          ...get().chatUnread,
          [orderId]: stageId
            ? { total: before.total, byStage: { ...before.byStage, [stageId]: 0 } }
            : { total: 0, byStage: {} },
        },
      });
    }
    const { error } = await erpQuery(() => supabase.rpc('erp_chat_mark_read', {
      p_order_id: orderId,
      p_stage_id: stageId,
    }));
    if (error) {
      // Молча: отметка прочтения — не действие человека, а следствие того,
      // что он посмотрел. Полоса об её отказе объясняла бы то, чего он
      // не делал. Правду вернёт следующий пересчёт
      if (before) set({ chatUnread: { ...get().chatUnread, [orderId]: before } });
      return;
    }
    await get().loadChatUnread(orderId);
  },

  closeChat: () => set({
    chatOrderId: null,
    chatContext: {} as ChatContext,
    chatMessages: [],
    chatHasMore: false,
    chatLoading: false,
    chatError: null,
  }),
});
