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

import { planCardState, planOverdue, planRemaining } from './planCard';
import type { PlanSlotLike } from './planCard';

/** Неделя как список дат YYYY-MM-DD, начиная с понедельника */
export function weekDates(mondayIso: string, days = 7): string[] {
  const out: string[] = [];
  const base = new Date(`${mondayIso}T00:00:00`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Понедельник недели, в которую попадает дата (локально, без UTC-сдвига) */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const shift = (d.getDay() + 6) % 7; // вс=0 → 6
  d.setDate(d.getDate() - shift);
  return d.toISOString().slice(0, 10);
}

/** Сдвиг недели на N недель вперёд/назад */
export function shiftWeek(mondayIso: string, weeks: number): string {
  const d = new Date(`${mondayIso}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export interface PlanSummary {
  /** Сколько задач в подборе */
  tasks: number;
  planned: number;
  fact: number;
  defect: number;
  /** План − факт, не меньше нуля */
  remaining: number;
  /** Процент выполнения плана (0..100); план 0 → 100 */
  percent: number;
  active: number;
  done: number;
  problems: number;
  overdue: number;
  awaitingMaterials: number;
}

const EMPTY: PlanSummary = {
  tasks: 0, planned: 0, fact: 0, defect: 0, remaining: 0, percent: 100,
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

  const acc = { ...EMPTY, tasks: live.length, percent: 0 };
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
  acc.percent = acc.planned > 0
    ? Math.min(100, Math.round((acc.fact / acc.planned) * 100))
    : 100;
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
