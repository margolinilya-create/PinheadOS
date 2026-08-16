import { describe, it, expect } from 'vitest';
import {
  currentStage,
  hasOutsourcing,
  isInternal,
  isOutsourced,
  nextRouteStage,
  openOutsourcedStages,
  ordersWithOutsourcing,
  outsourcedStages,
  stageLabel,
} from './outsourcing';
import type { ErpItemStage } from '../types';

function stage(patch: Partial<ErpItemStage> & { id: string }): ErpItemStage {
  return {
    item_id: 'i1',
    department_id: 'd1',
    depends_on: [],
    status: 'waiting',
    qty_done: 0,
    qty_rework: 0,
    planned_start: null,
    planned_end: null,
    started_at: null,
    finished_at: null,
    assignee: null,
    block_reason: null,
    notes: null,
    sort_order: 10,
    created_at: '',
    updated_at: '',
    ...patch,
  } as ErpItemStage;
}

describe('признак подряда', () => {
  it('этап без колонки — НАШ, а не подрядный', () => {
    // Колонка новая: у этапов из урезанных выборок, кэша и старых фикстур
    // её нет вовсе. Обратная трактовка увела бы всё производство в подряд.
    expect(isOutsourced(stage({ id: 's1' }))).toBe(false);
    expect(isInternal(stage({ id: 's1' }))).toBe(true);
  });

  it('подрядный этап распознаётся по точному значению', () => {
    expect(isOutsourced(stage({ id: 's1', executor: 'contractor' }))).toBe(true);
    expect(isOutsourced(stage({ id: 's1', executor: 'internal' }))).toBe(false);
  });
});

describe('подрядные этапы заказа', () => {
  const order = {
    id: 'o1',
    status: 'active',
    items: [{
      id: 'i1',
      stages: [
        stage({ id: 'cut', sort_order: 10, status: 'done' }),
        stage({ id: 'print', sort_order: 20, status: 'in_progress', executor: 'contractor', depends_on: ['cut'] }),
        stage({ id: 'sew', sort_order: 30, depends_on: ['print'] }),
      ],
    }],
  };

  it('находит подрядные этапы вместе с их позицией', () => {
    const found = outsourcedStages(order);
    expect(found).toHaveLength(1);
    expect(found[0].stage.id).toBe('print');
    expect(found[0].item.id).toBe('i1');
  });

  it('открытые — без завершённых и пропущенных', () => {
    const closed = {
      ...order,
      items: [{ id: 'i1', stages: [stage({ id: 'print', executor: 'contractor', status: 'done' })] }],
    };
    expect(openOutsourcedStages(order)).toHaveLength(1);
    expect(openOutsourcedStages(closed)).toHaveLength(0);
    // Закрытый подряд из истории маршрута не пропадает
    expect(outsourcedStages(closed)).toHaveLength(1);
  });

  it('заказ без подряда не попадает в раздел', () => {
    const own = { id: 'o2', status: 'active', items: [{ id: 'i1', stages: [stage({ id: 'cut' })] }] };
    expect(hasOutsourcing(own)).toBe(false);
    expect(ordersWithOutsourcing([own])).toEqual([]);
  });

  it('считаются ЗАКАЗЫ, а не этапы, и только активные', () => {
    const two = {
      id: 'o3',
      status: 'active',
      items: [{
        id: 'i1',
        stages: [
          stage({ id: 'p1', executor: 'contractor' }),
          stage({ id: 'p2', executor: 'contractor', sort_order: 20 }),
        ],
      }],
    };
    expect(ordersWithOutsourcing([two])).toHaveLength(1);
    expect(ordersWithOutsourcing([{ ...two, status: 'done_on_time' }])).toHaveLength(0);
  });

  it('пустой ввод не роняет — экраны зовут это до загрузки', () => {
    expect(outsourcedStages(null)).toEqual([]);
    expect(ordersWithOutsourcing(undefined)).toEqual([]);
  });
});

/**
 * Главное требование документа: «"вернулось от подрядчика" НЕ означает, что
 * заказ готов — система должна посмотреть следующий этап маршрута».
 */
describe('следующий этап маршрута', () => {
  const item = {
    id: 'i1',
    stages: [
      stage({ id: 'cut', sort_order: 10, status: 'done' }),
      stage({ id: 'print', sort_order: 20, status: 'done', executor: 'contractor', depends_on: ['cut'] }),
      stage({ id: 'sew', sort_order: 30, depends_on: ['print'] }),
      stage({ id: 'vto', sort_order: 40, depends_on: ['sew'] }),
    ],
  };

  it('после подрядного этапа заказ идёт в наш цех, а не считается готовым', () => {
    const next = nextRouteStage(item, { id: 'print', sort_order: 20 });
    expect(next?.id).toBe('sew');
  });

  it('после ПОСЛЕДНЕГО этапа следующего нет — вот тогда заказ готов', () => {
    expect(nextRouteStage(item, { id: 'vto', sort_order: 40 })).toBeNull();
  });

  it('закрытые этапы следующими не считаются', () => {
    const done = {
      id: 'i1',
      stages: [
        stage({ id: 'print', sort_order: 20, executor: 'contractor' }),
        stage({ id: 'sew', sort_order: 30, status: 'done', depends_on: ['print'] }),
        stage({ id: 'vto', sort_order: 40, depends_on: ['sew'] }),
      ],
    };
    expect(nextRouteStage(done, { id: 'print', sort_order: 20 })?.id).toBe('vto');
  });

  it('без зависимости берётся ближайший по порядку — маршруты до конструктора', () => {
    const loose = {
      id: 'i1',
      stages: [
        stage({ id: 'print', sort_order: 20, executor: 'contractor' }),
        stage({ id: 'sew', sort_order: 30 }),
      ],
    };
    expect(nextRouteStage(loose, { id: 'print', sort_order: 20 })?.id).toBe('sew');
  });
});

describe('где заказ сейчас', () => {
  it('первый незакрытый этап маршрута', () => {
    const item = {
      stages: [
        stage({ id: 'cut', sort_order: 10, status: 'done' }),
        stage({ id: 'print', sort_order: 20, status: 'in_progress', executor: 'contractor' }),
        stage({ id: 'sew', sort_order: 30 }),
      ],
    };
    expect(currentStage(item)?.id).toBe('print');
  });

  it('всё закрыто — производство закончено', () => {
    expect(currentStage({ stages: [stage({ id: 'cut', status: 'done' })] })).toBeNull();
  });
});

describe('подпись этапа', () => {
  it('у подрядного берётся операция: человек читает, ЧТО делает подрядчик', () => {
    expect(stageLabel(
      { executor: 'contractor', operation: 'Сублимация' }, 'Цех ДТФ',
    )).toBe('Сублимация');
  });

  it('без операции — имя цеха-владельца', () => {
    expect(stageLabel({ executor: 'contractor', operation: null }, 'Швейный')).toBe('Швейный');
    expect(stageLabel({ executor: 'contractor', operation: '  ' }, 'Швейный')).toBe('Швейный');
  });

  it('у нашего этапа операция подпись не подменяет', () => {
    // Иначе одна и та же работа называлась бы по-разному в очереди и на канбане
    expect(stageLabel({ executor: 'internal', operation: 'Сублимация' }, 'Цех ДТФ')).toBe('Цех ДТФ');
  });
});
