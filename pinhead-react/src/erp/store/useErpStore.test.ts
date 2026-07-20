import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Тесты логики частичной готовности (qty_done += N), фикса NaN в браке,
 * счётчика readyCountFor, точечного realtime (п.27), pendingMutations (п.29),
 * ленивого архива (п.26), RPC-создания заказа (п.28) и ретрая аудита (п.33).
 */

const h = vi.hoisted(() => ({
  updateCalls: [] as { table: string; patch: Record<string, unknown> }[],
  updateError: null as { message: string } | null,
  insertCalls: [] as { table: string; row: unknown }[],
  /** Очередь ошибок insert (для ретрая logStageEvent): shift на каждый вызов */
  insertErrors: [] as ({ message: string } | null)[],
  selectCalls: [] as { table: string; filters: string[] }[],
  tableData: {} as Record<string, unknown[]>,
  selectError: null as { message: string } | null,
  singleData: null as unknown,
  rpcCalls: [] as { fn: string; args: { payload?: unknown } }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeQuery = (table: string) => {
    const filters: string[] = [];
    const q: any = {
      eq: (col: string, val: unknown) => { filters.push(`eq:${col}=${val}`); return q; },
      neq: (col: string, val: unknown) => { filters.push(`neq:${col}=${val}`); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => {
        h.selectCalls.push({ table, filters });
        return Promise.resolve({ data: h.singleData, error: h.selectError });
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        h.selectCalls.push({ table, filters });
        return Promise
          .resolve({ data: h.tableData[table] ?? [], error: h.selectError })
          .then(resolve, reject);
      },
    };
    return q;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => makeQuery(table)),
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn(() => {
            h.updateCalls.push({ table, patch });
            return Promise.resolve({ error: h.updateError });
          }),
        })),
        insert: vi.fn((row: any) => {
          h.insertCalls.push({ table, row });
          const result = {
            data: Array.isArray(row) ? row : [row],
            error: h.insertErrors.shift() ?? null,
          };
          // Поддержка обоих стилей: await insert(row) и insert(row).select()
          const p: any = Promise.resolve(result);
          p.select = () => Promise.resolve(result);
          return p;
        }),
      })),
      rpc: vi.fn((fn: string, args: { payload?: unknown }) => {
        h.rpcCalls.push({ fn, args });
        return Promise.resolve(h.rpcResult);
      }),
    },
  };
});

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'u1', name: 'Тест', email: 't@t.ru' } })),
  },
}));

vi.mock('../../store/useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const { useErpStore, readyCountFor, _pendingMutations } = await import('./useErpStore');
const { toast } = await import('../../store/useToastStore');
const { useAuthStore } = await import('../../store/useAuthStore');

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
  vi.clearAllMocks();
  h.updateCalls.length = 0;
  h.updateError = null;
  h.insertCalls.length = 0;
  h.insertErrors.length = 0;
  h.selectCalls.length = 0;
  h.tableData = {};
  h.selectError = null;
  h.singleData = null;
  h.rpcCalls.length = 0;
  h.rpcResult = { data: null, error: null };
  _pendingMutations.clear();
  localStorage.removeItem('erp_my_dept');
  useErpStore.setState({
    orders: [], departments: [], loaded: false,
    archiveLoaded: false, archiveLoading: false,
    myDeptId: null, myDeptLoaded: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
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

describe('useErpStore — ackStageOverdue (обработка просрочки, правка 8)', () => {
  it('пишет комментарий и время подтверждения на этап', async () => {
    seed();
    const ok = await useErpStore.getState().ackStageOverdue('st1', 'ждём фурнитуру');
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.overdue_comment).toBe('ждём фурнитуру');
    expect(st.overdue_ack_at).toBeTruthy();
    const upd = h.updateCalls.find((c) => c.table === 'erp_item_stages');
    expect((upd?.patch as any).overdue_comment).toBe('ждём фурнитуру');
  });
});

describe('useErpStore — reportDefect (переделка на текущем этапе)', () => {
  it('target=current: qty_rework накапливается, этап in_progress', async () => {
    seed({ status: 'done', qty_rework: undefined });
    const ok = await useErpStore.getState().reportDefect('st1', { qty: 5, reason: 'пятно' });
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.qty_rework).toBe(5);
    expect(Number.isNaN(st.qty_rework)).toBe(false);
    expect(st.status).toBe('in_progress');
    // только текущий этап — одно обновление
    expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(1);
  });

  it('накапливает qty_rework', async () => {
    seed({ qty_rework: 3 });
    await useErpStore.getState().reportDefect('st1', { qty: 2, reason: 'кривая строчка' });
    expect(getStage().qty_rework).toBe(5);
  });
});

/** Цепочка закрой(done) → швейка(done), швейка зависит от закроя */
function seedChain() {
  const base = {
    item_id: 'it1', qty_done: 500, qty_rework: 0,
    planned_start: null, planned_end: null, started_at: null,
    assignee: null, block_reason: null, notes: null,
  };
  const cutting = { ...base, id: 'st-cut', department_id: 'd-cut', depends_on: [], status: 'done', finished_at: '2026-01-01', sort_order: 10 };
  const sewing = { ...base, id: 'st-sew', department_id: 'd-sew', depends_on: ['st-cut'], status: 'done', finished_at: '2026-01-02', sort_order: 20 };
  const item = {
    id: 'it1', order_id: 'o1', product_type: 'Футболка', variant: null, qty: 500,
    production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, sort_order: 10, stages: [cutting, sewing], prints: [],
  };
  const order = { id: 'o1', title: 'Заказ', status: 'active', items: [item], materials: [] };
  useErpStore.setState({
    orders: [order] as any,
    departments: [
      { id: 'd-cut', code: 'cutting', name: 'Закрой', active: true },
      { id: 'd-sew', code: 'sewing', name: 'Швейка', active: true },
    ] as any,
    loaded: true,
  });
}

describe('useErpStore — reportDefect (выбор этапа устранения)', () => {
  const stages = () => useErpStore.getState().orders[0].items[0].stages;

  it('target=<этап>: N уходит на выбранный этап, годные остаются', async () => {
    seedChain();
    const ok = await useErpStore.getState().reportDefect('st-sew', { qty: 20, reason: 'кривая строчка', target: 'st-cut' });
    expect(ok).toBe(true);
    const cut = stages().find((s) => s.id === 'st-cut');
    const sew = stages().find((s) => s.id === 'st-sew');
    expect(cut?.status).toBe('in_progress');
    expect(cut?.qty_done).toBe(480);
    expect(cut?.qty_rework).toBe(20);
    expect(cut?.finished_at).toBeNull();
    expect(sew?.status).toBe('waiting');
    expect(sew?.qty_done).toBe(480);
    expect(sew?.qty_rework).toBe(20);
    expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(2);
  });

  it('аудит-событие пишется на выбранный этап-получатель', async () => {
    seedChain();
    await useErpStore.getState().reportDefect('st-sew', { qty: 5, reason: 'пятно', target: 'st-cut' });
    const ev = h.insertCalls.find((c) => c.table === 'erp_stage_events');
    expect((ev?.row as any).stage_id).toBe('st-cut');
    expect((ev?.row as any).qty_rework).toBe(5);
    expect((ev?.row as any).comment).toContain('Возврат брака');
    expect((ev?.row as any).comment).toContain('Швейка');
  });

  it('target=current не трогает другие этапы', async () => {
    seedChain();
    await useErpStore.getState().reportDefect('st-sew', { qty: 10, reason: 'брак', target: 'current' });
    const cut = stages().find((s) => s.id === 'st-cut');
    expect(cut?.status).toBe('done'); // предыдущий этап не тронут
    expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(1);
  });

  it('брак больше тиража отклоняется', async () => {
    seedChain();
    const ok = await useErpStore.getState().reportDefect('st-sew', { qty: 999, reason: 'много', target: 'st-cut' });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Брак не может превышать тираж (500 шт)');
  });
});

describe('useErpStore — reportDefect (задача закупки)', () => {
  const stages = () => useErpStore.getState().orders[0].items[0].stages;

  it('target=procurement: этап в ожидание + создаётся задача закупки', async () => {
    seedChain();
    const ok = await useErpStore.getState().reportDefect('st-sew', {
      qty: 15, reason: 'ткань испорчена', target: 'procurement',
      materialName: 'Кулирка чёрная', cause: 'damaged_in_production',
    });
    expect(ok).toBe(true);
    const sew = stages().find((s) => s.id === 'st-sew');
    expect(sew?.status).toBe('waiting');
    expect(sew?.qty_rework).toBe(15);
    const task = h.insertCalls.find((c) => c.table === 'erp_procurement_tasks');
    expect(task).toBeTruthy();
    expect((task?.row as any).material_name).toBe('Кулирка чёрная');
    expect((task?.row as any).cause_type).toBe('damaged_in_production');
    expect((task?.row as any).kind).toBe('restock');
    expect((task?.row as any).counts_as_purchase).toBe(true);
    expect((task?.row as any).rework_qty).toBe(15);
  });

  it('needsMaterial=true + брак поставщика → задача замены (не закупка компании)', async () => {
    seedChain();
    await useErpStore.getState().reportDefect('st-sew', {
      qty: 8, reason: 'дырки в ткани', target: 'current',
      needsMaterial: true, cause: 'supplier_defect', supplier: 'ООО Ткани', plannedDate: '2026-07-25',
    });
    const task = h.insertCalls.find((c) => c.table === 'erp_procurement_tasks');
    expect((task?.row as any).kind).toBe('replacement');
    expect((task?.row as any).counts_as_purchase).toBe(false);
    expect((task?.row as any).supplier).toBe('ООО Ткани');
    expect((task?.row as any).planned_date).toBe('2026-07-25');
  });

  it('target=subcontractor: этап в ожидание + создаётся операция подряда (правка 4)', async () => {
    seedChain();
    const ok = await useErpStore.getState().reportDefect('st-sew', {
      qty: 12, reason: 'перешить рукав', target: 'subcontractor',
      subcontractOperation: 'Перешив', contractor: 'ИП Швейкин',
    });
    expect(ok).toBe(true);
    const sew = useErpStore.getState().orders[0].items[0].stages.find((s: any) => s.id === 'st-sew');
    expect(sew?.status).toBe('waiting');
    expect(sew?.qty_rework).toBe(12);
    const op = h.insertCalls.find((c) => c.table === 'erp_subcontracting');
    expect(op).toBeTruthy();
    expect((op?.row as any).operation).toBe('Перешив');
    expect((op?.row as any).contractor).toBe('ИП Швейкин');
    expect((op?.row as any).op_type).toBe('operation');
    expect((op?.row as any).return_dept).toBe('sewing');
    expect((op?.row as any).qty).toBe(12);
  });
});

describe('useErpStore — createProcurementTask (классификация причины)', () => {
  it('внутренняя причина → дозакупка, считается закупкой', async () => {
    seed();
    const row = await useErpStore.getState().createProcurementTask('o1', {
      material_name: 'Молния', cause_type: 'shortage',
    });
    expect(row).toBeTruthy();
    const call = h.insertCalls.find((c) => c.table === 'erp_procurement_tasks');
    expect((call?.row as any).kind).toBe('restock');
    expect((call?.row as any).counts_as_purchase).toBe(true);
    expect(useErpStore.getState().orders[0].procurement_tasks?.length).toBe(1);
  });

  it('брак поставщика → замена, не считается закупкой', async () => {
    seed();
    await useErpStore.getState().createProcurementTask('o1', {
      material_name: 'Ткань', cause_type: 'supplier_defect',
    });
    const call = h.insertCalls.find((c) => c.table === 'erp_procurement_tasks');
    expect((call?.row as any).kind).toBe('replacement');
    expect((call?.row as any).counts_as_purchase).toBe(false);
  });
});

describe('useErpStore — addMaterial (поставщик)', () => {
  it('передаёт supplier в insert и добавляет материал в стор', async () => {
    seed();
    const row = await useErpStore.getState().addMaterial('o1', {
      kind: 'fabric', name: 'Кулирка', source: 'purchase',
      supplier: 'ООО Ткани', eta_date: '2026-07-20', status: 'pending',
    } as any);
    expect(row).toBeTruthy();
    const call = h.insertCalls.find((c) => c.table === 'erp_materials');
    expect(call?.row).toMatchObject({ order_id: 'o1', supplier: 'ООО Ткани', name: 'Кулирка' });
    expect(useErpStore.getState().orders[0].materials.some((m) => m.supplier === 'ООО Ткани')).toBe(true);
  });
});

describe('useErpStore — Подряд (subcontracting)', () => {
  beforeEach(() => {
    useErpStore.setState({ subcontracting: [], subcontractingLoaded: false } as any);
  });

  it('createSubcontractOp: статус planned по умолчанию, добавляется в начало', async () => {
    const row = await useErpStore.getState().createSubcontractOp({
      order_id: 'o1', operation: 'Пошив', contractor: 'ИП Иванов', qty: 100,
    } as any);
    expect(row).toBeTruthy();
    const call = h.insertCalls.find((c) => c.table === 'erp_subcontracting');
    expect((call?.row as any).status).toBe('planned');
    expect((call?.row as any).operation).toBe('Пошив');
    expect(useErpStore.getState().subcontracting[0].operation).toBe('Пошив');
  });

  it('loadSubcontracting наполняет список и ставит флаг', async () => {
    h.tableData = { erp_subcontracting: [{ id: 's1', order_id: 'o1', operation: 'Вышивка', status: 'sent' }] };
    await useErpStore.getState().loadSubcontracting();
    const s = useErpStore.getState();
    expect(s.subcontractingLoaded).toBe(true);
    expect(s.subcontracting.map((o) => o.id)).toEqual(['s1']);
  });

  it('updateSubcontractOp: optimistic обновление + rollback при ошибке', async () => {
    useErpStore.setState({
      subcontracting: [{ id: 's1', order_id: 'o1', operation: 'Пошив', status: 'sent' }] as any,
    });
    const ok = await useErpStore.getState().updateSubcontractOp('s1', { status: 'returned' });
    expect(ok).toBe(true);
    expect(useErpStore.getState().subcontracting[0].status).toBe('returned');

    h.updateError = { message: 'boom' };
    const ok2 = await useErpStore.getState().updateSubcontractOp('s1', { status: 'delayed' });
    expect(ok2).toBe(false);
    expect(useErpStore.getState().subcontracting[0].status).toBe('returned'); // откат
  });
});

describe('useErpStore — материал со склада / авто-закрытие закупки', () => {
  function seedSupply(materials: any[] = []) {
    const supplyStage = {
      id: 'st-sup', item_id: 'it1', department_id: 'd-sup', depends_on: [],
      status: 'in_progress', qty_done: 0, qty_rework: 0, sort_order: 10,
      planned_start: null, planned_end: null, started_at: null,
      finished_at: null, assignee: null, block_reason: null, notes: null,
    };
    const item = {
      id: 'it1', order_id: 'o1', product_type: 'Футболка', variant: null, qty: 100,
      production_type: 'sewing', branding_methods: [], branding_on: 'cut',
      notes: null, sort_order: 10, stages: [supplyStage], prints: [],
    };
    const order = { id: 'o1', title: 'Заказ', status: 'active', items: [item], materials };
    useErpStore.setState({
      orders: [order] as any,
      departments: [{ id: 'd-sup', code: 'supply', name: 'Закупка', active: true }] as any,
      loaded: true,
    });
  }
  const supplyStage = () => useErpStore.getState().orders[0].items[0].stages[0];
  const mat = (over: any) => ({
    id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Ткань',
    source: 'stock', supplier: null, qty: null, status: 'pending',
    eta_date: null, received_at: null, notes: null, created_at: '', updated_at: '', ...over,
  });

  it('addMaterial сразу-готового материала закрывает этап «Закупка» (баг-фикс)', async () => {
    seedSupply();
    await useErpStore.getState().addMaterial('o1', {
      kind: 'fabric', name: 'X', source: 'client', status: 'received',
    } as any);
    expect(supplyStage().status).toBe('done');
  });

  it('addMaterial pending НЕ закрывает закупку', async () => {
    seedSupply();
    await useErpStore.getState().addMaterial('o1', {
      kind: 'fabric', name: 'X', source: 'purchase', status: 'pending',
    } as any);
    expect(supplyStage().status).toBe('in_progress');
  });

  it('confirmStockMaterial → reserved + закрывает закупку', async () => {
    seedSupply([mat({ status: 'pending' })]);
    const ok = await useErpStore.getState().confirmStockMaterial('m1');
    expect(ok).toBe(true);
    const m = useErpStore.getState().orders[0].materials[0];
    expect(m.status).toBe('reserved');
    expect(m.received_at).toBeTruthy();
    expect(supplyStage().status).toBe('done');
  });

  it('acceptMaterial: помечает материал received + пишет строку истории склада (правки 2, 3)', async () => {
    seedSupply([mat({ status: 'pending', accept_status: null })]);
    const ok = await useErpStore.getState().acceptMaterial('m1', {
      qty_received: 100, accept_status: 'accepted_full', accept_comment: 'ок',
    });
    expect(ok).toBe(true);
    const m = useErpStore.getState().orders[0].materials[0];
    expect(m.status).toBe('received'); // приёмка помечает прибытие
    expect(m.accept_status).toBe('accepted_full');
    expect(m.qty_received).toBe(100);
    expect(m.accepted_at).toBeTruthy();
    expect(m.accepted_by).toBe('Тест');
    const ops = useErpStore.getState().orders[0].warehouse_ops ?? [];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('material_receipt');
    expect(ops[0].qty).toBe(100);
  });

  it('acceptMaterial: частичная приёмка пишется как partial_receipt', async () => {
    seedSupply([mat({ status: 'received', accept_status: null })]);
    await useErpStore.getState().acceptMaterial('m1', {
      qty_received: 60, accept_status: 'accepted_partial',
    });
    const ops = useErpStore.getState().orders[0].warehouse_ops ?? [];
    expect(ops[0].op_type).toBe('partial_receipt');
  });
});

describe('useErpStore — reportDefect rollback + guard (аудит P1)', () => {
  function seedChainLocal() {
    const base = {
      item_id: 'it1', qty_done: 500, qty_rework: 0,
      planned_start: null, planned_end: null, started_at: null,
      assignee: null, block_reason: null, notes: null,
    };
    const cutting = { ...base, id: 'st-cut', department_id: 'd-cut', depends_on: [], status: 'done', finished_at: '2026-01-01', sort_order: 10 };
    const sewing = { ...base, id: 'st-sew', department_id: 'd-sew', depends_on: ['st-cut'], status: 'done', finished_at: '2026-01-02', sort_order: 20 };
    const item = { id: 'it1', order_id: 'o1', product_type: 'Ф', variant: null, qty: 500, production_type: 'sewing', branding_methods: [], branding_on: 'cut', notes: null, sort_order: 10, stages: [cutting, sewing], prints: [] };
    const order = { id: 'o1', title: 'Заказ', status: 'active', items: [item], materials: [] };
    useErpStore.setState({
      orders: [order] as any,
      departments: [{ id: 'd-cut', code: 'cutting', name: 'Закрой', active: true }, { id: 'd-sew', code: 'sewing', name: 'Швейка', active: true }] as any,
      loaded: true,
    });
  }
  const stages = () => useErpStore.getState().orders[0].items[0].stages;

  it('rollback при ошибке Supabase — оба этапа возвращаются к исходному', async () => {
    seedChainLocal();
    h.updateError = { message: 'boom' };
    const ok = await useErpStore.getState().reportDefect('st-sew', { qty: 20, reason: 'x', target: 'st-cut' });
    expect(ok).toBe(false);
    expect(stages().find((s) => s.id === 'st-cut')?.status).toBe('done');
    expect(stages().find((s) => s.id === 'st-cut')?.qty_rework).toBe(0);
    expect(stages().find((s) => s.id === 'st-sew')?.status).toBe('done');
    expect(toast.error).toHaveBeenCalledWith('Не удалось записать брак');
  });

  it('guard: qty<=0 / несуществующий этап → false, без запросов', async () => {
    seedChainLocal();
    expect(await useErpStore.getState().reportDefect('st-sew', { qty: 0, reason: 'x' })).toBe(false);
    expect(await useErpStore.getState().reportDefect('st-sew', { qty: -3, reason: 'x' })).toBe(false);
    expect(await useErpStore.getState().reportDefect('nope', { qty: 5, reason: 'x' })).toBe(false);
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('useErpStore — updateProcurementTask + error-пути (аудит P1)', () => {
  it('updateProcurementTask: optimistic + rollback', async () => {
    useErpStore.setState({
      orders: [{ id: 'o1', title: 'З', status: 'active', items: [], materials: [], procurement_tasks: [{ id: 'pt1', order_id: 'o1', status: 'new', material_name: 'X' }] }] as any,
    });
    const ok = await useErpStore.getState().updateProcurementTask('pt1', { status: 'ordered' });
    expect(ok).toBe(true);
    expect(useErpStore.getState().orders[0].procurement_tasks?.[0].status).toBe('ordered');

    h.updateError = { message: 'boom' };
    const ok2 = await useErpStore.getState().updateProcurementTask('pt1', { status: 'done' });
    expect(ok2).toBe(false);
    expect(useErpStore.getState().orders[0].procurement_tasks?.[0].status).toBe('ordered');
    expect(toast.error).toHaveBeenCalledWith('Не удалось обновить задачу закупки');
  });

  it('createProcurementTask: ошибка insert → null + toast', async () => {
    seed();
    h.insertErrors.push({ message: 'down' });
    const row = await useErpStore.getState().createProcurementTask('o1', { material_name: 'X', cause_type: 'shortage' });
    expect(row).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Не удалось создать задачу закупки');
  });

  it('addMaterial: ошибка insert → null + toast, материал не добавлен', async () => {
    seed();
    h.insertErrors.push({ message: 'down' });
    const row = await useErpStore.getState().addMaterial('o1', { kind: 'fabric', name: 'X', source: 'purchase', status: 'pending' } as any);
    expect(row).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Не удалось добавить материал');
  });
});

describe('useErpStore — reportDefect бэклог-фиксы (qty vs сделанное, промежут. этапы)', () => {
  it('qty больше сделанного на этапе → отклоняется', async () => {
    seed({ status: 'in_progress', qty_done: 100 }, 500);
    const ok = await useErpStore.getState().reportDefect('st1', { qty: 200, reason: 'x', target: 'current' });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Брак не может превышать сделанное на этапе (100 шт)');
  });

  it('возврат на ранний этап переоткрывает промежуточные (correctness #4)', async () => {
    const base = { item_id: 'it1', qty_done: 500, qty_rework: 0, planned_start: null, planned_end: null, started_at: null, assignee: null, block_reason: null, notes: null };
    const cut = { ...base, id: 's-cut', department_id: 'd1', depends_on: [], status: 'done', finished_at: 'x', sort_order: 10 };
    const sew = { ...base, id: 's-sew', department_id: 'd2', depends_on: ['s-cut'], status: 'done', finished_at: 'x', sort_order: 20 };
    const vto = { ...base, id: 's-vto', department_id: 'd3', depends_on: ['s-sew'], status: 'done', finished_at: 'x', sort_order: 30 };
    const item = { id: 'it1', order_id: 'o1', product_type: 'Ф', variant: null, qty: 500, production_type: 'sewing', branding_methods: [], branding_on: 'cut', notes: null, sort_order: 10, stages: [cut, sew, vto], prints: [] };
    useErpStore.setState({
      orders: [{ id: 'o1', title: 'З', status: 'active', items: [item], materials: [] }] as any,
      departments: [{ id: 'd1', code: 'cutting', name: 'Закрой', active: true }, { id: 'd2', code: 'sewing', name: 'Швейка', active: true }, { id: 'd3', code: 'vto', name: 'ВТО', active: true }] as any,
      loaded: true,
    });
    const ok = await useErpStore.getState().reportDefect('s-vto', { qty: 20, reason: 'x', target: 's-cut' });
    expect(ok).toBe(true);
    const st = (id: string) => useErpStore.getState().orders[0].items[0].stages.find((s) => s.id === id);
    expect(st('s-cut')?.status).toBe('in_progress');       // целевой
    expect(st('s-sew')?.status).toBe('waiting');           // промежуточный переоткрыт
    expect(st('s-sew')?.qty_done).toBe(480);
    expect(st('s-sew')?.qty_rework).toBe(20);
    expect(st('s-vto')?.status).toBe('waiting');           // текущий
    // 3 обновления этапов (cut, vto, sew)
    expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(3);
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

/** Два заказа: o1 (этап st1) + нетронутый o2 (этап st2) — для проверки идентичности */
function seedTwo() {
  seed();
  const o2 = {
    id: 'o2',
    title: 'Другой заказ',
    status: 'active',
    materials: [],
    items: [{
      id: 'it2',
      order_id: 'o2',
      product_type: 'Худи',
      qty: 100,
      production_type: 'sewing',
      branding_methods: [],
      branding_on: 'cut',
      sort_order: 10,
      prints: [],
      stages: [{
        id: 'st2', item_id: 'it2', department_id: 'd1', depends_on: [],
        status: 'waiting', qty_done: 0, qty_rework: 0, sort_order: 10,
        planned_start: null, planned_end: null, started_at: null,
        finished_at: null, assignee: null, block_reason: null, notes: null,
      }],
    }],
  };
  useErpStore.setState((s) => ({ orders: [...s.orders, o2] as any }));
}

const stageUpdateEvent = (patch: Record<string, unknown> = {}) => ({
  table: 'erp_item_stages',
  eventType: 'UPDATE' as const,
  new: { id: 'st1', item_id: 'it1', status: 'done', qty_done: 500, ...patch },
  old: null,
});

describe('shipOrder — отгрузка готового заказа в архив', () => {
  /** Готовый к отгрузке заказ: единственный этап done; срок — override */
  function seedReady(dueDate?: string) {
    seed({ status: 'done' });
    if (dueDate !== undefined) {
      useErpStore.setState((s) => ({
        orders: s.orders.map((o) => (o.id === 'o1' ? { ...o, due_date: dueDate } : o)),
      }));
    }
  }
  const getOrder = () => useErpStore.getState().orders[0];

  it('optimistic: status/shipped-поля сразу в сторе, toast об успехе', async () => {
    seedReady();
    const ok = await useErpStore.getState().shipOrder('o1');
    expect(ok).toBe(true);
    const o = getOrder();
    expect(o.status).toBe('done_on_time'); // срока нет → «вовремя»
    expect(o.shipped_status).toBe('shipped');
    expect(o.shipped_at).toBeTruthy();
    expect(o.shipped_by).toBe('u1');
    const call = h.updateCalls.find((c) => c.table === 'erp_orders');
    expect(call?.patch).toMatchObject({
      status: 'done_on_time',
      shipped_status: 'shipped',
      shipped_by: 'u1',
    });
    expect(toast.success).toHaveBeenCalledWith('Заказ отгружен и перемещён в архив');
  });

  it('архивный статус по сроку: просрочен → done_late, раньше срока → done_early', async () => {
    seedReady('2000-01-01');
    await useErpStore.getState().shipOrder('o1');
    expect(getOrder().status).toBe('done_late');

    seedReady('2999-01-01');
    await useErpStore.getState().shipOrder('o1');
    expect(getOrder().status).toBe('done_early');
  });

  it('dev-режим: user.id="dev" — не uuid, shipped_by = null', async () => {
    seedReady();
    vi.mocked(useAuthStore.getState).mockReturnValueOnce(
      { user: { id: 'dev', name: 'Dev' } } as never,
    );
    await useErpStore.getState().shipOrder('o1');
    const call = h.updateCalls.find((c) => c.table === 'erp_orders');
    expect(call?.patch.shipped_by).toBeNull();
  });

  it('rollback при ошибке Supabase + toast.error', async () => {
    seedReady();
    h.updateError = { message: 'boom' };
    const ok = await useErpStore.getState().shipOrder('o1');
    expect(ok).toBe(false);
    const o = getOrder();
    expect(o.status).toBe('active');
    expect(o.shipped_at).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('Не удалось отгрузить заказ');
  });

  it('не готовый заказ (этап in_progress) → false, запрос не уходит', async () => {
    seed(); // этап in_progress
    const ok = await useErpStore.getState().shipOrder('o1');
    expect(ok).toBe(false);
    expect(getOrder().status).toBe('active');
    expect(h.updateCalls).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('Заказ ещё не готов к отгрузке');
  });

  it('неизвестный заказ → false', async () => {
    seedReady();
    expect(await useErpStore.getState().shipOrder('nope')).toBe(false);
  });

  it('ставит и снимает pending-ключ order:<id> вокруг await (п.29)', async () => {
    seedReady();
    const p = useErpStore.getState().shipOrder('o1');
    expect(_pendingMutations.has('order:o1')).toBe(true);
    await p;
    expect(_pendingMutations.has('order:o1')).toBe(false);
  });
});

describe('applyRealtimeEvent — точечное применение (п.27)', () => {
  it('UPDATE этапа заменяет этап, не пересоздавая нетронутые заказы', () => {
    seedTwo();
    const [o1Before, o2Before] = useErpStore.getState().orders;
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent());
    const [o1After, o2After] = useErpStore.getState().orders;
    expect(o1After.items[0].stages[0].status).toBe('done');
    expect(o1After.items[0].stages[0].qty_done).toBe(500);
    expect(o1After).not.toBe(o1Before); // затронутый заказ — новый объект
    expect(o2After).toBe(o2Before);     // нетронутый — та же ссылка
  });

  it('UPDATE заказа мержит поля, не затирая вложенные items/materials', () => {
    seedTwo();
    const itemsBefore = useErpStore.getState().orders[0].items;
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_orders',
      eventType: 'UPDATE',
      new: { id: 'o1', title: 'Заказ', manager: 'Новый менеджер', status: 'active' },
      old: null,
    });
    const o1 = useErpStore.getState().orders[0];
    expect(o1.manager).toBe('Новый менеджер');
    expect(o1.items).toBe(itemsBefore); // вложенные не тронуты
  });

  it('DELETE заказа убирает его из списка', () => {
    seedTwo();
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_orders', eventType: 'DELETE', new: null, old: { id: 'o1' },
    });
    expect(useErpStore.getState().orders.map((o) => o.id)).toEqual(['o2']);
  });

  it('UPDATE неизвестного этапа (архив не загружен) игнорируется без падений', () => {
    seed();
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent({ id: 'unknown-stage' }));
    expect(useErpStore.getState().orders[0].items[0].stages[0].status).toBe('in_progress');
  });

  it('INSERT нового активного заказа → загрузка одного по id (loadOne)', async () => {
    seed();
    h.singleData = { id: 'o-new', title: 'Новый', status: 'active', items: [], materials: [] };
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_orders', eventType: 'INSERT',
      new: { id: 'o-new', title: 'Новый', status: 'active' }, old: null,
    });
    await vi.waitFor(() => {
      expect(useErpStore.getState().orders.some((o) => o.id === 'o-new')).toBe(true);
    });
    // загрузили ровно один заказ точечным select по id
    const call = h.selectCalls.find((c) => c.table === 'erp_orders');
    expect(call?.filters).toContain('eq:id=o-new');
  });
});

describe('applyRealtimeEvent — защита от race (pendingMutations, п.29)', () => {
  it('событие по этапу с pending-мутацией не применяется сразу, а после снятия ключа — применяется (~1с буфер)', async () => {
    vi.useFakeTimers();
    seed();
    _pendingMutations.add('stage:st1');
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent());
    expect(getStage().status).toBe('in_progress'); // проигнорировано

    _pendingMutations.delete('stage:st1'); // мутация завершилась
    await vi.advanceTimersByTimeAsync(1000);
    expect(getStage().status).toBe('done'); // отложенное событие применилось
  });

  it('если мутация всё ещё pending спустя буфер — событие отбрасывается', async () => {
    vi.useFakeTimers();
    seed();
    _pendingMutations.add('stage:st1');
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent());
    await vi.advanceTimersByTimeAsync(1000);
    expect(getStage().status).toBe('in_progress'); // событие пропало

    _pendingMutations.delete('stage:st1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(getStage().status).toBe('in_progress'); // и не «воскресает»
  });

  it('мутация ставит и снимает pending-ключ вокруг await', async () => {
    seed();
    const p = useErpStore.getState().setStageStatus('st1', 'in_progress');
    expect(_pendingMutations.has('stage:st1')).toBe(true);
    await p;
    expect(_pendingMutations.has('stage:st1')).toBe(false);
  });
});

describe('ленивый архив (п.26)', () => {
  const dept = { id: 'd1', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 10 };
  const activeRow = { id: 'o-a', title: 'Активный', status: 'active', items: [], materials: [] };
  const archivedRow = { id: 'o-z', title: 'Сданный', status: 'done_on_time', items: [], materials: [] };

  it('loadAll грузит только активные, archiveLoaded остаётся false', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    const s = useErpStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.archiveLoaded).toBe(false);
    expect(s.orders.map((o) => o.id)).toEqual(['o-a']);
    const call = h.selectCalls.find((c) => c.table === 'erp_orders');
    expect(call?.filters).toContain('eq:status=active');
  });

  it('loadArchive дозагружает неактивные и ставит archiveLoaded', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    h.tableData = { erp_orders: [archivedRow] };
    await useErpStore.getState().loadArchive();
    const s = useErpStore.getState();
    expect(s.archiveLoaded).toBe(true);
    expect(s.orders.map((o) => o.id)).toEqual(['o-a', 'o-z']);
    const archCall = h.selectCalls.at(-1);
    expect(archCall?.filters).toContain('neq:status=active');
  });

  it('после загрузки архива loadAll перезагружает всё (без фильтра active)', async () => {
    useErpStore.setState({ archiveLoaded: true });
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow, archivedRow] };
    await useErpStore.getState().loadAll();
    const call = h.selectCalls.find((c) => c.table === 'erp_orders');
    expect(call?.filters).not.toContain('eq:status=active');
    expect(useErpStore.getState().orders).toHaveLength(2);
  });

  it('повторный loadArchive — no-op (archiveLoaded уже true)', async () => {
    useErpStore.setState({ archiveLoaded: true });
    await useErpStore.getState().loadArchive();
    expect(h.selectCalls).toHaveLength(0);
  });
});

describe('createOrder через RPC erp_create_order (п.28)', () => {
  const DEPS = [
    { id: 'dep-supply', code: 'supply', name: 'Закупка', active: true },
    { id: 'dep-cutting', code: 'cutting', name: 'Закрой', active: true },
    { id: 'dep-dtf', code: 'dtf', name: 'ДТФ', active: true },
    { id: 'dep-sewing', code: 'sewing', name: 'Швейка', active: true },
    { id: 'dep-vto', code: 'vto', name: 'ВТО', active: true },
  ];

  it('передаёт маршрут buildRoute индексами depends_on и грузит созданный заказ', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    useErpStore.setState({ departments: DEPS as any });
    h.rpcResult = { data: 'o-created', error: null };
    h.singleData = { id: 'o-created', title: 'BOX39', status: 'active', items: [], materials: [] };

    const created = await useErpStore.getState().createOrder({
      title: 'BOX39',
      items: [{
        product_type: 'футболка',
        qty: 500,
        production_type: 'sewing',
        branding_methods: ['dtf'],
        branding_on: 'cut',
        prints: [{ method: 'dtf', zone: 'спина' }],
      }],
    });

    expect(created?.id).toBe('o-created');
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0].fn).toBe('erp_create_order');
    const payload = h.rpcCalls[0].args.payload as any;
    expect(payload.order.status).toBe('active');
    expect(payload.order.title).toBe('BOX39');
    // Маршрут пошива + ДТФ на крое: закуп → закрой → дтф → швейка → вто
    const stages = payload.items[0].stages;
    expect(stages.map((s: any) => s.department_id)).toEqual(
      ['dep-supply', 'dep-cutting', 'dep-dtf', 'dep-sewing', 'dep-vto']);
    expect(stages.map((s: any) => s.depends_on)).toEqual([[], [0], [1], [2], [3]]);
    expect(payload.items[0].prints).toEqual([expect.objectContaining({ seq: 1, method: 'dtf', zone: 'спина' })]);
    // созданный заказ попал в стор через loadOne
    expect(useErpStore.getState().orders[0].id).toBe('o-created');
  });

  it('ошибка RPC → toast.error и null', async () => {
    useErpStore.setState({ departments: DEPS as any });
    h.rpcResult = { data: null, error: { message: 'boom' } };
    const created = await useErpStore.getState().createOrder({
      title: 'X',
      items: [{ product_type: 'футболка', qty: 1, production_type: 'sewing', branding_methods: [], branding_on: 'cut' }],
    });
    expect(created).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Не удалось создать заказ');
  });
});

describe('logStageEvent — ретрай аудита (п.33)', () => {
  it('первая попытка неудачна → повтор через ~1.5с, без toast при успехе', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed();
    h.insertErrors.push({ message: 'network down' }, null); // fail → ok
    await useErpStore.getState().setStageStatus('st1', 'done', { qty_done: 500 });

    await vi.advanceTimersByTimeAsync(1600);
    const auditInserts = h.insertCalls.filter((c) => c.table === 'erp_stage_events');
    expect(auditInserts).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalledWith('Событие истории не записалось');
  });

  it('обе попытки неудачны → toast.error + console.warn', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed();
    h.insertErrors.push({ message: 'down' }, { message: 'still down' });
    await useErpStore.getState().setStageStatus('st1', 'done', { qty_done: 500 });

    await vi.advanceTimersByTimeAsync(1600);
    expect(h.insertCalls.filter((c) => c.table === 'erp_stage_events')).toHaveLength(2);
    expect(toast.error).toHaveBeenCalledWith('Событие истории не записалось');
    expect(warn).toHaveBeenCalled();
  });

  it('этап не блокируется: setStageStatus успешен независимо от аудита', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed();
    h.insertErrors.push({ message: 'down' }, { message: 'down' });
    const ok = await useErpStore.getState().setStageStatus('st1', 'done', { qty_done: 500 });
    expect(ok).toBe(true);
    expect(getStage().status).toBe('done');
    await vi.advanceTimersByTimeAsync(1600);
  });
});

describe('useErpStore — экспериментальный цех (правка 6)', () => {
  it('createExperimental создаёт разработку в фазе patterns', async () => {
    useErpStore.setState({ experimental: [], experimentalLoaded: true } as any);
    const row = await useErpStore.getState().createExperimental('o1');
    expect(row).toBeTruthy();
    expect(useErpStore.getState().experimental[0].phase).toBe('patterns');
  });

  it('createExperimentalOp добавляет передачу', async () => {
    useErpStore.setState({
      experimental: [{ id: 'e1', order_id: 'o1', phase: 'development', ops: [] }],
      experimentalLoaded: true,
    } as any);
    const row = await useErpStore.getState().createExperimentalOp('e1', {
      kind: 'to_branding', branding_method: 'DTF',
    });
    expect(row).toBeTruthy();
    expect(useErpStore.getState().experimental[0].ops).toHaveLength(1);
  });

  it('completeExperimentalOp возвращает передачу и авто-возвращает на «Проработку»', async () => {
    useErpStore.setState({
      experimental: [{
        id: 'e1', order_id: 'o1', phase: 'final_fitting',
        ops: [{ id: 'op1', experimental_id: 'e1', kind: 'to_sewing', status: 'sent' }],
      }],
      experimentalLoaded: true,
    } as any);
    const ok = await useErpStore.getState().completeExperimentalOp('op1');
    expect(ok).toBe(true);
    const e = useErpStore.getState().experimental[0];
    expect(e.phase).toBe('development'); // авто-возврат
    expect(e.ops[0].status).toBe('returned');
    expect(e.ops[0].returned_at).toBeTruthy();
  });
});
