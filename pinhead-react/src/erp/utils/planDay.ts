/**
 * Сводки производственного плана: по дню, по цеху и по всей фабрике.
 *
 * Требование: ещё до открытия карточек руководитель должен видеть, насколько
 * загружен цех и выполняет ли он план. Считается здесь — чистой функцией
 * с тестами; экраны только рисуют.
 *
 * Мощность цеха в сводку НЕ входит: `capacity_per_day` была удалена осознанно
 * (миграция 20260716170000), и возвращать её без решения заказчика нельзя.
 * Плановая загрузка выражается в штуках.
 */

import { addDays, mondayOfWeek } from '../../utils/date';
import { percentOf } from './format';
import { planCardState, planOverdue, planRemaining } from './planCard';
import type { PlanSlotLike } from './planCard';

/**
 * Статус задачи дня по внесённому факту — ОДНО правило на две точки входа:
 * внесение факта цехом (`reportPlanFact`) и повторная постановка в план
 * (`planStage` upsert-ом на ту же дату).
 *
 * Второй случай и был дырой: upsert писал `status: 'planned'` всегда, но факт
 * (`qty_done`, `fact_at`, переписку) намеренно НЕ трогал — и день, за который
 * цех уже отчитался, возвращался в «запланировано» с сохранённым результатом.
 * В сводке он переставал считаться выполненным, хотя работа сделана.
 *
 * `hasFact = false` (факта ещё не было) — всегда «запланировано»: статус
 * не должен опережать работу.
 */
export function planStatusForFact(
  qtyDone: number | null | undefined,
  qtyPlanned: number | null | undefined,
  hasFact: boolean,
): 'planned' | 'confirmed' | 'done' {
  if (!hasFact) return 'planned';
  const done = qtyDone ?? 0;
  const planned = qtyPlanned ?? 0;
  return planned > 0 && done >= planned ? 'done' : 'confirmed';
}

/**
 * Неделя как список дат YYYY-MM-DD, начиная с понедельника.
 *
 * Даты складываются через `utils/date` — здесь стоял `toISOString().slice(0,10)`,
 * и восточнее Гринвича он сдвигал КАЖДУЮ дату на сутки назад. Вместе с таким же
 * сдвигом в `mondayOf` доска показывала неделю с субботы, а подписи дней
 * («Понедельник», «Вторник»…) расставлялись по индексу и лгали заодно с датами.
 */
export function weekDates(mondayIso: string, days = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(addDays(mondayIso, i));
  return out;
}

/** Понедельник недели, в которую попадает дата (локально, без UTC-сдвига) */
export function mondayOf(iso: string): string {
  return mondayOfWeek(iso);
}

/** Сдвиг недели на N недель вперёд/назад */
export function shiftWeek(mondayIso: string, weeks: number): string {
  return addDays(mondayIso, weeks * 7);
}

export interface PlanSummary {
  /** Сколько задач в подборе */
  tasks: number;
  planned: number;
  fact: number;
  defect: number;
  /** План − факт, не меньше нуля */
  remaining: number;
  /**
   * Процент выполнения плана (0..100) или `null`, когда планировать было нечего.
   * Раньше здесь стояла 100 при нулевом плане, и пустая неделя рисовалась как
   * «100%» — «всё сделано» там, где не запланировано ничего.
   */
  percent: number | null;
  active: number;
  done: number;
  problems: number;
  overdue: number;
  awaitingMaterials: number;
}

const EMPTY: PlanSummary = {
  tasks: 0, planned: 0, fact: 0, defect: 0, remaining: 0, percent: null,
  active: 0, done: 0, problems: 0, overdue: 0, awaitingMaterials: 0,
};

export interface SummarySlot extends PlanSlotLike {
  qty_defect?: number | null;
  /** Ждёт ли материалы этап этой задачи — приходит от материального гейта */
  awaitingMaterials?: boolean;
}

/**
 * Сводка по набору задач (день цеха, неделя цеха, день всей фабрики —
 * зависит только от того, что передали).
 *
 * Отменённые задачи не считаются ни в план, ни в факт: они сняты руководителем
 * и учитывать их значило бы завышать «невыполнение».
 */
export function summarize(slots: SummarySlot[], today: string): PlanSummary {
  const live = slots.filter((s) => s.status !== 'cancelled');
  if (live.length === 0) return { ...EMPTY };

  const acc: PlanSummary = { ...EMPTY, tasks: live.length };
  for (const s of live) {
    const state = planCardState(s, today, Boolean(s.awaitingMaterials));
    acc.planned += s.qty_planned || 0;
    acc.fact += s.qty_done ?? 0;
    acc.defect += s.qty_defect ?? 0;
    acc.remaining += planRemaining(s);
    if (state === 'done') acc.done += 1;
    else acc.active += 1;
    if (s.problem_type) acc.problems += 1;
    if (planOverdue(s, today)) acc.overdue += 1;
    if (s.awaitingMaterials) acc.awaitingMaterials += 1;
  }
  acc.percent = percentOf(acc.fact, acc.planned);
  return acc;
}

/** Задачи по дням недели: дата → список (порядок внутри дня — sort_order) */
export function groupByDay<T extends { work_date: string; sort_order?: number }>(
  slots: T[],
  dates: string[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const d of dates) out[d] = [];
  for (const s of slots) {
    if (out[s.work_date]) out[s.work_date].push(s);
  }
  for (const d of dates) {
    out[d].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return out;
}

/**
 * Задачи, требующие внимания руководителя: недовыполнение прошедшего дня,
 * проблема или ожидание материалов. Требование: «если задача не выполнена
 * в установленный день, она должна появляться в списке отклонений» —
 * при этом система сама план НЕ меняет и ничего не переносит.
 */
export function deviations<T extends SummarySlot>(slots: T[], today: string): T[] {
  return slots.filter((s) => {
    if (s.status === 'cancelled' || s.status === 'done') return false;
    return planOverdue(s, today) || Boolean(s.problem_type) || Boolean(s.awaitingMaterials);
  });
}
