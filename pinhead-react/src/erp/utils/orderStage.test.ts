import { describe, it, expect } from 'vitest';
import { orderStageSummary } from './orderStage';
import type { ErpItemStage } from '../types';

const DEPTS: Record<string, string> = {
  'd-cut': 'Закрой',
  'd-sew': 'Швейка',
  'd-dtf': 'ДТФ',
};
const deptName = (id: string) => DEPTS[id] ?? null;

let seq = 0;
function stage(patch: Partial<ErpItemStage> & { department_id: string }): ErpItemStage {
  seq += 1;
  return {
    id: `s${seq}`,
    item_id: 'i1',
    depends_on: [],
    status: 'waiting',
    qty_done: 0,
    qty_rework: 0,
    sort_order: 10,
    executor: 'internal',
    ...patch,
  } as ErpItemStage;
}

const order = (stages: ErpItemStage[], patch: Record<string, unknown> = {}) => ({
  status: 'active',
  items: [{ qty: 100, stages }],
  ...patch,
} as Parameters<typeof orderStageSummary>[0]);

describe('orderStageSummary — «где заказ сейчас»', () => {
  it('ничего не начато — называет ближайший этап маршрута', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-sew', sort_order: 20 }),
      stage({ department_id: 'd-cut', sort_order: 10 }),
    ]), deptName);
    expect(res.label).toBe('Ждёт: Закрой');
    expect(res.tone).toBe('waiting');
  });

  it('работа идёт — называет цеха, где она идёт', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-cut', sort_order: 10, status: 'done', qty_done: 100 }),
      stage({ department_id: 'd-sew', sort_order: 20, status: 'in_progress', qty_done: 40 }),
    ]), deptName);
    expect(res.label).toBe('В работе: Швейка');
    expect(res.tone).toBe('progress');
    // 100 из 200 «штуко-этапов» — половина маршрута
    expect(res.pct).toBe(70);
  });

  /**
   * Блокировка важнее работы: заказ, где одна ветка идёт, а вторая стоит,
   * требует решения. Слово «в работе» показало бы благополучие вместо проблемы.
   */
  it('остановленный этап перебивает идущий', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-sew', sort_order: 20, status: 'in_progress' }),
      stage({ department_id: 'd-dtf', sort_order: 20, status: 'blocked' }),
    ]), deptName);
    expect(res.label).toBe('Остановлен: ДТФ');
    expect(res.tone).toBe('blocked');
  });

  /**
   * У подрядного этапа `department_id` означает «чей это участок
   * ответственности», а не где сейчас работа: подпись цехом отправила бы
   * менеджера спрашивать не туда.
   */
  it('подрядный этап называется подрядом, а не цехом', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-sew', sort_order: 20, status: 'in_progress', executor: 'contractor' }),
    ]), deptName);
    expect(res.label).toBe('В работе у подрядчика');
  });

  it('свой цех и подряд одновременно — видно оба', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-cut', sort_order: 10, status: 'in_progress' }),
      stage({ department_id: 'd-sew', sort_order: 20, status: 'in_progress', executor: 'contractor' }),
    ]), deptName);
    expect(res.label).toBe('В работе: Закрой · подряд');
  });

  it('все этапы закрыты и материалы приняты — готов к отгрузке', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-cut', sort_order: 10, status: 'done' }),
      stage({ department_id: 'd-sew', sort_order: 20, status: 'skipped' }),
    ]), deptName);
    expect(res.label).toBe('Готов к отгрузке');
    expect(res.tone).toBe('ready');
  });

  it('закрытый заказ называет свой исход, а не цех', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-cut', sort_order: 10, status: 'done' }),
    ], { status: 'done_late', shipped_at: '2026-08-18T10:00:00Z' }), deptName);
    expect(res.label).toBe('Сдан с опозданием');
    expect(res.tone).toBe('done');
  });

  it('отменённый не выдаётся за сданный', () => {
    const res = orderStageSummary(order([], { status: 'cancelled' }), deptName);
    expect(res.label).toBe('Отменён');
  });

  it('маршрута нет вовсе — так и сказано, а не «готово»', () => {
    const res = orderStageSummary({ status: 'active', items: [{ qty: 10, stages: [] }] }, deptName);
    expect(res.label).toBe('Маршрут не задан');
    expect(res.tone).toBe('none');
    // Ноль в знаменателе — «неизвестно», а не 100 %
    expect(res.pct).toBeNull();
  });

  it('незнакомый цех не печатается как «undefined»', () => {
    const res = orderStageSummary(order([
      stage({ department_id: 'd-ghost', sort_order: 10 }),
    ]), deptName);
    expect(res.label).toBe('Ждёт очереди');
  });
});
