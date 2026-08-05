/**
 * Состояние задачи производственного плана — цвет и ТЕКСТ карточки.
 *
 * Цвет здесь дополнительный сигнал, а не единственный: требование прямо говорит
 * «текстовый статус тоже должен оставаться видимым», и это же правило доступности
 * проекта. Поэтому функция возвращает пару «состояние + подпись», а не только класс.
 *
 * Чистая логика: экран лишь рисует результат.
 */

import { percentOf } from './format';
import type { ErpCalendarSlot } from '../types';

export type PlanCardState =
  /** запланировано, работа не начата */
  | 'planned'
  /** в работе */
  | 'in_progress'
  /** дневной план выполнен полностью */
  | 'done'
  /** выполнено частично либо зафиксирована проблема */
  | 'partial'
  /** срок прошёл, план не выполнен */
  | 'overdue'
  /** ждёт материалы */
  | 'awaiting_materials';

export const PLAN_STATE_LABELS: Record<PlanCardState, string> = {
  planned: 'Запланировано',
  in_progress: 'В работе',
  done: 'Выполнено',
  partial: 'Выполнено частично',
  overdue: 'Просрочено',
  awaiting_materials: 'Ожидает материалы',
};

/** Класс чипа статуса (совпадает с семантикой статус-чипов ERP) */
export const PLAN_STATE_CHIP: Record<PlanCardState, string> = {
  planned: 'chipNeutral',
  in_progress: 'chipProgress',
  done: 'chipDone',
  partial: 'chipWaiting',
  overdue: 'chipBlocked',
  awaiting_materials: 'chipWaiting',
};

export interface PlanSlotLike {
  work_date: string;
  qty_planned: number;
  qty_done?: number | null;
  status?: ErpCalendarSlot['status'];
  problem_type?: string | null;
  fact_at?: string | null;
}

/** Сколько осталось по задаче дня: план − факт, не меньше нуля */
export function planRemaining(slot: PlanSlotLike): number {
  return Math.max(0, (slot.qty_planned || 0) - (slot.qty_done ?? 0));
}

/**
 * Процент выполнения дневного плана (0..100) или `null`, когда плана нет.
 *
 * Раньше при нулевом плане возвращалось 100 («считаем выполненным») — то же
 * правило, из-за которого пустая неделя на /plan рисовалась как «100%».
 * Ноль в знаменателе означает «нечего было делать», а не «сделано».
 */
export function planPercent(slot: PlanSlotLike): number | null {
  return percentOf(slot.qty_done ?? 0, slot.qty_planned || 0);
}

/** День задачи прошёл, а план не закрыт. Показывается отдельным индикатором */
export function planOverdue(slot: PlanSlotLike, today: string): boolean {
  if (slot.status === 'done' || slot.status === 'cancelled') return false;
  return slot.work_date < today && planRemaining(slot) > 0;
}

/**
 * Состояние карточки.
 *
 * Порядок проверок смысловой. «Ожидает материалы» стоит выше просрочки не по
 * важности, а потому что отвечает на вопрос ПОЧЕМУ: красная карточка без причины
 * заставляет руководителя открывать каждую. Сама просрочка при этом не теряется —
 * её показывает `planOverdue` отдельным индикатором, и на карточке видны обе.
 *
 * Частичное выполнение до конца дня — жёлтое, после — красное: ровно так
 * сформулировано требование («жёлтым или красным в зависимости от того,
 * закончился ли срок»).
 */
export function planCardState(
  slot: PlanSlotLike,
  /** Сегодняшняя дата YYYY-MM-DD — передаётся, чтобы функция осталась чистой */
  today: string,
  /** Ждёт ли этап материалы (считает материальный гейт, а не план) */
  awaitingMaterials = false,
): PlanCardState {
  if (slot.status === 'done') return 'done';
  if (slot.qty_planned > 0 && planRemaining(slot) === 0) return 'done';
  if (awaitingMaterials) return 'awaiting_materials';
  if (planOverdue(slot, today)) return 'overdue';
  if (slot.problem_type) return 'partial';
  if ((slot.qty_done ?? 0) > 0) return 'partial';
  if (slot.status === 'confirmed') return 'in_progress';
  return 'planned';
}

/**
 * Нужна ли причина отклонения: факт меньше плана и день уже отработан
 * (внесён факт). Требование: «если фактическое меньше планового — потребовать
 * комментарий». Пустой факт до конца дня комментария не требует.
 */
export function needsDeviationReason(slot: PlanSlotLike): boolean {
  if (!slot.fact_at) return false;
  return planRemaining(slot) > 0;
}
