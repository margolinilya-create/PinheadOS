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
import type { ErpOrderFull, ErpStore, WarehouseSlice } from '../types';
import { factoryToday } from '../../../utils/date';

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
  /**
   * Приёмка материала: приход в журнал и статус позиции — ОДНОЙ транзакцией
   * (RPC `erp_material_accept`).
   *
   * До 22.08 это были два независимых действия: статус писала эта функция,
   * а строку журнала — отдельная форма «Записать приход», необязательная.
   * На боевой базе результат был такой: девять материалов приняты, задач
   * приёмки закрыто шесть, строк в `erp_material_receipts` — НОЛЬ, и
   * `qty_received` пуст у всех девятнадцати позиций.
   *
   * Ломалось при этом три вещи разом, и все молча: экран закупки показывал
   * «принято: —» у каждого принятого материала; «сколько осталось принять»
   * считалось от нуля, то есть частичная приёмка не работала вовсе; сортировка
   * по «принято» падала на дату. Производство не встало только потому, что
   * материальный гейт цеха смотрит `status` + `accept_status`, а не количество.
   *
   * Правило проекта, под которое это подпадает дословно, записано после разбора
   * подряда 20.08: «селект хранимого статуса рядом с величиной, которую ведёт
   * журнал, — это разрешение соврать; то, что меняет количества, пишет журнал
   * той же транзакцией». Здесь та же конструкция: «Принято полностью» можно
   * было выставить, не записав ни единицы.
   *
   * `qty` необязателен: правка статуса или комментария у уже принятого
   * материала нового прихода не означает. Сам гейт («принято» невозможно при
   * нулевом `qty_received`) стоит на сервере — там, где его не обойти.
   */
  acceptMaterial: async (
    materialId,
    { qty = null, accept_status, accept_comment = null, invoice = null,
      fact_name = null, fact_color = null, fact_article = null },
  ) => {
    const order = get().orders.find((o) => o.materials.some((m) => m.id === materialId));
    if (!order) {
      erpError('Приёмка не записана', { message: 'Материал не найден в загруженных заказах' });
      return false;
    }
    const { error } = await erpQuery(() => supabase.rpc('erp_material_accept', {
      p_material_id: materialId,
      p_accept_status: accept_status,
      p_qty: qty,
      p_comment: accept_comment,
      p_invoice: invoice,
      p_received_on: factoryToday(),
      p_fact_name: fact_name,
      p_fact_color: fact_color,
      p_fact_article: fact_article,
      p_actor: currentActor(),
    }));
    if (error) {
      erpError('Приёмка не записана', error);
      return false;
    }
    // Сумму журнала пересчитал триггер — перечитываем заказ, чтобы её увидели
    // и гейты, и экран. Не optimistic по той же причине: считает сервер.
    await get().loadOne(order.id);

    // История склада: строка приёмки. Её неудача приёмку не отменяет —
    // та уже закоммичена, и откатывать интерфейс поверх неё нельзя.
    const opRow = await get().logWarehouseOp(order.id, {
      op_type: receiptOpType(accept_status),
      material_id: materialId,
      qty,
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
     * Приёмку подряда закрывает СЕРВЕР — триггер `erp_warehouse_fg_accepted`.
     *
     * Здесь стояла клиентская цепочка: найти подрядную операцию, перевести её
     * в «принято», а следом завести упаковку. После ввода `warehouse.manage`
     * она ломалась ровно у того, кто эту задачу и делает: складскую задачу
     * кладовщик двигать вправе, а `erp_subcontracting` стоит под `order.manage`,
     * которого у него нет. Выходило «задача принята, подряд не принят, упаковки
     * нет», причём молча: оптимистичная правка откатывалась, а тост говорил
     * лишь «не удалось обновить операцию подряда».
     *
     * Триггер SECURITY DEFINER прав не требует и видит все три предусловия
     * упаковки сразу (`erp_can_pack_ship`). Стор только перечитывает данные.
     */
    if (task.task_type === 'subcontract_receipt' && status === 'accepted') {
      await get().loadOne(order.id);
      if (get().subcontractingLoaded) await get().loadSubcontracting();
    }
    return true;
  },
});
