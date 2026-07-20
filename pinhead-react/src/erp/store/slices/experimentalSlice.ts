/**
 * Слайс экспериментального цеха (правка 6): отдельная воронка разработки со стейт-машиной
 * фаз (лекала → проработка → финальная примерка → готово, с возвратами). Передачи в швейку/
 * на нанесения — erp_experimental_ops; по возврату операции заказ авто-возвращается на «Проработку».
 * Ленивая загрузка по вкладке (как subcontractingSlice).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpExperimental, ErpExperimentalOp } from '../../types';
import type { ErpStore, ExperimentalSlice } from '../types';

const EXP_SELECT = '*, ops:erp_experimental_ops (*), order:erp_orders (title, bitrix_id)';

export const experimentalSlice: StateCreator<ErpStore, [], [], ExperimentalSlice> = (set, get) => ({
  experimental: [],
  experimentalLoaded: false,

  loadExperimental: async () => {
    const { data, error } = await supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Не удалось загрузить экспериментальный цех');
      return;
    }
    set({ experimental: (data ?? []) as ErpExperimental[], experimentalLoaded: true });
  },

  createExperimental: async (orderId) => {
    const { data, error } = await supabase
      .from('erp_experimental')
      .insert({ order_id: orderId, phase: 'patterns' })
      .select(EXP_SELECT);
    const row = data?.[0] as ErpExperimental | undefined;
    if (error || !row) {
      toast.error('Не удалось создать эксперим. разработку');
      return null;
    }
    set((s) => ({ experimental: [row, ...s.experimental] }));
    return row;
  },

  updateExperimental: async (id, patch) => {
    const prev = get().experimental;
    set((s) => ({ experimental: s.experimental.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    const { error } = await supabase.from('erp_experimental').update(patch).eq('id', id);
    if (error) {
      set({ experimental: prev });
      toast.error('Не удалось обновить эксперим. разработку');
      return false;
    }
    return true;
  },

  createExperimentalOp: async (experimentalId, op) => {
    const { data, error } = await supabase
      .from('erp_experimental_ops')
      .insert({ status: 'sent', ...op, experimental_id: experimentalId })
      .select();
    const row = data?.[0] as ErpExperimentalOp | undefined;
    if (error || !row) {
      toast.error('Не удалось создать передачу');
      return null;
    }
    set((s) => ({
      experimental: s.experimental.map((e) =>
        e.id === experimentalId ? { ...e, ops: [...(e.ops ?? []), row] } : e),
    }));
    return row;
  },

  completeExperimentalOp: async (opId) => {
    const prev = get().experimental;
    const exp = prev.find((e) => (e.ops ?? []).some((o) => o.id === opId));
    if (!exp) return false;
    const returned_at = new Date().toISOString().slice(0, 10);
    // Операция возвращена + заказ авто-возвращается на «Проработку»
    set((s) => ({
      experimental: s.experimental.map((e) =>
        e.id !== exp.id
          ? e
          : {
              ...e,
              phase: 'development',
              ops: (e.ops ?? []).map((o) =>
                o.id === opId ? { ...o, status: 'returned', returned_at } : o),
            }),
    }));
    const [opRes, expRes] = await Promise.all([
      supabase.from('erp_experimental_ops').update({ status: 'returned', returned_at }).eq('id', opId),
      supabase.from('erp_experimental').update({ phase: 'development' }).eq('id', exp.id),
    ]);
    if (opRes.error || expRes.error) {
      set({ experimental: prev });
      toast.error('Не удалось завершить передачу');
      return false;
    }
    return true;
  },
});
