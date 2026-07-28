import { describe, it, expect } from 'vitest';
import { buildDeptLoad, loadDays, weekStart } from './deptLoad';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный', sort_order: 10 },
  { id: 'd2', code: 'sewing', name: 'Швейный', sort_order: 20 },
  { id: 'd3', code: 'vto', name: 'ВТО', sort_order: 30 },
] as any[];

const DAYS = loadDays('2026-08-03', 7); // пн–вс
const TODAY = '2026-08-03';

/** Заказ с одной позицией и произвольным набором этапов */
function order(qty: number, stages: any[], status = 'active') {
  return { status, items: [{ id: 'i', qty, stages }], materials: [] } as any;
}
function stage(deptId: string, planned: string | null, st = 'waiting', qtyDone = 0) {
  return { id: `s-${deptId}-${planned}`, department_id: deptId, planned_end: planned, status: st, qty_done: qtyDone };
}

describe('loadDays / weekStart', () => {
  it('loadDays отдаёт подряд идущие даты', () => {
    expect(loadDays('2026-08-03', 3)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('loadDays переходит через границу месяца', () => {
    expect(loadDays('2026-08-30', 3)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('weekStart — понедельник недели', () => {
    expect(weekStart('2026-08-05')).toBe('2026-08-03'); // среда → пн
    expect(weekStart('2026-08-03')).toBe('2026-08-03'); // пн → сам
    expect(weekStart('2026-08-09')).toBe('2026-08-03'); // вс → пн той же недели
  });
});

describe('buildDeptLoad', () => {
  it('раскладывает остаток позиции по дню планового завершения', () => {
    const { rows } = buildDeptLoad([order(10, [stage('d1', '2026-08-05')])], DEPTS, DAYS, TODAY);
    expect(rows).toHaveLength(1);
    const cell = rows[0].cells.find((c) => c.date === '2026-08-05');
    expect(cell).toMatchObject({ qty: 10, stages: 1 });
    expect(rows[0].total).toBe(10);
  });

  it('считает остаток, а не полное количество', () => {
    const { rows } = buildDeptLoad(
      [order(10, [stage('d1', '2026-08-05', 'in_progress', 4)])], DEPTS, DAYS, TODAY,
    );
    expect(rows[0].cells.find((c) => c.date === '2026-08-05')?.qty).toBe(6);
  });

  it('суммирует несколько этапов в один день', () => {
    const { rows } = buildDeptLoad(
      [order(10, [stage('d1', '2026-08-05')]), order(5, [stage('d1', '2026-08-05')])],
      DEPTS, DAYS, TODAY,
    );
    expect(rows[0].cells.find((c) => c.date === '2026-08-05')).toMatchObject({ qty: 15, stages: 2 });
  });

  it('закрытые этапы (done/skipped) не грузят цех', () => {
    const { rows } = buildDeptLoad(
      [order(10, [stage('d1', '2026-08-05', 'done'), stage('d2', '2026-08-05', 'skipped')])],
      DEPTS, DAYS, TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it('архивные заказы не учитываются', () => {
    const { rows } = buildDeptLoad(
      [order(10, [stage('d1', '2026-08-05')], 'done_on_time')], DEPTS, DAYS, TODAY,
    );
    expect(rows).toHaveLength(0);
  });

  it('этап без плановой даты попадает в «без плана», а не в дни', () => {
    const { rows } = buildDeptLoad([order(7, [stage('d1', null)])], DEPTS, DAYS, TODAY);
    expect(rows[0].unplanned).toEqual({ qty: 7, stages: 1 });
    expect(rows[0].total).toBe(0);
  });

  it('план в прошлом → просрочка отдельной группой', () => {
    const { rows } = buildDeptLoad([order(3, [stage('d1', '2026-07-30')])], DEPTS, DAYS, TODAY);
    expect(rows[0].overdue).toEqual({ qty: 3, stages: 1 });
    expect(rows[0].total).toBe(0);
  });

  it('план сегодня — это ещё не просрочка', () => {
    const { rows } = buildDeptLoad([order(3, [stage('d1', TODAY)])], DEPTS, DAYS, TODAY);
    expect(rows[0].overdue.stages).toBe(0);
    expect(rows[0].cells[0]).toMatchObject({ date: TODAY, qty: 3 });
  });

  it('план за пределами видимого периода не попадает никуда', () => {
    const { rows } = buildDeptLoad([order(3, [stage('d1', '2026-09-15')])], DEPTS, DAYS, TODAY);
    expect(rows).toHaveLength(0);
  });

  it('цеха без работ в сетку не попадают, а занятые сортируются по нагрузке', () => {
    const { rows } = buildDeptLoad(
      [order(4, [stage('d1', '2026-08-04')]), order(20, [stage('d2', '2026-08-06')])],
      DEPTS, DAYS, TODAY,
    );
    expect(rows.map((r) => r.dept.code)).toEqual(['sewing', 'cutting']);
  });

  it('maxCell — максимум по всем ячейкам (шкала заливки)', () => {
    const { maxCell } = buildDeptLoad(
      [order(4, [stage('d1', '2026-08-04')]), order(20, [stage('d2', '2026-08-06')])],
      DEPTS, DAYS, TODAY,
    );
    expect(maxCell).toBe(20);
  });

  it('пустые данные не роняют расчёт', () => {
    expect(buildDeptLoad([], DEPTS, DAYS, TODAY)).toEqual({ rows: [], maxCell: 0 });
  });
});
