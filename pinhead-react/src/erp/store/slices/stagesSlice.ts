/**
 * Слайс этапов: смена статуса, частичная готовность, брак/переделка, план дат,
 * приоритет в очереди цеха и перенос задания между цехами (волна 1).
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 * reportDefect зовёт get().createProcurementTask (procurementSlice) при needsMaterial.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { deptShortName } from '../../data/departments';
import type { ErpItemStage, ErpStageEvent } from '../../types';
import {
  defaultQueuePosition,
  nextQueuePosition,
  renumberedQueue,
  reorderIds,
} from '../../utils/queueOrder';
import { analyzeStageMove } from '../../utils/stageMove';
import { intermediateReopened } from '../../utils/stageDefect';
import { logStageEvent, withPending, erpError } from '../shared';
import { addStageIn, findStage, patchStageIn, stagesInDept } from '../orderHelpers';
import type { ErpStore, StagesSlice } from '../types';

export const stagesSlice: StateCreator<ErpStore, [], [], StagesSlice> = (set, get) => ({
  setStageStatus: async (stageId, status, extra = {}) => {
    const prev = get().orders;
    const { comment, ...fields } = extra;
    const patch: Partial<ErpItemStage> = { status, ...fields };
    if (status === 'in_progress') patch.started_at = new Date().toISOString();
    if (status === 'done') patch.finished_at = new Date().toISOString();

    // найдём заказ и прежний статус для аудита
    const found = findStage(prev, stageId);

    // optimistic с rollback (нетронутые заказы сохраняют идентичность)
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      erpError('Этап не обновлён', error);
      return false;
    }
    if (found) {
      logStageEvent({
        stage_id: stageId,
        order_id: found.order.id,
        from_status: found.stage.status,
        to_status: status,
        qty_done: extra.qty_done ?? null,
        qty_rework: null,
        comment: comment ?? extra.block_reason ?? null,
      });
    }
    return true;
  },

  reportProgress: async (stageId, qty) => {
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found || !(qty > 0)) return false;
    const { stage, item, order } = found;

    const total = item.qty;
    const newDone = Math.min((stage.qty_done ?? 0) + qty, total);
    const isDone = newDone >= total;
    if ((stage.qty_done ?? 0) + qty > total) {
      toast.warning(`Введено больше остатка — засчитано ${total - (stage.qty_done ?? 0)} шт (до полного тиража)`);
    }
    const patch: Partial<ErpItemStage> = { qty_done: newDone };
    if (isDone) {
      patch.status = 'done';
      patch.finished_at = new Date().toISOString();
    }

    // optimistic с rollback
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      erpError('Результат не записан', error);
      return false;
    }
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: isDone ? 'done' : stage.status,
      qty_done: qty,
      qty_rework: null,
      comment: `Частичная готовность: ${newDone}/${total}`,
    });
    return true;
  },

  reportDefect: async (stageId, opts) => {
    const {
      qty, reason, target = 'current', needsMaterial = false,
      cause = 'other', supplier = null, plannedDate = null,
      materialName = null, requiredQty = null,
      subcontractOperation = null, contractor = null,
    } = opts;
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found || !(qty > 0)) return false;
    const { stage, order, item } = found;

    // брак не может превышать тираж позиции
    if (item.qty > 0 && qty > item.qty) {
      toast.error(`Брак не может превышать тираж (${item.qty} шт)`);
      return false;
    }
    // ...и не больше, чем этап реально сделал (аудит correctness #3)
    const processed = stage.qty_done ?? 0;
    if (processed > 0 && qty > processed) {
      toast.error(`Брак не может превышать сделанное на этапе (${processed} шт)`);
      return false;
    }

    const dept = get().departments.find((d) => d.id === stage.department_id);
    const deptName = dept?.name || 'цех';

    // Целевой этап устранения: конкретный этап позиции (в т.ч. закрой), либо null.
    // Спец-цели (current/procurement/subcontractor) не резолвятся в этап.
    const SPECIAL_TARGETS = new Set(['current', 'procurement', 'subcontractor']);
    const byId = new Map(item.stages.map((s) => [s.id, s]));
    const targetStage = SPECIAL_TARGETS.has(target) ? null : byId.get(target) ?? null;

    // Патчи этапов
    const patches: { id: string; patch: Partial<ErpItemStage> }[] = [];
    if (targetStage) {
      // Текущий S: снять N с готовых, вернуть в очередь, +брак
      patches.push({
        id: stage.id,
        patch: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: stage.status === 'done' ? 'waiting' : stage.status,
          finished_at: stage.status === 'done' ? null : stage.finished_at,
        },
      });
      // Целевой этап T: переоткрыть на N штук
      patches.push({
        id: targetStage.id,
        patch: {
          status: 'in_progress',
          qty_done: Math.max((targetStage.qty_done ?? 0) - qty, 0),
          qty_rework: (targetStage.qty_rework ?? 0) + qty,
          finished_at: null,
        },
      });
      // Всё, что идёт ПОСЛЕ T по маршруту и уже обработало эти единицы, тоже
      // переоткрыть на N — перекроенные единицы должны заново пройти их
      // (аудит correctness #4), иначе они «застрянут» в done.
      //
      // По графу depends_on, а не по интервалу sort_order: ветки нанесения имеют
      // ОДИНАКОВЫЙ sort_order, и прежняя отсечка `>= hi` оставляла соседнюю ветку
      // в done с полным тиражом — партия уходила в пошив без печати. Тот же
      // расчёт, что показывает подтверждение (`utils/stageDefect`).
      for (const mid of intermediateReopened({ stage, targetStage, allStages: item.stages })) {
        patches.push({
          id: mid.id,
          patch: {
            status: 'waiting',
            qty_done: Math.max((mid.qty_done ?? 0) - qty, 0),
            qty_rework: (mid.qty_rework ?? 0) + qty,
            finished_at: null,
          },
        });
      }
    } else if (target === 'procurement' || target === 'subcontractor') {
      // Материал испорчен (procurement) или брак уходит подрядчику (subcontractor):
      // N единиц уходят в ожидание — этап в очередь до возврата закупки/подрядчика
      patches.push({
        id: stage.id,
        patch: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'waiting',
          finished_at: null,
        },
      });
    } else {
      // 'current' — переделка на месте
      patches.push({
        id: stage.id,
        patch: {
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'in_progress',
          finished_at: null,
        },
      });
    }

    // optimistic с rollback
    let next = prev;
    for (const p of patches) next = patchStageIn(next, p.id, p.patch);
    set({ orders: next });
    const results = await Promise.all(
      patches.map((p) =>
        withPending(`stage:${p.id}`, () =>
          supabase.from('erp_item_stages').update(p.patch).eq('id', p.id))),
    );
    if (results.some((r) => r.error)) {
      set({ orders: prev });
      erpError('Брак не записан', results.find((r) => r.error)?.error);
      return false;
    }

    // Аудит: событие на получателе (целевой этап, если есть)
    const receiver = targetStage ?? stage;
    logStageEvent({
      stage_id: receiver.id,
      order_id: order.id,
      from_status: receiver.status,
      to_status: 'in_progress',
      qty_done: null,
      qty_rework: qty,
      comment: targetStage ? `Возврат брака из «${deptName}»: ${reason}` : `Брак (${deptName}): ${reason}`,
    });

    // Правки 1-2: нужна закупка → отдельная задача закупщику (исходную закупку не трогаем)
    if (needsMaterial || target === 'procurement') {
      const task = await get().createProcurementTask(order.id, {
        item_id: item.id,
        source_stage_id: stage.id,
        initiating_dept: dept?.code ?? null,
        material_name: materialName || 'Материал (уточнить)',
        rework_qty: qty,
        required_qty: requiredQty,
        cause_type: cause,
        reason,
        supplier,
        planned_date: plannedDate,
      });
      // Аудит-агент: этап уже в waiting/переделке — если заявка не создалась, предупреждаем,
      // иначе этап «ждёт закупку», которой нет (createProcurementTask сам покажет error).
      if (!task) toast.warning('Брак записан, но заявка на закупку не создана — создайте вручную');
    }

    // Правка 4: брак уходит подрядчику → создать операцию подряда (тип «отдельная операция»,
    // возврат на текущий цех). Единый механизм возврата для всех участков производства.
    if (target === 'subcontractor') {
      const op = await get().createSubcontractOp({
        order_id: order.id,
        item_id: item.id,
        operation: subcontractOperation || reason,
        op_type: 'operation',
        return_dept: dept?.code ?? null,
        contractor,
        qty,
        status: 'planned',
      });
      if (!op) toast.warning('Брак записан, но операция подряда не создана — добавьте вручную');
    }
    return true;
  },

  findOrderIdByStage: async (stageId) => {
    // Диплинк на /task/:stageId: заказа может не быть в сторе (архив, чужой цех).
    // Одним запросом добираемся до order_id, дальше страницу дотягивает loadOne.
    const { data, error } = await supabase
      .from('erp_item_stages')
      .select('item:erp_order_items (order_id)')
      .eq('id', stageId)
      .maybeSingle();
    if (error || !data) return null;
    const item = (data as { item?: { order_id?: string } | null }).item;
    return item?.order_id ?? null;
  },

  loadStageReworkEvents: async (stageIds) => {
    if (stageIds.length === 0) return {};
    const { data, error } = await supabase
      .from('erp_stage_events')
      .select('*')
      .in('stage_id', stageIds)
      .not('qty_rework', 'is', null)
      .order('created_at', { ascending: false });
    if (error) return {};
    const map: Record<string, ErpStageEvent> = {};
    for (const ev of (data ?? []) as ErpStageEvent[]) {
      if (!map[ev.stage_id]) map[ev.stage_id] = ev;
    }
    return map;
  },

  ackStageOverdue: async (stageId, comment) => {
    const prev = get().orders;
    const patch = { overdue_comment: comment, overdue_ack_at: new Date().toISOString() };
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      erpError('Комментарий не сохранён', error);
      return false;
    }
    return true;
  },

  reorderStageQueue: async (stageId, prevStageId, nextStageId) => {
    const prevOrders = get().orders;
    const found = findStage(prevOrders, stageId);
    if (!found) return false;
    const { stage, order } = found;
    const deptName = (() => {
      const d = get().departments.find((x) => x.id === stage.department_id);
      return d ? deptShortName(d.code, d.name) : 'цех';
    })();

    const posOf = (id: string | null) =>
      (id ? findStage(prevOrders, id)?.stage.queue_position ?? null : null);
    const pos = nextQueuePosition(posOf(prevStageId), posOf(nextStageId));

    // Обычный путь — переезжает одна строка: позиция вычислена серединой между соседями.
    // Редкий путь (pos === null): соседи слиплись по точности double — перенумеровываем
    // очередь цеха целиком, иначе вставить между ними уже нечего.
    const writes: { id: string; queue_position: number }[] = pos !== null
      ? [{ id: stageId, queue_position: pos }]
      : renumberedQueue(
          reorderIds(
            stagesInDept(prevOrders, stage.department_id).map((r) => r.stage.id),
            stageId,
            prevStageId,
            nextStageId,
          ),
        );

    // optimistic с rollback
    let next = prevOrders;
    for (const w of writes) next = patchStageIn(next, w.id, { queue_position: w.queue_position });
    set({ orders: next });

    const results = await Promise.all(
      writes.map((w) =>
        withPending(`stage:${w.id}`, () =>
          supabase
            .from('erp_item_stages')
            .update({ queue_position: w.queue_position })
            .eq('id', w.id))),
    );
    if (results.some((r) => r.error)) {
      set({ orders: prevOrders });
      erpError('Приоритет не сохранён', results.find((r) => r.error)?.error);
      return false;
    }

    // История: кто, когда и куда переместил (правка 3)
    const prevTitle = prevStageId ? findStage(prevOrders, prevStageId)?.order.title : null;
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: stage.status,
      qty_done: null,
      qty_rework: null,
      comment: `Приоритет в очереди «${deptName}»: ${
        prevTitle ? `после «${prevTitle}»` : 'в начало очереди'}`,
    });
    return true;
  },

  moveStageToDepartment: async (stageId, targetDeptId, opts = {}) => {
    const prevOrders = get().orders;
    const found = findStage(prevOrders, stageId);
    if (!found) return false;
    const { stage, item, order } = found;

    const departments = get().departments;
    const targetDept = departments.find((d) => d.id === targetDeptId);
    if (!targetDept) return false;
    const sourceDept = departments.find((d) => d.id === stage.department_id);
    const deptNameById = new Map(
      departments.map((d) => [d.id, deptShortName(d.code, d.name)] as const),
    );

    const plan = analyzeStageMove({
      stage,
      item,
      targetDeptId,
      targetDeptName: targetDept.name,
      deptNameById,
    });
    if (!plan.allowed) {
      toast.error(plan.issues[0]?.text || 'Перенос невозможен');
      return false;
    }

    const now = new Date().toISOString();
    const sourceName = sourceDept ? deptShortName(sourceDept.code, sourceDept.name) : 'цех';
    const targetName = deptShortName(targetDept.code, targetDept.name);
    const comment = opts.comment?.trim() || null;
    const moveNote = `Перенос: ${sourceName} → ${targetName}${comment ? `. ${comment}` : ''}`;

    // Текущий этап закрывается — заказчик просил не помечать его завершённым молча,
    // предупреждение показывает UI (moveConfirmMessage) до вызова.
    const sourcePatch: Partial<ErpItemStage> = {
      status: 'done',
      qty_done: item.qty,
      finished_at: now,
    };
    const targetPatch: Partial<ErpItemStage> = {
      status: 'in_progress',
      started_at: now,
      finished_at: null,
      queue_position: plan.targetStage?.queue_position
        ?? defaultQueuePosition(order.due_date),
    };

    set((s) => ({ orders: patchStageIn(s.orders, stageId, sourcePatch) }));
    const sourceRes = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(sourcePatch).eq('id', stageId));
    if (sourceRes.error) {
      // Ничего не закоммичено — откат интерфейса честен.
      set({ orders: prevOrders });
      erpError('Задание не перенесено', sourceRes.error);
      return false;
    }

    /**
     * Второй шаг не удался, а исходный этап УЖЕ закрыт в базе.
     *
     * Прежде здесь стоял `set({ orders: prevOrders })` — интерфейс возвращался
     * к состоянию «до переноса», через секунду realtime приносил закоммиченный
     * `done`, и задание исчезало из обоих цехов: позиция оставалась без единого
     * открытого этапа, а повторить перенос было нечем.
     *
     * Поэтому сначала пробуем компенсирующую запись — вернуть исходный этап
     * в прежнее состояние. Если и она не прошла, интерфейс НЕ откатываем:
     * показываем то, что в базе на самом деле, и говорим прямым текстом, где
     * этап и что делать. Врать про состояние хуже, чем признать половину работы.
     */
    async function undoClosedSource(cause: { message?: string } | null) {
      const restore: Partial<ErpItemStage> = {
        status: stage.status,
        qty_done: stage.qty_done,
        finished_at: stage.finished_at,
      };
      const { error: undoError } = await supabase
        .from('erp_item_stages').update(restore).eq('id', stageId);
      if (undoError) {
        set((s) => ({ orders: patchStageIn(s.orders, stageId, sourcePatch) }));
        toast.error(
          `Этап закрыт в «${sourceName}», но не открыт в «${targetName}». `
          + 'Откатить тоже не удалось — откройте этап вручную в карточке заказа',
        );
        return false;
      }
      set({ orders: prevOrders });
      erpError(`Задание не перенесено в «${targetName}»`, cause);
      return false;
    }

    if (plan.targetStage) {
      const targetId = plan.targetStage.id;
      set((s) => ({ orders: patchStageIn(s.orders, targetId, targetPatch) }));
      const { error } = await withPending(`stage:${targetId}`, () =>
        supabase.from('erp_item_stages').update(targetPatch).eq('id', targetId));
      if (error) {
        return undoClosedSource(error);
      }
      logStageEvent({
        stage_id: targetId,
        order_id: order.id,
        from_status: plan.targetStage.status,
        to_status: 'in_progress',
        qty_done: null,
        qty_rework: null,
        comment: moveNote,
      });
    } else {
      // Цеха нет в маршруте — добавляем этап (подтверждение спросили в UI).
      // Не optimistic: id строки известен только из ответа Supabase.
      const { data, error } = await supabase
        .from('erp_item_stages')
        .insert({
          item_id: item.id,
          department_id: targetDeptId,
          sort_order: stage.sort_order + 5,
          depends_on: [stage.id],
          ...targetPatch,
        })
        .select();
      const row = data?.[0] as ErpItemStage | undefined;
      if (error || !row) {
        // Исходный этап уже закрыт в базе — та же компенсация, что и выше.
        return undoClosedSource(error);
      }
      set((s) => ({ orders: addStageIn(s.orders, item.id, row) }));
      logStageEvent({
        stage_id: row.id,
        order_id: order.id,
        from_status: null,
        to_status: 'in_progress',
        qty_done: null,
        qty_rework: null,
        comment: `${moveNote} (этап добавлен в маршрут)`,
      });
      // ТЗ новому этапу наследовать не нужно: документ принадлежит позиции и виден
      // всему её маршруту. Раньше здесь копировалось назначение исходного цеха —
      // иначе перетащенная карточка упиралась в гейт «Не назначено ТЗ».
    }

    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: 'done',
      qty_done: item.qty,
      qty_rework: null,
      comment: moveNote,
    });
    return true;
  },

  setStagePlan: async (stageId, plan) => {
    const prev = get().orders;
    set((s) => ({ orders: patchStageIn(s.orders, stageId, plan) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(plan).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      erpError('План этапа не сохранён', error);
      return false;
    }
    return true;
  },
});
