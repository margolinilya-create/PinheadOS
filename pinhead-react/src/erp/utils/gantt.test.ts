import { describe, expect, it } from 'vitest';
import { ganttBars } from './gantt';
import type { ErpDepartment } from '../types';
import type { ErpOrderFull } from '../store/types';

/**
 * ГАНТ (правки 07.09, п. 19).
 *
 * Главное, что здесь сторожится, — ИСТОЧНИК ДАТЫ. Плановых дат на живой базе
 * почти нет, и цепочка «план → факт → срок заказа» существует ровно затем,
 * чтобы диаграмма не была пустой. Цена ошибки — догадка, выданная за план:
 * по ней начнут принимать решения о сроках. Поэтому у каждой полосы
 * проверяется не только положение, но и то, чем она объявлена.
 */

const DEPARTMENTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', sort_order: 50, active: true,
    is_production: true },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', sort_order: 70, active: true,
    is_production: true },
] as unknown as ErpDepartment[];

interface StageInput {
  id: string;
  department_id?: string;
  status?: string;
  planned_start?: string | null;
  planned_end?: string | null;
  started_at?: string | null;
  executor?: string;
}

function order(stages: StageInput[], extra: Record<string, unknown> = {}): ErpOrderFull {
  return {
    id: 'o1', status: 'active', title: 'PH-1', launch_date: null, due_date: null,
    items: [{
      id: 'it1', qty: 100, product_type: 'Худи',
      stages: stages.map((s) => ({
        planned_start: null, planned_end: null, started_at: null,
        status: 'waiting', department_id: 'd-cut', qty_done: 0, sort_order: 10,
        ...s,
      })),
    }],
    materials: [], procurement_tasks: [], attachments: [], tz_documents: [],
    ...extra,
  } as unknown as ErpOrderFull;
}

const WEEK = { from: '2026-09-07', days: 7, today: '2026-09-07' };

describe('источник даты у полосы', () => {
  it('плановые даты этапа — самые сильные', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-08', planned_end: '2026-09-10',
        started_at: '2026-09-07T06:00:00Z' }], { launch_date: '2026-09-01', due_date: '2026-09-30' })],
      DEPARTMENTS, WEEK,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({
      start: '2026-09-08', end: '2026-09-10', startSource: 'planned', endSource: 'planned',
    });
  });

  it('без планового начала берётся ДЕНЬ фактического старта', () => {
    // `started_at` — момент (timestamptz), а полоса живёт в календарных днях
    const { bars } = ganttBars(
      [order([{ id: 's1', started_at: '2026-09-09T21:30:00Z', planned_end: '2026-09-11',
        status: 'in_progress' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({ start: '2026-09-09', startSource: 'fact' });
  });

  it('без плана и факта начало берётся у ЗАКАЗА — и так и подписано', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1' }], { launch_date: '2026-09-08', due_date: '2026-09-11' })],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({
      start: '2026-09-08', end: '2026-09-11', startSource: 'order', endSource: 'order',
    });
  });

  it('плановый конец этапа сильнее срока заказа', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', planned_end: '2026-09-09' }],
        { launch_date: '2026-09-07', due_date: '2026-09-30' })],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({ end: '2026-09-09', endSource: 'planned' });
  });
});

describe('конец главнее начала', () => {
  /**
   * Самый частый случай на живой базе: `planned_end` поставила форма «Взять
   * в работу», а начала не назвал никто. Полоса ОБЯЗАНА появиться — иначе
   * диаграмма молчит ровно про ту работу, у которой срок есть; но растянуть
   * её «от сегодня» нельзя: длительность работы никто не называл.
   */
  it('срок без начала даёт полосу в один день, помеченную `none`', () => {
    const { bars, undated } = ganttBars(
      [order([{ id: 's1', planned_end: '2026-09-10' }])],
      DEPARTMENTS, WEEK,
    );
    expect(undated).toHaveLength(0);
    expect(bars[0]).toMatchObject({
      start: '2026-09-10', end: '2026-09-10', spanDays: 1,
      startSource: 'none', endSource: 'planned',
    });
  });
});

describe('этап без конечной даты', () => {
  /**
   * Полосы нет — рисовать её было бы враньём. Но и молчать нельзя: сегодня
   * таких этапов большинство, и пустая диаграмма читалась бы как «работы нет».
   */
  it('уходит в `undated`, а не в полосы', () => {
    const { bars, undated } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-08' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars).toHaveLength(0);
    expect(undated.map((b) => b.stageId)).toEqual(['s1']);
    expect(undated[0]).toMatchObject({ start: null, end: null, endSource: 'none' });
  });

  it('считается БЕЗ оглядки на видимый период', () => {
    // Иначе «сроки вообще ставят?» превращалось бы в «на этой неделе ставят?»
    const { undated } = ganttBars(
      [order([{ id: 's1' }])],
      DEPARTMENTS, { from: '2027-01-04', days: 7, today: '2027-01-04' },
    );
    expect(undated).toHaveLength(1);
  });
});

describe('геометрия полосы', () => {
  it('смещение и длина считаются в днях от начала периода', () => {
    const { bars, dates } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-09', planned_end: '2026-09-11' }])],
      DEPARTMENTS, WEEK,
    );
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-09-07');
    expect(bars[0]).toMatchObject({ offsetDays: 2, spanDays: 3 });
  });

  it('«день в день» — это полоса в один день, а не нулевая', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-08', planned_end: '2026-09-08' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0].spanDays).toBe(1);
  });

  it('начало раньше периода даёт ОТРИЦАТЕЛЬНОЕ смещение, а не обрезку', () => {
    // Экран сам решает, как показать хвост слева; утилита не врёт про даты
    const { bars } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-04', planned_end: '2026-09-09' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({ offsetDays: -3, spanDays: 6 });
  });

  it('этап целиком вне периода в диаграмму не попадает', () => {
    const { bars, undated } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-10-01', planned_end: '2026-10-05' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars).toHaveLength(0);
    // …и «без даты» это тоже не значит: дата у него есть
    expect(undated).toHaveLength(0);
  });

  /**
   * Запуск заказа позже его срока — опечатка в паре дат, и на живой базе она
   * возможна. Полоса, растущая справа налево, хуже полосы нулевой длины:
   * первая читается как «этап идёт назад во времени».
   */
  it('начало позже конца схлопывается в конец, а не разворачивает полосу', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1' }], { launch_date: '2026-09-11', due_date: '2026-09-09' })],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({ start: '2026-09-09', end: '2026-09-09', spanDays: 1 });
  });
});

describe('что попадает в диаграмму', () => {
  it('закрытые и пропущенные этапы не показываются', () => {
    const { bars, undated } = ganttBars(
      [order([
        { id: 's1', status: 'done', planned_end: '2026-09-09' },
        { id: 's2', status: 'skipped', planned_end: '2026-09-09' },
        { id: 's3', status: 'ready', planned_end: '2026-09-09' },
      ])],
      DEPARTMENTS, WEEK,
    );
    expect(bars.map((b) => b.stageId)).toEqual(['s3']);
    expect(undated).toHaveLength(0);
  });

  it('заказ не в работе не показывается вовсе', () => {
    const { bars, undated } = ganttBars(
      [order([{ id: 's1', planned_end: '2026-09-09' }], { status: 'archived' })],
      DEPARTMENTS, WEEK,
    );
    expect(bars).toHaveLength(0);
    expect(undated).toHaveLength(0);
  });

  /**
   * Подряд ОСТАЁТСЯ, в отличие от загрузки цехов: там считались обязательства
   * нашего цеха, здесь — «когда что происходит по заказу», и выпавший подряд
   * оставил бы дыру между двумя нашими этапами. Помечен отдельно.
   */
  it('подрядный этап остаётся, но помечен', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', executor: 'contractor', planned_end: '2026-09-09' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].outsourced).toBe(true);
  });

  it('просрочка — конец в прошлом у незакрытого этапа', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', planned_start: '2026-09-07', planned_end: '2026-09-08' }])],
      DEPARTMENTS, { from: '2026-09-07', days: 7, today: '2026-09-10' },
    );
    expect(bars[0].overdue).toBe(true);
  });
});

describe('порядок строк', () => {
  it('по началу, затем по концу, затем устойчиво по этапу', () => {
    const { bars } = ganttBars(
      [order([
        { id: 's-b', planned_start: '2026-09-09', planned_end: '2026-09-12' },
        { id: 's-a', planned_start: '2026-09-09', planned_end: '2026-09-10' },
        { id: 's-c', planned_start: '2026-09-08', planned_end: '2026-09-13' },
      ])],
      DEPARTMENTS, WEEK,
    );
    expect(bars.map((b) => b.stageId)).toEqual(['s-c', 's-a', 's-b']);
  });
});

describe('подписи строки', () => {
  it('несут заказ, изделие и участок', () => {
    const { bars } = ganttBars(
      [order([{ id: 's1', department_id: 'd-sew', planned_end: '2026-09-09' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0]).toMatchObject({
      orderTitle: 'PH-1', itemTitle: 'Худи · 100 шт', deptName: 'Швейный цех', deptCode: 'sewing',
    });
  });

  it('неизвестный участок не роняет строку', () => {
    // Цех деактивирован либо справочник ещё не приехал: показать этап важнее
    const { bars } = ganttBars(
      [order([{ id: 's1', department_id: 'd-gone', planned_end: '2026-09-09' }])],
      DEPARTMENTS, WEEK,
    );
    expect(bars[0].deptName).toBe('—');
  });
});
