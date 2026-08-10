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
import type {
  ErpMaterial, ErpSubcontractOp, ErpWarehouseOp, ErpWarehouseTask, WarehouseOpType,
} from '../../types';
import { currentActor, erpError, erpQuery } from '../shared';
import { subcontractPhasePatch } from '../../utils/subcontractPhase';
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
  acceptMaterial: async (
    materialId,
    { qty_received, accept_status, accept_comment = null,
      fact_name = null, fact_color = null, fact_article = null },
  ) => {
    const order = get().orders.find((o) => o.materials.some((m) => m.id === materialId));
    if (!order) return false;
    // Патч материала (optimistic + rollback + авто-закрытие закупки) — через materialsSlice.
    // Приёмка складом означает, что материал ФИЗИЧЕСКИ прибыл → status='received'
    // (иначе гейт закроя по приёмке не сработает: он ждёт received + accept_status).
    // Факт-атрибуты (правка 4.1.3): что фактически поступило (пересорт/расхождение с планом).
    /**
     * Количество здесь БОЛЬШЕ НЕ ПИШЕТСЯ (волна 3.3).
     *
     * `qty_received` стала суммой журнала приходов и ведётся триггером. Оставить
     * прямую запись значило бы завести двух писателей одной колонки: карточка
     * поставила бы своё число, а первый же следующий приход пересчитал бы сумму
     * и затёр его — молча, потому что оба пути «работают».
     *
     * Приход вносится отдельным действием `addMaterialReceipt`; сюда приходит
     * уже посчитанное значение только для истории склада и для проверки
     * расхождения на экране.
     */
    const ok = await get().updateMaterial(materialId, {
      status: 'received',
      accept_status,
      accepted_at: new Date().toISOString().slice(0, 10),
      accepted_by: currentActor(),
      accept_comment,
      fact_name,
      fact_color,
      fact_article,
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

  /**
   * Отчёт склада по задаче (волна 3.4): строка в `erp_stage_reports` с якорем
   * `warehouse_task_id`. Тот же журнал, что у цехов — приёмка готовой продукции
   * считается в штуках и отвечает на те же вопросы. Отдельной таблицы для неё
   * нет намеренно: иначе «сколько изделий приняли» собиралось бы из двух мест
   * с разными правилами.
   */
  submitWarehouseReport: async (taskId, input) => {
    const good = Math.max(input.qtyGood ?? 0, 0);
    const defect = Math.max(input.qtyDefect ?? 0, 0);
    if (good + defect <= 0) {
      toast.error('Внесите количество');
      return false;
    }
    const comment = (input.comment ?? '').trim();
    if (defect > 0 && !comment) {
      toast.error('Брак нужно объяснить — заполните комментарий');
      return false;
    }
    const { error } = await erpQuery(() => supabase.rpc('erp_warehouse_submit_report', {
      p_task_id: taskId,
      p_qty_in: input.qtyIn ?? null,
      p_qty_good: good,
      p_qty_defect: defect,
      p_comment: comment || null,
      p_extra: input.extra ?? {},
    }));
    if (error) {
      erpError('Приёмка не записана', error);
      return false;
    }
    const order = get().orders.find(
      (o) => (o.warehouse_tasks ?? []).some((t) => t.id === taskId));
    if (order) await get().loadOne(order.id);
    return true;
  },

  logWarehouseOp: async (orderId, op) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_warehouse_ops')
      .insert({
        order_id: orderId,
        material_id: op.material_id ?? null,
        op_type: op.op_type,
        qty: op.qty ?? null,
        note: op.note ?? null,
        actor: currentActor(),
      })
      .select());
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
    const { error } = await erpQuery(() => supabase.from('erp_warehouse_tasks').update(patch).eq('id', taskId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось обновить задачу склада');
      return false;
    }
    // История склада для значимых переходов (маркировка выпущена / упаковано / отгружено)
    const opType = OP_FOR_STATUS[status];
    if (opType) await get().logWarehouseOp(order.id, { op_type: opType });

    /**
     * Приёмка готовой продукции от подрядчика принята (правка 4.2.1): переводим
     * подрядную операцию в «Принято складом» — это заведёт задачу упаковки.
     *
     * Отбор идёт по ФАЗЕ. Прежде здесь стояло `.eq('status','shipped_by_contractor')`,
     * и после переезда волны 3.5 на `phase` этот запрос находил бы строки по
     * колонке, которую больше никто не двигает: приёмка склада молча переставала
     * бы закрывать подряд.
     */
    if (task.task_type === 'subcontract_receipt' && status === 'accepted') {
      const { data } = await erpQuery(() => supabase
        .from('erp_subcontracting')
        .select('*, order:erp_orders (title, bitrix_id)')
        .eq('order_id', order.id)
        .eq('op_type', 'finished_product')
        .eq('phase', 'returned')
        .limit(1));
      const op = data?.[0] as ErpSubcontractOp | undefined;
      if (op) {
        // операция могла быть не загружена (вкладка подряда лениво) — вносим в стейт для optimistic
        set((s) => ({
          subcontracting: s.subcontracting.some((o) => o.id === op.id)
            ? s.subcontracting
            : [op, ...s.subcontracting],
        }));
        await get().updateSubcontractOp(op.id, subcontractPhasePatch('accepted'));
      }
    }
    return true;
  },
});
