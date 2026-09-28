import { describe, it, expect } from 'vitest';
import {
  economicsGaps, coverageNote, fabricNote, assemblySourceNote, money, moneyOrNot, qty, sizeRowsText,
  PLAN_COST_NOTE, COST_SCOPE_NOTE, missingAssembly, unitCostText, orderEconomicsSummary,
  summaryValueText, summaryNote,
} from './itemEconomics';
import type { ItemEconomics } from '../store/types';

const LOSSES: ItemEconomics['losses'] = {
  leftovers_usable: [], leftovers_usable_cost: null,
  leftovers_scrap: [], leftovers_scrap_cost: null,
  adjustments: [], adjustments_open: 0,
  extras: { cut_extra: 0, by_size: [], finished: 0, shipped: 0, in_stock: 0, unit_cost: null, value: null },
  defects: [], defects_qty: 0, defects_cost: null,
  wip: [], wip_qty: 0, wip_rework: 0,
};

const FULL: ItemEconomics = {
  item_id: 'it1',
  client_qty: 280,
  fabric: { metres: 142.1, priced_metres: 142.1, calc_metres: 0, incomplete_kg: 0, rows: 3, avg_m_per_cut: 0.49 },
  fabric_cost_total: 38620,
  rolls_used: 3,
  qty_cut: 290,
  qty_good: 274,
  qty_extra: 10,
  assembly: { avg: 214.5, covered_qty: 274, source: 'reports', total: 58773 },
  fabric_cost_per_good: 140.95,
  direct_unit_cost: 355.45,
  losses: LOSSES,
  final_good: 274,
  shipped: 0,
  production_done: true,
  costs_filled: true,
  preliminary: false,
  costs: { fabric: 38620, scrap: null, assembly: 58773, total: 97393, missing: [] },
  unit_cost_good: 355.45,
  unit_cost_plan: 347.83,
};

describe('economicsGaps — чего не хватает для полного расчёта', () => {
  it('всё на месте — пробелов нет', () => {
    expect(economicsGaps(FULL)).toEqual([]);
  });

  /**
   * На бою это и есть первое состояние вкладки: размерных строк закроя нет,
   * стоимость сборки не вводили ни разу. «0 ₽» здесь читалось бы
   * как «производство бесплатное».
   */
  it('ничего не сдано — названы причины по ходу производства', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: { metres: 0, priced_metres: 0, calc_metres: 0, incomplete_kg: 0, rows: 0, avg_m_per_cut: null },
      fabric_cost_total: null,
      qty_cut: 0,
      qty_good: 0,
      assembly: { avg: null, covered_qty: 0, source: null, total: null },
    })).toEqual(['no-cutting', 'no-sewing', 'no-assembly']);
  });

  it('расход есть, а цены нет — это отдельная причина', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: { ...FULL.fabric, priced_metres: 0 },
      fabric_cost_total: 0,
    })).toEqual(['no-price']);
  });

  /** Строки в кг без коэффициента — расход есть, хоть и не в метрах: цена по ним тоже спрашивается */
  it('не пересчитанные килограммы — тоже расход', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: { metres: 0, priced_metres: 0, calc_metres: 0, incomplete_kg: 12, rows: 1, avg_m_per_cut: null },
      fabric_cost_total: null,
    })).toContain('no-price');
  });

  it('расхода нет вовсе — про цену не упрекаем: упрекать не за что', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: { metres: 0, priced_metres: 0, calc_metres: 0, incomplete_kg: 0, rows: 0, avg_m_per_cut: null },
      fabric_cost_total: null,
    })).not.toContain('no-price');
  });

  it('пустой ответ сервера не роняет вкладку', () => {
    expect(economicsGaps(null)).toHaveLength(4);
  });
});

describe('coverageNote — среднее по части расхода читается как среднее по всему', () => {
  it('цена известна не для всего — говорим, для какой части, в метрах', () => {
    expect(coverageNote(40, 61.4)).toBe('цена известна для 40,00 м из 61,40 м');
  });

  it('цена есть у всего — оговорка не нужна', () => {
    expect(coverageNote(61.4, 61.4)).toBeNull();
    expect(coverageNote(61.398, 61.4)).toBeNull();
  });

  it('цены нет ни у чего — сказано прямо', () => {
    expect(coverageNote(0, 61.4)).toBe('цена не известна ни для одного рулона');
  });

  it('расхода нет — говорить не о чем', () => {
    expect(coverageNote(0, 0)).toBeNull();
  });
});

/**
 * ПЕРЕСЧЁТ СТАРЫХ СТРОК В КГ (правка 27.09, п. 4): «пересчёт истории разрешать
 * только при наличии параметров соответствующего рулона, с отметкой „Расчёт"».
 * Что пересчитано и что нет — словами, а не одним числом.
 */
describe('fabricNote — расчётные метры и непересчитанные килограммы', () => {
  it('всё введено в метрах — подписи нет', () => {
    expect(fabricNote(FULL)).toBeNull();
  });

  it('часть пересчитана из кг — названа с отметкой «расчёт»', () => {
    expect(fabricNote({ ...FULL, fabric: { ...FULL.fabric, calc_metres: 5.63 } }))
      .toBe('5,63 м пересчитано из кг по коэффициенту рулона (расчёт)');
  });

  it('часть пересчитать не из чего — килограммы названы отдельно', () => {
    expect(fabricNote({ ...FULL, fabric: { ...FULL.fabric, incomplete_kg: 12.5 } }))
      .toBe('12.5 кг не пересчитано: у рулонов нет коэффициента');
  });
});

describe('assemblySourceNote — откуда взята стоимость пошива', () => {
  it('из отчётов — названо, по скольким штукам средневзвешено', () => {
    expect(assemblySourceNote(FULL)).toBe('средневзвешенная по 274 шт');
  });

  it('из позиции — сказано, что отчёты цену не называли', () => {
    expect(assemblySourceNote({
      ...FULL,
      assembly: { avg: 200, covered_qty: 0, source: 'item_fallback', total: null },
    })).toBe('взята из позиции заказа: отчёты швейки цену не называли');
  });

  it('цены нет вовсе — оговорки нет', () => {
    expect(assemblySourceNote({
      ...FULL,
      assembly: { avg: null, covered_qty: 0, source: null, total: null },
    })).toBeNull();
  });
});

describe('деньги и количества: «нет данных» это прочерк, а не ноль', () => {
  it('null → прочерк', () => {
    expect(money(null)).toBe('—');
    expect(qty(undefined, 'шт')).toBe('—');
  });

  it('ноль остаётся нулём — это факт, а не отсутствие факта', () => {
    expect(money(0)).toBe('0 ₽');
    expect(qty(0, 'шт')).toBe('0 шт');
  });

  /** «Если стоимость нельзя определить, показывать „Не рассчитано", а не ноль» */
  it('стоимость, которую нельзя определить, названа словами', () => {
    expect(moneyOrNot(null)).toBe('Не рассчитано');
    expect(moneyOrNot(12.5)).toBe('12,5 ₽');
  });

  it('разбивка по размерам и цветам — одной строкой, цвет-прочерк не печатается', () => {
    expect(sizeRowsText([
      { color: '—', size: 'M', qty: 5 }, { color: 'чёрный', size: 'L', qty: 3 }, { color: '—', size: 'S', qty: 0 },
    ])).toBe('M — 5 шт, L · чёрный — 3 шт');
  });

  it('подписи документа — слово в слово', () => {
    expect(PLAN_COST_NOTE).toBe('Все затраты позиции распределены на клиентский тираж, включая изготовление плюсов');
    expect(COST_SCOPE_NOTE).toBe('Основное полотно и пошив на единицу');
  });
});

describe('«без пошива» — незаполненная стоимость не принимается за ноль (28.09, п. 7)', () => {
  it('пошив учтён — число без пометки', () => {
    expect(missingAssembly(FULL)).toBe(false);
    expect(unitCostText(355.45, false)).toBe('355,45 ₽');
  });

  it('пошив не учтён — пометка рядом с числом', () => {
    const e = { ...FULL, costs: { ...FULL.costs, assembly: null, missing: ['assembly' as const] } };
    expect(missingAssembly(e)).toBe(true);
    expect(unitCostText(140.95, true)).toBe('140,95 ₽ без пошива');
  });

  it('нет знаменателя — «Нет данных для расчёта», без пометки', () => {
    expect(unitCostText(null, true)).toBe('Нет данных для расчёта');
  });
});

describe('orderEconomicsSummary — сводка заказа по всем позициям (28.09, п. 1)', () => {
  const row = (item_id: string, e: Partial<ItemEconomics>) => ({
    item_id, product_type: 'Худи', variant: null, qty: 100, economics: { ...FULL, item_id, ...e },
  });

  it('складывает только рассчитанное и считает пропуски', () => {
    const lines = orderEconomicsSummary([
      row('a', { losses: { ...LOSSES, leftovers_usable_cost: 100 } }),
      row('b', { costs: { ...FULL.costs, total: 3, assembly: null, missing: ['assembly'] } }),
    ]);
    const total = lines.find((l) => l.key === 'total')!;
    expect(total.sum).toBe(97396);
    expect(total.noAssembly).toBe(1);
    expect(summaryNote(total)).toBe('без пошива: позиций 1');

    const usable = lines.find((l) => l.key === 'usable')!;
    expect(usable.sum).toBe(100);
    expect(summaryNote(usable)).toBe('без учёта позиций, где не рассчитано: 1');

    const defects = lines.find((l) => l.key === 'defects')!;
    expect(defects.sum).toBeNull();
    expect(summaryValueText(defects)).toBe('Не рассчитано');
    expect(summaryNote(defects)).toBeNull();
  });

  it('пять строк порознь — общей суммы «дополнительных расходов» нет', () => {
    expect(orderEconomicsSummary([]).map((l) => l.key)).toEqual(['total', 'usable', 'scrap', 'defects', 'extras']);
  });
});
