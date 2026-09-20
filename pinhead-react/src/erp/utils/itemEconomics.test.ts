import { describe, it, expect } from 'vitest';
import {
  economicsGaps, coverageNote, assemblySourceNote, money, qty,
} from './itemEconomics';
import type { ItemEconomics } from '../store/types';

const FULL: ItemEconomics = {
  item_id: 'it1',
  fabric: [{ unit: 'кг', qty_used: 61.4, cost: 38620, priced_qty: 61.4, avg_per_cut: 0.212 }],
  fabric_cost_total: 38620,
  rolls_used: 3,
  qty_cut: 290,
  qty_good: 274,
  assembly: { avg: 214.5, covered_qty: 274, source: 'reports' },
  fabric_cost_per_good: 140.95,
  direct_unit_cost: 355.45,
};

describe('economicsGaps — чего не хватает для полного расчёта', () => {
  it('всё на месте — пробелов нет', () => {
    expect(economicsGaps(FULL)).toEqual([]);
  });

  /**
   * На бою это и есть первое состояние вкладки: `erp_stage_report_sizes`
   * пуста, стоимость сборки не вводили ни разу. «0 ₽» здесь читалось бы
   * как «производство бесплатное».
   */
  it('ничего не сдано — названы все четыре причины, по ходу производства', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: [],
      fabric_cost_total: null,
      qty_cut: 0,
      qty_good: 0,
      assembly: { avg: null, covered_qty: 0, source: null },
    })).toEqual(['no-cutting', 'no-sewing', 'no-assembly']);
  });

  it('расход есть, а цены нет — это отдельная причина', () => {
    expect(economicsGaps({
      ...FULL,
      fabric: [{ unit: 'кг', qty_used: 61.4, cost: null, priced_qty: 0, avg_per_cut: 0.212 }],
      fabric_cost_total: 0,
    })).toEqual(['no-price']);
  });

  it('расхода нет вовсе — про цену не упрекаем: упрекать не за что', () => {
    expect(economicsGaps({ ...FULL, fabric: [], fabric_cost_total: null }))
      .not.toContain('no-price');
  });

  it('пустой ответ сервера не роняет вкладку', () => {
    expect(economicsGaps(null)).toHaveLength(4);
  });
});

describe('coverageNote — среднее по части расхода читается как среднее по всему', () => {
  it('цена известна не для всего — говорим, для какой части', () => {
    expect(coverageNote(40, 61.4, 'кг')).toBe('цена известна для 40 кг из 61.4 кг');
  });

  it('цена есть у всего — оговорка не нужна', () => {
    expect(coverageNote(61.4, 61.4, 'кг')).toBeNull();
  });

  it('цены нет ни у чего — сказано прямо', () => {
    expect(coverageNote(0, 61.4, 'кг')).toBe('цена не известна ни для одного рулона');
  });

  it('расхода нет — говорить не о чем', () => {
    expect(coverageNote(0, 0, 'кг')).toBeNull();
  });
});

describe('assemblySourceNote — откуда взята стоимость пошива', () => {
  it('из отчётов — названо, по скольким штукам средневзвешено', () => {
    expect(assemblySourceNote(FULL)).toBe('средневзвешенная по 274 шт');
  });

  /**
   * Отчёты, закрытые до правки 20.09, цены не несут: колонка появилась
   * вместе с ней. Показать «—» там, где цену вводили, значило бы потерять
   * данные на экране.
   */
  it('из позиции — сказано, что отчёты цену не называли', () => {
    expect(assemblySourceNote({
      ...FULL,
      assembly: { avg: 200, covered_qty: 0, source: 'item_fallback' },
    })).toContain('из позиции заказа');
  });

  it('цены нет вовсе — оговорки нет', () => {
    expect(assemblySourceNote({
      ...FULL, assembly: { avg: null, covered_qty: 0, source: null },
    })).toBeNull();
  });
});

describe('деньги и количества: «нет данных» это прочерк, а не ноль', () => {
  it('null → прочерк', () => {
    expect(money(null)).toBe('—');
    expect(qty(null, 'шт')).toBe('—');
  });

  it('ноль остаётся нулём — это факт, а не отсутствие факта', () => {
    expect(money(0)).toBe('0 ₽');
    expect(qty(0, 'шт')).toBe('0 шт');
  });
});
