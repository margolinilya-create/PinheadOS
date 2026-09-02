/**
 * Слайс realtime: точечное применение postgres_changes + подписка на канал.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита). Таймер debounce полной
 * перезагрузки держится локально в модуле (реассайнится, чистится при отписке).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type { ErpItemStage, ErpOrder } from '../../types';
import {
  _pendingMutations,
  REALTIME_DEFER_MS,
  REALTIME_DEFER_ATTEMPTS,
  FULL_RELOAD_DEBOUNCE_MS,
} from '../shared';
import { findStage, patchStageIn, withNewWorkToast } from '../orderHelpers';
import { flushQueue } from '../offlineQueue';
import type { ErpOrderFull, ErpStore, RealtimeSlice } from '../types';

/** Таймер debounce полной перезагрузки (реассайнится здесь — держим локально) */
let fullReloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Переподключение канала.
 *
 * До 22.08 у `.subscribe()` не было обработчика статуса ВООБЩЕ: `CHANNEL_ERROR`
 * и `TIMED_OUT` не ловились ничем, а слушателей `visibilitychange`/`online`/
 * `focus` в проекте не было ни одного. Планшет цеха, ушедший в сон или
 * потерявший Wi-Fi, возвращался с молча устаревшей очередью — и распознать
 * это человек не мог в принципе: экран выглядит рабочим, просто показывает
 * позавчерашнюю работу.
 *
 * Шаги растут до минуты и не дольше: цех смотрит в очередь постоянно, и
 * получасовое ожидание переподключения для него то же самое, что его отсутствие.
 */
export const RECONNECT_STEPS_MS = [1000, 2000, 5000, 10000, 30000, 60000];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
}

/** Дочерние массивы заказа, обновляемые точечно по realtime (не трогая этапы) */
type ChildKey =
  | 'materials' | 'procurement_tasks' | 'warehouse_ops' | 'warehouse_tasks'
  | 'tz_documents' | 'developments';
const TABLE_TO_CHILD: Record<string, ChildKey> = {
  erp_materials: 'materials',
  erp_procurement_tasks: 'procurement_tasks',
  erp_warehouse_ops: 'warehouse_ops',
  erp_warehouse_tasks: 'warehouse_tasks',
  // ТЗ: замена файла должна долетать до открытого задания цеха
  erp_tz_documents: 'tz_documents',
};

/**
 * Дочерние таблицы, изменение которых может СДЕЛАТЬ этап готовым к запуску
 * (материальный гейт, гейт закупки, гейт ТЗ). Только для них имеет смысл считать
 * «в вашем цехе появилась новая работа»: пересчёт обходит все заказы дважды,
 * и вешать его на складские события — чистая трата на каждом переходе этапа.
 */
const AFFECTS_READINESS = new Set<ChildKey>(['materials', 'procurement_tasks', 'tz_documents']);

/**
 * Точечный upsert/удаление дочерней строки заказа (материал/закупка/склад).
 * Раньше эти события вызывали полный loadOne заказа — а он затирал оптимистичные
 * мутации ЭТАПОВ, если прилетал во время незавершённой мутации (регрессия волны 4.1:
 * триггер складских задач шлёт события на каждом переходе этапа). Точечный патч
 * массива готовность этапов не ломает (она считается из материалов при рендере).
 */
function upsertChildRow(
  order: ErpOrderFull, key: ChildKey, row: Record<string, unknown>, id: string, eventType: string,
): ErpOrderFull {
  const list = (order[key] ?? []) as { id: string }[];
  let next: unknown[];
  if (eventType === 'DELETE') next = list.filter((r) => r.id !== id);
  else if (list.some((r) => r.id === id)) next = list.map((r) => (r.id === id ? { ...r, ...row } : r));
  else next = [...list, row];
  return { ...order, [key]: next };
}

export const realtimeSlice: StateCreator<ErpStore, [], [], RealtimeSlice> = (set, get) => ({
  /**
   * Живой ли канал. `true` по умолчанию — до первой подписки говорить «связи
   * нет» неправда, а полоса «данные могли устареть» на пустом экране пугает
   * там, где ничего ещё не грузилось.
   */
  realtimeLive: true,

  /** Идёт перечитывание после разрыва — полоса говорит «обновляем», а не «всё плохо» */
  realtimeResyncing: false,

  /**
   * Перечитать данные после разрыва.
   *
   * Зовётся из трёх мест: возврат вкладки, появление сети, восстановление
   * канала. Всё это — «мы не знаем, что произошло, пока нас не было», и ответ
   * один: спросить сервер заново. `loadAll` намеренно без guard'а от повторного
   * вызова (правило в `ordersSlice`), поэтому лишний вызов безопаснее пропуска.
   */
  resyncRealtime: async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    set({ realtimeResyncing: true });
    try {
      /**
       * Сначала отдать накопленное, потом читать. Обратный порядок показал бы
       * человеку состояние БЕЗ его же приёмок, сделанных без связи, — и он
       * ввёл бы их заново, теперь уже вторым приходом.
       */
      await flushQueue();
      await get().loadAll();
      set({ realtimeLive: true });
    } finally {
      // В `finally`: сбой перезагрузки не должен оставить полосу «обновляем…»
      // навсегда — это ровно тот вечный индикатор, от которого её и ставят
      set({ realtimeResyncing: false });
    }
  },

  applyRealtimeEvent: (ev) => {
    const row = (ev.eventType === 'DELETE' ? ev.old : ev.new) ?? {};
    const id = row.id as string | undefined;

    // Последний fallback: точечно применить нельзя — debounced полная перезагрузка
    const scheduleFullReload = () => {
      if (fullReloadTimer) clearTimeout(fullReloadTimer);
      fullReloadTimer = setTimeout(() => {
        fullReloadTimer = null;
        void withNewWorkToast(get, () => get().loadAll());
      }, FULL_RELOAD_DEBOUNCE_MS);
    };
    if (!id) {
      scheduleFullReload();
      return;
    }

    // Материалы/закупка/склад: точечный upsert в массив заказа, БЕЗ полного loadOne
    // (loadOne затирал бы оптимистичные мутации этапов — «откат»/«перескок»).
    const childKey = TABLE_TO_CHILD[ev.table];
    if (childKey) {
      const orderId = (row.order_id ?? null) as string | null;
      if (orderId && get().orders.some((o) => o.id === orderId)) {
        const apply = () => {
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === orderId
                ? upsertChildRow(o, childKey, row as Record<string, unknown>, id, ev.eventType)
                : o),
          }));
        };
        // Материалы/закупка/ТЗ влияют на готовность этапов → проверяем, не появилась ли
        // работа. Складские таблицы на готовность не влияют — комментарий говорил это
        // и раньше, но код всё равно гонял двойной обход всех заказов на каждое их
        // событие, а триггер складских задач шлёт события на КАЖДОМ переходе этапа.
        if (AFFECTS_READINESS.has(childKey)) void withNewWorkToast(get, apply);
        else apply();
      }
      return;
    }
    if (ev.table === 'erp_subcontracting') {
      if (get().subcontractingLoaded) void get().loadSubcontracting();
      return;
    }
    /**
     * Разработка, её задачи и старые операции.
     *
     * `erp_experimental_tasks` подписаны обязательно: статус задачи, ушедшей
     * в цех, ведёт ТРИГГЕР — цех закрывает этап у себя, и без подписки
     * открытая карточка разработки показывала бы старое состояние до
     * перезагрузки руками. Это ровно тот дефект, который чинится всей волной.
     */
    if (ev.table === 'erp_experimental' || ev.table === 'erp_experimental_tasks') {
      /**
       * ЭМБЕД РАЗРАБОТКИ В ЗАКАЗЕ — ВТОРАЯ КОПИЯ ТЕХ ЖЕ СТРОК (правки 02.09).
       *
       * `loadExperimental()` перечитывает `s.experimental`, а гейт отгрузки
       * (`utils/stageUi.openDevelopments`) судит по `order.developments` —
       * эмбеду, который приезжает с самим заказом. Без этой строки кладовщик
       * в открытой вкладке продолжал бы видеть «разработка не завершена»
       * после того, как её завершили, и кнопка отгрузки не появилась бы
       * до перезагрузки руками.
       *
       * Патч стоит ЗДЕСЬ, а не в `TABLE_TO_CHILD`: та ветка выше и делает
       * `return` — доска ЭКС перестала бы обновляться вовсе.
       */
      if (ev.table === 'erp_experimental') {
        const orderId = (row.order_id ?? null) as string | null;
        if (orderId && get().orders.some((o) => o.id === orderId)) {
          set((st) => ({
            orders: st.orders.map((o) => (o.id === orderId
              ? upsertChildRow(
                o, 'developments', row as Record<string, unknown>, id, ev.eventType)
              : o)),
          }));
        }
      }
      if (get().experimentalLoaded) void get().loadExperimental();
      return;
    }

    /**
     * Защита от race (п.29): по сущности идёт мутация — отложить событие и применить,
     * когда ключ снят (иначе состояние выправит ответ сервера).
     *
     * Попыток несколько, а не одна. Прежде отсрочка была одноразовой: если через
     * секунду запрос ещё не вернулся — а на цеховом Wi-Fi это обычное дело, —
     * событие ПРОПАДАЛО навсегда. Своя мутация такое переживает (её ответ и так
     * запишется в стор), а вот чужая правка того же этапа тихо терялась, и на
     * экране оставалось состояние, которого в базе уже нет, до следующего события.
     */
    const key = ev.table === 'erp_item_stages' ? `stage:${id}` : `order:${id}`;
    if (_pendingMutations.has(key)) {
      const attempt = (left: number) => {
        setTimeout(() => {
          if (!_pendingMutations.has(key)) get().applyRealtimeEvent(ev);
          else if (left > 0) attempt(left - 1);
        }, REALTIME_DEFER_MS);
      };
      attempt(REALTIME_DEFER_ATTEMPTS - 1);
      return;
    }

    if (ev.table === 'erp_item_stages') {
      if (ev.eventType === 'UPDATE') {
        // Точечная замена этапа; этап незагруженного (архивного) заказа — мимо
        if (!findStage(get().orders, id)) return;
        void withNewWorkToast(get, () => {
          set((s) => ({ orders: patchStageIn(s.orders, id, row as Partial<ErpItemStage>) }));
        });
        return;
      }
      if (ev.eventType === 'DELETE') {
        const found = findStage(get().orders, id);
        if (!found) return;
        set((s) => ({
          orders: s.orders.map((o) =>
            o.id !== found.order.id
              ? o
              : {
                  ...o,
                  items: o.items.map((it) => ({
                    ...it,
                    stages: it.stages.filter((st) => st.id !== id),
                  })),
                }),
        }));
        return;
      }
      // INSERT этапа: точечно не применить — перезагрузим один заказ, если позиция наша
      // (этапы новых заказов придут вместе с INSERT erp_orders → loadOne там)
      const itemId = (ev.new?.item_id ?? null) as string | null;
      const order = itemId
        ? get().orders.find((o) => o.items.some((it) => it.id === itemId))
        : null;
      if (order) void withNewWorkToast(get, () => get().loadOne(order.id));
      return;
    }

    if (ev.table === 'erp_orders') {
      if (ev.eventType === 'DELETE') {
        set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
        return;
      }
      const existing = get().orders.find((o) => o.id === id);
      if (ev.eventType === 'UPDATE' && existing) {
        // merge полей заказа — вложенные items/materials/attachments не затираются
        void withNewWorkToast(get, () => {
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === id ? { ...o, ...(row as Partial<ErpOrder>) } : o),
          }));
        });
        return;
      }
      // INSERT нового заказа (или UPDATE незагруженного) → перезагрузка одного по id.
      // Незагруженный неактивный заказ при незагруженном архиве не тянем — не нужен.
      const status = (ev.new?.status ?? 'active') as string;
      // Тестовый заказ при выключенном показе не втягиваем: списочные запросы
      // его отсекают, и realtime вернул бы через заднюю дверь ровно то,
      // что человек попросил спрятать.
      if (ev.new?.is_demo === true && !get().showDemoOrders) return;
      if (status === 'active' || get().archiveLoaded) {
        void withNewWorkToast(get, () => get().loadOne(id));
      }
      return;
    }

    /**
     * Аварийно снятые блокировки (правки 10.08).
     *
     * Снятие и возврат проверки обязаны доходить до цеха немедленно: человек
     * в цехе смотрит на очередь и должен увидеть, что задание запустилось —
     * или что проверку вернули и работать по обходному сценарию больше нельзя.
     * Список маленький, поэтому перечитываем его целиком, а не патчим точечно.
     */
    if (ev.table === 'erp_bypasses') {
      void get().loadBypasses();
      return;
    }

    // Неизвестная таблица — старый путь
    scheduleFullReload();
  },

  subscribeRealtime: () => {
    /**
     * Отписка канала, ЗАМЕНИВШЕГО этот при переподключении. Объявлена до самого
     * канала намеренно: обработчик статуса ссылается на неё, а выполняется он
     * позже конструирования.
     */
    let cleanupNext: (() => void) | null = null;
    // Уникальное имя канала (паттерн kontora24); события применяются точечно (п.27)
    const forward = (table: string) => (payload: {
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      get().applyRealtimeEvent({
        table,
        eventType: payload.eventType,
        new: payload.new ?? null,
        old: payload.old ?? null,
      });
    };
    const channel = supabase
      .channel(`erp-live-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_item_stages' },
        forward('erp_item_stages'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_orders' },
        forward('erp_orders'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_materials' },
        forward('erp_materials'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_procurement_tasks' },
        forward('erp_procurement_tasks'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_subcontracting' },
        forward('erp_subcontracting'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_warehouse_ops' },
        forward('erp_warehouse_ops'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_warehouse_tasks' },
        forward('erp_warehouse_tasks'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_experimental' },
        forward('erp_experimental'),
      )
      /**
       * Задачи разработки: их статус пишет триггер при закрытии этапа цехом.
       * Подписка и обработчик заводятся ВМЕСТЕ — расхождение сторожит
       * `realtimeCoverage.test.ts`.
       */
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_experimental_tasks' },
        forward('erp_experimental_tasks'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_tz_documents' },
        forward('erp_tz_documents'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'erp_bypasses' },
        forward('erp_bypasses'),
      )
      /**
       * Обработчик статуса. Его здесь не было вовсе, и это главный пробел
       * реалтайма: разрыв канала не давал ни события, ни признака — экран
       * просто переставал обновляться.
       */
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          const wasDown = !get().realtimeLive;
          clearReconnect();
          set({ realtimeLive: true });
          // Пока канала не было, в базе что-то произошло — событий об этом
          // не придёт никогда, их можно только запросить заново
          if (wasDown) void get().resyncRealtime();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          set({ realtimeLive: false });
          if (reconnectTimer) return;
          const delay = RECONNECT_STEPS_MS[
            Math.min(reconnectAttempt, RECONNECT_STEPS_MS.length - 1)];
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            // Канал пересоздаётся целиком: у оборванного `subscribe()` повторно
            // не вызывают — supabase-js держит его в терминальном состоянии
            supabase.removeChannel(channel);
            const next = get().subscribeRealtime();
            cleanupNext = next;
          }, delay);
        }
      });

    /**
     * Возврат к экрану и появление сети — те же «нас не было»: канал мог
     * пережить сон вкладки, а мог и нет, и полагаться на его статус нельзя.
     * Слушателей `visibilitychange`/`online`/`focus` в проекте не было ни
     * одного, поэтому планшет после сна показывал устаревшую очередь молча.
     */
    const onWake = () => { void get().resyncRealtime(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onWake);
      window.addEventListener('focus', onWake);
      document.addEventListener('visibilitychange', onWake);
    }

    return () => {
      if (fullReloadTimer) {
        clearTimeout(fullReloadTimer);
        fullReloadTimer = null;
      }
      clearReconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onWake);
        window.removeEventListener('focus', onWake);
        document.removeEventListener('visibilitychange', onWake);
      }
      // Канал мог быть пересоздан переподключением — отписываем ТОТ, что живёт
      if (cleanupNext) cleanupNext();
      else supabase.removeChannel(channel);
    };
  },
});
