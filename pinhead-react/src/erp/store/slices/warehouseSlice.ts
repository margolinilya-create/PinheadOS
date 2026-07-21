/**
 * Слайс склада (правки 2, 3 + волна 4): числовая приёмка материалов (план/факт/статус)
 * с записью в историю складских операций; прочие операции (упаковка/отгрузка/маркировка);
 * и задачи склада с жизненным циклом (erp_warehouse_tasks) — приёмка → маркировка →
 * упаковка и отгрузка. Задачи авто-создаются триггером БД по переходам маршрута; здесь —
 * их продвижение по стейт-машине с записью значимых переходов в историю.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpMaterial, ErpWarehouseOp, ErpWarehouseTask, WarehouseOpType } from '../../types';
import { currentActor } from '../shared';
import type { ErpOrderFull, ErpStore, WarehouseSlice } from '../types';

/** Тип складской операции для приёмки по статусу приёмки */
function receiptOpType(acceptStatus: string): ErpWarehouseOp['op_type'] {
  return acceptStatus === 'accepted_partial' ? 'partial_receipt' : 'material_receipt';
}

/** Материал ещё ждёт приёмки складом (пришёл, но не принят) */
function awaitsAcceptance(m: ErpMaterial): boolean {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

/** Значимые статусы задач → строка истории склада (прочие переходы историю не пишут) */
const OP_FOR_STATUS: Record<string, WarehouseOpType> = {
  issued: 'marking',
  packed: 'packaging',
  shipped: 'shipment',
};

/** Точечный патч задачи склада в orders[].warehouse_tasks (сохраняет идентичность прочих заказов) */
function patchTaskIn(orders: ErpOrderFull[], taskId: string, patch: Partial<ErpWarehouseTask>): ErpOrderFull[] {
  return orders.map((o) =>
    (o.warehouse_tasks ?? []).some((t) => t.id === taskId)
      ? { ...o, warehouse_tasks: o.warehouse_tasks!.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
      : o);
}

export const warehouseSlice: StateCreator<ErpStore, [], [], WarehouseSlice> = (set, get) => ({
  acceptMaterial: async (materialId, { qty_received, accept_status, accept_comment = null }) => {
    const order = get().orders.find((o) => o.materials.some((m) => m.id === materialId));
    if (!order) return false;
    // Патч материала (optimistic + rollback + авто-закрытие закупки) — через materialsSlice.
    // Приёмка складом означает, что материал ФИЗИЧЕСКИ прибыл → status='received'
    // (иначе гейт закроя по приёмке не сработает: он ждёт received + accept_status).
    const ok = await get().updateMaterial(materialId, {
      status: 'received',
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

    // Если приёмка заказа завершена (нечего больше принимать) — закрыть задачу приёмки.
    const fresh = get().orders.find((o) => o.id === order.id);
    const task = fresh?.warehouse_tasks?.find(
      (t) => t.task_type === 'material_receipt' && t.status !== 'accepted');
    if (task && fresh && !fresh.materials.some(awaitsAcceptance)) {
      await get().advanceWarehouseTask(task.id, 'accepted');
    }
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

  advanceWarehouseTask: async (taskId, status, extra) => {
    const prev = get().orders;
    const order = prev.find((o) => (o.warehouse_tasks ?? []).some((t) => t.id === taskId));
    const task = order?.warehouse_tasks?.find((t) => t.id === taskId);
    if (!order || !task) return false;

    // Отгрузка — единственное место отгрузки заказа: сперва shipOrder (гейт готовности),
    // затем закрываем задачу. Если заказ не готов — задачу не трогаем.
    if (task.task_type === 'pack_ship' && status === 'shipped') {
      const shipped = await get().shipOrder(order.id);
      if (!shipped) return false;
    }

    const patch: Partial<ErpWarehouseTask> = {
      status,
      ...(extra?.marking_type !== undefined ? { marking_type: extra.marking_type } : {}),
      ...(extra?.deadline !== undefined ? { deadline: extra.deadline } : {}),
      ...(extra?.note !== undefined ? { note: extra.note } : {}),
    };
    set((s) => ({ orders: patchTaskIn(s.orders, taskId, patch) }));
    const { error } = await supabase.from('erp_warehouse_tasks').update(patch).eq('id', taskId);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить задачу склада');
      return false;
    }
    // История склада для значимых переходов (маркировка выпущена / упаковано / отгружено)
    const opType = OP_FOR_STATUS[status];
    if (opType) await get().logWarehouseOp(order.id, { op_type: opType });
    return true;
  },
});
