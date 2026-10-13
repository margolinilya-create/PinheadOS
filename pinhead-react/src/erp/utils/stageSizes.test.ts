import { describe, it, expect } from 'vitest';
import type { SizeGridRow } from '../types';
import {
  sizeKey, stageSizeOutput, sizeInputFor, sizeInputRows, sizeReportBlock,
  sizeTotals, sizeReportPayload, rowEntered, sizeInputCells, stageAncestors,
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

  /**
   * Потолка нет, только когда разбивки нет ВО ВСЕЙ цепочке (правка 27.09,
   * п. 6): первый этап маршрута без размерного отчёта — судить не по чему.
   */
  it('предшественник без размерных данных и без своих предков не создаёт потолка', () => {
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

  /**
   * ПОТОЛОК — ОСТАТОК ИЗ ПРИНЯТЫХ (правка 27.09, п. 7): прежние сдачи этого
   * этапа уже забрали своё. Принято 10, сдано 7 и списано 1 → сдать можно 2.
   */
  it('после прежних сдач потолок строки — остаток, а не «принято»', () => {
    const later = sizeInputRows(GRID, { [k('XS')]: 10 }, [], { [k('XS')]: 8 });
    expect(later[0].expected).toBe(10);
    expect(later[0].remaining).toBe(2);
    expect(sizeReportBlock(later, { [k('XS')]: { good: 2 } })).toBeNull();
    const block = sizeReportBlock(later, { [k('XS')]: { good: 3 } });
    expect(block).toContain('больше 2 шт сдать нельзя');
    expect(block).toContain('введено 3');
    // Итоги несут и остаток
    expect(sizeTotals(later, {}).remaining).toBe(2);
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
    expect(sizeTotals(rows, values)).toEqual({ good: 27, defect: 1, rework: 2, expected: 45, remaining: 45 });
  });

  it('в отчёт уезжают только заполненные строки', () => {
    expect(sizeReportPayload(rows, values)).toEqual([
      { color: '—', size: 'XS', qty_good: 9, qty_defect: 1, qty_rework: 0 },
      { color: '—', size: 'S', qty_good: 18, qty_defect: 0, qty_rework: 2 },
    ]);
  });
});

/**
 * СТРОКИ ТАБЛИЦЫ ПРИ ОТСУТСТВИИ СЕТКИ (правка заказчика 20.09, п. 8).
 *
 * `sizeInputRows` строила строки ТОЛЬКО по сетке позиции, и `gridCells(null)`
 * пуст — таблицы не было вовсе. Документ требует обратного: «размеры
 * и количество „Покроено, шт" должны подтягиваться из этапа закройки».
 */
describe('размеры подтягиваются из закроя, когда сетки у позиции нет', () => {
  const STAGE = { depends_on: ['cut1'] };
  const ALL = [{ id: 'cut1' }, { id: 'sew1' }];
  const REPORTS = [{
    id: 'r1',
    stage_id: 'cut1',
    sizes: [
      { color: '—', size: 'M', qty_good: 30 },
      { color: '—', size: 'L', qty_good: 20 },
    ],
  }] as never;

  it('sizeInputCells отдаёт размер и цвет, а не только ключ и число', () => {
    const cells = sizeInputCells(STAGE, ALL, REPORTS);
    expect(cells).toEqual(expect.arrayContaining([
      { color: '—', size: 'M', qty: 30 },
      { color: '—', size: 'L', qty: 20 },
    ]));
  });

  it('без сетки строки берутся из факта закроя', () => {
    const rows = sizeInputRows(null, sizeInputFor(STAGE, ALL, REPORTS), sizeInputCells(STAGE, ALL, REPORTS));
    expect(rows.map((r) => r.size).sort()).toEqual(['L', 'M']);
    expect(rows.find((r) => r.size === 'M')?.expected).toBe(30);
  });

  it('сетка есть — она и главная: строки заказа, включая ещё не скроенные', () => {
    const grid = [{ color: '—', sizes: { M: 40, XL: 10 } }];
    const rows = sizeInputRows(grid, sizeInputFor(STAGE, ALL, REPORTS), sizeInputCells(STAGE, ALL, REPORTS));
    // XL в заказе есть, закрой его не сдавал — строка обязана остаться с нулём
    expect(rows.map((r) => r.size)).toEqual(['M', 'XL']);
    expect(rows.find((r) => r.size === 'XL')?.expected).toBe(0);
  });

  it('закрой ничего не сдавал — строк из факта нет, потолка тоже (fail-open)', () => {
    expect(sizeInputCells(STAGE, ALL, [])).toEqual([]);
    expect(sizeInputRows(null, null, [])).toEqual([]);
  });
});

/**
 * СВЯЗЬ С ЗАКРОЕМ ЧЕРЕЗ ПРОМЕЖУТОЧНЫЙ ЭТАП (правка заказчика 27.09, п. 6).
 *
 * «Задача появилась в швейном цехе, но столбец „Покроено, шт" пустой:
 * по размерам стоят прочерки, в строке „Итого" стоит 0. При этом сверху
 * отображается „Принято в работу: 472 шт"». Маршрут закрой → вышивка →
 * пошив: швейка зависит от вышивки, у той размерного отчёта нет, и прямые
 * предшественники давали `null`. Документ: «сохранять связь с результатом
 * закройки, даже если между закройкой и пошивом есть нанесение».
 *
 * Мутация: вернуть в `sizeInputFor` обход только по `depends_on` — красный.
 */
describe('«Покроено» через промежуточный этап без размеров (27.09, п. 6)', () => {
  const chain = [
    { id: 'cut', depends_on: [] },
    { id: 'emb', depends_on: ['cut'] },
    { id: 'sew', depends_on: ['emb'] },
  ];
  const cutOnly = [report('cut', { XS: 200, S: 272 })];

  it('вышивка без разбивки прозрачна — швейка видит размеры закроя', () => {
    expect(sizeInputFor({ depends_on: ['emb'] }, chain, cutOnly))
      .toEqual({ [k('XS')]: 200, [k('S')]: 272 });
  });

  it('вышивка со своим размерным отчётом — берётся он, а не закрой', () => {
    const both = [...cutOnly, report('emb', { XS: 150, S: 272 })];
    expect(sizeInputFor({ depends_on: ['emb'] }, chain, both)?.[k('XS')]).toBe(150);
  });

  it('две ветки нанесения без разбивки — обе ведут к закрою, минимум не занижает', () => {
    const fork = [
      { id: 'cut', depends_on: [] },
      { id: 'emb', depends_on: ['cut'] },
      { id: 'dtf', depends_on: ['cut'] },
      { id: 'sew', depends_on: ['emb', 'dtf'] },
    ];
    expect(sizeInputFor({ depends_on: ['emb', 'dtf'] }, fork, cutOnly))
      .toEqual({ [k('XS')]: 200, [k('S')]: 272 });
  });

  it('цвет и размер строк берутся у предка, а не только у прямого предшественника', () => {
    expect(sizeInputCells({ depends_on: ['emb'] }, chain, cutOnly)).toEqual(
      expect.arrayContaining([{ color: '—', size: 'XS', qty: 200 }, { color: '—', size: 'S', qty: 272 }]),
    );
  });

  it('stageAncestors обходит граф вверх без повторов и не падает на цикле', () => {
    expect(stageAncestors({ depends_on: ['emb'] }, chain).sort()).toEqual(['cut', 'emb']);
    const loop = [{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }];
    expect(stageAncestors({ depends_on: ['a'] }, loop).sort()).toEqual(['a', 'b']);
    // Этап вне набора пропускается
    expect(stageAncestors({ depends_on: ['ghost'] }, chain)).toEqual([]);
  });
});
