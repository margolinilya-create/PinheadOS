/**
 * Слайс подряда: операции у внешних подрядчиков (ленивая загрузка по вкладке).
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpSubcontractOp } from '../../types';
import type { ErpStore, SubcontractingSlice } from '../types';

export const subcontractingSlice: StateCreator<ErpStore, [], [], SubcontractingSlice> = (set, get) => ({
  subcontracting: [],
  subcontractingLoaded: false,

  loadSubcontracting: async () => {
    const { data, error } = await supabase
      .from('erp_subcontracting')
      .select('*, order:erp_orders (title, bitrix_id)')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Не удалось загрузить операции подряда');
      return;
    }
    set({ subcontracting: (data ?? []) as ErpSubcontractOp[], subcontractingLoaded: true });
  },

  createSubcontractOp: async (op) => {
    const { data, error } = await supabase
      .from('erp_subcontracting')
      .insert({ status: 'planned', ...op })
      .select('*, order:erp_orders (title, bitrix_id)');
    const row = data?.[0] as ErpSubcontractOp | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить операцию подряда');
      return null;
    }
    set((s) => ({ subcontracting: [row, ...s.subcontracting] }));
    return row;
  },

  updateSubcontractOp: async (id, patch) => {
    const prev = get().subcontracting;
    set((s) => ({
      subcontracting: s.subcontracting.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    const { error } = await supabase.from('erp_subcontracting').update(patch).eq('id', id);
    if (error) {
      set({ subcontracting: prev });
      toast.error('Не удалось обновить операцию подряда');
      return false;
    }
    return true;
  },
});
