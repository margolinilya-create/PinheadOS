import { describe, it, expect } from 'vitest';
import {
  planCardState, planOverdue, planPercent, planRemaining, needsDeviationReason,
} from './planCard';

/**
 * Состояние задачи производственного плана. Цвет здесь — дополнительный сигнал,
 * поэтому у каждого состояния есть и текстовая подпись; тесты закрепляют именно
 * смысл состояний, а не палитру.
 */

const TODAY = '2026-08-05';
const slot = (over = {}) => ({
  work_date: TODAY,
  qty_planned: 100,
  qty_done: 0,
  status: 'planned' as const,
  problem_type: null,
  fact_at: null,
  ...over,
});

describe('planRemaining / planPercent', () => {
  it('остаток = план − факт и никогда не отрицательный', () => {
    expect(planRemaining(slot({ qty_done: 70 }))).toBe(30);
    expect(planRemaining(slot({ qty_done: 100 }))).toBe(0);
    // Сделали больше плана — остаток ноль, а не «минус двадцать»
    expect(planRemaining(slot({ qty_done: 120 }))).toBe(0);
    expect(planRemaining(slot({ qty_done: null }))).toBe(100);
  });

  it('процент выполнения ограничен сотней, нулевой план считается закрытым', () => {
    expect(planPercent(slot({ qty_done: 70 }))).toBe(70);
    expect(planPercent(slot({ qty_done: 120 }))).toBe(100);
    expect(planPercent(slot({ qty_planned: 0 }))).toBe(100);
  });
});

describe('planCardState', () => {
  it('запланировано: день не наступил, работы не было', () => {
    expect(planCardState(slot({ work_date: '2026-08-06' }), TODAY)).toBe('planned');
  });

  it('частично: факт есть, но план не закрыт и день ещё не прошёл', () => {
    expect(planCardState(slot({ qty_done: 70 }), TODAY)).toBe('partial');
  });

  it('выполнено: факт закрыл дневной план', () => {
    expect(planCardState(slot({ qty_done: 100 }), TODAY)).toBe('done');
    expect(planCardState(slot({ qty_done: 0, status: 'done' }), TODAY)).toBe('done');
  });

  it('просрочено: день прошёл, план не закрыт', () => {
    expect(planCardState(slot({ work_date: '2026-08-03', qty_done: 70 }), TODAY)).toBe('overdue');
  });

  it('закрытая вчера задача просроченной не считается', () => {
    expect(planCardState(slot({ work_date: '2026-08-03', qty_done: 100 }), TODAY)).toBe('done');
    expect(planOverdue(slot({ work_date: '2026-08-03', qty_done: 100 }), TODAY)).toBe(false);
  });

  it('проблема делает карточку жёлтой даже без факта', () => {
    expect(planCardState(slot({ problem_type: 'defect' }), TODAY)).toBe('partial');
  });

  /**
   * «Ожидает материалы» отвечает на вопрос ПОЧЕМУ, поэтому перебивает цвет
   * просрочки. Сама просрочка при этом не теряется — её отдельно отдаёт
   * planOverdue, и карточка показывает оба признака.
   */
  it('ожидание материалов важнее цвета просрочки, но просрочку не прячет', () => {
    const s = slot({ work_date: '2026-08-03', qty_done: 0 });
    expect(planCardState(s, TODAY, true)).toBe('awaiting_materials');
    expect(planOverdue(s, TODAY)).toBe(true);
  });

  it('выполненная задача материалов уже не ждёт', () => {
    expect(planCardState(slot({ qty_done: 100 }), TODAY, true)).toBe('done');
  });

  it('снятая руководителем задача просроченной не бывает', () => {
    expect(planOverdue(slot({ work_date: '2026-08-01', status: 'cancelled' }), TODAY)).toBe(false);
  });
});

describe('needsDeviationReason', () => {
  it('требует причину, когда факт внесён и меньше плана', () => {
    expect(needsDeviationReason(slot({ qty_done: 70, fact_at: '2026-08-05T18:00:00Z' }))).toBe(true);
  });

  it('не требует, пока факт не вносили', () => {
    expect(needsDeviationReason(slot({ qty_done: 0 }))).toBe(false);
  });

  it('не требует при полном выполнении', () => {
    expect(needsDeviationReason(slot({ qty_done: 100, fact_at: '2026-08-05T18:00:00Z' }))).toBe(false);
  });
});
