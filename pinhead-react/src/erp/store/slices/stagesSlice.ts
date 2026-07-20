/**
 * Слайс этапов: смена статуса, частичная готовность, брак/переделка, план дат.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 * reportDefect зовёт get().createProcurementTask (procurementSlice) при needsMaterial.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpItemStage, ErpStageEvent } from '../../types';
import { logStageEvent, withPending } from '../shared';
import { findStage, patchStageIn } from '../orderHelpers';
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
      toast.error('Не удалось обновить этап');
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
      toast.error('Не удалось записать прогресс');
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
      // Промежуточные этапы между T и S тоже переоткрыть на N — перекроенные единицы
      // должны заново пройти их (аудит correctness #4), иначе они «застрянут» в done.
      const lo = Math.min(targetStage.sort_order, stage.sort_order);
      const hi = Math.max(targetStage.sort_order, stage.sort_order);
      for (const mid of item.stages) {
        if (mid.id === stage.id || mid.id === targetStage.id) continue;
        if (mid.sort_order <= lo || mid.sort_order >= hi) continue;
        if (mid.status !== 'done' && mid.status !== 'in_progress') continue;
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
      toast.error('Не удалось записать брак');
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

  setStagePlan: async (stageId, plan) => {
    const prev = get().orders;
    set((s) => ({ orders: patchStageIn(s.orders, stageId, plan) }));
    const { error } = await withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(plan).eq('id', stageId));
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось сохранить план этапа');
      return false;
    }
    return true;
  },
});
