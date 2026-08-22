import { describe, it, expect } from 'vitest';
import {
  itemProgress, orderProgress, stageCountProgress, stageQtyProgress,
} from './progress';

const st = (status: string, qty_done = 0) => ({ status, qty_done } as never);

describe('stageQtyProgress', () => {
  it('частичная готовность', () => {
    expect(stageQtyProgress(st('in_progress', 45), 100)).toEqual({ done: 45, total: 100, pct: 45 });
  });

  it('завершённый этап засчитан целиком, даже если qty_done не набивали', () => {
    expect(stageQtyProgress(st('done', 0), 100)).toEqual({ done: 100, total: 100, pct: 100 });
  });

  it('ожидающий этап — ноль', () => {
    expect(stageQtyProgress(st('waiting'), 100)).toEqual({ done: 0, total: 100, pct: 0 });
  });

  it('qty_done больше тиража обрезается по тиражу', () => {
    expect(stageQtyProgress(st('in_progress', 500), 100).done).toBe(100);
  });

  it('нулевой тираж не делит на ноль', () => {
    expect(stageQtyProgress(st('in_progress', 5), 0)).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe('itemProgress', () => {
  it('пример из требования: 2 этапа закрыто, швейка 45 из 100, два впереди', () => {
    const item = {
      qty: 100,
      stages: [st('done'), st('done'), st('in_progress', 45), st('waiting'), st('waiting')],
    };
    // (100 + 100 + 45) / (5 × 100) = 245/500 = 49%
    expect(itemProgress(item)).toEqual({ done: 245, total: 500, pct: 49 });
  });

  it('пропущенные этапы не входят в знаменатель', () => {
    const item = { qty: 10, stages: [st('done'), st('skipped'), st('waiting')] };
    expect(itemProgress(item)).toEqual({ done: 10, total: 20, pct: 50 });
  });

  it('маршрут целиком завершён — 100%', () => {
    const item = { qty: 7, stages: [st('done'), st('done')] };
    expect(itemProgress(item)).toEqual({ done: 14, total: 14, pct: 100 });
  });

  it('позиция без этапов — ноль без деления на ноль', () => {
    expect(itemProgress({ qty: 50, stages: [] })).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

describe('orderProgress', () => {
  it('позиция с большим тиражом весит больше среднего по позициям', () => {
    const order = {
      items: [
        { qty: 900, stages: [st('done'), st('done')] },        // 1800/1800
        { qty: 100, stages: [st('waiting'), st('waiting')] },  // 0/200
      ],
    };
    // 1800/2000 = 90%, а не среднее (100% + 0%) / 2 = 50%
    expect(orderProgress(order)).toEqual({ done: 1800, total: 2000, pct: 90 });
  });

  it('заказ без позиций — ноль', () => {
    expect(orderProgress({ items: [] })).toEqual({ done: 0, total: 0, pct: 0 });
    expect(orderProgress({})).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

/**
 * Этап образца в прогресс серии не входит (ТЗ ЭКС 12.08).
 *
 * Передача задачи разработки в цех создаёт настоящий этап на позиции заказа.
 * Пока таких этапов в проде ноль, это ничего не меняет; с новой моделью они
 * станут рутиной, и без отбора маршрут из четырёх этапов с одним заходом
 * образца показывал бы 80 % при полностью закрытой работе.
 */
describe('прогресс не считает этапы образца', () => {
  it('этап образца не попадает ни в числитель, ни в знаменатель', () => {
    const item = {
      qty: 100,
      stages: [
        { status: 'done' as const },
        { status: 'done' as const },
        // Образец: три штуки, своя история, к серии отношения не имеет
        { status: 'ready' as const, qty_done: 0, origin: 'experimental' },
      ],
    };
    expect(itemProgress(item)).toEqual({ done: 200, total: 200, pct: 100 });
  });

  it('этап без поля origin считается серийным', () => {
    // Колонка `not null default 'production'`, но в фикстурах поля нет
    const item = { qty: 10, stages: [{ status: 'done' as const }] };
    expect(itemProgress(item).total).toBe(10);
  });

  it('позиция ТОЛЬКО из этапов образца даёт «неизвестно», а не 100 %', () => {
    // Ноль в знаменателе — правило проекта: pct 0 при total 0
    const item = { qty: 3, stages: [{ status: 'done' as const, origin: 'experimental' }] };
    expect(itemProgress(item)).toEqual({ done: 0, total: 0, pct: 0 });
  });
});

/**
 * П. 3.11: «1 из 5 этапов завершено» вместо «100/500 шт·этапов».
 * Величина другая, а не то же число другими словами.
 */
describe('счёт этапов', () => {
  const item = (statuses: string[]) => ({
    qty: 100,
    stages: statuses.map((status, i) => ({
      id: `s${i}`, status, qty_done: 0, qty_rework: 0,
    })) as never,
  });

  it('считает закрытые этапы, а не штуки', () => {
    expect(stageCountProgress(item(['done', 'done', 'in_progress', 'waiting', 'waiting'])))
      .toEqual({ done: 2, total: 5, pct: 40 });
  });

  it('пропущенные и этапы образца не участвуют — как в itemProgress', () => {
    const withSkipped = {
      qty: 100,
      stages: [
        { id: 'a', status: 'done', qty_done: 0, qty_rework: 0 },
        { id: 'b', status: 'skipped', qty_done: 0, qty_rework: 0 },
        { id: 'c', status: 'waiting', qty_done: 0, qty_rework: 0, origin: 'experimental' },
      ] as never,
    };
    expect(stageCountProgress(withSkipped)).toEqual({ done: 1, total: 1, pct: 100 });
  });

  /** Ноль в знаменателе — «неизвестно», а не «готово» (правило проекта) */
  it('маршрута нет — процент не выдумывается', () => {
    expect(stageCountProgress({ qty: 100, stages: [] })).toEqual(
      { done: 0, total: 0, pct: null });
  });
});
