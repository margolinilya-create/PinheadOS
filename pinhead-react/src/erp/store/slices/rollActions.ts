/**
 * ДЕЙСТВИЯ С РУЛОНАМИ ТКАНИ — судьба остатка, параметры для учёта в метрах,
 * место хранения, остатки по всем заказам (правки 27.09 и 28.09).
 *
 * Вынесены из `materialsSlice` (ратчет размера: новый модуль ≤ 500 строк)
 * и подмешиваются в него: контракт `MaterialsSlice` не меняется.
 */
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpStore, FabricLeftoverRow, MaterialsSlice } from '../types';

type Set = (partial: Partial<ErpStore> | ((s: ErpStore) => Partial<ErpStore>)) => void;
type Get = () => ErpStore;

export function rollActions(set: Set, get: Get): Pick<MaterialsSlice,
  'setRollLeftover' | 'setRollLocation' | 'loadFabricLeftovers' | 'loadOrderForeignRolls' | 'setRollParams'
  | 'finishRoll'> {
  return {
    setRollLeftover: async (rollId, kind, itemId) => {
      if (kind !== 'usable' && kind !== 'scrap') return false;
      /**
       * RPC, а не прямой UPDATE (правка 28.09): малый остаток обязан стать
       * СПИСАНИЕМ со стоимостью на позицию — «списывается отдельно как
       * непригодный, а не исчезает из учёта». Прямая запись вида этого
       * не делала, и стоимость остатка терялась для экономики.
       */
      const { error } = await erpQuery(() => supabase.rpc('erp_roll_set_leftover', {
        p_roll_id: rollId, p_kind: kind, p_item_id: itemId ?? null,
      }));
      if (error) {
        erpError('Остаток рулона не записан', error);
        return false;
      }
      // Не optimistic: судьба остатка — необратимое решение, и показать его
      // записанным раньше ответа сервера значило бы соврать закройщику
      set((s) => ({
        orders: s.orders.map((o) => ({
          ...o,
          materials: o.materials.map((m) => ({
            ...m,
            rolls: (m.rolls ?? []).map((r) => (
              r.id === rollId ? { ...r, leftover_kind: kind, status: 'used' as const } : r)),
          })),
        })),
        fabricLeftovers: null,
      }));
      toast.success(kind === 'usable'
        ? 'Остаток записан как пригодный — он появится в «Остатках ткани»'
        : 'Малый остаток списан на позицию');
      return true;
    },

    setRollLocation: async (rollId, location) => {
      const { error } = await erpQuery(() => supabase.rpc('erp_material_roll_set_location', {
        p_roll_id: rollId, p_location: location,
      }));
      if (error) {
        erpError('Место хранения не записано', error);
        return false;
      }
      const value = (location ?? '').trim() || null;
      set((s) => ({
        orders: s.orders.map((o) => ({
          ...o,
          materials: o.materials.map((m) => ({
            ...m,
            rolls: (m.rolls ?? []).map((r) => (r.id === rollId ? { ...r, location: value } : r)),
          })),
        })),
        fabricLeftovers: (s.fabricLeftovers ?? null)?.map((r) => (
          r.roll_id === rollId ? { ...r, location: value } : r)) ?? null,
      }));
      toast.success('Место хранения записано');
      return true;
    },

    loadOrderForeignRolls: async (orderId) => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_order_foreign_rolls', {
        p_order_id: orderId,
      }));
      if (error) {
        erpError('Рулоны других заказов не загрузились', error);
        return null;
      }
      return (data ?? []) as Awaited<ReturnType<MaterialsSlice['loadOrderForeignRolls']>>;
    },

    loadFabricLeftovers: async () => {
      const { data, error } = await erpQuery(() => supabase.rpc('erp_fabric_leftovers'));
      if (error) {
        erpError('Остатки ткани не загрузились', error);
        return null;
      }
      const rows = (data ?? []) as FabricLeftoverRow[];
      set({ fabricLeftovers: rows });
      return rows;
    },

    setRollParams: async (rollId, params) => {
      const order = get().orders.find((o) => o.materials.some(
        (m) => (m.rolls ?? []).some((r) => r.id === rollId)));
      const { error } = await erpQuery(() => supabase.rpc('erp_material_roll_set_params', {
        p_roll_id: rollId,
        p_width_cm: params.width_cm ?? null,
        p_density_gsm: params.density_gsm ?? null,
        p_length_m: params.length_m ?? null,
        p_length_source: params.length_source ?? null,
        p_reason: params.reason ?? null,
        p_weight_kg: params.weight_kg ?? null,
      }));
      if (error) {
        erpError('Параметры рулона не записаны', error);
        return false;
      }
      // Производные (метраж, коэффициент, цена за метр) считает сервер —
      // перечитываем заказ, а не дописываем их в сторе
      if (order) await get().loadOne(order.id);
      set({ fabricLeftovers: null });
      toast.success('Параметры рулона записаны');
      return true;
    },

    /**
     * ЗАВЕРШИТЬ РУЛОН (правка 05.10, п. 5) — отдельно от записи результата.
     * Замер остатка уезжает уточнением полного метража (`utils/rollFinish`:
     * сервер вычтет весь записанный расход и запишет корректировку с причиной),
     * судьба — `erp_roll_set_leftover`. Не optimistic: обе операции необратимы.
     * Упало второе — заказ всё равно перечитывается: повтор увидит остаток
     * уже равным замеру и уточнять повторно не станет.
     */
    finishRoll: async (rollId, { kind, itemId = null, refineLengthM = null, reason = null }) => {
      const order = get().orders.find((o) => o.materials.some(
        (m) => (m.rolls ?? []).some((r) => r.id === rollId)));
      const reload = async () => {
        if (order) await get().loadOne(order.id);
        set({ fabricLeftovers: null });
      };
      if (refineLengthM !== null) {
        const { error } = await erpQuery(() => supabase.rpc('erp_material_roll_set_params', {
          p_roll_id: rollId,
          p_width_cm: null,
          p_density_gsm: null,
          p_length_m: refineLengthM,
          p_length_source: 'measured',
          p_reason: (reason ?? '').trim() || 'Замер остатка при завершении рулона',
          p_weight_kg: null,
        }));
        if (error) {
          erpError('Замер остатка не записан', error);
          return false;
        }
      }
      if (kind) {
        const { error } = await erpQuery(() => supabase.rpc('erp_roll_set_leftover', {
          p_roll_id: rollId, p_kind: kind, p_item_id: itemId ?? null,
        }));
        if (error) {
          erpError('Рулон не завершён', error);
          await reload();
          return false;
        }
      }
      await reload();
      toast.success(kind === 'usable'
        ? 'Рулон завершён: пригодный остаток доступен в «Остатках ткани»'
        : kind === 'scrap' ? 'Рулон завершён: остаток списан в потери ткани' : 'Замер остатка записан');
      return true;
    },
  };
}
