import { describe, it, expect } from 'vitest';
import {
  deviations, groupByDay, mondayOf, planStatusForFact, shiftWeek, summarize, weekDates,
} from './planDay';

const TODAY = '2026-08-05'; // среда

const slot = (over = {}) => ({
  work_date: TODAY,
  qty_planned: 100,
  qty_done: 0,
  qty_defect: 0,
  status: 'planned' as const,
  problem_type: null,
  fact_at: null,
  sort_order: 1000,
  ...over,
});

describe('неделя', () => {
  it('понедельник считается локально, без сдвига в UTC', () => {
    expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // среда → понедельник
    expect(mondayOf('2026-08-03')).toBe('2026-08-03'); // сам понедельник
    // Воскресенье относится к УХОДЯЩЕЙ неделе, а не к следующей
    expect(mondayOf('2026-08-09')).toBe('2026-08-03');
  });

  it('дни недели идут подряд', () => {
    expect(weekDates('2026-08-03', 5))
      .toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
  });

  it('переход между неделями и через границу месяца', () => {
    expect(shiftWeek('2026-08-03', 1)).toBe('2026-08-10');
    expect(shiftWeek('2026-08-03', -1)).toBe('2026-07-27');
  });
});

describe('summarize — сводка дня и цеха', () => {
  it('пустой набор — нули и сто процентов', () => {
    const s = summarize([], TODAY);
    expect(s.tasks).toBe(0);
    expect(s.percent).toBe(100);
  });

  it('складывает план, факт, брак и остаток', () => {
    const s = summarize([
      slot({ qty_done: 70, qty_defect: 3 }),
      slot({ qty_planned: 50, qty_done: 50 }),
    ], TODAY);
    expect(s.planned).toBe(150);
    expect(s.fact).toBe(120);
    expect(s.defect).toBe(3);
    expect(s.remaining).toBe(30);
    expect(s.percent).toBe(80);
    expect(s.done).toBe(1);
    expect(s.active).toBe(1);
  });

  it('считает проблемы, просрочки и ожидание материалов', () => {
    const s = summarize([
      slot({ problem_type: 'defect' }),
      slot({ work_date: '2026-08-03' }),
      slot({ awaitingMaterials: true }),
    ], TODAY);
    expect(s.problems).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.awaitingMaterials).toBe(1);
  });

  /**
   * Снятая руководителем задача не должна завышать невыполнение: она не работа,
   * а отменённое намерение.
   */
  it('отменённые задачи в план и факт не входят', () => {
    const s = summarize([
      slot({ qty_done: 100 }),
      slot({ status: 'cancelled', qty_planned: 999 }),
    ], TODAY);
    expect(s.tasks).toBe(1);
    expect(s.planned).toBe(100);
    expect(s.percent).toBe(100);
  });
});

describe('groupByDay', () => {
  it('раскладывает по датам недели и сортирует внутри дня', () => {
    const dates = weekDates('2026-08-03', 3);
    const g = groupByDay([
      slot({ work_date: '2026-08-04', sort_order: 2000, qty_planned: 2 }),
      slot({ work_date: '2026-08-04', sort_order: 1000, qty_planned: 1 }),
      slot({ work_date: '2026-09-01' }), // вне недели — отбрасывается
    ], dates);
    expect(Object.keys(g)).toEqual(dates);
    expect(g['2026-08-04'].map((s) => s.qty_planned)).toEqual([1, 2]);
    expect(g['2026-08-03']).toEqual([]);
  });
});

describe('deviations — что руководителю разбирать', () => {
  it('собирает просрочки, проблемы и ожидание материалов', () => {
    const list = [
      slot({ work_date: '2026-08-03', qty_done: 10 }),   // просрочено
      slot({ problem_type: 'defect' }),                  // проблема
      slot({ awaitingMaterials: true }),                 // ждёт материалы
      slot({ qty_done: 100 }),                           // выполнено
      slot({ work_date: '2026-08-06' }),                 // ещё не наступило
    ];
    expect(deviations(list, TODAY)).toHaveLength(3);
  });

  it('система сама ничего не переносит — только показывает', () => {
    // Отклонение остаётся на своей дате: перенос это решение руководителя
    const overdue = slot({ work_date: '2026-08-03', qty_done: 10 });
    expect(deviations([overdue], TODAY)[0].work_date).toBe('2026-08-03');
  });
});

/**
 * Одно правило «статус по факту» на две точки входа: внесение факта цехом
 * и повторная постановка задачи в план на ту же дату.
 *
 * Вторая и была дырой: upsert писал `status: 'planned'` безусловно, но факт
 * (`qty_done`, `fact_at`, переписку) намеренно не трогал — и день, за который
 * цех уже отчитался, откатывался в «запланировано» с сохранённым результатом.
 * В сводке работа переставала считаться выполненной.
 */
describe('planStatusForFact — статус задачи дня по факту', () => {
  it('факта не было — «запланировано», сколько бы ни стояло в плане', () => {
    expect(planStatusForFact(0, 100, false)).toBe('planned');
    expect(planStatusForFact(100, 100, false)).toBe('planned');
    expect(planStatusForFact(null, null, false)).toBe('planned');
  });

  it('факт есть, плана не добрали — «подтверждено»', () => {
    expect(planStatusForFact(40, 100, true)).toBe('confirmed');
    expect(planStatusForFact(0, 100, true)).toBe('confirmed');
  });

  it('факт добрал план — «выполнено» (перевыполнение тоже)', () => {
    expect(planStatusForFact(100, 100, true)).toBe('done');
    expect(planStatusForFact(140, 100, true)).toBe('done');
  });

  it('план ноль — «выполнено» не ставим: делить нечего', () => {
    expect(planStatusForFact(10, 0, true)).toBe('confirmed');
  });

  it('перепланирование дня с фактом сохраняет выполненность', () => {
    // Цех сдал 100 из 100, руководитель поднимает план на этот же день до 150
    expect(planStatusForFact(100, 150, true)).toBe('confirmed');
    // …и обратно: план урезали до сделанного — день снова выполнен
    expect(planStatusForFact(100, 100, true)).toBe('done');
  });
});
