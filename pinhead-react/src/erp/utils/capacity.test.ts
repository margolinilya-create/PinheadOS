import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPACITY,
  capacityForDates,
  capacityReport,
  dailyCapacity,
  isWorkingDay,
  monthCapacityReport,
  monthDates,
  monthRange,
  parseCapacitySettings,
  workingDays,
} from './capacity';
import type { ErpOrderFull } from '../store/types';

const S = { monthly_units: 10000, work_days_per_week: 5 };

function order(id: string, due: string | null, qtys: number[], status = 'active'): ErpOrderFull {
  return {
    id, status, due_date: due,
    items: qtys.map((qty, i) => ({ id: `${id}-i${i}`, qty, stages: [] })),
    materials: [],
  } as unknown as ErpOrderFull;
}

describe('parseCapacitySettings', () => {
  it('читает нормальное значение', () => {
    expect(parseCapacitySettings({ monthly_units: 10000, work_days_per_week: 6 }))
      .toEqual({ monthly_units: 10000, work_days_per_week: 6 });
  });

  /**
   * Fail-open: чего не поняли — то «не задано». Показать выдуманную мощность
   * хуже, чем не показать никакой: по ней начнут планировать.
   */
  it.each([null, undefined, 'x', 42, {}, { monthly_units: 'много' }, { monthly_units: 0 }])(
    'непонятное значение (%s) даёт «мощность не задана»',
    (value) => {
      expect(parseCapacitySettings(value).monthly_units).toBeNull();
    },
  );

  it('нерабочее число дней в неделе откатывается к пяти', () => {
    expect(parseCapacitySettings({ monthly_units: 100, work_days_per_week: 0 }).work_days_per_week)
      .toBe(DEFAULT_CAPACITY.work_days_per_week);
    expect(parseCapacitySettings({ monthly_units: 100, work_days_per_week: 9 }).work_days_per_week)
      .toBe(DEFAULT_CAPACITY.work_days_per_week);
  });
});

describe('рабочие дни', () => {
  // 2026-08-10 — понедельник, 2026-08-15 — суббота, 2026-08-16 — воскресенье
  it('пн–пт при пятидневке', () => {
    expect(isWorkingDay('2026-08-10', 5)).toBe(true);
    expect(isWorkingDay('2026-08-14', 5)).toBe(true);
    expect(isWorkingDay('2026-08-15', 5)).toBe(false);
    expect(isWorkingDay('2026-08-16', 5)).toBe(false);
  });

  it('шестидневка добавляет субботу, семидневка — воскресенье', () => {
    expect(isWorkingDay('2026-08-15', 6)).toBe(true);
    expect(isWorkingDay('2026-08-16', 6)).toBe(false);
    expect(isWorkingDay('2026-08-16', 7)).toBe(true);
  });

  it('в августе 2026 двадцать один рабочий день при пятидневке', () => {
    expect(monthDates('2026-08-10')).toHaveLength(31);
    expect(workingDays(monthDates('2026-08-10'), 5)).toBe(21);
  });

  it('границы месяца берутся локально, без UTC-сдвига', () => {
    expect(monthRange('2026-08-10')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(monthRange('2026-02-14').to).toBe('2026-02-28');
  });
});

describe('dailyCapacity', () => {
  /**
   * Прямое требование документа: фиксированного значения на день нет, оно
   * считается из числа рабочих дней. Февраль и март при одной месячной мощности
   * дают РАЗНУЮ дневную — это и есть смысл правила.
   */
  it('дневная мощность плавает по месяцам', () => {
    const feb = dailyCapacity(S, '2026-02-10');
    const mar = dailyCapacity(S, '2026-03-10');
    expect(feb).not.toBeNull();
    expect(mar).not.toBeNull();
    expect(feb!).toBeGreaterThan(mar!); // в феврале рабочих дней меньше
  });

  it('без заданной мощности — null, а не ноль', () => {
    expect(dailyCapacity({ monthly_units: null, work_days_per_week: 5 }, '2026-08-10')).toBeNull();
  });
});

describe('capacityReport', () => {
  const week = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];

  it('считает объём заказов со сроком внутри периода', () => {
    const r = capacityReport([
      order('a', '2026-08-12', [100, 50]),
      order('b', '2026-08-13', [30]),
      order('c', '2026-09-01', [1000]), // вне периода
    ], week, S);
    expect(r.used).toBe(180);
    expect(r.orders).toBe(2);
  });

  it('заказ без срока в объём не попадает', () => {
    expect(capacityReport([order('a', null, [100])], week, S).used).toBe(0);
  });

  it('неактивные заказы не занимают мощность', () => {
    expect(capacityReport([order('a', '2026-08-12', [100], 'done')], week, S).used).toBe(0);
  });

  /**
   * Превышение — это ответ, а не ошибка: 130 % должны дойти до руководителя
   * числом, а не заклампиться в 100 %.
   */
  it('перебор показывается процентом больше ста и штуками сверх', () => {
    const capacity = capacityForDates(S, week)!;
    const r = capacityReport([order('a', '2026-08-12', [capacity * 2])], week, S);
    expect(r.percent).toBe(200);
    expect(r.over).toBe(capacity);
    expect(r.left).toBe(0);
  });

  it('без заданной мощности процент неизвестен, а объём всё равно считается', () => {
    const r = capacityReport([order('a', '2026-08-12', [100])], week,
      { monthly_units: null, work_days_per_week: 5 });
    expect(r.capacity).toBeNull();
    expect(r.percent).toBeNull();
    expect(r.used).toBe(100);
  });

  it('пустой период не считается', () => {
    expect(capacityReport([order('a', '2026-08-12', [100])], [], S).capacity).toBeNull();
  });

  /**
   * Единица счёта — изделия. Тот же тираж, прошедший четыре цеха, не должен
   * учитываться четыре раза: отчёт смотрит на позиции заказа, а не на этапы.
   */
  it('месячный отчёт считает тираж позиции один раз', () => {
    const o = order('a', '2026-08-12', [300]);
    o.items[0].stages = [
      { id: 's1', department_id: 'd1' }, { id: 's2', department_id: 'd2' },
      { id: 's3', department_id: 'd3' }, { id: 's4', department_id: 'd4' },
    ] as never;
    expect(monthCapacityReport([o], '2026-08-10', S).used).toBe(300);
  });
});
