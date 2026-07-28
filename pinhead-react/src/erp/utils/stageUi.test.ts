import { describe, it, expect } from 'vitest';
import { isOrderReadyToShip, shipBlockReason } from './stageUi';
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


/** Материал заказа: статус + (для закупки) результат приёмки складом */
function mat(status: string, accept: string | null = null, name = 'Материал') {
  return { status, accept_status: accept, name } as never;
}
/** Пришедший и принятый складом материал */
function accepted() {
  return mat('received', 'accepted_full');
}
/** Заказ со всеми этапами done и заданным набором материалов */
function withMats(materials: ReturnType<typeof mat>[]) {
  return { ...order('active', [['done']]), materials };
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

  it('непришедший материал → не готов, даже если все этапы done (аудит #5)', () => {
    expect(isOrderReadyToShip(withMats([mat('pending')]))).toBe(false); // сирота-материал не пришёл
    expect(isOrderReadyToShip(withMats([accepted(), mat('ordered')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([]))).toBe(true);
  });

  it('годны без приёмки: «не требуется» и «доступен со склада»', () => {
    expect(isOrderReadyToShip(withMats([mat('not_needed'), mat('reserved')]))).toBe(true);
  });

  /**
   * Гейт отгрузки судит о материалах по тому же правилу, что и запуск этапа:
   * пришедший закупочный материал годен ТОЛЬКО после приёмки складом.
   * Раньше отгрузка считала годным любой `received` — заказ с недостачей,
   * пересортом или отказом склада доходил до «готов к отгрузке».
   */
  it('пришёл, но склад не принял → не готов', () => {
    expect(isOrderReadyToShip(withMats([mat('received')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'rejected')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'shortage')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'mismatch')]))).toBe(false);
  });

  it('принят полностью или частично → готов', () => {
    expect(isOrderReadyToShip(withMats([mat('received', 'accepted_full')]))).toBe(true);
    expect(isOrderReadyToShip(withMats([mat('received', 'accepted_partial')]))).toBe(true);
  });
});

describe('shipBlockReason — почему нельзя отгружать', () => {
  it('нет причины, когда заказ готов', () => {
    expect(shipBlockReason(withMats([accepted()]))).toBeNull();
  });

  it('называет число незавершённых этапов', () => {
    const o = { ...order('active', [['done', 'in_progress'], ['waiting']]), materials: [] };
    expect(shipBlockReason(o)).toBe('Не завершены этапы: 2');
  });

  it('различает «не пришло» и «склад не принял»', () => {
    expect(shipBlockReason(withMats([mat('pending', null, 'Кулирка')])))
      .toBe('Не получены материалы: Кулирка');
    expect(shipBlockReason(withMats([mat('received', 'shortage', 'Бирки')])))
      .toBe('Склад не принял материалы: Бирки');
  });

  it('заказ без этапов отгружать нечем', () => {
    expect(shipBlockReason({ ...order('active', []), materials: [] }))
      .toBe('У заказа нет этапов маршрута');
  });

  it('архивный заказ причин не показывает', () => {
    expect(shipBlockReason({ ...order('done_on_time', [['done']]), materials: [] })).toBeNull();
  });
});
