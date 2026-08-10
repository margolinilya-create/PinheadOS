/**
 * Слайс экспериментального цеха (правка 6): отдельная воронка разработки со стейт-машиной
 * фаз (лекала → проработка → финальная примерка → готово, с возвратами). Передачи в швейку/
 * на нанесения — erp_experimental_ops; по возврату операции заказ авто-возвращается на «Проработку».
 * Ленивая загрузка по вкладке (как subcontractingSlice).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpExperimental, ErpExperimentalOp } from '../../types';
import type { ErpStore, ExperimentalSlice } from '../types';
import { factoryToday } from '../../../utils/date';

const EXP_SELECT = '*, ops:erp_experimental_ops (*), order:erp_orders (title, bitrix_id)';

export const experimentalSlice: StateCreator<ErpStore, [], [], ExperimentalSlice> = (set, get) => ({
  experimental: [],
  experimentalLoaded: false,

  loadExperimental: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental')
      .select(EXP_SELECT)
      .order('created_at', { ascending: false }));
    if (error) {
      toast.error('Не удалось загрузить экспериментальный цех');
      return;
    }
    set({ experimental: (data ?? []) as ErpExperimental[], experimentalLoaded: true });
  },

  createExperimental: async (orderId) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental')
      .insert({ order_id: orderId, phase: 'patterns' })
      .select(EXP_SELECT));
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
    const { error } = await erpQuery(() => supabase.from('erp_experimental').update(patch).eq('id', id));
    if (error) {
      set({ experimental: prev });
      toast.error('Не удалось обновить эксперим. разработку');
      return false;
    }
    return true;
  },

  /**
   * Передача образца в цех (волна 3.6).
   *
   * Кроме записи в разработке создаёт НАСТОЯЩИЙ ЭТАП — и это главное здесь.
   * Раньше передача жила только в `erp_experimental_ops`, и цех её не видел:
   * в очередь попадают `erp_item_stages`. Технолог отмечал «передал», цех
   * узнавал голосом, а в плане этой работы не существовало.
   *
   * Этап заводится в следующем свободном `cycle` — образец ходит в один и тот же
   * цех многократно, и до волны 3.0 это запрещал `unique (item_id, department_id)`.
   * Именно он и был причиной, по которой эксп. цех моделировали отдельно.
   *
   * Если цех не указан (фаза без цеха — лекала, подбор материалов, примерка),
   * этап не создаётся: не всякая работа разработки проходит через участок.
   */
  createExperimentalOp: async (experimentalId, op) => {
    let stageId: string | null = null;
    if (op.department_id && op.item_id) {
      const { data: stage, error: stageError } = await erpQuery(() => supabase
        .rpc('erp_experimental_send_to_dept', {
          p_item_id: op.item_id,
          p_department_id: op.department_id,
          p_planned_end: op.planned_date ?? null,
        }));
      if (stageError || !stage) {
        erpError('Образец не поставлен в очередь цеха', stageError);
        return null;
      }
      stageId = (stage as { id: string }).id;
    }

    const { department_id: _dept, item_id: _item, ...opFields } = op;
    const { data, error } = await erpQuery(() => supabase
      .from('erp_experimental_ops')
      .insert({ status: 'sent', ...opFields, stage_id: stageId, experimental_id: experimentalId })
      .select());
    const row = data?.[0] as ErpExperimentalOp | undefined;
    if (error || !row) {
      erpError('Не удалось создать передачу', error);
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
    const returned_at = factoryToday();
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
