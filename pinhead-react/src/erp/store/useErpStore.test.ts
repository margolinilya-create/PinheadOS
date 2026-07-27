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
  deleteCalls: [] as { table: string }[],
  deleteError: null as { message: string } | null,
  selectCalls: [] as { table: string; filters: string[] }[],
  tableData: {} as Record<string, unknown[]>,
  selectError: null as { message: string } | null,
  singleData: null as unknown,
  rpcCalls: [] as { fn: string; args: { payload?: unknown } }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  /** Загрузки в Storage (ТЗ в PDF, волна 4) */
  uploadCalls: [] as { bucket: string; path: string; name: string }[],
  uploadError: null as { message: string } | null,
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
        // Цепочки .eq().neq() (снятие is_current у прошлых версий ТЗ) — звено возвращает себя
        update: vi.fn((patch: Record<string, unknown>) => {
          let recorded = false;
          const q: any = {
            eq: () => {
              if (!recorded) { recorded = true; h.updateCalls.push({ table, patch }); }
              return q;
            },
            neq: () => q,
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve({ error: h.updateError }).then(resolve, reject),
          };
          return q;
        }),
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
        // upsert (onConflict/ignoreDuplicates) — идемпотентные вставки задач склада/этапов
        upsert: vi.fn((row: any) => {
          h.insertCalls.push({ table, row });
          const result = {
            data: Array.isArray(row) ? row : [row],
            error: h.insertErrors.shift() ?? null,
          };
          const p: any = Promise.resolve({ error: result.error });
          p.select = () => Promise.resolve(result);
          return p;
        }),
        delete: vi.fn(() => {
          let recorded = false;
          const q: any = {
            eq: () => {
              if (!recorded) { recorded = true; h.deleteCalls.push({ table }); }
              return q;
            },
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve({ error: h.deleteError }).then(resolve, reject),
          };
          return q;
        }),
      })),
      rpc: vi.fn((fn: string, args: { payload?: unknown }) => {
        h.rpcCalls.push({ fn, args });
        return Promise.resolve(h.rpcResult);
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn((path: string, file: { name?: string }) => {
            h.uploadCalls.push({ bucket, path, name: file?.name ?? '' });
            return Promise.resolve({ error: h.uploadError });
          }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        })),
      },
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

const {
  useErpStore, readyCountFor, _pendingMutations,
  openWarehouseTaskCount, openProcurementCount, openSubcontractCount,
  activeExperimentalCount, activeOrdersCount,
} = await import('./useErpStore');
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
  h.deleteCalls.length = 0;
  h.deleteError = null;
  h.selectCalls.length = 0;
  h.tableData = {};
  h.selectError = null;
  h.singleData = null;
  h.rpcCalls.length = 0;
  h.rpcResult = { data: null, error: null };
  h.uploadCalls.length = 0;
  h.uploadError = null;
  _pendingMutations.clear();
  localStorage.removeItem('erp_my_dept');
  useErpStore.setState({
    orders: [], departments: [], loaded: false,
    archiveLoaded: false, archiveLoading: false,
    myDeptId: null, myDeptLoaded: false,
    dictionaries: [], dictionariesLoaded: false,
    permissionMatrix: null, permissionsLoaded: false,
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

  it('acceptMaterial: закрывает задачу приёмки, когда все материалы приняты', async () => {
    seedSupply([mat({ status: 'pending', accept_status: null })]);
    useErpStore.setState({
      orders: [{
        ...useErpStore.getState().orders[0],
        warehouse_tasks: [{ id: 'wt1', order_id: 'o1', item_id: null, task_type: 'material_receipt', status: 'awaiting' }],
      }] as any,
    });
    await useErpStore.getState().acceptMaterial('m1', {
      qty_received: 100, accept_status: 'accepted_full',
    });
    const task = useErpStore.getState().orders[0].warehouse_tasks?.[0];
    expect(task?.status).toBe('accepted');
  });
});

describe('useErpStore — задачи склада (волна 4): advanceWarehouseTask', () => {
  function seedTask(task: any, orderOver: any = {}) {
    const item = {
      id: 'it1', order_id: 'o1', product_type: 'Ф', variant: null, qty: 100,
      production_type: 'sewing', branding_methods: [], branding_on: 'cut',
      notes: null, sort_order: 10, stages: [], prints: [],
    };
    const order = {
      id: 'o1', title: 'Заказ', status: 'active', due_date: null,
      shipped_status: 'not_shipped', items: [item], materials: [],
      warehouse_ops: [], warehouse_tasks: [task], ...orderOver,
    };
    useErpStore.setState({ orders: [order] as any, departments: [] as any, loaded: true });
  }
  const task0 = () => useErpStore.getState().orders[0].warehouse_tasks?.[0];

  it('marking new→in_progress: optimistic + update Supabase', async () => {
    seedTask({ id: 'wt1', order_id: 'o1', item_id: null, task_type: 'marking', status: 'new' });
    const ok = await useErpStore.getState().advanceWarehouseTask('wt1', 'in_progress', { marking_type: 'ЧЗ' });
    expect(ok).toBe(true);
    expect(task0()?.status).toBe('in_progress');
    expect(task0()?.marking_type).toBe('ЧЗ');
    expect(h.updateCalls.some((c) => c.table === 'erp_warehouse_tasks')).toBe(true);
  });

  it('marking →issued: пишет строку истории marking', async () => {
    seedTask({ id: 'wt1', order_id: 'o1', item_id: null, task_type: 'marking', status: 'in_progress' });
    await useErpStore.getState().advanceWarehouseTask('wt1', 'issued');
    const ops = useErpStore.getState().orders[0].warehouse_ops ?? [];
    expect(ops.some((o) => o.op_type === 'marking')).toBe(true);
  });

  it('rollback при ошибке Supabase', async () => {
    seedTask({ id: 'wt1', order_id: 'o1', item_id: null, task_type: 'pack_ship', status: 'accepted' });
    h.updateError = { message: 'boom' };
    const ok = await useErpStore.getState().advanceWarehouseTask('wt1', 'packing');
    expect(ok).toBe(false);
    expect(task0()?.status).toBe('accepted');
    expect(toast.error).toHaveBeenCalledWith('Не удалось обновить задачу склада');
  });

  it('pack_ship ready_to_ship→shipped: отгружает заказ (все этапы done) → done_* + shipment', async () => {
    const doneStage = {
      id: 'st1', item_id: 'it1', department_id: 'd1', depends_on: [], status: 'done',
      qty_done: 100, qty_rework: 0, sort_order: 10, planned_start: null, planned_end: null,
      started_at: null, finished_at: '2026-01-01', assignee: null, block_reason: null, notes: null,
    };
    seedTask(
      { id: 'wt1', order_id: 'o1', item_id: null, task_type: 'pack_ship', status: 'ready_to_ship' },
      { items: [{
        id: 'it1', order_id: 'o1', product_type: 'Ф', variant: null, qty: 100,
        production_type: 'sewing', branding_methods: [], branding_on: 'cut',
        notes: null, sort_order: 10, stages: [doneStage], prints: [],
      }], materials: [] },
    );
    const ok = await useErpStore.getState().advanceWarehouseTask('wt1', 'shipped');
    expect(ok).toBe(true);
    expect(task0()?.status).toBe('shipped');
    expect(useErpStore.getState().orders[0].status).toMatch(/^done_/);
    const ops = useErpStore.getState().orders[0].warehouse_ops ?? [];
    expect(ops.some((o) => o.op_type === 'shipment')).toBe(true);
  });

  it('pack_ship →shipped при неготовом заказе: shipOrder блокирует, задача не меняется', async () => {
    const openStage = {
      id: 'st1', item_id: 'it1', department_id: 'd1', depends_on: [], status: 'in_progress',
      qty_done: 0, qty_rework: 0, sort_order: 10, planned_start: null, planned_end: null,
      started_at: null, finished_at: null, assignee: null, block_reason: null, notes: null,
    };
    seedTask(
      { id: 'wt1', order_id: 'o1', item_id: null, task_type: 'pack_ship', status: 'ready_to_ship' },
      { items: [{
        id: 'it1', order_id: 'o1', product_type: 'Ф', variant: null, qty: 100,
        production_type: 'sewing', branding_methods: [], branding_on: 'cut',
        notes: null, sort_order: 10, stages: [openStage], prints: [],
      }], materials: [] },
    );
    const ok = await useErpStore.getState().advanceWarehouseTask('wt1', 'shipped');
    expect(ok).toBe(false);
    expect(task0()?.status).toBe('ready_to_ship');
    expect(useErpStore.getState().orders[0].status).toBe('active');
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

  it('warehouse_tasks событие — точечный upsert, БЕЗ loadOne (этапы не тронуты)', () => {
    seed({ status: 'in_progress' });
    useErpStore.setState((s) => ({ orders: s.orders.map((o) => ({ ...o, warehouse_tasks: [] })) }));
    const ordersSelectsBefore = h.selectCalls.filter((c) => c.table === 'erp_orders').length;
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_warehouse_tasks', eventType: 'INSERT',
      new: { id: 'wt1', order_id: 'o1', task_type: 'material_receipt', status: 'awaiting' }, old: null,
    });
    const o = useErpStore.getState().orders[0];
    expect(o.warehouse_tasks).toHaveLength(1);
    expect((o.warehouse_tasks as any)[0].id).toBe('wt1');
    expect(o.items[0].stages[0].status).toBe('in_progress'); // этап НЕ затёрт
    // loadOne (полная перезагрузка заказа) НЕ вызывался
    expect(h.selectCalls.filter((c) => c.table === 'erp_orders').length).toBe(ordersSelectsBefore);
  });

  it('materials событие — точечный upsert материала, этапы не тронуты', () => {
    seed({ status: 'in_progress' });
    useErpStore.setState((s) => ({ orders: s.orders.map((o) => ({ ...o, materials: [] })) }));
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_materials', eventType: 'INSERT',
      new: { id: 'm1', order_id: 'o1', kind: 'fabric', name: 'Ткань', status: 'received' }, old: null,
    });
    const o = useErpStore.getState().orders[0];
    expect(o.materials).toHaveLength(1);
    expect(o.items[0].stages[0].status).toBe('in_progress');
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

  it('подряд (волна 4.2): несёт поля подряда и авто-создаёт операцию подряда', async () => {
    useErpStore.setState({ departments: DEPS as any });
    h.rpcResult = { data: 'o-sub', error: null };
    h.singleData = {
      id: 'o-sub', title: 'Подряд', status: 'active', materials: [],
      items: [{
        id: 'it-sub', order_id: 'o-sub', product_type: 'Худи', qty: 50,
        production_type: 'outsource', branding_methods: [], branding_on: 'cut',
        sort_order: 10, stages: [], prints: [],
        subcontract_kind: 'finished_product', material_source: 'pinhead',
      }],
    };
    const created = await useErpStore.getState().createOrder({
      title: 'Подряд',
      items: [{
        product_type: 'Худи', qty: 50, production_type: 'outsource',
        branding_methods: [], branding_on: 'cut',
        subcontract_kind: 'finished_product', material_source: 'pinhead',
      }],
    });
    expect(created?.id).toBe('o-sub');
    const payloadItem = (h.rpcCalls[0].args.payload as any).items[0];
    expect(payloadItem.subcontract_kind).toBe('finished_product');
    expect(payloadItem.material_source).toBe('pinhead');
    // авто-создана операция подряда «готовое изделие» в статусе awaiting_payment
    const subInsert = h.insertCalls.find((c) => c.table === 'erp_subcontracting');
    expect(subInsert).toBeTruthy();
    expect((subInsert!.row as any).op_type).toBe('finished_product');
    expect((subInsert!.row as any).status).toBe('awaiting_payment');
    expect((subInsert!.row as any).order_id).toBe('o-sub');
  });

  it('подряд-операция (S2-1): передаёт return_dept из формы в авто-операцию', async () => {
    useErpStore.setState({ departments: DEPS as any });
    h.rpcResult = { data: 'o-op', error: null };
    h.singleData = {
      id: 'o-op', title: 'Операция', status: 'active', materials: [],
      items: [{
        id: 'it-op', order_id: 'o-op', product_type: 'Свитшот', qty: 30,
        production_type: 'outsource', branding_methods: [], branding_on: 'cut',
        sort_order: 10, stages: [], prints: [],
        subcontract_kind: 'operation', material_source: 'contractor',
      }],
    };
    await useErpStore.getState().createOrder({
      title: 'Операция',
      items: [{
        product_type: 'Свитшот', qty: 30, production_type: 'outsource',
        branding_methods: [], branding_on: 'cut',
        subcontract_kind: 'operation', material_source: 'contractor', return_dept: 'sewing',
      }],
    });
    const subInsert = h.insertCalls.find((c) => c.table === 'erp_subcontracting');
    expect((subInsert!.row as any).op_type).toBe('operation');
    expect((subInsert!.row as any).status).toBe('planned');
    expect((subInsert!.row as any).return_dept).toBe('sewing');
  });

  it('образец (волна 4.3): авто-создаёт эксперим. разработку в фазе patterns', async () => {
    useErpStore.setState({ departments: DEPS as any });
    h.rpcResult = { data: 'o-exp', error: null };
    h.singleData = {
      id: 'o-exp', title: 'Образец', status: 'active', materials: [],
      items: [{
        id: 'it-exp', order_id: 'o-exp', product_type: 'Худи', qty: 2,
        production_type: 'samples', branding_methods: [], branding_on: 'cut',
        sort_order: 10, stages: [], prints: [],
      }],
    };
    await useErpStore.getState().createOrder({
      title: 'Образец',
      items: [{ product_type: 'Худи', qty: 2, production_type: 'samples', branding_methods: [], branding_on: 'cut' }],
    });
    const expInsert = h.insertCalls.find((c) => c.table === 'erp_experimental');
    expect(expInsert).toBeTruthy();
    expect((expInsert!.row as any).order_id).toBe('o-exp');
    expect((expInsert!.row as any).phase).toBe('patterns');
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

describe('useErpStore — правки ПМ 4.1.3 / 4.2.1 / 4.2.2 / 4.2.3', () => {
  const depts = [
    { id: 'd-sup', code: 'supply', name: 'Закупка', active: true },
    { id: 'd-cut', code: 'cutting', name: 'Закрой', active: true },
    { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true },
  ];

  // 4.2.2 — материал подрядчика → без этапа «Закупка»
  it('createOrder: материал подрядчика → этап «Закупка» НЕ создаётся', async () => {
    useErpStore.setState({ departments: depts as any, orders: [], loaded: true });
    h.rpcResult = { data: 'o-new', error: null };
    h.singleData = null;
    await useErpStore.getState().createOrder({
      title: 'Подряд', items: [{
        product_type: 'Худи', qty: 10, production_type: 'outsource',
        branding_methods: [], branding_on: 'cut',
        subcontract_kind: 'finished_product', material_source: 'contractor',
      }],
    } as any);
    const payload: any = h.rpcCalls[0].args.payload;
    expect(payload.items[0].stages).toHaveLength(0);
  });

  it('createOrder: материал Pinhead → этап «Закупка» создаётся', async () => {
    useErpStore.setState({ departments: depts as any, orders: [], loaded: true });
    h.rpcResult = { data: 'o-new', error: null };
    h.singleData = null;
    await useErpStore.getState().createOrder({
      title: 'Подряд', items: [{
        product_type: 'Худи', qty: 10, production_type: 'outsource',
        branding_methods: [], branding_on: 'cut',
        subcontract_kind: 'finished_product', material_source: 'pinhead',
      }],
    } as any);
    const payload: any = h.rpcCalls[0].args.payload;
    expect(payload.items[0].stages).toHaveLength(1);
    expect(payload.items[0].stages[0].department_id).toBe('d-sup');
  });

  // 4.2.1 — приёмка готового изделия от подрядчика
  it('updateSubcontractOp: готовое изделие «Отгружено» → задача склада subcontract_receipt', async () => {
    useErpStore.setState({
      orders: [{ id: 'o1', title: 'З', status: 'active', items: [], materials: [] }] as any,
      subcontracting: [{
        id: 's1', order_id: 'o1', operation: 'Худи', op_type: 'finished_product',
        status: 'ready_to_ship', material_source: 'contractor', return_dept: null,
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = { id: 'o1', title: 'З', status: 'active', items: [], materials: [] };
    await useErpStore.getState().updateSubcontractOp('s1', { status: 'shipped_by_contractor' });
    const wt = h.insertCalls.find((c) => c.table === 'erp_warehouse_tasks');
    expect((wt?.row as any)?.task_type).toBe('subcontract_receipt');
    expect((wt?.row as any)?.status).toBe('awaiting_receipt');
  });

  it('advanceWarehouseTask: приёмка от подрядчика принята → op received_at_pinhead + pack_ship', async () => {
    const task = {
      id: 'wt1', order_id: 'o1', item_id: null, task_type: 'subcontract_receipt', status: 'awaiting_receipt',
    };
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active', items: [], materials: [],
        warehouse_ops: [], warehouse_tasks: [task],
      }] as any,
      subcontracting: [], subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.tableData = {
      erp_subcontracting: [{
        id: 's1', order_id: 'o1', operation: 'Худи', op_type: 'finished_product',
        status: 'shipped_by_contractor', material_source: 'contractor', return_dept: null,
      }],
    };
    h.singleData = { id: 'o1', title: 'З', status: 'active', items: [], materials: [] };
    await useErpStore.getState().advanceWarehouseTask('wt1', 'accepted');
    const scUpd = h.updateCalls.find((c) => c.table === 'erp_subcontracting');
    expect(scUpd?.patch.status).toBe('received_at_pinhead');
    const packShip = h.insertCalls.find(
      (c) => c.table === 'erp_warehouse_tasks' && (c.row as any).task_type === 'pack_ship');
    expect(packShip).toBeTruthy();
  });

  // 4.2.3 — маршрут после отдельной операции
  it('updateSubcontractOp: операция «Возвращено» с участком → готовый этап цеха', async () => {
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active',
        items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
      }] as any,
      subcontracting: [{
        id: 's1', order_id: 'o1', item_id: 'it1', operation: 'Печать', op_type: 'operation',
        status: 'in_progress', material_source: 'pinhead', return_dept: 'sewing',
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = {
      id: 'o1', title: 'З', status: 'active',
      items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
    };
    await useErpStore.getState().updateSubcontractOp('s1', { status: 'returned' });
    const stage = h.insertCalls.find((c) => c.table === 'erp_item_stages');
    expect((stage?.row as any)?.department_id).toBe('d-sew');
    expect((stage?.row as any)?.status).toBe('ready');
  });

  it('updateSubcontractOp: операция «Возвращено» без участка → задача упаковки/отгрузки', async () => {
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active',
        items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
      }] as any,
      subcontracting: [{
        id: 's1', order_id: 'o1', item_id: 'it1', operation: 'Стирка', op_type: 'operation',
        status: 'in_progress', material_source: 'pinhead', return_dept: null,
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = {
      id: 'o1', title: 'З', status: 'active',
      items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
    };
    await useErpStore.getState().updateSubcontractOp('s1', { status: 'returned' });
    const packShip = h.insertCalls.find(
      (c) => c.table === 'erp_warehouse_tasks' && (c.row as any).task_type === 'pack_ship');
    expect(packShip).toBeTruthy();
  });

  // 4.1.3 — факт приёмки + гейт планового кол-ва
  it('acceptMaterial: пишет фактические атрибуты (материал/цвет/артикул)', async () => {
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active', items: [], warehouse_ops: [],
        materials: [{ id: 'm1', order_id: 'o1', kind: 'fabric', name: 'Футер', status: 'in_transit' }],
      }] as any,
      departments: depts as any, loaded: true,
    });
    await useErpStore.getState().acceptMaterial('m1', {
      qty_received: 126, accept_status: 'mismatch',
      fact_name: 'Футер 3Н', fact_color: 'Чёрный', fact_article: 'FT-320-02',
    });
    const upd = h.updateCalls.find((c) => c.table === 'erp_materials');
    expect(upd?.patch.fact_name).toBe('Футер 3Н');
    expect(upd?.patch.fact_color).toBe('Чёрный');
    expect(upd?.patch.fact_article).toBe('FT-320-02');
  });

  it('maybeCloseSupply: без планового кол-ва закупку НЕ закрывает', async () => {
    const stage = {
      id: 'st-sup', item_id: 'it1', department_id: 'd-sup', depends_on: [],
      status: 'in_progress', qty_done: 0, qty_rework: 0, sort_order: 10,
    };
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active',
        items: [{ id: 'it1', order_id: 'o1', stages: [stage] }],
        materials: [{
          id: 'm1', order_id: 'o1', kind: 'fabric', name: 'Футер',
          source: 'purchase', status: 'received', qty_expected: null,
        }],
      }] as any,
      departments: depts as any, loaded: true,
    });
    await useErpStore.getState().maybeCloseSupply('o1');
    const stageDone = h.updateCalls.find(
      (c) => c.table === 'erp_item_stages' && c.patch.status === 'done');
    expect(stageDone).toBeFalsy();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('maybeCloseSupply: с плановым кол-вом закупку закрывает', async () => {
    const stage = {
      id: 'st-sup', item_id: 'it1', department_id: 'd-sup', depends_on: [],
      status: 'in_progress', qty_done: 0, qty_rework: 0, sort_order: 10,
    };
    useErpStore.setState({
      orders: [{
        id: 'o1', title: 'З', status: 'active',
        items: [{ id: 'it1', order_id: 'o1', stages: [stage] }],
        materials: [{
          id: 'm1', order_id: 'o1', kind: 'fabric', name: 'Футер',
          source: 'purchase', status: 'received', qty_expected: 128,
        }],
      }] as any,
      departments: depts as any, loaded: true,
    });
    await useErpStore.getState().maybeCloseSupply('o1');
    const stageDone = h.updateCalls.find(
      (c) => c.table === 'erp_item_stages' && c.patch.status === 'done');
    expect(stageDone).toBeTruthy();
  });
});

describe('orderHelpers — счётчики разделов (сайдбар редизайна)', () => {
  const active = (extra: any) => ({ id: 'o', status: 'active', items: [], materials: [], ...extra });

  it('activeOrdersCount: только активные', () => {
    expect(activeOrdersCount(
      [{ status: 'active' }, { status: 'done_on_time' }, { status: 'active' }] as any,
    )).toBe(2);
  });

  it('openWarehouseTaskCount: открытые задачи склада (не терминальные), только активные заказы', () => {
    const orders = [active({ warehouse_tasks: [
      { task_type: 'material_receipt', status: 'awaiting' },
      { task_type: 'material_receipt', status: 'accepted' },
      { task_type: 'pack_ship', status: 'packing' },
      { task_type: 'subcontract_receipt', status: 'accepted' },
    ] }), { status: 'done_on_time', warehouse_tasks: [{ task_type: 'pack_ship', status: 'packing' }] }];
    expect(openWarehouseTaskCount(orders as any)).toBe(2);
  });

  it('openProcurementCount: задачи закупки не в done/cancelled', () => {
    const orders = [active({ procurement_tasks: [
      { status: 'new' }, { status: 'ordered' }, { status: 'done' }, { status: 'cancelled' },
    ] })];
    expect(openProcurementCount(orders as any)).toBe(2);
  });

  it('openSubcontractCount: активные операции (не returned/received/cancelled)', () => {
    expect(openSubcontractCount([
      { status: 'sent' }, { status: 'in_progress' }, { status: 'returned' },
      { status: 'received_at_pinhead' }, { status: 'cancelled' }, { status: 'awaiting_payment' },
    ])).toBe(3);
  });

  it('activeExperimentalCount: разработки с фазой ≠ done', () => {
    expect(activeExperimentalCount([
      { phase: 'patterns' }, { phase: 'development' }, { phase: 'done' },
    ])).toBe(2);
  });
});

// --- Волна 1: приоритет очереди и перенос между цехами -----------------------

/** Заказ с одной позицией и несколькими этапами (по одному на цех) */
function seedRoute(
  stages: Record<string, unknown>[],
  { qty = 100, dueDate = '2026-08-01', orderId = 'o1' } = {},
) {
  const full = stages.map((s, i) => ({
    id: `st${i + 1}`, item_id: 'it1', depends_on: [], status: 'waiting',
    qty_done: 0, qty_rework: 0, planned_start: null, planned_end: null,
    started_at: null, finished_at: null, assignee: null, block_reason: null,
    notes: null, sort_order: (i + 1) * 10, queue_position: null,
    ...s,
  }));
  const item = {
    id: 'it1', order_id: orderId, product_type: 'Худи', variant: null, qty,
    production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, sort_order: 10, stages: full, prints: [],
  };
  const order = {
    id: orderId, title: 'Заказ', status: 'active', due_date: dueDate,
    items: [item], materials: [],
  };
  useErpStore.setState({
    orders: [order] as any,
    departments: [
      { id: 'd-cut', code: 'cutting', name: 'Закройный цех', active: true, sort_order: 50 },
      { id: 'd-emb', code: 'embroidery', name: 'Цех вышивки', active: true, sort_order: 62 },
      { id: 'd-sew', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 70 },
      { id: 'd-vto', code: 'vto', name: 'ВТО цех', active: true, sort_order: 80 },
    ] as any,
    loaded: true,
  });
  return full;
}

const stageById = (id: string) =>
  useErpStore.getState().orders
    .flatMap((o: any) => o.items).flatMap((it: any) => it.stages)
    .find((s: any) => s.id === id);

describe('useErpStore — reorderStageQueue (приоритет в очереди цеха)', () => {
  it('вставка между соседями пишет середину и трогает одну строку', async () => {
    seedRoute([
      { department_id: 'd-sew', queue_position: 100 },
      { department_id: 'd-emb', queue_position: 200 },
      { department_id: 'd-cut', queue_position: 300 },
    ]);
    const ok = await useErpStore.getState().reorderStageQueue('st3', 'st1', 'st2');
    expect(ok).toBe(true);
    expect(stageById('st3').queue_position).toBe(150);
    const writes = h.updateCalls.filter((c) => c.table === 'erp_item_stages');
    expect(writes).toHaveLength(1);
    expect(writes[0].patch).toEqual({ queue_position: 150 });
  });

  it('в начало очереди — на шаг выше первого', async () => {
    seedRoute([
      { department_id: 'd-sew', queue_position: 1000 },
      { department_id: 'd-emb', queue_position: 2000 },
    ]);
    await useErpStore.getState().reorderStageQueue('st2', null, 'st1');
    expect(stageById('st2').queue_position).toBe(1000 - 86400);
  });

  it('слипшиеся соседи — перенумеровывает очередь цеха целиком', async () => {
    const pos = 1_800_000_000;
    seedRoute([
      { department_id: 'd-sew', queue_position: pos },
      { department_id: 'd-sew', queue_position: pos + 2 ** -22 },
      { department_id: 'd-sew', queue_position: pos + 1 },
    ]);
    const ok = await useErpStore.getState().reorderStageQueue('st3', 'st1', 'st2');
    expect(ok).toBe(true);
    expect(stageById('st1').queue_position).toBe(0);
    expect(stageById('st3').queue_position).toBe(86400);
    expect(stageById('st2').queue_position).toBe(86400 * 2);
    expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(3);
  });

  it('ошибка Supabase — откат позиции и toast', async () => {
    seedRoute([
      { department_id: 'd-sew', queue_position: 100 },
      { department_id: 'd-sew', queue_position: 200 },
    ]);
    h.updateError = { message: 'нет связи' };
    const ok = await useErpStore.getState().reorderStageQueue('st2', null, 'st1');
    expect(ok).toBe(false);
    expect(stageById('st2').queue_position).toBe(200);
    expect(toast.error).toHaveBeenCalled();
  });

  it('пишет перемещение в историю этапов', async () => {
    seedRoute([
      { department_id: 'd-sew', queue_position: 100 },
      { department_id: 'd-sew', queue_position: 200 },
    ]);
    await useErpStore.getState().reorderStageQueue('st2', 'st1', null);
    const ev = h.insertCalls.find((c) => c.table === 'erp_stage_events');
    expect((ev?.row as any).comment).toContain('Приоритет в очереди');
    expect((ev?.row as any).actor).toBe('Тест');
  });
});

describe('useErpStore — moveStageToDepartment (перенос между цехами)', () => {
  it('закрывает текущий этап и открывает целевой', async () => {
    seedRoute([
      { department_id: 'd-emb', status: 'in_progress', qty_done: 100 },
      { department_id: 'd-sew' },
    ]);
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-sew');
    expect(ok).toBe(true);
    expect(stageById('st1').status).toBe('done');
    expect(stageById('st1').qty_done).toBe(100);
    expect(stageById('st2').status).toBe('in_progress');
    expect(stageById('st2').started_at).toBeTruthy();
  });

  it('заблокированное задание переносить нельзя — состояние не меняется', async () => {
    seedRoute([
      { department_id: 'd-emb', status: 'blocked', block_reason: 'нет ниток' },
      { department_id: 'd-sew' },
    ]);
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-sew');
    expect(ok).toBe(false);
    expect(stageById('st1').status).toBe('blocked');
    expect(stageById('st2').status).toBe('waiting');
    expect(h.updateCalls).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it('цеха нет в маршруте — добавляет этап с зависимостью от текущего', async () => {
    seedRoute([{ department_id: 'd-cut', status: 'in_progress', qty_done: 100 }]);
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-vto');
    expect(ok).toBe(true);
    const inserted = h.insertCalls.find((c) => c.table === 'erp_item_stages');
    expect((inserted?.row as any).department_id).toBe('d-vto');
    expect((inserted?.row as any).depends_on).toEqual(['st1']);
    expect((inserted?.row as any).status).toBe('in_progress');
    expect(useErpStore.getState().orders[0].items[0].stages).toHaveLength(2);
  });

  it('комментарий возврата уходит в историю обоих этапов', async () => {
    seedRoute([
      { department_id: 'd-cut', status: 'done', qty_done: 100 },
      { department_id: 'd-sew', status: 'in_progress' },
    ]);
    await useErpStore.getState().moveStageToDepartment('st2', 'd-cut', { comment: 'перекроить' });
    const events = h.insertCalls.filter((c) => c.table === 'erp_stage_events');
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect((e.row as any).comment).toContain('Швейка');
      expect((e.row as any).comment).toContain('Закрой');
      expect((e.row as any).comment).toContain('перекроить');
    }
  });

  it('ошибка Supabase на исходном этапе — полный откат', async () => {
    seedRoute([
      { department_id: 'd-emb', status: 'in_progress', qty_done: 50 },
      { department_id: 'd-sew' },
    ]);
    h.updateError = { message: 'нет связи' };
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-sew');
    expect(ok).toBe(false);
    expect(stageById('st1').status).toBe('in_progress');
    expect(stageById('st2').status).toBe('waiting');
    expect(toast.error).toHaveBeenCalled();
  });
});

// --- Волна 2: справочники, права, участки ------------------------------------

const dict = (over: Record<string, unknown> = {}) => ({
  id: 'dic1', kind: 'block_reason', code: 'no_material', name: 'Нет материала',
  sort_order: 10, active: true, meta: {}, created_at: '', updated_at: '', ...over,
});

describe('useErpStore — справочники админки', () => {
  it('loadDictionaries кладёт значения в стор', async () => {
    h.tableData.erp_dictionaries = [dict(), dict({ id: 'dic2', code: 'equipment', name: 'Сломано оборудование', sort_order: 20 })];
    await useErpStore.getState().loadDictionaries();
    expect(useErpStore.getState().dictionaries).toHaveLength(2);
    expect(useErpStore.getState().dictionariesLoaded).toBe(true);
  });

  it('ошибка загрузки не блокирует работу — экраны остаются на свободном вводе', async () => {
    h.selectError = { message: 'нет связи' };
    await useErpStore.getState().loadDictionaries();
    expect(useErpStore.getState().dictionaries).toEqual([]);
    expect(useErpStore.getState().dictionariesLoaded).toBe(true);
  });

  it('создание генерирует латинский код из русского названия', async () => {
    await useErpStore.getState().createDictionaryItem('block_reason' as never, '  Нет ниток  ');
    const call = h.insertCalls.find((c) => c.table === 'erp_dictionaries');
    expect((call?.row as any).code).toBe('net_nitok');
    expect((call?.row as any).name).toBe('Нет ниток');
    expect((call?.row as any).kind).toBe('block_reason');
  });

  it('дубликат по названию не создаётся', async () => {
    useErpStore.setState({ dictionaries: [dict()] as any });
    const created = await useErpStore.getState().createDictionaryItem('block_reason' as never, 'нет материала');
    expect(created).toBeNull();
    expect(h.insertCalls.filter((c) => c.table === 'erp_dictionaries')).toHaveLength(0);
    expect(toast.warning).toHaveBeenCalled();
  });

  it('новое значение встаёт в конец своего вида', async () => {
    useErpStore.setState({ dictionaries: [dict({ sort_order: 40 })] as any });
    await useErpStore.getState().createDictionaryItem('block_reason' as never, 'Нет ниток');
    const call = h.insertCalls.find((c) => c.table === 'erp_dictionaries');
    expect((call?.row as any).sort_order).toBe(50);
  });

  it('отключение вместо удаления — правка через updateDictionaryItem', async () => {
    useErpStore.setState({ dictionaries: [dict()] as any });
    const ok = await useErpStore.getState().updateDictionaryItem('dic1', { active: false });
    expect(ok).toBe(true);
    expect(useErpStore.getState().dictionaries[0].active).toBe(false);
    expect(h.updateCalls.find((c) => c.table === 'erp_dictionaries')?.patch).toEqual({ active: false });
  });

  it('ошибка правки откатывает значение', async () => {
    useErpStore.setState({ dictionaries: [dict()] as any });
    h.updateError = { message: 'нет связи' };
    const ok = await useErpStore.getState().updateDictionaryItem('dic1', { name: 'Другое' });
    expect(ok).toBe(false);
    expect(useErpStore.getState().dictionaries[0].name).toBe('Нет материала');
    expect(toast.error).toHaveBeenCalled();
  });

  it('перестановка меняет порядок только внутри своего вида', async () => {
    useErpStore.setState({
      dictionaries: [
        dict({ id: 'a', sort_order: 10 }),
        dict({ id: 'b', sort_order: 20 }),
        dict({ id: 'x', kind: 'problem_type', code: 'p', sort_order: 5 }),
      ] as any,
    });
    const ok = await useErpStore.getState().moveDictionaryItem('b', 'up');
    expect(ok).toBe(true);
    const byId = Object.fromEntries(useErpStore.getState().dictionaries.map((d) => [d.id, d.sort_order]));
    expect(byId.b).toBe(10);
    expect(byId.a).toBe(20);
    expect(byId.x).toBe(5);
  });

  it('перестановка за границу списка ничего не делает', async () => {
    useErpStore.setState({ dictionaries: [dict({ id: 'a' })] as any });
    expect(await useErpStore.getState().moveDictionaryItem('a', 'up')).toBe(false);
    expect(h.updateCalls).toHaveLength(0);
  });
});

describe('useErpStore — матрица прав', () => {
  it('setRolePermission пишет upsert и обновляет матрицу', async () => {
    useErpStore.setState({ permissionMatrix: { worker: { 'stage.priority': false } } as any });
    const ok = await useErpStore.getState().setRolePermission('worker' as never, 'stage.priority' as never, true);
    expect(ok).toBe(true);
    expect(useErpStore.getState().permissionMatrix?.worker['stage.priority']).toBe(true);
    const call = h.insertCalls.find((c) => c.table === 'erp_role_permissions');
    expect(call?.row).toMatchObject({ role: 'worker', permission: 'stage.priority', allowed: true });
  });

  it('ошибка сохранения возвращает матрицу как была', async () => {
    useErpStore.setState({ permissionMatrix: { worker: { 'stage.priority': false } } as any });
    h.insertErrors.push({ message: 'нет связи' });
    const ok = await useErpStore.getState().setRolePermission('worker' as never, 'stage.priority' as never, true);
    expect(ok).toBe(false);
    expect(useErpStore.getState().permissionMatrix?.worker['stage.priority']).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useErpStore — справочник участков', () => {
  it('создание участка добавляет его в стор по порядку', async () => {
    useErpStore.setState({ departments: [{ id: 'd1', code: 'cutting', name: 'Закрой', sort_order: 50 }] as any });
    const created = await useErpStore.getState().createDepartment({ code: 'heat', name: 'Термоперенос', sort_order: 60 } as any);
    expect(created).toBeTruthy();
    expect(useErpStore.getState().departments.map((d) => d.code)).toEqual(['cutting', 'heat']);
  });

  it('правка участка — optimistic с откатом при ошибке', async () => {
    useErpStore.setState({ departments: [{ id: 'd1', code: 'cutting', name: 'Закрой', sort_order: 50, norm_days: null }] as any });
    expect(await useErpStore.getState().updateDepartment('d1', { norm_days: 3 })).toBe(true);
    expect(useErpStore.getState().departments[0].norm_days).toBe(3);

    h.updateError = { message: 'нет связи' };
    expect(await useErpStore.getState().updateDepartment('d1', { norm_days: 9 })).toBe(false);
    expect(useErpStore.getState().departments[0].norm_days).toBe(3);
  });
});

// --- Волна 3: варианты поставщиков (правка 10) -------------------------------

function seedMaterial(suppliers: Record<string, unknown>[] = [], supplier: string | null = null) {
  useErpStore.setState({
    orders: [{
      id: 'o1', title: 'Заказ', status: 'active', items: [],
      materials: [{
        id: 'm1', order_id: 'o1', kind: 'fabric', name: 'Кулирка',
        source: 'purchase', status: 'pending', supplier, qty_expected: 10,
        suppliers,
      }],
    }] as any,
    departments: [{ id: 'd-sup', code: 'supply', name: 'Закупка', active: true }] as any,
    loaded: true,
  });
}

const materialNow = () => useErpStore.getState().orders[0].materials[0] as any;

describe('useErpStore — варианты поставщиков', () => {
  it('добавление кладёт вариант в материал', async () => {
    seedMaterial();
    const created = await useErpStore.getState().addSupplierOption('m1', {
      supplier: 'Астра Текстиль', price: 420, lead_days: 5,
    } as never);
    expect(created).toBeTruthy();
    expect(materialNow().suppliers).toHaveLength(1);
    const call = h.insertCalls.find((c) => c.table === 'erp_material_suppliers');
    expect((call?.row as any).material_id).toBe('m1');
    expect((call?.row as any).supplier).toBe('Астра Текстиль');
  });

  it('пустое имя поставщика не создаёт вариант', async () => {
    seedMaterial();
    expect(await useErpStore.getState().addSupplierOption('m1', { supplier: '   ' } as never)).toBeNull();
    expect(h.insertCalls).toHaveLength(0);
  });

  it('выбор варианта снимает флаг с прежнего и пишет поставщика в материал', async () => {
    seedMaterial([
      { id: 's1', material_id: 'm1', supplier: 'Астра', is_selected: true },
      { id: 's2', material_id: 'm1', supplier: 'Юг-Текстиль', is_selected: false },
    ], 'Астра');
    const ok = await useErpStore.getState().selectSupplierOption('m1', 's2');
    expect(ok).toBe(true);
    const m = materialNow();
    expect(m.suppliers.find((o: any) => o.id === 's1').is_selected).toBe(false);
    expect(m.suppliers.find((o: any) => o.id === 's2').is_selected).toBe(true);
    expect(m.supplier).toBe('Юг-Текстиль');
    // прежний флаг снимается ДО установки нового — иначе частичный уникальный индекс упадёт
    const stageWrites = h.updateCalls.filter((c) => c.table === 'erp_material_suppliers');
    expect(stageWrites[0].patch).toEqual({ is_selected: false });
    expect(stageWrites[1].patch).toEqual({ is_selected: true });
    expect(h.updateCalls.find((c) => c.table === 'erp_materials')?.patch).toEqual({ supplier: 'Юг-Текстиль' });
  });

  it('ошибка Supabase при выборе — полный откат', async () => {
    seedMaterial([
      { id: 's1', material_id: 'm1', supplier: 'Астра', is_selected: true },
      { id: 's2', material_id: 'm1', supplier: 'Юг-Текстиль', is_selected: false },
    ], 'Астра');
    h.updateError = { message: 'нет связи' };
    const ok = await useErpStore.getState().selectSupplierOption('m1', 's2');
    expect(ok).toBe(false);
    const m = materialNow();
    expect(m.supplier).toBe('Астра');
    expect(m.suppliers.find((o: any) => o.id === 's1').is_selected).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });

  it('удаление выбранного варианта очищает поставщика позиции', async () => {
    seedMaterial([{ id: 's1', material_id: 'm1', supplier: 'Астра', is_selected: true }], 'Астра');
    const ok = await useErpStore.getState().deleteSupplierOption('m1', 's1');
    expect(ok).toBe(true);
    expect(materialNow().suppliers).toHaveLength(0);
    expect(materialNow().supplier).toBeNull();
  });

  it('удаление невыбранного варианта поставщика позиции не трогает', async () => {
    seedMaterial([
      { id: 's1', material_id: 'm1', supplier: 'Астра', is_selected: true },
      { id: 's2', material_id: 'm1', supplier: 'Юг-Текстиль', is_selected: false },
    ], 'Астра');
    await useErpStore.getState().deleteSupplierOption('m1', 's2');
    expect(materialNow().supplier).toBe('Астра');
    expect(materialNow().suppliers).toHaveLength(1);
  });

  it('правка варианта — optimistic с откатом', async () => {
    seedMaterial([{ id: 's1', material_id: 'm1', supplier: 'Астра', price: 400, is_selected: true }], 'Астра');
    expect(await useErpStore.getState().updateSupplierOption('m1', 's1', { price: 380 })).toBe(true);
    expect(materialNow().suppliers[0].price).toBe(380);

    h.updateError = { message: 'нет связи' };
    expect(await useErpStore.getState().updateSupplierOption('m1', 's1', { price: 999 })).toBe(false);
    expect(materialNow().suppliers[0].price).toBe(380);
  });
});

describe('ТЗ в PDF (волна 4)', () => {
  const pdf = (name = 'tz.pdf', size = 1024) =>
    ({ name, size, type: 'application/pdf' }) as unknown as File;

  /** Заказ с двумя цехами на позиции и опциональными документами/назначениями */
  function seedTz(over: Record<string, unknown> = {}) {
    useErpStore.setState({
      departments: [
        { id: 'd-cut', code: 'cutting', name: 'Закройный цех' },
        { id: 'd-sew', code: 'sewing', name: 'Швейный цех' },
      ],
      orders: [{
        id: 'o1', status: 'active', title: 'Заказ', due_date: '2026-08-01',
        tz_required: true,
        items: [{
          id: 'it1', qty: 100, product_type: 'Футболка', sort_order: 10,
          stages: [
            { id: 'st-cut', item_id: 'it1', department_id: 'd-cut', status: 'waiting', sort_order: 10, depends_on: [], qty_done: 0 },
            { id: 'st-sew', item_id: 'it1', department_id: 'd-sew', status: 'waiting', sort_order: 20, depends_on: [], qty_done: 0 },
          ],
        }],
        materials: [], tz_documents: [], tz_assignments: [],
        ...over,
      }],
      loaded: true,
    } as any);
  }
  const orderNow = () => useErpStore.getState().orders[0] as any;

  it('загрузка ТЗ кладёт файл в бакет и создаёт первую версию', async () => {
    seedTz();
    const doc = await useErpStore.getState().uploadTzDocument({
      orderId: 'o1', itemId: 'it1', file: pdf('Футболка ТЗ.pdf'),
    });
    expect(doc).toBeTruthy();
    expect(h.uploadCalls).toHaveLength(1);
    expect(h.uploadCalls[0].bucket).toBe('erp-attachments');
    expect(h.uploadCalls[0].path).toMatch(/^tz\/o1\/[0-9a-f-]+\/v1-Футболка ТЗ\.pdf$/);
    expect(orderNow().tz_documents).toHaveLength(1);
    expect(orderNow().tz_documents[0].version).toBe(1);
    expect(orderNow().tz_documents[0].is_current).toBe(true);
  });

  it('не-PDF и слишком большой файл отклоняются до загрузки', async () => {
    seedTz();
    const jpg = { name: 'скан.jpg', size: 10, type: 'image/jpeg' } as unknown as File;
    expect(await useErpStore.getState().uploadTzDocument({ orderId: 'o1', file: jpg })).toBeNull();
    const huge = pdf('огромное.pdf', 20 * 1024 * 1024);
    expect(await useErpStore.getState().uploadTzDocument({ orderId: 'o1', file: huge })).toBeNull();
    expect(h.uploadCalls).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it('сбой загрузки файла не создаёт запись документа', async () => {
    seedTz();
    h.uploadError = { message: 'нет связи' };
    expect(await useErpStore.getState().uploadTzDocument({
      orderId: 'o1', file: pdf(),
    })).toBeNull();
    expect(orderNow().tz_documents).toHaveLength(0);
  });

  it('замена файла создаёт версию 2 и снимает is_current с прежней', async () => {
    seedTz({
      tz_documents: [{
        id: 'doc1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1,
        is_current: true, file_path: 'tz/o1/g1/v1-tz.pdf', file_name: 'tz.pdf',
        created_at: '2026-07-20T10:00:00Z',
      }],
      tz_assignments: [{
        id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-sew', group_id: 'g1',
        created_at: '2026-07-20T10:00:00Z',
      }],
    });
    const row = await useErpStore.getState().replaceTzDocument('g1', pdf('tz-v2.pdf'));
    expect(row?.version).toBe(2);
    expect(h.uploadCalls[0].path).toBe('tz/o1/g1/v2-tz-v2.pdf');

    const docs = orderNow().tz_documents;
    expect(docs.filter((d: any) => d.is_current)).toHaveLength(1);
    expect(docs.find((d: any) => d.is_current).version).toBe(2);
    // Снятие is_current идёт ПОСЛЕ вставки — иначе партиальный уникальный индекс не пустит
    expect(h.updateCalls.some((c) => c.table === 'erp_tz_documents' && c.patch.is_current === false))
      .toBe(true);
    // Цеху с назначением пишется событие «ТЗ обновлено»
    expect(h.insertCalls.some((c) => c.table === 'erp_stage_events'
      && String((c.row as any).comment).includes('ТЗ обновлено до версии 2'))).toBe(true);
  });

  it('назначение ТЗ цеху заменяет прежнее назначение того же этапа', async () => {
    seedTz({
      tz_documents: [
        { id: 'd1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1, is_current: true, file_path: 'p1', created_at: '2026-07-20T10:00:00Z' },
        { id: 'd2', order_id: 'o1', item_id: 'it1', group_id: 'g2', version: 1, is_current: true, file_path: 'p2', created_at: '2026-07-20T11:00:00Z' },
      ],
      tz_assignments: [{
        id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-sew', group_id: 'g1',
        created_at: '2026-07-20T10:00:00Z',
      }],
    });
    expect(await useErpStore.getState().assignTz({
      orderId: 'o1', itemId: 'it1', departmentId: 'd-sew', groupId: 'g2',
    })).toBe(true);
    const asg = orderNow().tz_assignments.filter((a: any) => a.department_id === 'd-sew');
    expect(asg).toHaveLength(1);
    expect(asg[0].group_id).toBe('g2');
  });

  it('снять единственное ТЗ у этапа маршрута нельзя', async () => {
    seedTz({
      tz_documents: [{ id: 'd1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1, is_current: true, file_path: 'p1', created_at: '2026-07-20T10:00:00Z' }],
      tz_assignments: [{ id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-sew', group_id: 'g1', created_at: '2026-07-20T10:00:00Z' }],
    });
    expect(await useErpStore.getState().unassignTz('it1', 'd-sew')).toBe(false);
    expect(orderNow().tz_assignments).toHaveLength(1);
    expect(h.deleteCalls).toHaveLength(0);
  });

  it('битое назначение (документ удалён) снять можно', async () => {
    seedTz({
      tz_documents: [],
      tz_assignments: [{ id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-sew', group_id: 'нет', created_at: '2026-07-20T10:00:00Z' }],
    });
    expect(await useErpStore.getState().unassignTz('it1', 'd-sew')).toBe(true);
    expect(orderNow().tz_assignments).toHaveLength(0);
  });

  it('гейт: этап без ТЗ не попадает в «готово к работе»', async () => {
    seedTz();
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'cutting')).toBe(0);

    useErpStore.setState({
      orders: [{
        ...orderNow(),
        tz_documents: [{ id: 'd1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1, is_current: true, file_path: 'p1', created_at: '2026-07-20T10:00:00Z' }],
        tz_assignments: [{ id: 'a1', order_id: 'o1', item_id: 'it1', department_id: 'd-cut', group_id: 'g1', created_at: '2026-07-20T10:00:00Z' }],
      }],
    } as any);
    const s2 = useErpStore.getState();
    expect(readyCountFor(s2.orders, s2.departments, 'cutting')).toBe(1);
  });

  it('требование ТЗ включается вручную — optimistic с откатом', async () => {
    seedTz({ tz_required: false });
    expect(await useErpStore.getState().setTzRequired('o1', true)).toBe(true);
    expect(orderNow().tz_required).toBe(true);

    h.updateError = { message: 'нет связи' };
    expect(await useErpStore.getState().setTzRequired('o1', false)).toBe(false);
    expect(orderNow().tz_required).toBe(true);
  });
});
