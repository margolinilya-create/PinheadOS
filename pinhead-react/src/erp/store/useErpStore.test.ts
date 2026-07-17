import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Тесты логики частичной готовности (qty_done += N), фикса NaN в браке
 * и счётчика readyCountFor для бейджа «Мой цех».
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as { table: string; patch: Record<string, unknown> }[],
  updateError: null as { message: string } | null,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      update: vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn(() => {
          h.updateCalls.push({ table, patch });
          return Promise.resolve({ error: h.updateError });
        }),
      })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'u1', name: 'Тест', email: 't@t.ru' } })),
  },
}));

const { useErpStore, readyCountFor } = await import('./useErpStore');

/* eslint-disable @typescript-eslint/no-explicit-any */
function seed(stageOverrides: Record<string, unknown> = {}, itemQty = 500) {
  const stage = {
    id: 'st1',
    item_id: 'it1',
    department_id: 'd1',
    depends_on: [],
    status: 'in_progress',
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
    ...stageOverrides,
  };
  const item = {
    id: 'it1',
    order_id: 'o1',
    product_type: 'Футболка',
    variant: null,
    qty: itemQty,
    production_type: 'sewing',
    branding_methods: [],
    branding_on: 'cut',
    notes: null,
    sort_order: 10,
    stages: [stage],
    prints: [],
  };
  const order = { id: 'o1', title: 'Заказ', status: 'active', items: [item], materials: [] };
  useErpStore.setState({
    orders: [order] as any,
    departments: [{ id: 'd1', code: 'sewing', name: 'Швейный цех', active: true }] as any,
    loaded: true,
  });
}

function getStage() {
  return useErpStore.getState().orders[0].items[0].stages[0];
}

beforeEach(() => {
  h.updateCalls.length = 0;
  h.updateError = null;
  useErpStore.setState({ orders: [], departments: [], loaded: false, myDeptId: null, myDeptLoaded: false });
});

describe('useErpStore — reportProgress (частичная готовность)', () => {
  it('накапливает qty_done, этап остаётся in_progress', async () => {
    seed();
    const ok = await useErpStore.getState().reportProgress('st1', 300);
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.qty_done).toBe(300);
    expect(st.status).toBe('in_progress');
    expect(st.finished_at).toBeNull();
    const call = h.updateCalls.find((c) => c.table === 'erp_item_stages');
    expect(call?.patch).toEqual({ qty_done: 300 });
  });

  it('при достижении qty позиции закрывает этап (done + finished_at)', async () => {
    seed({ qty_done: 300 });
    const ok = await useErpStore.getState().reportProgress('st1', 200);
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.qty_done).toBe(500);
    expect(st.status).toBe('done');
    expect(st.finished_at).toBeTruthy();
  });

  it('не даёт qty_done уйти выше qty позиции (клампится)', async () => {
    seed({ qty_done: 400 });
    await useErpStore.getState().reportProgress('st1', 900);
    const st = getStage();
    expect(st.qty_done).toBe(500);
    expect(st.status).toBe('done');
  });

  it('qty_done может быть null в БД — считается как 0 (без NaN)', async () => {
    seed({ qty_done: null });
    await useErpStore.getState().reportProgress('st1', 100);
    expect(getStage().qty_done).toBe(100);
  });

  it('отклоняет некорректное количество (0, отрицательное)', async () => {
    seed();
    expect(await useErpStore.getState().reportProgress('st1', 0)).toBe(false);
    expect(await useErpStore.getState().reportProgress('st1', -5)).toBe(false);
    expect(getStage().qty_done).toBe(0);
    expect(h.updateCalls).toHaveLength(0);
  });

  it('rollback при ошибке Supabase', async () => {
    seed({ qty_done: 100 });
    h.updateError = { message: 'boom' };
    const ok = await useErpStore.getState().reportProgress('st1', 200);
    expect(ok).toBe(false);
    const st = getStage();
    expect(st.qty_done).toBe(100);
    expect(st.status).toBe('in_progress');
  });

  it('несуществующий этап → false', async () => {
    seed();
    expect(await useErpStore.getState().reportProgress('nope', 10)).toBe(false);
  });
});

describe('useErpStore — setStageStatus (полное закрытие)', () => {
  it('«Готово» без числа закрывает целиком: qty_done = qty позиции', async () => {
    seed({ qty_done: 300 });
    const ok = await useErpStore.getState().setStageStatus('st1', 'done', { qty_done: 500 });
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.status).toBe('done');
    expect(st.qty_done).toBe(500);
    expect(st.finished_at).toBeTruthy();
  });
});

describe('useErpStore — reportDefect (фикс NaN)', () => {
  it('qty_rework null/undefined считается как 0', async () => {
    seed({ status: 'done', qty_rework: undefined });
    const ok = await useErpStore.getState().reportDefect('st1', 5, 'пятно');
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.qty_rework).toBe(5);
    expect(Number.isNaN(st.qty_rework)).toBe(false);
    expect(st.status).toBe('in_progress');
  });

  it('накапливает qty_rework', async () => {
    seed({ qty_rework: 3 });
    await useErpStore.getState().reportDefect('st1', 2, 'кривая строчка');
    expect(getStage().qty_rework).toBe(5);
  });
});

describe('readyCountFor — бейдж «Мой цех»', () => {
  it('считает in_progress и готовые к работе waiting-этапы цеха', () => {
    seed({ status: 'in_progress' });
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'sewing')).toBe(1);
  });

  it('waiting без незакрытых зависимостей — готов к работе', () => {
    seed({ status: 'waiting', depends_on: [] });
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'sewing')).toBe(1);
  });

  it('чужой цех / неизвестный код — 0', () => {
    seed({ status: 'in_progress' });
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'cutting')).toBe(0);
  });
});
