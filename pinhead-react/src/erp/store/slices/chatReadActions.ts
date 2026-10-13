/**
 * ПРОЧТЕНИЕ И СЧЁТЧИКИ ЧАТА — счётчики непрочитанного, отметка просмотра,
 * «Прочитали N», режим уведомлений по заказу.
 *
 * Вынесены из `chatSlice` (ратчет размера: новый модуль ≤ 500 строк, правка
 * 01.10, п. 4) и подмешиваются в него: контракт `ChatSlice` не меняется.
 */
import { supabase } from '../../../lib/supabase';
import type { ChatReadReceipt, ChatUnread } from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import type { ChatSlice, ErpStore } from '../types';

type Set = (partial: Partial<ErpStore> | ((s: ErpStore) => Partial<ErpStore>)) => void;
type Get = () => ErpStore;

export function chatReadActions(set: Set, get: Get): Pick<ChatSlice,
  'loadChatUnread' | 'markChatSeen' | 'loadChatReadReceipts' | 'loadChatMode'
  | 'setChatMode' | 'loadChatUnreadMany' | 'markChatRead'> {
  return {
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
      /**
       * Тот же вызов погасил на сервере уведомления об этих сообщениях
       * (правка 01.10, п. 4) — колокол гасится в памяти сразу, без второго
       * запроса. По ВСЕМ отправленным, а не по числу новых строк: строка
       * просмотра могла быть и раньше, а уведомление — гореть до сих пор.
       */
      get().noteMessagesSeen(ids);
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
  };
}
