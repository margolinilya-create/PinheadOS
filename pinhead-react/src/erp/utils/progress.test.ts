import { describe, it, expect } from 'vitest';
import { itemProgress, orderProgress, stageQtyProgress } from './progress';

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
