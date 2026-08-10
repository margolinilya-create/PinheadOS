import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  NO_ASSIGNEE,
  applyStageFilters,
  filterEntries,
  filtersFromParams,
  filtersToParams,
  hasActiveFilters,
  hasProblem,
  isEntryOverdue,
  overdueDays,
  sortEntries,
} from './filterStages';
import type { QueueEntry, StageFilters } from './filterStages';

const NOW = new Date('2026-07-27T10:00:00');

function entry(over: Partial<{
  id: string; title: string; customer: string; due: string | null; dept: string;
  group: QueueEntry['group']; assignee: string | null; plannedEnd: string | null;
  rework: number; pos: number | null; product: string;
}> = {}): QueueEntry {
  const {
    id = 's1', title = 'BOX39 свитшоты', customer = 'BOX39', due = '2026-08-01',
    dept = 'd-sewing', group = 'ready', assignee = null, plannedEnd = null,
    rework = 0, pos = null, product = 'Свитшот',
  } = over;
  return {
    order: { id: `o-${id}`, title, customer, bitrix_id: '5' + id, due_date: due, items: [], materials: [] },
    item: { id: `i-${id}`, product_type: product, variant: null, qty: 100 },
    stage: {
      id, department_id: dept, status: 'waiting',
      assignee, planned_end: plannedEnd, qty_rework: rework, queue_position: pos,
    },
    group,
  };
}

const f = (over: Partial<StageFilters> = {}): StageFilters => ({ ...EMPTY_FILTERS, ...over });

describe('filterEntries', () => {
  const list = [
    entry({ id: 'a', title: 'BOX39 свитшоты', customer: 'BOX39', dept: 'd1', group: 'ready' }),
    entry({ id: 'b', title: 'Дзен флиски', customer: 'Дзен', dept: 'd2', group: 'in_progress', assignee: 'Пётр' }),
    entry({ id: 'c', title: 'Тест худи', customer: 'Тест', dept: 'd1', group: 'blocked' }),
    entry({ id: 'd', title: 'Старый заказ', customer: 'Дзен', dept: 'd1', group: 'waiting', due: '2026-07-20' }),
  ];

  it('поиск по названию заказа и по клиенту', () => {
    expect(filterEntries(list, f({ q: 'флиски' }), NOW).map((e) => e.stage.id)).toEqual(['b']);
    expect(filterEntries(list, f({ q: 'дзен' }), NOW).map((e) => e.stage.id)).toEqual(['b', 'd']);
  });

  it('фильтр по цеху', () => {
    expect(filterEntries(list, f({ dept: 'd1' }), NOW)).toHaveLength(3);
  });

  it('фильтр по статусу', () => {
    expect(filterEntries(list, f({ status: 'blocked' }), NOW).map((e) => e.stage.id)).toEqual(['c']);
  });

  it('фильтр по исполнителю и по незакреплённым', () => {
    expect(filterEntries(list, f({ assignee: 'Пётр' }), NOW).map((e) => e.stage.id)).toEqual(['b']);
    expect(filterEntries(list, f({ assignee: NO_ASSIGNEE }), NOW).map((e) => e.stage.id))
      .toEqual(['a', 'c', 'd']);
  });

  it('фильтр по сроку — границы включительно', () => {
    expect(filterEntries(list, f({ dueFrom: '2026-08-01' }), NOW)).toHaveLength(3);
    expect(filterEntries(list, f({ dueTo: '2026-07-20' }), NOW).map((e) => e.stage.id)).toEqual(['d']);
  });

  it('только просроченные — любым способом', () => {
    expect(filterEntries(list, f({ overdue: 'any' }), NOW).map((e) => e.stage.id)).toEqual(['d']);
  });

  /**
   * Просрочка заказа и просрочка этапа разведены (правки 10.08): у заказа
   * прошёл срок клиента, у этапа сорвана СВОЯ плановая дата. Это разные
   * решения — отвечать перед заказчиком или разбираться внутри цеха.
   */
  it('срок заказа и план этапа отбираются по отдельности', () => {
    const mix = [
      // срок клиента прошёл, плана у этапа нет вовсе
      entry({ id: 'late-order', due: '2026-07-20' }),
      // срок клиента далеко, но этап должен был закрыться позавчера
      entry({ id: 'late-stage', due: '2026-09-01', plannedEnd: '2026-07-25' }),
      // всё по плану
      entry({ id: 'ok', due: '2026-09-01', plannedEnd: '2026-08-20' }),
    ];
    expect(filterEntries(mix, f({ overdue: 'order' }), NOW).map((e) => e.stage.id))
      .toEqual(['late-order']);
    expect(filterEntries(mix, f({ overdue: 'stage' }), NOW).map((e) => e.stage.id))
      .toEqual(['late-stage']);
    expect(filterEntries(mix, f({ overdue: 'any' }), NOW).map((e) => e.stage.id))
      .toEqual(['late-order', 'late-stage']);
  });

  /**
   * «Не запланирован» — не просрочка, а её невозможность: сорвать несуществующую
   * дату нельзя. На проде так живут 305 открытых этапов из 311, и без отбора
   * эта дыра ничем не видна.
   */
  it('этапы без плановой даты отбираются отдельно и просроченными не считаются', () => {
    const mix = [
      entry({ id: 'no-plan', due: '2026-09-01' }),
      entry({ id: 'planned', due: '2026-09-01', plannedEnd: '2026-08-20' }),
      entry({ id: 'closed', due: '2026-09-01', group: 'done' }),
    ];
    expect(filterEntries(mix, f({ overdue: 'unplanned' }), NOW).map((e) => e.stage.id))
      .toEqual(['no-plan']);
    expect(filterEntries(mix, f({ overdue: 'stage' }), NOW)).toHaveLength(0);
  });

  it('только готовые к запуску', () => {
    expect(filterEntries(list, f({ readyOnly: true }), NOW).map((e) => e.stage.id)).toEqual(['a']);
  });

  it('только с проблемой: блокировка или возвращённый брак', () => {
    const withRework = [...list, entry({ id: 'e', group: 'in_progress', rework: 5 })];
    expect(filterEntries(withRework, f({ problem: true }), NOW).map((e) => e.stage.id))
      .toEqual(['c', 'e']);
  });

  it('фильтры комбинируются', () => {
    expect(filterEntries(list, f({ dept: 'd1', q: 'дзен' }), NOW).map((e) => e.stage.id)).toEqual(['d']);
  });

  it('пустые фильтры пропускают всё', () => {
    expect(filterEntries(list, EMPTY_FILTERS, NOW)).toHaveLength(4);
  });
});

describe('isEntryOverdue / overdueDays', () => {
  it('просрочка по сроку клиента', () => {
    const e = entry({ due: '2026-07-24' });
    expect(isEntryOverdue(e, NOW)).toBe(true);
    expect(overdueDays(e, NOW)).toBe(3);
  });

  it('просрочка по плану этапа при живом сроке клиента', () => {
    const e = entry({ due: '2026-09-01', plannedEnd: '2026-07-25' });
    expect(isEntryOverdue(e, NOW)).toBe(true);
    expect(overdueDays(e, NOW)).toBe(2);
  });

  it('завершённое задание не просрочено', () => {
    expect(isEntryOverdue(entry({ due: '2026-07-01', group: 'done' }), NOW)).toBe(false);
    expect(overdueDays(entry({ due: '2026-07-01', group: 'done' }), NOW)).toBe(0);
  });

  it('без сроков — не просрочено', () => {
    expect(isEntryOverdue(entry({ due: null }), NOW)).toBe(false);
  });
});

describe('sortEntries', () => {
  it('по приоритету: ручной порядок очереди, этапы без позиции — в хвост по сроку', () => {
    const list = [
      entry({ id: 'a', pos: 300, due: '2026-08-05' }),
      entry({ id: 'b', pos: null, due: '2026-07-30' }),
      entry({ id: 'c', pos: 100, due: '2026-09-01' }),
    ];
    expect(sortEntries(list, 'priority', NOW).map((e) => e.stage.id)).toEqual(['c', 'a', 'b']);
  });

  it('по ближайшему сроку — приоритет игнорируется', () => {
    const list = [
      entry({ id: 'a', pos: 1, due: '2026-09-01' }),
      entry({ id: 'b', pos: 999, due: '2026-07-28' }),
    ];
    expect(sortEntries(list, 'due', NOW).map((e) => e.stage.id)).toEqual(['b', 'a']);
  });

  it('по величине просрочки — сильнее просроченные первыми', () => {
    const list = [
      entry({ id: 'a', due: '2026-07-26' }),
      entry({ id: 'b', due: '2026-07-01' }),
      entry({ id: 'c', due: '2026-08-30' }),
    ];
    expect(sortEntries(list, 'overdue', NOW).map((e) => e.stage.id)).toEqual(['b', 'a', 'c']);
  });

  it('не мутирует исходный массив', () => {
    const list = [entry({ id: 'a', pos: 2 }), entry({ id: 'b', pos: 1 })];
    sortEntries(list, 'priority', NOW);
    expect(list.map((e) => e.stage.id)).toEqual(['a', 'b']);
  });
});

describe('applyStageFilters', () => {
  it('фильтрует и сортирует разом', () => {
    const list = [
      entry({ id: 'a', dept: 'd1', pos: 300 }),
      entry({ id: 'b', dept: 'd2', pos: 100 }),
      entry({ id: 'c', dept: 'd1', pos: 100 }),
    ];
    expect(applyStageFilters(list, f({ dept: 'd1' }), NOW).map((e) => e.stage.id)).toEqual(['c', 'a']);
  });
});

describe('URL-синхронизация', () => {
  it('дефолтные значения в адрес не пишутся', () => {
    expect(filtersToParams(EMPTY_FILTERS)).toEqual({});
  });

  it('туда-обратно без потерь', () => {
    const src = f({ q: 'дзен', dept: 'd1', status: 'ready', assignee: 'Пётр', dueFrom: '2026-07-01', overdue: 'any', sort: 'overdue' });
    const params = new URLSearchParams(filtersToParams(src));
    expect(filtersFromParams(params)).toEqual(src);
  });

  it('мусор в адресе не ломает фильтры', () => {
    expect(filtersFromParams(new URLSearchParams('sort=abc&overdue=maybe'))).toEqual(EMPTY_FILTERS);
  });

  /**
   * Ссылки на отфильтрованную очередь живут в переписке и закладках. Прежний
   * булев фильтр писался как `overdue=1`, и после разделения он обязан читаться
   * как «любая просрочка», а не молча теряться.
   */
  it('старое `overdue=1` читается как «любая просрочка»', () => {
    expect(filtersFromParams(new URLSearchParams('overdue=1')).overdue).toBe('any');
    expect(filtersToParams(f({ overdue: 'any' }))).toEqual({ overdue: '1' });
  });

  it('уточнённые виды просрочки ездят в адресе как есть', () => {
    for (const v of ['order', 'stage', 'unplanned'] as const) {
      expect(filtersToParams(f({ overdue: v }))).toEqual({ overdue: v });
      expect(filtersFromParams(new URLSearchParams(`overdue=${v}`)).overdue).toBe(v);
    }
  });
});

describe('hasActiveFilters', () => {
  it('пустые — нет', () => expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false));
  it('любой заполненный — да', () => {
    expect(hasActiveFilters(f({ problem: true }))).toBe(true);
    expect(hasActiveFilters(f({ sort: 'due' }))).toBe(true);
    expect(hasActiveFilters(f({ q: 'x' }))).toBe(true);
  });
});

describe('hasProblem', () => {
  it('блокировка и брак', () => {
    expect(hasProblem(entry({ group: 'blocked' }))).toBe(true);
    expect(hasProblem(entry({ rework: 3 }))).toBe(true);
    expect(hasProblem(entry())).toBe(false);
  });
});
