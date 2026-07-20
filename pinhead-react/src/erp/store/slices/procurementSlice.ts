/**
 * Слайс задач закупки: дозакупка/замена при возврате брака (не трогает исходную закупку).
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpProcurementTask } from '../../types';
import type { ErpStore, ProcurementSlice } from '../types';

export const procurementSlice: StateCreator<ErpStore, [], [], ProcurementSlice> = (set, get) => ({
  createProcurementTask: async (orderId, task) => {
    // Правка 2: брак поставщика → замена (не считается закупкой компании);
    // прочие причины → дозакупка (внутренняя ошибка).
    // Аудит (A5): вычисляемые kind/counts_as_purchase идут ПОСЛЕ ...task —
    // вызывающий не может их переопределить (сервер также форсит их триггером).
    const isSupplier = task.cause_type === 'supplier_defect';
    const row0 = {
      status: 'new',
      ...task,
      kind: isSupplier ? 'replacement' : 'restock',
      counts_as_purchase: !isSupplier,
      order_id: orderId,
    };
    const { data, error } = await supabase
      .from('erp_procurement_tasks')
      .insert(row0)
      .select();
    const row = data?.[0] as ErpProcurementTask | undefined;
    if (error || !row) {
      toast.error('Не удалось создать задачу закупки');
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, procurement_tasks: [...(o.procurement_tasks ?? []), row] }
          : o),
    }));
    return row;
  },

  updateProcurementTask: async (id, patch) => {
    const prev = get().orders;
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        procurement_tasks: (o.procurement_tasks ?? []).map((t) =>
          t.id === id ? { ...t, ...patch } : t),
      })),
    }));
    const { error } = await supabase.from('erp_procurement_tasks').update(patch).eq('id', id);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить задачу закупки');
      return false;
    }
    return true;
  },
});
