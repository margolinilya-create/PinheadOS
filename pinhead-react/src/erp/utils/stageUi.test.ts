import { describe, it, expect } from 'vitest';
import { isOrderReadyToShip } from './stageUi';
import type { StageStatus } from '../types';

/** Заказ-минимум для проверки готовности к отгрузке */
function order(status: string, itemStages: StageStatus[][]) {
  return {
    status,
    items: itemStages.map((stages) => ({
      stages: stages.map((s) => ({ status: s })),
    })),
  };
}

describe('isOrderReadyToShip — стадия «Готов к отгрузке»', () => {
  it('все этапы done → готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'done']]))).toBe(true);
  });

  it('done + skipped → готов (skipped считается завершённым)', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'skipped'], ['done']]))).toBe(true);
  });

  it('есть незавершённый этап (in_progress) → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'in_progress']]))).toBe(false);
  });

  it('waiting / ready / blocked → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'waiting']]))).toBe(false);
    expect(isOrderReadyToShip(order('active', [['done', 'ready']]))).toBe(false);
    expect(isOrderReadyToShip(order('active', [['done', 'blocked']]))).toBe(false);
  });

  it('незавершённый этап в любой из позиций → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done'], ['in_progress']]))).toBe(false);
  });

  it('без этапов вообще → не готов (нечего отгружать)', () => {
    expect(isOrderReadyToShip(order('active', []))).toBe(false);
    expect(isOrderReadyToShip(order('active', [[], []]))).toBe(false);
  });

  it('неактивный (архивный) заказ → не готов, даже если все этапы done', () => {
    expect(isOrderReadyToShip(order('done_on_time', [['done']]))).toBe(false);
    expect(isOrderReadyToShip(order('cancelled', [['done']]))).toBe(false);
  });
});
