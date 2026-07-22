/**
 * Слайс материалов: добавление/правка, подтверждение склада, авто-закрытие закупки.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 * maybeCloseSupply/confirmStockMaterial зовут действия других слайсов через get().
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpMaterial } from '../../types';
import type { ErpStore, MaterialsSlice } from '../types';

export const materialsSlice: StateCreator<ErpStore, [], [], MaterialsSlice> = (set, get) => ({
  addMaterial: async (orderId, material) => {
    const { data, error } = await supabase
      .from('erp_materials')
      .insert({ ...material, order_id: orderId })
      .select();
    const row = data?.[0] as ErpMaterial | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить материал');
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId ? { ...o, materials: [...o.materials, row] } : o),
    }));
    // Правка 4: добавление сразу-готового материала тоже должно закрывать этап «Закупка»
    await get().maybeCloseSupply(orderId);
    return row;
  },

  updateMaterial: async (id, patch) => {
    const prev = get().orders;
    set((s) => ({
      orders: s.orders.map((o) => ({
        ...o,
        materials: o.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    }));
    const { error } = await supabase.from('erp_materials').update(patch).eq('id', id);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить материал');
      return false;
    }
    const order = get().orders.find((o) => o.materials.some((m) => m.id === id));
    if (order) await get().maybeCloseSupply(order.id);
    return true;
  },

  confirmStockMaterial: async (id) => {
    // Материал со склада: подтверждение наличия → «Доступен со склада» (reserved)
    const ok = await get().updateMaterial(id, {
      status: 'reserved',
      received_at: new Date().toISOString().slice(0, 10),
    });
    return ok;
  },

  maybeCloseSupply: async (orderId) => {
    const order = get().orders.find((o) => o.id === orderId);
    const supplyDept = get().departments.find((d) => d.code === 'supply');
    if (!order || !supplyDept) return;
    // «Готов» = пришло / зарезервировано со склада / не требуется.
    // length>0 — не закрывать закупку у заказа вовсе без материалов (аудит, LOW).
    const allIn = order.materials.length > 0 && order.materials.every(
      (m) => m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed');
    if (!allIn) return;
    // Правка 4.1.3: плановое кол-во (qty_expected) — обязательная графа закупки. Без него
    // сделка не идёт дальше (иначе на приёмке склад не увидит план). Гейтим только закупаемые.
    const missingPlan = order.materials.filter(
      (m) => m.source === 'purchase' && (m.qty_expected == null || m.qty_expected <= 0));
    if (missingPlan.length > 0) {
      toast.warning(`Укажите плановое кол-во в закупке: ${missingPlan.map((m) => m.name).join(', ')}`);
      return;
    }
    const openSupply = order.items.flatMap((it) =>
      it.stages.filter(
        (st) => st.department_id === supplyDept.id &&
          st.status !== 'done' && st.status !== 'skipped'));
    for (const st of openSupply) {
      await get().setStageStatus(st.id, 'done', { comment: 'Материалы готовы — закупка закрыта автоматически' });
    }
    if (openSupply.length > 0) toast.success('Материалы готовы — закупка по заказу закрыта');
  },
});
