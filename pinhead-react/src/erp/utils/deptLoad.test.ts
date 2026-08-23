import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { buildDeptLoad, loadDays, ordersWithoutPlan, weekStart } from './deptLoad';

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
    expect(buildDeptLoad([], DEPTS, DAYS, TODAY))
      .toEqual({ rows: [], maxCell: 0, totals: { planned: 0, unplanned: 0 } });
  });
});

/**
 * «Планов нет ни у чего» против «на этой неделе пусто».
 *
 * Экран обязан их различать: в первом случае листать недели бессмысленно,
 * во втором — осмысленно. На проде 22.08 было ровно первое (43 открытых
 * этапа, плановой даты нет ни у одного), и экран показывал строки цехов
 * с семью прочерками — то есть выглядел рабочим и отвечал неправду.
 */
describe('totals: планируют ли вообще', () => {
  it('ни одной плановой даты — planned = 0', () => {
    const { totals, rows } = buildDeptLoad(
      [order(10, [stage('d1', null), stage('d2', null)])], DEPTS, DAYS, TODAY,
    );
    expect(totals).toEqual({ planned: 0, unplanned: 2 });
    // Строки при этом ЕСТЬ — их держат этапы без плана, поэтому пустое
    // состояние экрана не показывается и полоса обязана быть отдельной
    expect(rows).toHaveLength(2);
  });

  it('план на другую неделю — это ЗАПЛАНИРОВАНО, а не «дат нет»', () => {
    const { totals } = buildDeptLoad(
      [order(10, [stage('d1', '2026-09-15')])], DEPTS, DAYS, TODAY,
    );
    expect(totals).toEqual({ planned: 1, unplanned: 0 });
  });

  it('просроченный план тоже считается планом', () => {
    const { totals } = buildDeptLoad(
      [order(10, [stage('d1', '2026-07-01')])], DEPTS, DAYS, TODAY,
    );
    expect(totals).toEqual({ planned: 1, unplanned: 0 });
  });

  it('закрытые этапы и подряд в счёт не идут', () => {
    const closed = stage('d1', null, 'done');
    const contractor = { ...stage('d2', null), executor: 'contractor' };
    const { totals } = buildDeptLoad(
      [order(10, [closed, contractor, stage('d3', null)])], DEPTS, DAYS, TODAY,
    );
    expect(totals).toEqual({ planned: 0, unplanned: 1 });
  });
});

/** Тот же регресс, что на доске плана: сетка загрузки начиналась с субботы */
describe('неделя загрузки в поясе UTC+3', () => {
  const REAL_TZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Europe/Moscow'; });
  afterAll(() => {
    if (REAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = REAL_TZ;
  });

  it('weekStart понедельника — он сам', () => {
    expect(weekStart('2026-08-10')).toBe('2026-08-10');
  });

  it('loadDays не сдвигает даты на сутки назад', () => {
    expect(loadDays('2026-08-10', 3)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });
});

/**
 * Куда идти проставлять срок. Полоса «загрузка не рассчитывается» без списка
 * заказов оставляет человека с задачей «найди сам среди пятнадцати».
 */
describe('ordersWithoutPlan', () => {
  const ord = (id: string, stages: any[], status = 'active') =>
    ({ id, status, items: [{ id: `${id}-i`, qty: 10, stages }], materials: [] }) as any;

  it('собирает только заказы с открытыми этапами без даты', () => {
    const rows = ordersWithoutPlan([
      ord('a', [stage('d1', null), stage('d2', null)]),
      ord('b', [stage('d1', '2026-09-01')]),
      ord('c', [stage('d1', null, 'done')]),
    ]);
    expect(rows.map((r) => r.order.id)).toEqual(['a']);
    expect(rows[0].unplanned).toBe(2);
  });

  it('сортирует по числу этапов без даты — начинать с крупного', () => {
    const rows = ordersWithoutPlan([
      ord('small', [stage('d1', null)]),
      ord('big', [stage('d1', null), stage('d2', null), stage('d3', null)]),
    ]);
    expect(rows.map((r) => r.order.id)).toEqual(['big', 'small']);
  });

  it('подряд не считается: срок подрядчику ставят в его карточке', () => {
    const contractor = { ...stage('d2', null), executor: 'contractor' };
    const rows = ordersWithoutPlan([ord('a', [contractor])]);
    expect(rows).toEqual([]);
  });

  it('архивный заказ в список не идёт', () => {
    expect(ordersWithoutPlan([ord('a', [stage('d1', null)], 'archived')])).toEqual([]);
  });
});
