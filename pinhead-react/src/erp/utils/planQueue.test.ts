import { describe, expect, it } from 'vitest';
import { remainingQty, unplannedEntries } from './planQueue';
import type { QueueEntry } from './filterStages';

function entry(over: Partial<{
  id: string; group: QueueEntry['group']; status: string; dept: string;
  qty: number; done: number;
}> = {}): QueueEntry {
  const {
    id = 's1', group = 'ready', status = 'waiting', dept = 'd1', qty = 100, done = 0,
  } = over;
  return {
    order: { id: `o-${id}`, title: 'Заказ', due_date: '2026-08-20', items: [], materials: [] },
    item: { id: `i-${id}`, product_type: 'Худи', variant: null, qty },
    stage: {
      id, department_id: dept, status: status as QueueEntry['stage']['status'],
      assignee: null, planned_end: null, qty_rework: 0, queue_position: null,
      qty_done: done,
    } as QueueEntry['stage'],
    group,
  };
}

describe('unplannedEntries', () => {
  it('берёт только готовые к запуску', () => {
    const list = [
      entry({ id: 'ready' }),
      entry({ id: 'waits', group: 'waiting' }),
      entry({ id: 'materials', group: 'awaiting_materials' }),
      entry({ id: 'runs', group: 'in_progress', status: 'in_progress' }),
      entry({ id: 'blocked', group: 'blocked', status: 'blocked' }),
    ];
    expect(unplannedEntries(list, { plannedStageIds: [] }).map((e) => e.stage.id))
      .toEqual(['ready']);
  });

  /**
   * Главное правило очереди: горизонт, а не видимая неделя. Задание,
   * разложенное на следующий понедельник, запланировано — предлагать
   * запланировать его ещё раз значит получить двойную работу.
   */
  it('уже стоящие в плане не показываются', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(unplannedEntries(list, { plannedStageIds: ['b'] }).map((e) => e.stage.id))
      .toEqual(['a']);
    expect(unplannedEntries(list, { plannedStageIds: new Set(['a', 'b']) })).toEqual([]);
  });

  it('фильтр по цеху отбирает только его задания', () => {
    const list = [entry({ id: 'a', dept: 'd1' }), entry({ id: 'b', dept: 'd2' })];
    expect(unplannedEntries(list, { plannedStageIds: [], departmentId: 'd2' })
      .map((e) => e.stage.id)).toEqual(['b']);
    expect(unplannedEntries(list, { plannedStageIds: [], departmentId: null }))
      .toHaveLength(2);
  });

  it('закрытые этапы не планируются, даже если группа говорит «готово»', () => {
    const list = [entry({ id: 'done', status: 'done' }), entry({ id: 'skip', status: 'skipped' })];
    expect(unplannedEntries(list, { plannedStageIds: [] })).toEqual([]);
  });
});

describe('remainingQty', () => {
  it('по умолчанию планируется ОСТАТОК, а не весь тираж', () => {
    expect(remainingQty(entry({ qty: 300, done: 120 }))).toBe(180);
  });

  it('никогда не ноль: планировать «нисколько» бессмысленно', () => {
    expect(remainingQty(entry({ qty: 100, done: 100 }))).toBe(1);
    expect(remainingQty(entry({ qty: 0, done: 0 }))).toBe(1);
  });
});
