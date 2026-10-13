import { describe, expect, it } from 'vitest';
import {
  EMPTY_DEV_FILTERS,
  applyDevFilters,
  buildDevRows,
  devFiltersFromParams,
  devFiltersToParams,
  filterDevs,
  hasActiveDevFilters,
  sortDevs,
} from './filterExperimental';
import type { DevFilters } from './filterExperimental';
import type { ErpExperimental, ErpExperimentalTask } from '../types';

const TODAY = '2026-08-12';

function task(over: Partial<ErpExperimentalTask> = {}): ErpExperimentalTask {
  return {
    id: 't', experimental_id: 'e', task_type: 'patterns', title: null,
    responsible: null, due_date: null, status: 'todo', blocked_reason: null,
    depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null,
    result: null, department_id: null, stage_id: null, done_on: null,
    created_at: '', updated_at: '', ...over,
  };
}

/** Разработка собирается через Object.assign: колонка `constructor` мешает литералу */
function devOf(over: Record<string, unknown>): ErpExperimental {
  return Object.assign({
    id: 'e1', order_id: 'o1', phase: 'patterns', tech_name: 'Hoodie Zero Nights',
    measurement_table: null, has_3d: false, constructor: null, technologist: null,
    final_outcome: null, constructor_return_comment: null,
    outcome: null, due_date: null, dev_type: null, owner: null,
    created_at: '2026-08-01T00:00:00Z', updated_at: '', tasks: [],
    order: { title: 'Заказ', bitrix_id: '4821', due_date: null },
  }, over) as unknown as ErpExperimental;
}

const f = (over: Partial<DevFilters> = {}): DevFilters => ({ ...EMPTY_DEV_FILTERS, ...over });

describe('строки экрана разработок', () => {
  it('состояние считается один раз и едет вместе со строкой', () => {
    const rows = buildDevRows([
      devOf({ id: 'a', tasks: [task({ status: 'blocked' })] }),
      devOf({ id: 'b', outcome: 'ready_for_serial' }),
    ], TODAY);
    expect(rows.map((r) => r.state)).toEqual(['attention', 'ready']);
  });
});

describe('фильтры разработок', () => {
  const rows = buildDevRows([
    devOf({
      id: 'a', tech_name: 'Худи Зеро', constructor: 'Иван', technologist: 'Пётр',
      dev_type: 'Кастомный заказ', due_date: '2026-08-20',
      tasks: [task({ id: '1', status: 'in_progress' })],
    }),
    devOf({
      id: 'b', tech_name: 'Свитшот', constructor: 'Мария', technologist: 'Пётр',
      dev_type: 'Своя линейка', due_date: '2026-09-01',
      tasks: [task({ id: '2', status: 'blocked', blocked_reason: 'Нет ткани' })],
    }),
    devOf({ id: 'c', tech_name: 'Кепка', outcome: 'ready_for_serial', due_date: '2026-08-15' }),
  ], TODAY);

  const ids = (list: ReturnType<typeof filterDevs>) => list.map((r) => r.dev.id);

  it('поиск по изделию и по номеру сделки', () => {
    expect(ids(filterDevs(rows, f({ q: 'свитшот' })))).toEqual(['b']);
    expect(ids(filterDevs(rows, f({ q: '4821' })))).toHaveLength(3);
  });

  it('состояние', () => {
    expect(ids(filterDevs(rows, f({ state: 'ready' })))).toEqual(['c']);
    expect(ids(filterDevs(rows, f({ state: 'attention' })))).toEqual(['b']);
  });

  it('конструктор и проработчик — разные поля', () => {
    expect(ids(filterDevs(rows, f({ constructorName: 'Иван' })))).toEqual(['a']);
    expect(ids(filterDevs(rows, f({ developer: 'Пётр' })))).toEqual(['a', 'b']);
  });

  it('тип разработки', () => {
    expect(ids(filterDevs(rows, f({ devType: 'Своя линейка' })))).toEqual(['b']);
  });

  it('срок: диапазон включает границы', () => {
    expect(ids(filterDevs(rows, f({ dueFrom: '2026-08-16' })))).toEqual(['a', 'b']);
    expect(ids(filterDevs(rows, f({ dueTo: '2026-08-20' })))).toEqual(['a', 'c']);
  });

  it('«с проблемой» — только заблокированные задачи', () => {
    expect(ids(filterDevs(rows, f({ problem: true })))).toEqual(['b']);
  });

  it('пустой набор фильтров ничего не отбрасывает', () => {
    expect(filterDevs(rows, f())).toHaveLength(3);
  });
});

describe('сортировка разработок', () => {
  const rows = buildDevRows([
    devOf({ id: 'a', due_date: '2026-09-01', created_at: '2026-08-01T00:00:00Z',
      tasks: [task({ id: '1', status: 'done' }), task({ id: '2', status: 'done' })] }),
    devOf({ id: 'b', due_date: '2026-08-15', created_at: '2026-08-05T00:00:00Z',
      tasks: [task({ id: '3', status: 'done' }), task({ id: '4', status: 'todo' })] }),
    devOf({ id: 'c', due_date: null, created_at: '2026-08-03T00:00:00Z', tasks: [] }),
  ], TODAY);
  const ids = (list: ReturnType<typeof sortDevs>) => list.map((r) => r.dev.id);

  it('по сроку: без срока — в конец', () => {
    expect(ids(sortDevs(rows, 'due'))).toEqual(['b', 'a', 'c']);
  });

  it('по готовности: наименее готовые сверху, без задач — первой', () => {
    // Разработка без задач вообще не начата, ей нужно внимание раньше всех
    expect(ids(sortDevs(rows, 'readiness'))).toEqual(['c', 'b', 'a']);
  });

  it('по дате создания: свежие сверху', () => {
    expect(ids(sortDevs(rows, 'created'))).toEqual(['b', 'c', 'a']);
  });

  it('исходный массив не мутируется', () => {
    const before = rows.map((r) => r.dev.id);
    sortDevs(rows, 'created');
    expect(rows.map((r) => r.dev.id)).toEqual(before);
  });

  it('applyDevFilters фильтрует и сортирует разом', () => {
    const got = applyDevFilters(rows, f({ sort: 'due' }));
    expect(got.map((r) => r.dev.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('фильтры и адрес', () => {
  it('круг сохраняет значения', () => {
    const src = f({
      q: 'худи', state: 'attention', constructorName: 'Иван', developer: 'Пётр',
      devType: 'Кастом', dueFrom: '2026-08-01', problem: true, sort: 'readiness',
    });
    expect(devFiltersFromParams(new URLSearchParams(devFiltersToParams(src)))).toEqual(src);
  });

  it('умолчания в адрес не пишутся', () => {
    expect(devFiltersToParams(f())).toEqual({});
  });

  it('мусор игнорируется, а не даёт пустой экран', () => {
    const got = devFiltersFromParams(new URLSearchParams('state=абвгд&sort=никак'));
    expect(got.state).toBe('');
    expect(got.sort).toBe('due');
  });

  it('активность фильтров видна кнопке «Сбросить»', () => {
    expect(hasActiveDevFilters(f())).toBe(false);
    expect(hasActiveDevFilters(f({ problem: true }))).toBe(true);
    expect(hasActiveDevFilters(f({ sort: 'created' }))).toBe(true);
  });
});
