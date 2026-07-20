/**
 * Слайс склада (правки 2, 3): числовая приёмка материалов (план/факт/статус) с записью
 * в историю складских операций, и прочие складские операции (упаковка/отгрузка/маркировка).
 * warehouse_ops приходят join'ом в ORDER_SELECT; здесь оптимистично дописываем строки.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpWarehouseOp } from '../../types';
import { currentActor } from '../shared';
import type { ErpStore, WarehouseSlice } from '../types';

/** Тип складской операции для приёмки по статусу приёмки */
function receiptOpType(acceptStatus: string): ErpWarehouseOp['op_type'] {
  return acceptStatus === 'accepted_partial' ? 'partial_receipt' : 'material_receipt';
}

export const warehouseSlice: StateCreator<ErpStore, [], [], WarehouseSlice> = (set, get) => ({
  acceptMaterial: async (materialId, { qty_received, accept_status, accept_comment = null }) => {
    const order = get().orders.find((o) => o.materials.some((m) => m.id === materialId));
    if (!order) return false;
    // Патч материала (optimistic + rollback + авто-закрытие закупки) — через materialsSlice
    const ok = await get().updateMaterial(materialId, {
      qty_received,
      accept_status,
      accepted_at: new Date().toISOString().slice(0, 10),
      accepted_by: currentActor(),
      accept_comment,
    });
    if (!ok) return false;
    // История склада: строка приёмки
    const opRow = await get().logWarehouseOp(order.id, {
      op_type: receiptOpType(accept_status),
      material_id: materialId,
      qty: qty_received,
      note: accept_comment,
    });
    if (!opRow) toast.warning('Приёмка записана, но не попала в историю склада');
    return true;
  },

  logWarehouseOp: async (orderId, op) => {
    const { data, error } = await supabase
      .from('erp_warehouse_ops')
      .insert({
        order_id: orderId,
        material_id: op.material_id ?? null,
        op_type: op.op_type,
        qty: op.qty ?? null,
        note: op.note ?? null,
        actor: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpWarehouseOp | undefined;
    if (error || !row) {
      toast.error('Не удалось записать складскую операцию');
      return null;
    }
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === orderId
          ? { ...o, warehouse_ops: [...(o.warehouse_ops ?? []), row] }
          : o),
    }));
    return row;
  },
});
