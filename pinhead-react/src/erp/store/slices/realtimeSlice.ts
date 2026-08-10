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
import type { ErpOrderFull, ErpStore, RealtimeSlice } from '../types';

/** Таймер debounce полной перезагрузки (реассайнится здесь — держим локально) */
let fullReloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Дочерние массивы заказа, обновляемые точечно по realtime (не трогая этапы) */
type ChildKey =
  | 'materials' | 'procurement_tasks' | 'warehouse_ops' | 'warehouse_tasks'
  | 'tz_documents';
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
    if (ev.table === 'erp_experimental' || ev.table === 'erp_experimental_ops') {
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
      .subscribe();
    return () => {
      if (fullReloadTimer) {
        clearTimeout(fullReloadTimer);
        fullReloadTimer = null;
      }
      supabase.removeChannel(channel);
    };
  },
});
