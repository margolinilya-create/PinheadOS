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
import { erpError, erpQuery, logStageEvent, withPending } from '../shared';
import { addStageIn, findStage, patchStageIn, stagesInDept } from '../orderHelpers';
import type { ErpStore, StagesSlice } from '../types';

/**
 * Патч этапа для `erp_stage_apply_defect`: счётчики ПРИРАЩЕНИЕМ, статус либо явный,
 * либо вычисляемый сервером по актуальной строке (`reopen_if_done`).
 * Какие этапы затронуты, по-прежнему решает клиент (`utils/stageDefect`) — он
 * остаётся единственным местом, где живёт правило обхода графа `depends_on`.
 */
interface DefectWrite {
  id: string;
  qty_done_delta?: number;
  qty_rework_delta?: number;
  status?: ErpItemStage['status'];
  /** Закрытый этап вернуть в очередь (решение принимается по строке в базе) */
  reopen_if_done?: boolean;
  clear_finished?: boolean;
}

export const stagesSlice: StateCreator<ErpStore, [], [], StagesSlice> = (set, get) => ({
  setStageStatus: async (stageId, status, extra = {}) => {
    const prev = get().orders;
    const { comment, ...fields } = extra;
    // найдём заказ и прежний статус для аудита
    const found = findStage(prev, stageId);

    const patch: Partial<ErpItemStage> = { status, ...fields };
    // `started_at` ставится ОДИН раз — при первом входе в работу. Прежде его
    // перетирал каждый переход в `in_progress`: снятие блокировки, переоткрытие
    // после брака, открытие целевого этапа при переносе. От этой отметки зависит
    // бейдж «ТЗ обновлено» (`tz.tzUpdatedAfterStart` сравнивает дату документа
    // с началом работы) — сдвигая её вперёд, мы прятали от цеха ровно то
    // предупреждение, ради которого бейдж и сделан.
    if (status === 'in_progress' && !found?.stage.started_at) {
      patch.started_at = new Date().toISOString();
    }
    if (status === 'done') patch.finished_at = new Date().toISOString();

    // optimistic с rollback (нетронутые заказы сохраняют идентичность)
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));
    const { error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId)));
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
    const before = stage.qty_done ?? 0;

    // Оптимистичная картинка — как раньше; ИСТИНУ считает сервер.
    // Абсолют с клиента терял результат: два планшета в одном цехе читали
    // `qty_done` каждый из своего стора и писали итог. A записал 30, B со своим
    // ещё нулевым состоянием записал 20 — в базе оставалось 20. Для цеха
    // с несколькими исполнителями это обычный день, а не редкая гонка.
    const optimistic = Math.min(before + qty, total);
    const patch: Partial<ErpItemStage> = { qty_done: optimistic };
    if (optimistic >= total) {
      patch.status = 'done';
      patch.finished_at = new Date().toISOString();
    }
    set((s) => ({ orders: patchStageIn(s.orders, stageId, patch) }));

    const { data, error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.rpc('erp_stage_report_progress', { p_stage_id: stageId, p_qty: qty })));
    if (error) {
      set({ orders: prev });
      erpError('Результат не записан', error);
      return false;
    }
    // Сигнал сбоя — только `error`. Возвращённая строка нужна для СВЕРКИ: обрезку
    // по тиражу и запись соседа по цеху видно лишь оттуда. Не пришла — остаёмся
    // на оптимистичной картинке, её выправит realtime.
    const row = (data ?? null) as ErpItemStage | null;
    if (row) set((s) => ({ orders: patchStageIn(s.orders, stageId, row) }));

    const after = row?.qty_done ?? optimistic;
    const credited = Math.max(after - before, 0);
    if (credited < qty) {
      toast.warning(`Засчитано ${credited} шт из ${qty} — этап добрал полный тираж (${total})`);
    }
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: row?.status ?? (after >= total ? 'done' : stage.status),
      qty_done: credited,
      qty_rework: null,
      comment: `Частичная готовность: ${after}/${total}`,
    });
    return true;
  },

  /**
   * Отчёт цеха по схеме участка (правки заказчика 10.08, P2).
   *
   * Отличается от `reportProgress` не «богаче полями», а СМЫСЛОМ: там цех
   * говорит «сделал ещё N», здесь — сдаёт результат целиком (сделано, брак,
   * переделка, сверх тиража) одной записью, и она попадает в журнал
   * `erp_stage_reports` вместе с приращением счётчиков. Одна транзакция:
   * журнал без счётчика — цифры, которых не видит производство; счётчик без
   * журнала — число без объяснения.
   *
   * Не optimistic: у отчёта есть серверные проверки, которых нет на клиенте
   * (обязательный комментарий при отклонении — CHECK), и показать записанным
   * то, что сервер отклонил, значит соврать цеху о сданной работе.
   */
  submitStageReport: async (stageId, input) => {
    const prev = get().orders;
    const found = findStage(prev, stageId);
    if (!found) return false;
    const { stage, item, order } = found;

    const good = Math.max(input.qtyGood ?? 0, 0);
    const defect = Math.max(input.qtyDefect ?? 0, 0);
    const rework = Math.max(input.qtyRework ?? 0, 0);
    const extraQty = Math.max(input.qtyExtra ?? 0, 0);
    if (good + defect + rework + extraQty <= 0) {
      toast.error('Внесите хотя бы одно число');
      return false;
    }
    const comment = (input.comment ?? '').trim();
    if ((defect > 0 || rework > 0) && !comment) {
      toast.error('Отклонение нужно объяснить — заполните комментарий');
      return false;
    }

    const { data, error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.rpc('erp_stage_submit_report', {
        p_stage_id: stageId,
        p_qty_in: input.qtyIn ?? null,
        p_qty_good: good,
        p_qty_defect: defect,
        p_qty_rework: rework,
        p_qty_extra: extraQty,
        p_comment: comment || null,
        p_extra: input.extra ?? {},
      })));
    if (error) {
      erpError('Результат не записан', error);
      return false;
    }
    const row = (data ?? null) as ErpItemStage | null;
    if (row) set((s) => ({ orders: patchStageIn(s.orders, stageId, row) }));

    const after = row?.qty_done ?? (stage.qty_done ?? 0) + good;
    const credited = Math.max(after - (stage.qty_done ?? 0), 0);
    if (credited < good) {
      toast.warning(`Засчитано ${credited} шт из ${good} — этап добрал полный тираж (${item.qty})`);
    }
    logStageEvent({
      stage_id: stageId,
      order_id: order.id,
      from_status: stage.status,
      to_status: row?.status ?? stage.status,
      qty_done: credited,
      qty_rework: rework || null,
      comment: comment || `Результат: ${after}/${item.qty}`,
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

    // Патчи этапов.
    //
    // Каждый несёт две формы: `optimistic` — абсолют для мгновенной картинки,
    // `write` — ПРИРАЩЕНИЕ для сервера. Счётчики считаются приращением по той же
    // причине, что и в `reportProgress`: абсолют с клиента затирает чужую запись.
    // Статус там, где он зависит от текущего значения строки, тоже решает сервер
    // (`reopen_if_done`) — клиентский снимок мог устареть.
    const patches: { id: string; optimistic: Partial<ErpItemStage>; write: DefectWrite }[] = [];
    if (targetStage) {
      // Текущий S: снять N с готовых, вернуть в очередь, +брак
      patches.push({
        id: stage.id,
        optimistic: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: stage.status === 'done' ? 'waiting' : stage.status,
          finished_at: stage.status === 'done' ? null : stage.finished_at,
        },
        write: { id: stage.id, qty_done_delta: -qty, qty_rework_delta: qty, reopen_if_done: true },
      });
      // Целевой этап T: переоткрыть на N штук
      patches.push({
        id: targetStage.id,
        optimistic: {
          status: 'in_progress',
          qty_done: Math.max((targetStage.qty_done ?? 0) - qty, 0),
          qty_rework: (targetStage.qty_rework ?? 0) + qty,
          finished_at: null,
        },
        write: {
          id: targetStage.id,
          qty_done_delta: -qty,
          qty_rework_delta: qty,
          status: 'in_progress',
          clear_finished: true,
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
          optimistic: {
            status: 'waiting',
            qty_done: Math.max((mid.qty_done ?? 0) - qty, 0),
            qty_rework: (mid.qty_rework ?? 0) + qty,
            finished_at: null,
          },
          write: {
            id: mid.id,
            qty_done_delta: -qty,
            qty_rework_delta: qty,
            status: 'waiting',
            clear_finished: true,
          },
        });
      }
    } else if (target === 'procurement' || target === 'subcontractor') {
      // Материал испорчен (procurement) или брак уходит подрядчику (subcontractor):
      // N единиц уходят в ожидание — этап в очередь до возврата закупки/подрядчика
      patches.push({
        id: stage.id,
        optimistic: {
          qty_done: Math.max((stage.qty_done ?? 0) - qty, 0),
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'waiting',
          finished_at: null,
        },
        write: {
          id: stage.id,
          qty_done_delta: -qty,
          qty_rework_delta: qty,
          status: 'waiting',
          clear_finished: true,
        },
      });
    } else {
      // 'current' — переделка на месте
      patches.push({
        id: stage.id,
        optimistic: {
          qty_rework: (stage.qty_rework ?? 0) + qty,
          status: 'in_progress',
          finished_at: null,
        },
        write: {
          id: stage.id,
          qty_rework_delta: qty,
          status: 'in_progress',
          clear_finished: true,
        },
      });
    }

    // optimistic с rollback
    let next = prev;
    for (const p of patches) next = patchStageIn(next, p.id, p.optimistic);
    set({ orders: next });

    /**
     * Одна транзакция вместо пачки независимых UPDATE.
     *
     * Прежде здесь стоял `Promise.all` по 2-4 запросам, а при сбое любого из них
     * интерфейс откатывался ЦЕЛИКОМ — поверх уже закоммиченных остальных.
     * Проект сам сформулировал обратное правило для `moveStageToDepartment`
     * («сначала компенсация, врать про состояние нельзя»), но на брак его
     * не распространил: возврат оставлял позицию в состоянии, которого никто
     * не выбирал, и через секунду realtime приносил его на экран.
     * С RPC откатывать нечего по построению — либо все патчи, либо ни одного.
     */
    const { data, error } = await erpQuery(() => withPending(`stage:${stage.id}`, () =>
      supabase.rpc('erp_stage_apply_defect', { p_patches: patches.map((p) => p.write) })));
    if (error) {
      set({ orders: prev });
      erpError('Брак не записан', error);
      return false;
    }
    // Строки — сверка с базой, а не признак успеха (сбой сообщает `error`)
    const rows = (data ?? null) as ErpItemStage[] | null;
    if (rows?.length) {
      set((s) => {
        let orders = s.orders;
        for (const row of rows) orders = patchStageIn(orders, row.id, row);
        return { orders };
      });
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
    const { data, error } = await erpQuery(() => supabase
      .from('erp_item_stages')
      .select('item:erp_order_items (order_id)')
      .eq('id', stageId)
      .maybeSingle());
    if (error || !data) return null;
    const item = (data as { item?: { order_id?: string } | null }).item;
    return item?.order_id ?? null;
  },

  loadStageReworkEvents: async (stageIds) => {
    if (stageIds.length === 0) return {};
    const { data, error } = await erpQuery(() => supabase
      .from('erp_stage_events')
      .select('*')
      .in('stage_id', stageIds)
      .not('qty_rework', 'is', null)
      .order('created_at', { ascending: false }));
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
    const { error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(patch).eq('id', stageId)));
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

    // Одной транзакцией: перенумерация переписывает всю очередь цеха, и сбой
    // на середине оставлял бы её перемешанной, а интерфейс — откаченным целиком.
    const { error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.rpc('erp_stage_reorder_queue', { p_writes: writes })));
    if (error) {
      set({ orders: prevOrders });
      erpError('Приоритет не сохранён', error);
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

    // Оптимистичная картинка. Текущий этап закрывается — заказчик просил не помечать
    // его завершённым молча, предупреждение показывает UI (moveConfirmMessage) до вызова.
    let next = patchStageIn(prevOrders, stageId, {
      status: 'done',
      qty_done: item.qty,
      finished_at: now,
    });
    if (plan.targetStage) {
      next = patchStageIn(next, plan.targetStage.id, {
        status: 'in_progress',
        started_at: now,
        finished_at: null,
      });
    }
    set({ orders: next });

    /**
     * Перенос — три записи, которые обязаны быть неделимыми: закрыть исходный этап,
     * открыть (или создать) целевой и перевести на целевой тех, кто ждал исходный.
     *
     * Прежде это были два-три независимых запроса с компенсирующей записью на случай
     * сбоя второго: комментарий на 12 строк объяснял, почему интерфейс нельзя
     * откатывать поверх уже закрытого этапа. Транзакция снимает и вопрос, и ответ.
     *
     * Третья запись — та, которой раньше не было вовсе. Без неё финальный ОТК
     * открывался РАНЬШЕ перенесённой работы: в маршруте «…→ВТО→ОТК» перенос из ВТО
     * в ДТФ закрывал ВТО, и ОТК видел свою зависимость выполненной, хотя ДТФ ещё
     * не начинал. Партия уходила бы на контроль до того, как её напечатают.
     */
    const { data, error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.rpc('erp_stage_move_department', {
        p_stage_id: stageId,
        p_target_dept: targetDeptId,
        p_queue_position: plan.targetStage?.queue_position
          ?? defaultQueuePosition(order.due_date),
      })));
    if (error) {
      // Транзакция не оставила следа — откат интерфейса честен.
      set({ orders: prevOrders });
      erpError(`Задание не перенесено в «${targetName}»`, error);
      return false;
    }

    // Возвращённые строки: исходный этап, целевой (возможно, только что созданный)
    // и переведённые зависимые.
    const rows = ((data ?? []) as ErpItemStage[]);
    if (rows.length) {
      set((s) => {
        let orders = s.orders;
        for (const row of rows) {
          orders = findStage(orders, row.id)
            ? patchStageIn(orders, row.id, row)
            : addStageIn(orders, item.id, row);
        }
        return { orders };
      });
    }

    const targetRow = rows.find((r) => r.department_id === targetDeptId) ?? null;
    const createdTarget = !plan.targetStage;
    if (createdTarget && !targetRow) {
      // Этап цеха, которого не было в маршруте, создан сервером — его id знает
      // только ответ. Пришёл пустым (старый клиент, урезанный ответ) — дотягиваем
      // заказ целиком, иначе новый этап не появится на экране до перезагрузки.
      await get().loadOne(order.id);
    }
    if (targetRow || plan.targetStage) {
      logStageEvent({
        stage_id: targetRow?.id ?? plan.targetStage!.id,
        order_id: order.id,
        from_status: createdTarget ? null : plan.targetStage?.status ?? null,
        to_status: 'in_progress',
        qty_done: null,
        qty_rework: null,
        comment: createdTarget ? `${moveNote} (этап добавлен в маршрут)` : moveNote,
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

  /**
   * Правка маршрута позиции (конструктор, правки заказчика 16.08).
   *
   * Оптимистичного обновления здесь НЕТ намеренно: правка меняет состав этапов,
   * их порядок и связи `depends_on` разом, и собрать это состояние на клиенте
   * значило бы во второй раз реализовать то, что уже сделала функция — включая
   * решение, какие выпавшие этапы она удалить ПОСТЕСНЯЛАСЬ (с фактом их
   * не трогает ни она, ни RLS). Поэтому заказ перечитывается целиком.
   */
  applyItemRoute: async (orderId, itemId, steps) => {
    const { error } = await erpQuery(() => withPending(`route:${itemId}`, () =>
      supabase.rpc('erp_route_apply', { p_item_id: itemId, p_steps: steps })));
    if (error) {
      erpError('Маршрут не сохранён', error);
      return false;
    }
    await get().loadOne(orderId);
    return true;
  },

  setStagePlan: async (stageId, plan) => {
    const prev = get().orders;
    set((s) => ({ orders: patchStageIn(s.orders, stageId, plan) }));
    const { error } = await erpQuery(() => withPending(`stage:${stageId}`, () =>
      supabase.from('erp_item_stages').update(plan).eq('id', stageId)));
    if (error) {
      set({ orders: prev });
      erpError('План этапа не сохранён', error);
      return false;
    }
    return true;
  },
});
