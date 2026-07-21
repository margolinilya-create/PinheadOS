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
  FULL_RELOAD_DEBOUNCE_MS,
} from '../shared';
import { findStage, patchStageIn, withNewWorkToast } from '../orderHelpers';
import type { ErpOrderFull, ErpStore, RealtimeSlice } from '../types';

/** Таймер debounce полной перезагрузки (реассайнится здесь — держим локально) */
let fullReloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Дочерние массивы заказа, обновляемые точечно по realtime (не трогая этапы) */
type ChildKey = 'materials' | 'procurement_tasks' | 'warehouse_ops' | 'warehouse_tasks';
const TABLE_TO_CHILD: Record<string, ChildKey> = {
  erp_materials: 'materials',
  erp_procurement_tasks: 'procurement_tasks',
  erp_warehouse_ops: 'warehouse_ops',
  erp_warehouse_tasks: 'warehouse_tasks',
};

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
        // материалы/закупка влияют на готовность → уведомление о новой работе; склад — нет
        void withNewWorkToast(get, () => {
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === orderId
                ? upsertChildRow(o, childKey, row as Record<string, unknown>, id, ev.eventType)
                : o),
          }));
        });
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

    // Защита от race (п.29): по сущности идёт мутация — отложить событие на ~1с
    // и применить, только если ключ снят (иначе состояние выправит ответ сервера).
    const key = ev.table === 'erp_item_stages' ? `stage:${id}` : `order:${id}`;
    if (_pendingMutations.has(key)) {
      setTimeout(() => {
        if (!_pendingMutations.has(key)) get().applyRealtimeEvent(ev);
      }, REALTIME_DEFER_MS);
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
      if (status === 'active' || get().archiveLoaded) {
        void withNewWorkToast(get, () => get().loadOne(id));
      }
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
