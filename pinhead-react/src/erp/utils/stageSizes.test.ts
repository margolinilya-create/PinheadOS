import { describe, it, expect } from 'vitest';
import type { SizeGridRow } from '../types';
import {
  sizeKey, stageSizeOutput, sizeInputFor, sizeInputRows, sizeReportBlock,
  sizeTotals, sizeReportPayload, rowEntered,
} from './stageSizes';

const GRID: SizeGridRow[] = [{ color: '—', sizes: { XS: 10, S: 20, M: 15 } }];
const k = (size: string) => sizeKey('—', size);

const report = (stageId: string, sizes: Record<string, number> | null) => ({
  id: `rep-${stageId}-${Math.random()}`,
  stage_id: stageId,
  warehouse_task_id: null,
  qty_in: null, qty_good: 0, qty_defect: 0, qty_rework: 0, qty_extra: 0,
  comment: null, extra: {}, author: null, author_id: null, created_at: '2026-09-16',
  sizes: sizes === null ? [] : Object.entries(sizes).map(([size, qty]) => ({
    id: `s-${size}`, report_id: 'r', color: '—', size, qty_good: qty,
    qty_defect: 0, qty_rework: 0, qty_extra: 0, created_at: '',
  })),
}) as never;

describe('stageSizeOutput', () => {
  it('складывает размерные строки всех отчётов этапа', () => {
    const reports = [report('cut', { XS: 4, S: 8 }), report('cut', { XS: 2, M: 5 })];
    expect(stageSizeOutput('cut', reports)).toEqual({
      [k('XS')]: 6, [k('S')]: 8, [k('M')]: 5,
    });
  });

  /**
   * FAIL-OPEN, и это условие выката: у этапов, закрытых до правки, размерных
   * строк нет вовсе. Прочитать их как «сдано ноль» значило бы в день выката
   * остановить швейку на ВСЕХ действующих заказах.
   */
  it('отчёты без размерной разбивки — это «данных нет», а не «ноль»', () => {
    expect(stageSizeOutput('cut', [report('cut', null)])).toBeNull();
  });

  it('этап без отчётов — тоже «данных нет»', () => {
    expect(stageSizeOutput('cut', [])).toBeNull();
    expect(stageSizeOutput('cut', null)).toBeNull();
  });
});

describe('sizeInputFor', () => {
  const stages = [{ id: 'cut' }, { id: 'dtf' }, { id: 'sew' }];

  it('один предшественник — сколько он сдал по размерам', () => {
    const input = sizeInputFor({ depends_on: ['cut'] }, stages, [report('cut', { XS: 4, S: 8 })]);
    expect(input).toEqual({ [k('XS')]: 4, [k('S')]: 8 });
  });

  /**
   * МИНИМУМ, А НЕ СУММА — тот же довод, что у `stageInputQty`: параллельные
   * ветки нанесения проходят ОДНИ И ТЕ ЖЕ изделия, и сумма дала бы вдвое
   * больше, чем существует.
   */
  it('две параллельные ветки — минимум по каждому размеру', () => {
    const reports = [report('cut', { XS: 10, S: 20 }), report('dtf', { XS: 7, S: 20 })];
    expect(sizeInputFor({ depends_on: ['cut', 'dtf'] }, stages, reports))
      .toEqual({ [k('XS')]: 7, [k('S')]: 20 });
  });

  it('размер, которого нет в одной ветке, даёт ноль — он через неё не прошёл', () => {
    const reports = [report('cut', { XS: 10, M: 5 }), report('dtf', { XS: 10 })];
    expect(sizeInputFor({ depends_on: ['cut', 'dtf'] }, stages, reports)?.[k('M')]).toBe(0);
  });

  it('первый этап маршрута потолка по размерам не имеет', () => {
    expect(sizeInputFor({ depends_on: [] }, stages, [])).toBeNull();
  });

  it('предшественник без размерных данных не создаёт потолка', () => {
    expect(sizeInputFor({ depends_on: ['cut'] }, stages, [report('cut', null)])).toBeNull();
  });

  it('зависимость на этап вне набора игнорируется — урезанная выборка не должна врать', () => {
    expect(sizeInputFor({ depends_on: ['unknown'] }, stages, [])).toBeNull();
  });
});

describe('sizeInputRows', () => {
  it('строки берутся у ПОЗИЦИИ, а «принято» подставляется из входа', () => {
    const rows = sizeInputRows(GRID, { [k('XS')]: 4, [k('S')]: 8 });
    expect(rows.map((r) => [r.size, r.expected])).toEqual([['XS', 4], ['S', 8], ['M', 0]]);
  });

  it('без входных данных «принято» неизвестно, а строки всё равно есть', () => {
    expect(sizeInputRows(GRID, null).map((r) => r.expected)).toEqual([null, null, null]);
  });
});

describe('sizeReportBlock — проверка превышения', () => {
  const rows = sizeInputRows(GRID, { [k('XS')]: 10, [k('S')]: 20, [k('M')]: 15 });

  it('сумма сшито+брак+переделка не может превысить принятое по размеру', () => {
    const values = { [k('XS')]: { good: 8, defect: 2, rework: 2 } };
    const block = sizeReportBlock(rows, values);
    expect(block).toContain('XS');
    expect(block).toContain('12');
    expect(block).toContain('10');
  });

  it('ровно столько, сколько принято, — не превышение', () => {
    expect(sizeReportBlock(rows, { [k('XS')]: { good: 7, defect: 2, rework: 1 } })).toBeNull();
  });

  it('при неизвестном входе строка не блокируется — работает общий потолок этапа', () => {
    const unknown = sizeInputRows(GRID, null);
    expect(sizeReportBlock(unknown, { [k('XS')]: { good: 999 } })).toBeNull();
  });

  it('rowEntered складывает три колонки и игнорирует мусор', () => {
    expect(rowEntered({ good: 5, defect: '2', rework: null })).toBe(7);
    expect(rowEntered({ good: -3 })).toBe(0);
  });
});

describe('итоги и полезная нагрузка', () => {
  const rows = sizeInputRows(GRID, { [k('XS')]: 10, [k('S')]: 20, [k('M')]: 15 });
  const values = {
    [k('XS')]: { good: 9, defect: 1 },
    [k('S')]: { good: 18, rework: 2 },
  };

  it('итоги считаются по колонкам, а не вводятся', () => {
    expect(sizeTotals(rows, values)).toEqual({ good: 27, defect: 1, rework: 2, expected: 45 });
  });

  it('в отчёт уезжают только заполненные строки', () => {
    expect(sizeReportPayload(rows, values)).toEqual([
      { color: '—', size: 'XS', qty_good: 9, qty_defect: 1, qty_rework: 0 },
      { color: '—', size: 'S', qty_good: 18, qty_defect: 0, qty_rework: 2 },
    ]);
  });
});
