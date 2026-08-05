/**
 * Слайс производственного плана (правка менеджера 2026-08-03).
 *
 * Руководитель производства вручную раскладывает этапы по цехам и дням, цех
 * ежедневно вносит факт. Система план не составляет и НИЧЕГО не переносит сама:
 * невыполненный остаток остаётся отклонением, а новую дату ставит человек.
 *
 * Данные — `erp_calendar_slots` (таблица существовала с первой миграции и
 * не использовалась) + `erp_plan_comments` для переписки по задаче.
 *
 * Правила Pinhead: toast.error на каждую ошибку, optimistic только с rollback,
 * удаление ждёт ответ Supabase.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { ErpCalendarSlot, ErpPlanComment } from '../../types';
import { planStatusForFact } from '../../utils/planDay';
import { currentActor, erpError, withPending } from '../shared';
import type { ErpStore, PlanSlice } from '../types';

/** Точечный патч задачи в списке (остальные сохраняют идентичность) */
function patchSlot(
  slots: ErpCalendarSlot[],
  id: string,
  patch: Partial<ErpCalendarSlot>,
): ErpCalendarSlot[] {
  return slots.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/**
 * Место в конце дня: numeric-середина не нужна, хвост всегда «последний + 1000».
 * Тот же приём, что у `queue_position` этапов — перенумеровывать день целиком
 * ради одной вставки незачем.
 */
function tailSortOrder(slots: ErpCalendarSlot[], deptId: string, date: string): number {
  const day = slots.filter((s) => s.department_id === deptId && s.work_date === date);
  if (day.length === 0) return 1000;
  return Math.max(...day.map((s) => Number(s.sort_order) || 0)) + 1000;
}

export const planSlice: StateCreator<ErpStore, [], [], PlanSlice> = (set, get) => ({
  planSlots: [],
  planComments: [],
  planLoaded: false,
  planLoading: false,
  planLoadError: false,

  loadPlan: async (fromDate, toDate) => {
    set({ planLoading: true, planLoadError: false });
    const { data, error } = await supabase
      .from('erp_calendar_slots')
      .select('*')
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .order('work_date')
      .order('sort_order');
    if (error) {
      set({ planLoading: false, planLoadError: true });
      erpError('Не удалось загрузить производственный план', error);
      return;
    }
    set({
      planSlots: (data ?? []) as ErpCalendarSlot[],
      planLoaded: true,
      planLoading: false,
    });
  },

  /**
   * Поставить этап в план на дату. Повторная постановка на ту же дату — не ошибка,
   * а правка: `upsert` по уникальному индексу (stage_id, work_date) возвращает
   * снятую задачу в работу вместо падения на 23505.
   *
   * Индекс обязан быть НЕ частичным. PostgREST шлёт `ON CONFLICT (stage_id, work_date)`,
   * а частичный индекс из голого списка колонок Postgres не выводит — нужен ещё и
   * предикат, которого PostgREST не отправляет. Индекс тут заводился с
   * `where stage_id is not null`, и `planStage` падал на 42P10 при КАЖДОМ вызове
   * (спецификация ON CONFLICT проверяется при планировании, до поиска конфликта).
   * Исправлено миграцией 20260803200000; сторожит `upsertConflict.test.ts`.
   */
  planStage: async ({ stageId, departmentId, workDate, qty, comment = null, priority = 0 }) => {
    if (!(qty > 0)) {
      toast.error('Укажите количество на день');
      return null;
    }
    /**
     * Повторная постановка на ту же дату идёт upsert-ом и НЕ трогает факт
     * (`qty_done`, `fact_at`, переписку) — это осознанно. Но статус писался
     * безусловным `'planned'`, и день, за который цех уже отчитался, откатывался
     * в «запланировано» с сохранённым результатом: в сводке работа переставала
     * считаться выполненной. Статус выводим из факта тем же правилом, что и при
     * его внесении (`planStatusForFact`), с учётом НОВОГО планового количества.
     */
    const existing = get().planSlots.find(
      (s) => s.stage_id === stageId && s.work_date === workDate,
    );
    const row = {
      stage_id: stageId,
      department_id: departmentId,
      work_date: workDate,
      qty_planned: qty,
      priority,
      comment,
      status: planStatusForFact(existing?.qty_done, qty, Boolean(existing?.fact_at)),
      sort_order: tailSortOrder(get().planSlots, departmentId, workDate),
      created_by: currentActor(),
    };
    const { data, error } = await supabase
      .from('erp_calendar_slots')
      .upsert(row, { onConflict: 'stage_id,work_date' })
      .select();
    const saved = data?.[0] as ErpCalendarSlot | undefined;
    if (error || !saved) {
      erpError('Задача не поставлена в план', error);
      return null;
    }
    set((s) => ({
      planSlots: [...s.planSlots.filter((x) => x.id !== saved.id), saved],
    }));
    return saved;
  },

  updatePlanSlot: async (id, patch) => {
    const prev = get().planSlots;
    set({ planSlots: patchSlot(prev, id, patch) });
    const { error } = await withPending(`plan:${id}`, () =>
      supabase.from('erp_calendar_slots').update(patch).eq('id', id));
    if (error) {
      set({ planSlots: prev });
      return erpError('План не изменён', error);
    }
    return true;
  },

  /**
   * Перенос задачи на другой день. Отдельным действием, а не общим патчем:
   * при переносе меняется и место в дне, иначе задача встаёт первой в чужой день.
   */
  movePlanSlot: async (id, workDate) => {
    const slot = get().planSlots.find((s) => s.id === id);
    if (!slot) return false;
    return get().updatePlanSlot(id, {
      work_date: workDate,
      sort_order: tailSortOrder(get().planSlots, slot.department_id, workDate),
    });
  },

  /**
   * Снятие задачи из плана — статусом, а не удалением: уже внесённый цехом факт
   * и переписка остаются в истории, а повторная постановка на ту же дату проходит
   * upsert-ом. DELETE на таблице и так только у админа.
   */
  cancelPlanSlot: async (id) => get().updatePlanSlot(id, { status: 'cancelled' }),

  /**
   * Факт за день от цеха. `qty_done` — накопительное значение за этот день,
   * а не приращение: цех вводит «сделано столько-то», и повторный ввод исправляет
   * ошибку, а не удваивает результат.
   */
  reportPlanFact: async (id, { qty, defect = 0, comment = null, deviationReason = null }) => {
    const slot = get().planSlots.find((s) => s.id === id);
    if (!slot) return false;
    if (qty < 0 || defect < 0) {
      toast.error('Количество не может быть отрицательным');
      return false;
    }
    return get().updatePlanSlot(id, {
      qty_done: qty,
      qty_defect: defect,
      fact_comment: comment,
      deviation_reason: deviationReason,
      fact_by: currentActor(),
      fact_at: new Date().toISOString(),
      status: planStatusForFact(qty, slot.qty_planned, true),
    });
  },

  /**
   * Проблема по задаче дня. Блокировку самого этапа делает `setStageStatus`
   * (существующий механизм) — второй параллельной машины состояний не заводим,
   * иначе «этап идёт, а задача дня заблокирована» станет обычным делом.
   */
  reportPlanProblem: async (id, problem) => get().updatePlanSlot(id, {
    problem_type: problem.type || null,
    problem_note: problem.note || null,
    problem_affects_due: Boolean(problem.affectsDue),
    problem_needs_help: Boolean(problem.needsHelp),
    problem_can_continue: problem.canContinue !== false,
  }),

  clearPlanProblem: async (id) => get().updatePlanSlot(id, {
    problem_type: null,
    problem_note: null,
    problem_affects_due: false,
    problem_needs_help: false,
    problem_can_continue: true,
  }),

  loadPlanComments: async (slotId) => {
    const { data, error } = await supabase
      .from('erp_plan_comments')
      .select('*')
      .eq('slot_id', slotId)
      .order('created_at');
    if (error) {
      erpError('Комментарии не загружены', error);
      return;
    }
    set((s) => ({
      planComments: [
        ...s.planComments.filter((c) => c.slot_id !== slotId),
        ...((data ?? []) as ErpPlanComment[]),
      ],
    }));
  },

  addPlanComment: async (slotId, text, side) => {
    const clean = text.trim();
    if (!clean) return null;
    const { data, error } = await supabase
      .from('erp_plan_comments')
      .insert({ slot_id: slotId, author: currentActor(), side, text: clean })
      .select();
    const row = data?.[0] as ErpPlanComment | undefined;
    if (error || !row) {
      erpError('Комментарий не сохранён', error);
      return null;
    }
    set((s) => ({ planComments: [...s.planComments, row] }));
    return row;
  },
});
