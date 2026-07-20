import { describe, it, expect } from 'vitest';
import { buildKanbanColumns } from './kanbanColumns';

// Минимальные фикстуры: только поля, которые читает buildKanbanColumns.
const dept = (id, code, active = true) => ({ id, code, name: code, active });

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
