import { describe, it, expect } from 'vitest';
import { buildKanbanColumns } from './kanbanColumns';
import { EMPTY_FILTERS } from './filterStages';

// Минимальные фикстуры: только поля, которые читает buildKanbanColumns.
// is_production не задаём: фикстура проверяет и откат на сид-набор кодов
const dept = (id, code, active = true, gate = undefined) =>
  ({ id, code, name: code, active, gate_material_kinds: gate });

const stage = (id, department_id, status, extra = {}) => ({
  id, item_id: 'i1', department_id, status,
  depends_on: [], sort_order: 0, qty_done: 0, qty_rework: 0,
  started_at: null, finished_at: null, updated_at: null, block_reason: null,
  ...extra,
});

const order = (id, stages, { status = 'active', due_date = '2026-01-01', materials = [] } = {}) => ({
  id, status, due_date, materials,
  items: [{ id: 'i1', qty: 10, product_type: 'футболка', stages }],
});

describe('buildKanbanColumns — группировка канбана', () => {
  it('колонки — только активные цеха из очереди', () => {
    const deps = [
      dept('d-sew', 'sewing'),
      dept('d-off', 'office'),        // не queue-цех → нет колонки
      dept('d-dtf', 'dtf', false),    // неактивный → нет колонки
    ];
    const cols = buildKanbanColumns([], deps);
    expect(cols.map((c) => c.dept.id)).toEqual(['d-sew']);
  });

  it('этапы попадают в свои дорожки', () => {
    const deps = [dept('d-sew', 'sewing')];
    const o = order('o1', [
      stage('s-ready', 'd-sew', 'waiting'),      // нет deps/материалов → ready
      stage('s-prog', 'd-sew', 'in_progress'),
      stage('s-block', 'd-sew', 'blocked'),
      stage('s-done', 'd-sew', 'done'),
    ]);
    const [col] = buildKanbanColumns([o], deps);
    expect(col.ready.map((e) => e.stage.id)).toEqual(['s-ready']);
    expect(col.in_progress.map((e) => e.stage.id)).toEqual(['s-prog']);
    expect(col.blocked.map((e) => e.stage.id)).toEqual(['s-block']);
    expect(col.done.map((e) => e.stage.id)).toEqual(['s-done']);
    expect(col.ready[0].group).toBe('ready');
  });

  it('заказы не в статусе active пропускаются', () => {
    const deps = [dept('d-sew', 'sewing')];
    const o = order('o1', [stage('s1', 'd-sew', 'in_progress')], { status: 'done_on_time' });
    const [col] = buildKanbanColumns([o], deps);
    expect(col.in_progress).toHaveLength(0);
  });

  it('«Завершено» — максимум 5, свежие по finished_at сверху', () => {
    const deps = [dept('d-sew', 'sewing')];
    const stages = Array.from({ length: 7 }, (_, i) =>
      stage(`d${i}`, 'd-sew', 'done', { finished_at: `2026-01-0${i + 1}` }));
    const o = { id: 'o1', status: 'active', due_date: '2026-01-01', materials: [],
      items: [{ id: 'i1', qty: 10, product_type: 'x', stages }] };
    const [col] = buildKanbanColumns([o], deps);
    expect(col.done).toHaveLength(5);
    expect(col.done[0].stage.id).toBe('d6'); // самый поздний finished_at
  });

  it('ready/in_progress сортируются по сроку (due_date asc)', () => {
    const deps = [dept('d-sew', 'sewing')];
    const late = order('late', [stage('s-late', 'd-sew', 'in_progress')], { due_date: '2026-12-31' });
    const soon = order('soon', [stage('s-soon', 'd-sew', 'in_progress')], { due_date: '2026-02-01' });
    const [col] = buildKanbanColumns([late, soon], deps);
    expect(col.in_progress.map((e) => e.stage.id)).toEqual(['s-soon', 's-late']);
  });
});

describe('buildKanbanColumns — приоритет и фильтры (волна 1)', () => {
  const deps = [dept('d-sew', 'sewing'), dept('d-dtf', 'dtf')];

  it('порядок внутри дорожки — по приоритету очереди', () => {
    const a = order('a', [stage('s-a', 'd-sew', 'in_progress', { queue_position: 300 })], { due_date: '2026-01-01' });
    const b = order('b', [stage('s-b', 'd-sew', 'in_progress', { queue_position: 100 })], { due_date: '2026-12-31' });
    const [col] = buildKanbanColumns([a, b], deps);
    // приоритет важнее срока: 100 идёт раньше 300, хотя срок у него дальше
    expect(col.in_progress.map((e) => e.stage.id)).toEqual(['s-b', 's-a']);
  });

  it('фильтры отсекают карточки во всех колонках', () => {
    const a = order('a', [stage('s-a', 'd-sew', 'in_progress')]);
    const b = order('b', [stage('s-b', 'd-dtf', 'in_progress')]);
    const cols = buildKanbanColumns([a, b], deps, { ...EMPTY_FILTERS, dept: 'd-dtf' });
    const sew = cols.find((c) => c.dept.id === 'd-sew');
    const dtf = cols.find((c) => c.dept.id === 'd-dtf');
    expect(sew.in_progress).toHaveLength(0);
    expect(dtf.in_progress.map((e) => e.stage.id)).toEqual(['s-b']);
  });

  it('заблокированные карточки попадают в свою дорожку с причиной', () => {
    const o = order('o1', [stage('s1', 'd-sew', 'blocked', { block_reason: 'нет ниток' })]);
    const [col] = buildKanbanColumns([o], deps);
    expect(col.blocked[0].reason).toBe('нет ниток');
  });
});

/**
 * Правка менеджера 2026-08-03: «Ожидают материалы» — своя дорожка ПЕРЕД «Готово
 * к работе». Раньше такие задания на доску не попадали вовсе (`waiting`
 * отбрасывался), а ручные блокировки подмешивались в «Готово к работе», и понять,
 * что цех стоит из-за снабжения, было нельзя.
 */
describe('buildKanbanColumns — дорожка «Ожидают материалы»', () => {
  const mat = (over = {}) => ({
    id: 'm1', kind: 'fabric', name: 'Кулирка', status: 'ordered',
    eta_date: null, accept_status: null, item_id: null, ...over,
  });

  it('этап без материала едет в свою дорожку, а не в «Готово к работе»', () => {
    const deps = [dept('d-cut', 'cutting', true, ['fabric'])];
    const o = order('o1', [stage('s1', 'd-cut', 'waiting')], { materials: [mat()] });
    const [col] = buildKanbanColumns([o], deps);
    expect(col.awaiting_materials.map((e) => e.stage.id)).toEqual(['s1']);
    expect(col.ready).toEqual([]);
  });

  it('блокировка цехом больше не подмешивается в «Готово к работе»', () => {
    const deps = [dept('d-cut', 'cutting', true, ['fabric'])];
    const o = order('o1', [
      stage('s-ready', 'd-cut', 'waiting'),
      stage('s-block', 'd-cut', 'blocked'),
    ]);
    const [col] = buildKanbanColumns([o], deps);
    expect(col.ready.map((e) => e.stage.id)).toEqual(['s-ready']);
    expect(col.blocked.map((e) => e.stage.id)).toEqual(['s-block']);
  });

  it('участок без настройки материалов дорожку не наполняет', () => {
    const deps = [dept('d-vto', 'vto')];
    const o = order('o1', [stage('s1', 'd-vto', 'waiting')], { materials: [mat()] });
    const [col] = buildKanbanColumns([o], deps);
    expect(col.awaiting_materials).toEqual([]);
    expect(col.ready.map((e) => e.stage.id)).toEqual(['s1']);
  });
});
