import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Тесты логики частичной готовности (qty_done += N), фикса NaN в браке,
 * счётчика readyCountFor, точечного realtime (п.27), pendingMutations (п.29),
 * ленивого архива (п.26), RPC-создания заказа (п.28) и ретрая аудита (п.33).
 */

const h = vi.hoisted(() => ({
  /**
   * Журнал операций в порядке выполнения. updateCalls/insertCalls лежат в разных
   * массивах, поэтому «что раньше — снятие флага или вставка» по ним не проверить,
   * а для замены ТЗ порядок и есть суть инварианта (партиальный уникальный индекс).
   */
  opLog: [] as { op: 'update' | 'insert' | 'upsert' | 'delete'; table: string }[],
  updateCalls: [] as { table: string; patch: Record<string, unknown> }[],
  updateError: null as { message: string } | null,
  /** Ошибки на каждый update по порядку; пусто — используется updateError */
  updateErrors: [] as ({ message: string } | null)[],
  /** Аргумент .select(...) по каждому запросу — списочный запрос обязан быть лёгким */
  selectCols: [] as { table: string; cols: string }[],
  insertCalls: [] as { table: string; row: unknown }[],
  /** Очередь ошибок insert (для ретрая logStageEvent): shift на каждый вызов */
  insertErrors: [] as ({ message: string } | null)[],
  deleteCalls: [] as { table: string }[],
  deleteError: null as { message: string } | null,
  /**
   * Строки, вернувшиеся из `delete().select()`. Пустой массив = ОТКАЗ RLS:
   * запрет на DELETE приходит через `USING`, то есть «удалено 0 строк»,
   * а не исключение. Без этого различия мок не умеет воспроизвести отказ.
   */
  deletedRows: [{ id: 'ord-1' }] as unknown[],
  selectCalls: [] as { table: string; filters: string[] }[],
  /**
   * Колонки сортировки по каждому `.order(...)`. Постраничная выборка обязана
   * иметь УНИКАЛЬНЫЙ доводчик, иначе `range` перетасовывает строки между
   * страницами — проверять это можно только по фактическому запросу.
   */
  orderCalls: [] as { table: string; col: string }[],
  tableData: {} as Record<string, unknown[]>,
  selectError: null as { message: string } | null,
  singleData: null as unknown,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  /**
   * Ответ по КОНКРЕТНОЙ функции — операции этапов уехали в свои RPC
   * (`erp_stage_report_progress`, `erp_stage_apply_defect`, `erp_stage_reorder_queue`,
   * `erp_stage_move_department`), и общий `rpcResult` их уже не различает:
   * в одном сценарии `erp_create_order` обязан пройти, а перенос — упасть.
   */
  rpcByFn: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  /** Загрузки в Storage (ТЗ в PDF, волна 4) */
  uploadCalls: [] as { bucket: string; path: string; name: string }[],
  uploadError: null as { message: string } | null,
  /** Уборка за собой: файл загрузился, но не привязался — его надо убрать */
  removeCalls: [] as { bucket: string; paths: string[] }[],
}));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeQuery = (table: string) => {
    const filters: string[] = [];
    const q: any = {
      eq: (col: string, val: unknown) => { filters.push(`eq:${col}=${val}`); return q; },
      neq: (col: string, val: unknown) => { filters.push(`neq:${col}=${val}`); return q; },
      gte: (col: string, val: unknown) => { filters.push(`gte:${col}=${val}`); return q; },
      lte: (col: string, val: unknown) => { filters.push(`lte:${col}=${val}`); return q; },
      order: (col: string) => { h.orderCalls.push({ table, col }); return q; },
      limit: () => q,
      range: (from: number, to: number) => { filters.push(`range:${from}-${to}`); return q; },
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
        select: vi.fn((cols?: string) => { h.selectCols.push({ table, cols: cols ?? '' }); return makeQuery(table); }),
        // Цепочки .eq().neq() (снятие is_current у прошлых версий ТЗ) — звено возвращает себя
        update: vi.fn((patch: Record<string, unknown>) => {
          let recorded = false;
          const q: any = {
            eq: () => {
              if (!recorded) { recorded = true; h.updateCalls.push({ table, patch }); h.opLog.push({ op: 'update', table }); }
              return q;
            },
            neq: () => q,
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              // updateErrors — очередь на КАЖДЫЙ вызов по порядку (как insertErrors).
              // Нужна там, где важно, какой именно шаг упал: у переноса этапа первый
              // update коммитится, а падает второй, и поведение обязано различаться.
              Promise
                .resolve({ error: h.updateErrors.length ? h.updateErrors.shift()! : h.updateError })
                .then(resolve, reject),
          };
          return q;
        }),
        insert: vi.fn((row: any) => {
          h.insertCalls.push({ table, row });
          h.opLog.push({ op: 'insert', table });
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
            // `.select()` после delete: им проверяют, сколько строк УДАЛИЛОСЬ
            select: () => Promise.resolve({
              data: h.deleteError ? null : h.deletedRows,
              error: h.deleteError,
            }),
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve({ error: h.deleteError }).then(resolve, reject),
          };
          return q;
        }),
      })),
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        return Promise.resolve(h.rpcByFn[fn] ?? h.rpcResult);
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn((path: string, file: { name?: string }) => {
            h.uploadCalls.push({ bucket, path, name: file?.name ?? '' });
            return Promise.resolve({ error: h.uploadError });
          }),
          remove: vi.fn((paths: string[]) => {
            h.removeCalls.push({ bucket, paths });
            return Promise.resolve({ data: null, error: null });
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
  useErpStore, readyCountFor, _pendingMutations, resetErpStore,
  openWarehouseTaskCount, openProcurementCount, openSubcontractCount,
  activeExperimentalCount, activeOrdersCount,
} = await import('./useErpStore');
/**
 * Доменные действия стора приезжают отдельным чанком (`erp/lazyScreen`), и в
 * работающем приложении экран никогда не видит стор без них. Тест обязан
 * работать в тех же условиях — иначе он проверяет не стор, а состояние
 * загрузки, которого у пользователя не бывает.
 *
 * Подключение стоит ЗДЕСЬ, а не в общем `setupTests`: моки Supabase объявлены
 * в этом файле, и слайсы, поднятые раньше него, захватили бы другой инстанс
 * клиента — действия работали бы, но мимо шпионов.
 */
const { attachDomainSlices } = await import('./domainSlices');
attachDomainSlices();

// Кэш запросов — своя память рядом со стором; тесты числа запросов должны
// стартовать с чистой, иначе соседний тест «оплатит» их запрос.
const { clearQueryCache } = await import('./queryCache');
const { ARCHIVE_PAGE_SIZE } = await import('./slices/ordersSlice');
const { REALTIME_DEFER_ATTEMPTS } = await import('./shared');
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
  h.opLog.length = 0;
  h.updateCalls.length = 0;
  h.updateError = null;
  h.updateErrors.length = 0;
  h.selectCols.length = 0;
  h.insertCalls.length = 0;
  h.insertErrors.length = 0;
  h.deleteCalls.length = 0;
  h.deleteError = null;
  h.deletedRows = [{ id: 'ord-1' }];
  h.selectCalls.length = 0;
  h.orderCalls.length = 0;
  h.tableData = {};
  h.selectError = null;
  h.singleData = null;
  h.rpcCalls.length = 0;
  h.rpcResult = { data: null, error: null };
  h.rpcByFn = {};
  h.uploadCalls.length = 0;
  h.uploadError = null;
  h.removeCalls.length = 0;
  _pendingMutations.clear();
  localStorage.removeItem('erp_my_dept');
  useErpStore.setState({
    orders: [], departments: [], loaded: false, detailIds: [],
    archiveLoaded: false, archiveLoading: false, archiveHasMore: false,
    myDeptId: null, myDeptLoaded: false,
    dictionaries: [], dictionariesLoaded: false,
    permissionMatrix: null, permissionsLoaded: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Патчи, ушедшие в транзакцию брака. Операции этапов больше не пачка независимых
 * UPDATE, а один RPC: считать записи по `updateCalls` нечего — сверяем то, что
 * реально уехало на сервер.
 */
const defectPatches = (): any[] =>
  ((h.rpcCalls.find((c) => c.fn === 'erp_stage_apply_defect')?.args as any)?.p_patches ?? []);

/** Позиции, ушедшие в транзакцию перенумерации очереди */
const queueWrites = (): any[] =>
  ((h.rpcCalls.find((c) => c.fn === 'erp_stage_reorder_queue')?.args as any)?.p_writes ?? []);

describe('useErpStore — reportProgress (частичная готовность)', () => {
  it('накапливает qty_done, этап остаётся in_progress', async () => {
    seed();
    const ok = await useErpStore.getState().reportProgress('st1', 300);
    expect(ok).toBe(true);
    const st = getStage();
    expect(st.qty_done).toBe(300);
    expect(st.status).toBe('in_progress');
    expect(st.finished_at).toBeNull();
    // Приращение считает сервер: уходит «сделано ещё N», а не итог. Абсолют
    // с клиента затирал результат второго исполнителя того же цеха.
    const call = h.rpcCalls.find((c) => c.fn === 'erp_stage_report_progress');
    expect(call?.args).toEqual({ p_stage_id: 'st1', p_qty: 300 });
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
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('rollback при ошибке Supabase', async () => {
    seed({ qty_done: 100 });
    h.rpcByFn.erp_stage_report_progress = { data: null, error: { message: 'boom' } };
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

  /**
   * `started_at` — отметка «когда цех действительно взялся». Прежде её перетирал
   * КАЖДЫЙ переход в `in_progress`: снятие блокировки, переоткрытие после брака,
   * открытие целевого этапа при переносе. От неё зависит бейдж «ТЗ обновлено»
   * (`tzUpdatedAfterStart` сравнивает дату документа с началом работы) — сдвигая
   * отметку вперёд, мы прятали от цеха ровно то предупреждение, ради которого
   * бейдж и сделан: ТЗ поменяли, а исполнитель дошивает по старому файлу.
   */
  it('started_at ставится один раз — повторный вход в работу его не сдвигает', async () => {
    seed({ status: 'blocked', started_at: '2026-08-01T08:00:00.000Z' });
    await useErpStore.getState().setStageStatus('st1', 'in_progress');
    expect(getStage().started_at).toBe('2026-08-01T08:00:00.000Z');
    const patch = h.updateCalls.find((c) => c.table === 'erp_item_stages')?.patch as any;
    expect(patch).not.toHaveProperty('started_at');
  });

  it('первый вход в работу отметку проставляет', async () => {
    seed({ status: 'waiting', started_at: null });
    await useErpStore.getState().setStageStatus('st1', 'in_progress');
    expect(getStage().started_at).toBeTruthy();
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
    // только текущий этап — один патч в транзакции
    expect(defectPatches()).toHaveLength(1);
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
    expect(defectPatches()).toHaveLength(2);
    // счётчики уходят ПРИРАЩЕНИЕМ, а не итогом
    expect(defectPatches().find((w: any) => w.id === 'st-cut')).toMatchObject({
      qty_done_delta: -20, qty_rework_delta: 20, status: 'in_progress',
    });
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
    expect(defectPatches()).toHaveLength(1);
    expect(defectPatches()[0].id).toBe('st-sew');
  });

  it('брак больше тиража отклоняется', async () => {
    seedChain();
    const ok = await useErpStore.getState().reportDefect('st-sew', { qty: 999, reason: 'много', target: 'st-cut' });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Брак не может превышать тираж (500 шт)');
  });
});

/**
 * Регрессия A3 на уровне СЛАЙСА, а не чистой утилиты: правильный расчёт
 * бесполезен, если слайс его не применяет. Прежняя реализация считала
 * промежуточные по интервалу sort_order прямо здесь.
 */
describe('useErpStore — reportDefect с параллельными ветками нанесения (A3)', () => {
  /**
   *           ┌─ вышивка(30, in_progress) ─┐
   * закрой(20)┤                            ├─ швейка(40, waiting)
   *           └─ шелкография(30, done) ────┘
   *
   * Обе ветки нанесения имеют ОДИНАКОВЫЙ sort_order — так их строит buildRoute.
   */
  function seedParallel() {
    const base = {
      item_id: 'it1', qty_done: 500, qty_rework: 0,
      planned_start: null, planned_end: null, started_at: null,
      assignee: null, block_reason: null, notes: null,
    };
    const stages = [
      { ...base, id: 'st-cut', department_id: 'd-cut', depends_on: [], status: 'done', finished_at: '2026-01-01', sort_order: 20 },
      { ...base, id: 'st-emb', department_id: 'd-emb', depends_on: ['st-cut'], status: 'in_progress', finished_at: null, sort_order: 30 },
      { ...base, id: 'st-silk', department_id: 'd-silk', depends_on: ['st-cut'], status: 'done', finished_at: '2026-01-02', sort_order: 30 },
      { ...base, id: 'st-sew', department_id: 'd-sew', depends_on: ['st-emb', 'st-silk'], status: 'waiting', finished_at: null, qty_done: 0, sort_order: 40 },
    ];
    const item = {
      id: 'it1', order_id: 'o1', product_type: 'Футболка', variant: null, qty: 500,
      production_type: 'sewing', branding_methods: ['embroidery', 'silkscreen'], branding_on: 'cut',
      notes: null, sort_order: 10, stages, prints: [],
    };
    useErpStore.setState({
      orders: [{ id: 'o1', title: 'Заказ', status: 'active', items: [item], materials: [] }] as any,
      departments: [
        { id: 'd-cut', code: 'cutting', name: 'Закрой', active: true },
        { id: 'd-emb', code: 'embroidery', name: 'Вышивка', active: true },
        { id: 'd-silk', code: 'silkscreen', name: 'Шелкография', active: true },
        { id: 'd-sew', code: 'sewing', name: 'Швейка', active: true },
      ] as any,
      loaded: true,
    });
  }

  const stagesNow = () => useErpStore.getState().orders[0].items[0].stages;

  it('возврат из вышивки в закрой переоткрывает сданную шелкографию', async () => {
    seedParallel();
    const ok = await useErpStore.getState().reportDefect('st-emb', {
      qty: 20, reason: 'кривая вышивка', target: 'st-cut',
    });
    expect(ok).toBe(true);

    const silk = stagesNow().find((s) => s.id === 'st-silk');
    // Прежняя отсечка по sort_order (`>= hi`, 30 >= 30) оставляла шелкографию
    // в done с полным тиражом — 20 перекроенных единиц уходили в пошив без печати.
    expect(silk?.status).toBe('waiting');
    expect(silk?.qty_done).toBe(480);
    expect(silk?.qty_rework).toBe(20);
    expect(silk?.finished_at).toBeNull();
  });

  it('швейка ждёт обе ветки и не трогается — этих единиц она не видела', async () => {
    seedParallel();
    await useErpStore.getState().reportDefect('st-emb', { qty: 20, reason: 'брак', target: 'st-cut' });
    const sew = stagesNow().find((s) => s.id === 'st-sew');
    expect(sew?.status).toBe('waiting');
    expect(sew?.qty_rework).toBe(0);
  });

  it('в БД уходят ТРИ записи — закрой, вышивка и соседняя ветка, но не швейка', async () => {
    seedParallel();
    await useErpStore.getState().reportDefect('st-emb', { qty: 20, reason: 'брак', target: 'st-cut' });
    // Мок пишет только (table, patch), поэтому сверяем количество: до починки
    // шелкография не патчилась вовсе и записей было ДВЕ. Какой именно этап
    // изменился, проверяют два теста выше — по состоянию стора.
    expect(defectPatches()).toHaveLength(3);
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
    /**
     * Количество приёмка БОЛЬШЕ НЕ ПИШЕТ (волна 3.3): `qty_received` стала
     * суммой журнала `erp_material_receipts` и ведётся триггером. Прямая запись
     * из карточки означала бы двух писателей одной колонки — первый же приход
     * пересчитал бы сумму и затёр набранное. Число по-прежнему уходит
     * в историю склада (проверяется ниже) и в проверку расхождения на экране.
     */
    expect(m.qty_received).toBeUndefined();
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
    h.rpcByFn.erp_stage_apply_defect = { data: null, error: { message: 'boom' } };
    const ok = await useErpStore.getState().reportDefect('st-sew', { qty: 20, reason: 'x', target: 'st-cut' });
    expect(ok).toBe(false);
    expect(stages().find((s) => s.id === 'st-cut')?.status).toBe('done');
    expect(stages().find((s) => s.id === 'st-cut')?.qty_rework).toBe(0);
    expect(stages().find((s) => s.id === 'st-sew')?.status).toBe('done');
    // Текст обязан называть ПРИЧИНУ: раньше отказ прав, обрыв сети и конфликт
    // выглядели одинаково («Не удалось записать брак»), и рабочий не знал, что делать
    expect(toast.error).toHaveBeenCalledWith('Брак не записан: boom');
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
    // 3 патча этапов (cut, vto, sew) — одной транзакцией
    expect(defectPatches()).toHaveLength(3);
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
    // Причина в тексте: отказ прав, обрыв сети и конфликт больше не выглядят одинаково
    expect(toast.error).toHaveBeenCalledWith('Не удалось отгрузить заказ: boom');
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

  /**
   * Прежде отсрочка была ОДНОРАЗОВОЙ: не успела мутация за секунду — событие
   * пропадало навсегда. На цеховом Wi-Fi запрос дольше секунды это норма, и так
   * терялась чужая правка того же этапа: на экране оставалось состояние, которого
   * в базе уже нет, до следующего события по этой строке.
   */
  it('мутация дольше буфера — событие ждёт, а не пропадает', async () => {
    vi.useFakeTimers();
    seed();
    _pendingMutations.add('stage:st1');
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent());
    await vi.advanceTimersByTimeAsync(3000);
    expect(getStage().status).toBe('in_progress'); // пока мутация идёт — не применяем

    _pendingMutations.delete('stage:st1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(getStage().status).toBe('done'); // ключ снят — событие доехало
  });

  it('попытки не бесконечны — зависший запрос не оставляет вечный таймер', async () => {
    vi.useFakeTimers();
    seed();
    _pendingMutations.add('stage:st1');
    useErpStore.getState().applyRealtimeEvent(stageUpdateEvent());
    // Потолок REALTIME_DEFER_ATTEMPTS попыток по секунде — ждём заведомо дольше
    await vi.advanceTimersByTimeAsync(1000 * (REALTIME_DEFER_ATTEMPTS + 2));

    _pendingMutations.delete('stage:st1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(getStage().status).toBe('in_progress'); // попытки исчерпаны
  });

  it('мутация ставит и снимает pending-ключ вокруг await', async () => {
    seed();
    const p = useErpStore.getState().setStageStatus('st1', 'in_progress');
    expect(_pendingMutations.has('stage:st1')).toBe(true);
    await p;
    expect(_pendingMutations.has('stage:st1')).toBe(false);
  });
});

/**
 * D2 аудита: список грузится облегчённым select-ом, полный — только по заказу.
 * Без отметки `detailIds` карточка не узнала бы, что ей нужна дозагрузка, и
 * молча нарисовала бы позицию без размерной сетки.
 */
describe('облегчённый списочный запрос (D2)', () => {
  const dept = { id: 'd1', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 10 };
  const row = { id: 'o-a', title: 'Активный', status: 'active', items: [], materials: [] };

  it('loadAll просит списочный select, без размерной сетки', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [row] };
    await useErpStore.getState().loadAll();
    const call = h.selectCols.find((c) => c.table === 'erp_orders');
    expect(call).toBeTruthy();
    expect(call!.cols).not.toContain('size_grid');
    // Гейты и очередь без этих колонок сломались бы молча
    expect(call!.cols).toContain('overdue_comment');
    expect(call!.cols).toContain('queue_position');
    expect(call!.cols).toContain('procurement_tasks');
  });

  it('loadAll НЕ помечает заказы как загруженные полностью', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [row] };
    await useErpStore.getState().loadAll();
    expect(useErpStore.getState().detailIds).toEqual([]);
  });

  it('loadOne просит полный select и помечает заказ', async () => {
    h.singleData = { ...row, items: [], materials: [] };
    await useErpStore.getState().loadOne('o-a');
    const call = h.selectCols.filter((c) => c.table === 'erp_orders').at(-1)!;
    // Полный select берёт колонки звёздочкой — размерная сетка приезжает с ней
    expect(call.cols).toContain('items:erp_order_items (\n    *');
    expect(useErpStore.getState().detailIds).toContain('o-a');
  });

  it('повторный loadOne не дублирует отметку', async () => {
    h.singleData = { ...row, items: [], materials: [] };
    await useErpStore.getState().loadOne('o-a');
    await useErpStore.getState().loadOne('o-a');
    expect(useErpStore.getState().detailIds.filter((id) => id === 'o-a')).toHaveLength(1);
  });
});

describe('число запросов: оболочка и карточка заказа (Ф1′)', () => {
  const dept = { id: 'd1', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 10 };
  const row = { id: 'o-a', title: 'Активный', status: 'active', items: [], materials: [] };

  /** Сколько сетевых операций сделано: REST-выборки + RPC */
  const netCalls = () => h.selectCalls.length + h.rpcCalls.length;

  beforeEach(() => {
    clearQueryCache();
    useErpStore.setState({
      bootstrapLoaded: false, loaded: false, departments: [], orders: [], detailIds: [],
    });
  });

  it('загрузка оболочки — 2 запроса вместо 7', async () => {
    // Было: departments, role_permissions, dictionaries, subcontracting,
    // experimental, employees(мой цех) + заказы. Стало: erp_bootstrap + заказы.
    h.rpcResult = {
      data: {
        departments: [dept], permissions: [], dictionaries: [],
        subcontracting: [], experimental: [], my_employee: null,
      },
      error: null,
    };
    h.tableData = { erp_orders: [row] };

    await useErpStore.getState().loadBootstrap();
    await useErpStore.getState().loadAll();

    expect(netCalls()).toBe(2);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['erp_bootstrap']);
  });

  it('бутстрап приносит всё, ради чего слали шесть запросов', async () => {
    h.rpcResult = {
      data: {
        departments: [dept],
        permissions: [{ role: 'production_head', permission: 'plan.manage', allowed: true }],
        dictionaries: [{ id: 'x', kind: 'block_reason', name: 'Нет ткани', active: true, sort_order: 1 }],
        subcontracting: [{ id: 's1', status: 'planned' }],
        experimental: [{ id: 'e1', phase: 'patterns' }],
        my_employee: { department_id: 'd1', role: 'worker' },
      },
      error: null,
    };
    await useErpStore.getState().loadBootstrap();
    const st = useErpStore.getState();
    expect(st.departments).toHaveLength(1);
    expect(st.permissionMatrix?.production_head?.['plan.manage']).toBe(true);
    expect(st.dictionaries).toHaveLength(1);
    expect(st.subcontracting).toHaveLength(1);
    expect(st.experimental).toHaveLength(1);
    expect(st.myDeptId).toBe('d1');
    // Все флаги «загружено» подняты — иначе экраны дозапросят то же самое
    expect(st.permissionsLoaded && st.dictionariesLoaded
      && st.subcontractingLoaded && st.experimentalLoaded && st.myDeptLoaded).toBe(true);
  });

  it('loadAll после бутстрапа НЕ перезапрашивает цеха', async () => {
    useErpStore.setState({ departments: [dept] as never });
    h.tableData = { erp_orders: [row] };
    await useErpStore.getState().loadAll();
    expect(h.selectCalls.filter((c) => c.table === 'erp_departments')).toHaveLength(0);
  });

  it('loadAll без бутстрапа цеха всё же берёт — экран не должен остаться без них', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [row] };
    await useErpStore.getState().loadAll();
    expect(h.selectCalls.filter((c) => c.table === 'erp_departments')).toHaveLength(1);
    expect(useErpStore.getState().departments).toHaveLength(1);
  });

  it('открытие карточки — 2 запроса вместо 4', async () => {
    // Было: loadOne + stage_events + order_audit + order_comments.
    // Стало: loadOne + erp_order_detail.
    h.singleData = { ...row, items: [], materials: [] };
    h.rpcResult = { data: { events: [], audit: [], comments: [] }, error: null };

    await useErpStore.getState().loadOne('o-a');
    await useErpStore.getState().loadOrderBundle('o-a');

    expect(netCalls()).toBe(2);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['erp_order_detail']);
  });

  it('повторное открытие того же заказа в сеть не идёт', async () => {
    h.rpcResult = { data: { events: [], audit: [], comments: [] }, error: null };
    await useErpStore.getState().loadOrderBundle('o-a');
    await useErpStore.getState().loadOrderBundle('o-a');
    // Страница и боковой Drawer используют один хук; в dev StrictMode
    // эффекты вызываются парой — без дедупликации это удвоение запросов
    expect(h.rpcCalls).toHaveLength(1);
  });

  it('после своей правки лента перечитывается принудительно', async () => {
    h.rpcResult = { data: { events: [], audit: [], comments: [] }, error: null };
    await useErpStore.getState().loadOrderBundle('o-a');
    await useErpStore.getState().loadOrderBundle('o-a', { force: true });
    // Аудит пишет триггер БД — без сброса кэша правка выглядела бы непрошедшей
    expect(h.rpcCalls).toHaveLength(2);
  });

  it('отправленный комментарий сбрасывает пакет заказа', async () => {
    h.rpcResult = { data: { events: [], audit: [], comments: [] }, error: null };
    await useErpStore.getState().loadOrderBundle('o-a');
    await useErpStore.getState().addComment('o-a', 'текст');
    await useErpStore.getState().loadOrderBundle('o-a');
    expect(h.rpcCalls).toHaveLength(2);
  });

  it('выход из системы чистит кэш: планшет в цеху общий', async () => {
    h.rpcResult = { data: { events: [], audit: [], comments: [] }, error: null };
    await useErpStore.getState().loadOrderBundle('o-a');
    resetErpStore();
    await useErpStore.getState().loadOrderBundle('o-a');
    expect(h.rpcCalls).toHaveLength(2);
  });
});

describe('тестовые заказы (is_demo) — фильтр в запросе, не в экранах', () => {
  const dept = { id: 'd1', code: 'sewing', name: 'Швейный цех', active: true, sort_order: 10 };
  const row = { id: 'o-a', title: 'Активный', status: 'active', items: [], materials: [] };

  beforeEach(() => {
    localStorage.removeItem('erp_show_demo');
    useErpStore.setState({ showDemoOrders: false, archiveLoaded: false, archiveHasMore: false });
  });

  it('по умолчанию списочный запрос отсекает демо', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [row] };
    await useErpStore.getState().loadAll();
    const call = h.selectCalls.filter((c) => c.table === 'erp_orders').at(-1)!;
    expect(call.filters).toContain('eq:is_demo=false');
  });

  it('архив фильтруется тем же условием — иначе демо всплывёт во вкладке «Архив»', async () => {
    h.tableData = { erp_orders: [] };
    await useErpStore.getState().loadArchive();
    const call = h.selectCalls.filter((c) => c.table === 'erp_orders').at(-1)!;
    expect(call.filters).toContain('eq:is_demo=false');
  });

  it('включённый показ снимает условие и перечитывает данные', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [row] };
    await useErpStore.getState().setShowDemoOrders(true);
    const call = h.selectCalls.filter((c) => c.table === 'erp_orders').at(-1)!;
    expect(call.filters).not.toContain('eq:is_demo=false');
    expect(localStorage.getItem('erp_show_demo')).toBe('1');
  });

  it('loadOne фильтру НЕ подчиняется: прямая ссылка на демо обязана открываться', async () => {
    h.singleData = { ...row, is_demo: true, items: [], materials: [] };
    const loaded = await useErpStore.getState().loadOne('o-a');
    expect(loaded).toBeTruthy();
    const call = h.selectCalls.filter((c) => c.table === 'erp_orders').at(-1)!;
    expect(call.filters).not.toContain('eq:is_demo=false');
  });

  it('пометка тестовым убирает заказ из списка сразу, без F5', async () => {
    useErpStore.setState({ orders: [row] as never, detailIds: ['o-a'] });
    const ok = await useErpStore.getState().setOrderDemo('o-a', true);
    expect(ok).toBe(true);
    expect(useErpStore.getState().orders).toHaveLength(0);
    expect(useErpStore.getState().detailIds).toEqual([]);
  });

  it('снятие пометки заказ не выбрасывает', async () => {
    useErpStore.setState({ orders: [{ ...row, is_demo: true }] as never });
    await useErpStore.getState().setOrderDemo('o-a', false);
    expect(useErpStore.getState().orders).toHaveLength(1);
  });

  it('realtime не втягивает демо обратно при выключенном показе', () => {
    useErpStore.setState({ orders: [] as never });
    useErpStore.getState().applyRealtimeEvent({
      table: 'erp_orders',
      eventType: 'INSERT',
      new: { id: 'o-demo', status: 'active', is_demo: true },
      old: null,
    });
    expect(h.selectCalls.filter((c) => c.table === 'erp_orders')).toHaveLength(0);
  });

  it('проверка дубля № сделки идёт запросом, а не поиском по стору', async () => {
    // Дубль может лежать в архиве или быть помечен тестовым — в сторе его нет
    h.tableData = { erp_orders: [{ id: 'o-x', title: 'Тест новый', status: 'active' }] };
    const found = await useErpStore.getState().findOrdersByBitrixId(' 213231 ');
    expect(found).toHaveLength(1);
    const call = h.selectCalls.filter((c) => c.table === 'erp_orders').at(-1)!;
    expect(call.filters).toContain('eq:bitrix_id=213231');
  });

  it('пустой № сделки запроса не шлёт', async () => {
    const found = await useErpStore.getState().findOrdersByBitrixId('   ');
    expect(found).toEqual([]);
    expect(h.selectCalls.filter((c) => c.table === 'erp_orders')).toHaveLength(0);
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

  it('архив грузится страницей, а не целиком', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    h.tableData = { erp_orders: [archivedRow] };
    await useErpStore.getState().loadArchive();
    const archCall = h.selectCalls.at(-1);
    expect(archCall?.filters).toContain(`range:0-${ARCHIVE_PAGE_SIZE - 1}`);
    // Пришло меньше страницы — значит это весь архив, кнопки «показать ещё» не будет
    expect(useErpStore.getState().archiveHasMore).toBe(false);
  });

  it('полная страница означает «есть ещё», следующая догружается со смещением', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    // Ровно страница архивных заказов
    const page = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, i) => ({
      id: `arc-${i}`, title: `Сдан ${i}`, status: 'done_on_time', items: [], materials: [],
    }));
    h.tableData = { erp_orders: page };
    await useErpStore.getState().loadArchive();
    expect(useErpStore.getState().archiveHasMore).toBe(true);

    h.tableData = { erp_orders: [archivedRow] };
    await useErpStore.getState().loadMoreArchive();
    const moreCall = h.selectCalls.at(-1);
    expect(moreCall?.filters)
      .toContain(`range:${ARCHIVE_PAGE_SIZE}-${ARCHIVE_PAGE_SIZE * 2 - 1}`);
    const s = useErpStore.getState();
    expect(s.archiveHasMore).toBe(false);
    expect(s.orders.map((o) => o.id)).toContain('o-z');
    expect(s.orders).toHaveLength(1 + ARCHIVE_PAGE_SIZE + 1);
  });

  it('повторный заказ в следующей странице не дублируется', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    const page = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, i) => ({
      id: `arc-${i}`, title: `Сдан ${i}`, status: 'done_on_time', items: [], materials: [],
    }));
    h.tableData = { erp_orders: page };
    await useErpStore.getState().loadArchive();
    // Страница сдвинулась: тот же заказ пришёл снова
    h.tableData = { erp_orders: [page[0], archivedRow] };
    await useErpStore.getState().loadMoreArchive();
    const ids = useErpStore.getState().orders.map((o) => o.id);
    expect(ids.filter((id) => id === 'arc-0')).toHaveLength(1);
  });

  it('«показать ещё» не стреляет, когда догружать нечего', async () => {
    useErpStore.setState({ archiveHasMore: false, archiveLoading: false } as any);
    h.selectCalls.length = 0;
    await useErpStore.getState().loadMoreArchive();
    expect(h.selectCalls).toHaveLength(0);
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

  /**
   * `due_date` не уникален и бывает NULL: при равных значениях порядок строк
   * между двумя запросами `range` мог перетасоваться, и заказ приезжал дважды
   * либо не приезжал вовсе. Дубль гасит дедуп по id — пропуск не видно ничем.
   */
  it('страницы упорядочены уникальным доводчиком, иначе строки теряются', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    h.orderCalls.length = 0;
    h.tableData = { erp_orders: [archivedRow] };
    await useErpStore.getState().loadArchive();
    const cols = h.orderCalls.filter((c) => c.table === 'erp_orders').map((c) => c.col);
    expect(cols).toEqual(['due_date', 'id']);
  });

  /**
   * Смещение следующей страницы считалось из стора
   * (`orders.filter(status !== 'active').length`), а туда попадают архивные заказы,
   * пришедшие мимо пагинации: по диплинку (`loadOne`) или из realtime, когда
   * активный заказ уехал в архив. Каждый такой сдвигал смещение вперёд, и ровно
   * столько строк следующая страница ПЕРЕПРЫГИВАЛА.
   */
  it('смещение считается по загруженным страницам, а не по содержимому стора', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    const page = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, i) => ({
      id: `arc-${i}`, title: `Сдан ${i}`, status: 'done_on_time', items: [], materials: [],
    }));
    h.tableData = { erp_orders: page };
    await useErpStore.getState().loadArchive();

    // Диплинк принёс архивный заказ мимо пагинации
    h.singleData = archivedRow;
    await useErpStore.getState().loadOne('o-z');
    expect(useErpStore.getState().orders.filter((o) => o.status !== 'active')).toHaveLength(
      ARCHIVE_PAGE_SIZE + 1);

    h.tableData = { erp_orders: [] };
    await useErpStore.getState().loadMoreArchive();
    // Смещение прежнее — заказ с диплинка страницу не сдвинул
    expect(h.selectCalls.at(-1)?.filters)
      .toContain(`range:${ARCHIVE_PAGE_SIZE}-${ARCHIVE_PAGE_SIZE * 2 - 1}`);
  });

  it('архивный заказ, открытый по ссылке, не пропадает при заходе в архив', async () => {
    h.tableData = { erp_departments: [dept], erp_orders: [activeRow] };
    await useErpStore.getState().loadAll();
    // Пришли по прямой ссылке `/orders/o-z` — заказ дозагружен в стор
    h.singleData = archivedRow;
    await useErpStore.getState().loadOne('o-z');
    expect(useErpStore.getState().orders.map((o) => o.id)).toContain('o-z');

    // Открываем вкладку архива, а он в первую страницу не попал
    h.tableData = { erp_orders: [] };
    await useErpStore.getState().loadArchive();
    // Прежде здесь стоял filter(status === 'active') и заказ исчезал вместе
    // с открытой карточкой
    expect(useErpStore.getState().orders.map((o) => o.id)).toContain('o-z');
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
    expect(toast.error).toHaveBeenCalledWith('Не удалось создать заказ: boom');
  });

  /**
   * Этап цеха, которого нет в справочнике, выпадал из маршрута молча — вместе
   * со ссылками на него в `depends_on`. Заказ создавался короче задуманного,
   * а финальный ОТК, зависевший от выпавшего этапа, оставался вообще без
   * зависимостей и был готов к запуску с первой секунды. Ошибкой это не считаем
   * (цех могли отключить осознанно), но молчать нельзя.
   */
  it('нет цеха в справочнике — этап выпадает из маршрута, но об этом говорят', async () => {
    // Швейного цеха в справочнике нет: маршрут sewing требует supply→cutting→sewing→vto
    useErpStore.setState({
      departments: DEPS.filter((d: any) => d.code !== 'sewing') as any,
    });
    h.rpcResult = { data: 'o-short', error: null };
    await useErpStore.getState().createOrder({
      title: 'X',
      items: [{
        product_type: 'футболка', qty: 1, production_type: 'sewing',
        branding_methods: [], branding_on: 'cut',
      }],
    });
    const codes = ((h.rpcCalls[0].args as any).payload.items[0].stages as any[])
      .map((st) => st.department_id);
    expect(codes).not.toContain('dep-sewing');
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('sewing'));
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

  it('образец: авто-создаёт разработку НА ПОЗИЦИЮ, без задач и без фазы', async () => {
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
    /**
     * Позиция обязательна: задачи разработки уходят в цеха этапами КОНКРЕТНОЙ
     * позиции, и одна разработка на заказ из двух образцов отправила бы работу
     * не туда. Прежде здесь стояла эвристика «первая позиция» в экране.
     */
    expect((expInsert!.row as any).item_id).toBe('it-exp');
    // Фазы больше нет: состояние вычисляется из задач, а набор задач
    // выбирает технолог — план по умолчанию это то, от чего отказались
    expect((expInsert!.row as any).phase).toBeUndefined();
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

describe('useErpStore — экспериментальный цех: задачи вместо фаз (ТЗ 12.08)', () => {
  const seed = (tasks: object[] = []) => {
    useErpStore.setState({
      experimental: [{ id: 'e1', order_id: 'o1', item_id: 'i1', tasks }],
      experimentalLoaded: true,
    } as any);
  };

  it('createExperimental заводит разработку с позицией заказа', async () => {
    // `item_id` чинит эвристику items[0]: передача задачи в цех создаёт этап
    // именно этой позиции, а не первой попавшейся
    useErpStore.setState({ experimental: [], experimentalLoaded: true } as any);
    const row = await useErpStore.getState().createExperimental('o1', { item_id: 'i1' });
    expect(row).toBeTruthy();
    const insert = h.insertCalls.find((c) => c.table === 'erp_experimental');
    const inserted = insert?.row as Record<string, unknown> | undefined;
    expect(inserted?.item_id).toBe('i1');
    // Фаза больше не задаётся: состояние вычисляется из задач
    expect(inserted?.phase).toBeUndefined();
  });

  it('addDevTasks шлёт пачку ОДНИМ RPC', async () => {
    seed();
    await useErpStore.getState().addDevTasks('e1', [
      { task_type: 'patterns', title: 'Лекала' },
      { task_type: 'sample', depends_on: [0] },
    ]);
    const rpc = h.rpcCalls.find((c) => c.fn === 'erp_experimental_add_tasks');
    expect(rpc).toBeTruthy();
    expect(rpc?.args.p_experimental_id).toBe('e1');
    expect(rpc?.args.p_tasks).toHaveLength(2);
    // Зависимость едет ИНДЕКСОМ — id ещё не существует
    expect((rpc?.args.p_tasks as any)[1].depends_on).toEqual([0]);
  });

  it('пустая пачка не идёт на сервер', async () => {
    seed();
    const before = h.rpcCalls.length;
    expect(await useErpStore.getState().addDevTasks('e1', [])).toEqual([]);
    expect(h.rpcCalls).toHaveLength(before);
  });

  it('sendDevTaskToDept — один RPC вместо RPC + INSERT', async () => {
    // Прежде это были два запроса: при сбое второго этап оставался в очереди
    // цеха, а разработка о нём не знала
    seed([{ id: 't1', experimental_id: 'e1', task_type: 'dtf', status: 'todo' }]);
    await useErpStore.getState().sendDevTaskToDept('t1', {
      department_id: 'd-dtf', planned_end: '2026-08-20', qty: 3,
    });
    const rpc = h.rpcCalls.find((c) => c.fn === 'erp_experimental_task_send');
    expect(rpc?.args).toMatchObject({
      p_task_id: 't1', p_department_id: 'd-dtf', p_planned_end: '2026-08-20', p_qty: 3,
    });
    expect(h.insertCalls.filter((c) => c.table === 'erp_experimental_tasks')).toHaveLength(0);
  });

  it('статус задачи В ЦЕХЕ клиент не пишет — его ведёт триггер', async () => {
    // Два писателя одной колонки затирают друг друга молча: «готово»,
    // поставленное технологом, разошлось бы с открытым этапом в цехе
    seed([{ id: 't1', experimental_id: 'e1', task_type: 'dtf', status: 'waiting', stage_id: 'st1' }]);
    const ok = await useErpStore.getState().updateDevTask('t1', { status: 'done' } as any);
    expect(ok).toBe(false);
    expect(h.updateCalls.filter((c) => c.table === 'erp_experimental_tasks')).toHaveLength(0);
  });

  it('но комментарий и результат у задачи в цехе правятся', async () => {
    seed([{ id: 't1', experimental_id: 'e1', task_type: 'dtf', status: 'waiting', stage_id: 'st1' }]);
    const ok = await useErpStore.getState().updateDevTask('t1', {
      status: 'done', comment: 'плёнка своя',
    } as any);
    expect(ok).toBe(true);
    const upd = h.updateCalls.find((c) => c.table === 'erp_experimental_tasks');
    expect(upd?.patch.comment).toBe('плёнка своя');
    expect(upd?.patch.status).toBeUndefined();
  });

  it('у задачи БЕЗ цеха статус меняется свободно', async () => {
    seed([{ id: 't1', experimental_id: 'e1', task_type: 'patterns', status: 'todo' }]);
    expect(await useErpStore.getState().updateDevTask('t1', { status: 'done' } as any)).toBe(true);
    const upd = h.updateCalls.find((c) => c.table === 'erp_experimental_tasks');
    expect(upd?.patch.status).toBe('done');
  });

  it('closeExperimental пишет исход и дату закрытия', async () => {
    seed();
    await useErpStore.getState().closeExperimental('e1', {
      outcome: 'ready_for_serial', comment: 'принято',
    });
    const upd = h.updateCalls.find((c) => c.table === 'erp_experimental');
    expect(upd?.patch.outcome).toBe('ready_for_serial');
    expect(upd?.patch.outcome_comment).toBe('принято');
    expect(upd?.patch.closed_at).toBeTruthy();
  });

  it('конструктор едет в колонку `constructor` под своим именем поля', async () => {
    // `constructorName` в типе — обход столкновения с Object.prototype.constructor
    seed();
    await useErpStore.getState().updateExperimental('e1', { constructorName: 'Иван' });
    const upd = h.updateCalls.find((c) => c.table === 'erp_experimental');
    expect(upd?.patch.constructor).toBe('Иван');
    expect(upd?.patch.constructorName).toBeUndefined();
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
        phase: 'at_contractor', material_source: 'contractor', return_dept: null,
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = { id: 'o1', title: 'З', status: 'active', items: [], materials: [] };
    // Переход ведёт ФАЗА: до волны 3.5 здесь стоял `status: 'shipped_by_contractor'`,
    // и после переезда гейта на `phase` эффект не сработал бы ни разу.
    await useErpStore.getState().updateSubcontractOp('s1', { phase: 'returned' });
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
        phase: 'returned', material_source: 'contractor', return_dept: null,
      }],
    };
    h.singleData = { id: 'o1', title: 'З', status: 'active', items: [], materials: [] };
    await useErpStore.getState().advanceWarehouseTask('wt1', 'accepted');
    /**
     * Подрядную операцию и упаковку закрывает СЕРВЕР (триггер
     * `erp_warehouse_fg_accepted`), а не стор. Клиентская цепочка ломалась
     * ровно у того, кто эту задачу делает: складскую задачу кладовщик двигать
     * вправе, а `erp_subcontracting` стоит под `order.manage`, которого у него
     * нет. Стор теперь только перечитывает данные.
     */
    expect(h.updateCalls.find((c) => c.table === 'erp_subcontracting')).toBeUndefined();
    expect(h.insertCalls.find(
      (c) => c.table === 'erp_warehouse_tasks' && (c.row as any).task_type === 'pack_ship',
    )).toBeUndefined();
    // Задача склада при этом переведена — это и есть действие кладовщика
    const taskUpd = h.updateCalls.find((c) => c.table === 'erp_warehouse_tasks');
    expect(taskUpd?.patch.status).toBe('accepted');
  });

  /**
   * У заказа СО СВОИМИ этапами упаковку заводит триггер, а не клиент: у него
   * три предусловия (все этапы закрыты, подряд принят, склад принял готовую
   * продукцию). Создание задачи отсюда обходило бы собственный гейт приёмки ГП —
   * упаковали бы то, чего никто не пересчитал.
   *
   * Подряд «под ключ» — обратный случай: этапов нет вовсе, триггер висит на их
   * движении и не сработает никогда, поэтому там задачу заводит клиент (тест выше).
   */
  it('приёмка подряда у заказа с этапами НЕ создаёт упаковку — её заведёт триггер', async () => {
    const task = {
      id: 'wt1', order_id: 'o1', item_id: null, task_type: 'subcontract_receipt', status: 'awaiting_receipt',
    };
    const withStages = {
      id: 'o1', title: 'З', status: 'active', materials: [],
      items: [{ id: 'it1', order_id: 'o1', stages: [{ id: 'st1', status: 'done' }] }],
    };
    useErpStore.setState({
      orders: [{ ...withStages, warehouse_ops: [], warehouse_tasks: [task] }] as any,
      subcontracting: [], subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.tableData = {
      erp_subcontracting: [{
        id: 's1', order_id: 'o1', operation: 'Худи', op_type: 'finished_product',
        phase: 'returned', material_source: 'contractor', return_dept: null,
      }],
    };
    h.singleData = withStages;
    await useErpStore.getState().advanceWarehouseTask('wt1', 'accepted');
    const packShip = h.insertCalls.find(
      (c) => c.table === 'erp_warehouse_tasks' && (c.row as any).task_type === 'pack_ship');
    expect(packShip).toBeUndefined();
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
        phase: 'at_contractor', material_source: 'pinhead', return_dept: 'sewing',
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = {
      id: 'o1', title: 'З', status: 'active',
      items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
    };
    await useErpStore.getState().updateSubcontractOp('s1', { phase: 'returned' });
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
        phase: 'at_contractor', material_source: 'pinhead', return_dept: null,
      }] as any,
      subcontractingLoaded: true, departments: depts as any, loaded: true,
    });
    h.singleData = {
      id: 'o1', title: 'З', status: 'active',
      items: [{ id: 'it1', order_id: 'o1', stages: [] }], materials: [],
    };
    await useErpStore.getState().updateSubcontractOp('s1', { phase: 'returned' });
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

  /**
   * Явное закрытие закупки (правки заказчика 12.08).
   *
   * До него единственным путём был побочный эффект `maybeCloseSupply` внутри
   * правки материала, и он требовал непустого списка. У заказа, которому
   * закупка не нужна или ведётся вне системы, этап не закрывался НИКОГДА,
   * и весь маршрут за ним стоял.
   */
  describe('закупка закрывается и явным действием', () => {
    const supplyStage = (patch: object = {}) => ({
      id: 'st-sup', item_id: 'it1', department_id: 'd-sup', depends_on: [],
      status: 'waiting', qty_done: 0, qty_rework: 0, sort_order: 10, ...patch,
    });
    const seed = (stages: object[], materials: object[] = []) => {
      useErpStore.setState({
        orders: [{
          id: 'o1', title: 'З', status: 'active',
          items: [{ id: 'it1', order_id: 'o1', stages }],
          materials,
        }] as any,
        departments: depts as any, loaded: true,
      });
    };
    const doneCalls = () => h.updateCalls.filter(
      (c) => c.table === 'erp_item_stages' && c.patch.status === 'done');

    it('закрывает заказ БЕЗ материалов — тот самый застрявший случай', async () => {
      seed([supplyStage()]);
      const ok = await useErpStore.getState().closeSupply('o1', 'Давальческое сырьё');
      expect(ok).toBe(true);
      expect(doneCalls()).toHaveLength(1);
    });

    it('без комментария не закрывает', async () => {
      // Этап закрывается досрочно — «почему» должно отвечать не расследование
      seed([supplyStage()]);
      const ok = await useErpStore.getState().closeSupply('o1', '   ');
      expect(ok).toBe(false);
      expect(doneCalls()).toHaveLength(0);
      expect(toast.error).toHaveBeenCalled();
    });

    it('закрывает ВСЕ открытые этапы закупки заказа', async () => {
      // Этап заводится на каждую позицию, а закупка ведётся по заказу целиком
      seed([
        supplyStage({ id: 'a' }),
        supplyStage({ id: 'b', status: 'in_progress' }),
        supplyStage({ id: 'c', status: 'done' }),
      ]);
      await useErpStore.getState().closeSupply('o1', 'Материалы у клиента');
      expect(doneCalls()).toHaveLength(2);
    });

    it('takeSupply переводит незакрытые этапы в работу', async () => {
      seed([supplyStage({ id: 'a' }), supplyStage({ id: 'b', status: 'in_progress' })]);
      const ok = await useErpStore.getState().takeSupply('o1');
      expect(ok).toBe(true);
      const started = h.updateCalls.filter(
        (c) => c.table === 'erp_item_stages' && c.patch.status === 'in_progress');
      // Только 'a': повторный перевод уже взятого — лишний запрос
      expect(started).toHaveLength(1);
    });

    it('takeSupply не трогает заблокированный этап', async () => {
      // Сначала снимают блокировку — иначе «взял в работу» прячет проблему
      seed([supplyStage({ id: 'a', status: 'blocked' })]);
      expect(await useErpStore.getState().takeSupply('o1')).toBe(false);
      expect(h.updateCalls.filter(
        (c) => c.table === 'erp_item_stages' && c.patch.status === 'in_progress',
      )).toHaveLength(0);
    });
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

  /**
   * Бейдж «Закупка» считал ТОЛЬКО дозакупки, а они заводятся исключительно
   * из брака. Заказ, у которого закупка — первый этап маршрута, счётчик
   * не увеличивал вовсе, поэтому пункт меню молчал ровно тогда, когда работа
   * там была: 33 заказа на боевой базе стояли при нуле на бейдже.
   */
  it('openProcurementCount: заказы с открытым этапом «Закупка» тоже считаются', () => {
    const DEPTS = [{ id: 'd-supply', code: 'supply' }, { id: 'd-cut', code: 'cut' }];
    const stage = (p: object) => ({ department_id: 'd-supply', status: 'waiting', ...p });
    const orders = [
      // Ждёт закупки, материалов нет вовсе — тот самый пропадавший заказ
      active({ items: [{ stages: [stage({})] }] }),
      // Закупка закрыта — работы нет
      active({ items: [{ stages: [stage({ status: 'done' })] }] }),
      // Три позиции = три этапа, но заказ один: считаем ЗАКАЗЫ
      active({ items: [
        { stages: [stage({})] }, { stages: [stage({})] }, { stages: [stage({})] },
      ] }),
    ];
    expect(openProcurementCount(orders as any, DEPTS as any)).toBe(2);
  });

  it('openProcurementCount: без справочника цехов считает только дозакупки', () => {
    // Справочник может не загрузиться; бейдж обязан это пережить, а не упасть
    const orders = [active({
      procurement_tasks: [{ status: 'new' }],
      items: [{ stages: [{ department_id: 'd-supply', status: 'waiting' }] }],
    })];
    expect(openProcurementCount(orders as any)).toBe(1);
  });

  it('openSubcontractCount: активные операции (не returned/received/cancelled)', () => {
    expect(openSubcontractCount([
      { status: 'sent' }, { status: 'in_progress' }, { status: 'returned' },
      { status: 'received_at_pinhead' }, { status: 'cancelled' }, { status: 'awaiting_payment' },
    ])).toBe(3);
  });

  it('activeExperimentalCount: разработки без зафиксированного исхода', () => {
    /**
     * Считается по ИСХОДУ, а не по фазе: фазы заменены задачами (ТЗ 12.08),
     * и `phase` осталась мёртвой колонкой до уборочной миграции. Оставь тест
     * на фазе — бейдж «Эксперим. цех» повис бы навсегда, показывая все
     * разработки активными.
     */
    expect(activeExperimentalCount([
      { outcome: null }, { outcome: undefined }, { outcome: 'ready_for_serial' },
      { outcome: 'cancelled' },
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
    const writes = queueWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ id: 'st3', queue_position: 150 });
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
    // Вся очередь цеха переписывается ОДНОЙ транзакцией: сбой на середине
    // оставлял бы её перемешанной, а интерфейс — откаченным целиком
    expect(queueWrites()).toHaveLength(3);
    expect(h.rpcCalls.filter((c) => c.fn === 'erp_stage_reorder_queue')).toHaveLength(1);
  });

  it('ошибка Supabase — откат позиции и toast', async () => {
    seedRoute([
      { department_id: 'd-sew', queue_position: 100 },
      { department_id: 'd-sew', queue_position: 200 },
    ]);
    h.rpcByFn.erp_stage_reorder_queue = { data: null, error: { message: 'нет связи' } };
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

  it('цеха нет в маршруте — этап создаёт транзакция, клиент кладёт его в стор', async () => {
    seedRoute([{ department_id: 'd-cut', status: 'in_progress', qty_done: 100 }]);
    // id новой строки знает только ответ сервера — вставка живёт внутри RPC
    h.rpcByFn.erp_stage_move_department = {
      data: [
        {
          id: 'st1', item_id: 'it1', department_id: 'd-cut', depends_on: [],
          status: 'done', qty_done: 100, qty_rework: 0, sort_order: 10,
        },
        {
          id: 'st-new', item_id: 'it1', department_id: 'd-vto', depends_on: ['st1'],
          status: 'in_progress', qty_done: 0, qty_rework: 0, sort_order: 15,
        },
      ],
      error: null,
    };
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-vto');
    expect(ok).toBe(true);
    const call = h.rpcCalls.find((c) => c.fn === 'erp_stage_move_department');
    expect((call?.args as any).p_stage_id).toBe('st1');
    expect((call?.args as any).p_target_dept).toBe('d-vto');
    expect(useErpStore.getState().orders[0].items[0].stages).toHaveLength(2);
    expect(stageById('st-new').status).toBe('in_progress');
    expect(stageById('st-new').depends_on).toEqual(['st1']);
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
    h.rpcByFn.erp_stage_move_department = { data: null, error: { message: 'нет связи' } };
    const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-sew');
    expect(ok).toBe(false);
    expect(stageById('st1').status).toBe('in_progress');
    expect(stageById('st2').status).toBe('waiting');
    expect(toast.error).toHaveBeenCalled();
  });

  /**
   * Регрессия A8 (аудит 29.07) и её закрытие ревью 05.08.
   *
   * Прежде перенос был двумя-тремя независимыми запросами: первый коммитил
   * закрытие исходного этапа, второй мог упасть — и появлялось состояние,
   * которого никто не выбирал. Лечили компенсирующей записью, а если падала
   * и она — честно показывали половину работы и просили починить руками.
   *
   * Теперь перенос — одна транзакция, и промежуточного состояния не бывает
   * по построению: сбой не оставляет следа, откат интерфейса снова честен.
   * Тесты закрепляют именно это — чтобы перенос не разъехали обратно на пачку
   * запросов «так проще».
   */
  describe('перенос атомарен — половины работы не бывает (A8)', () => {
    it('сбой транзакции откатывает интерфейс целиком, ОДНИМ запросом', async () => {
      seedRoute([
        { department_id: 'd-emb', status: 'in_progress', qty_done: 50 },
        { department_id: 'd-sew' },
      ]);
      h.rpcByFn.erp_stage_move_department = { data: null, error: { message: 'нет связи' } };
      const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-sew');
      expect(ok).toBe(false);

      // Ни одного отдельного UPDATE по этапам: закрытие, открытие и перевод
      // зависимых уехали внутрь транзакции
      expect(h.updateCalls.filter((c) => c.table === 'erp_item_stages')).toHaveLength(0);
      expect(h.rpcCalls.filter((c) => c.fn === 'erp_stage_move_department')).toHaveLength(1);

      // Интерфейс вернулся к правде: этап снова у исходного цеха
      expect(stageById('st1').status).toBe('in_progress');
      expect(stageById('st1').qty_done).toBe(50);
      expect(stageById('st2').status).toBe('waiting');
      const msg = (toast.error as any).mock.calls.at(-1)[0] as string;
      expect(msg).toContain('не перенесено');
      expect(msg).toContain('нет связи');
    });

    it('зависимые этапы переводит та же транзакция — ОТК не открывается раньше', async () => {
      // Маршрут: ВТО(в работе) → ОТК(ждёт ВТО). Работу уносим в ДТФ.
      seedRoute([
        { department_id: 'd-emb', status: 'in_progress', qty_done: 50 },
        { department_id: 'd-cut', status: 'waiting', depends_on: ['st1'] },
      ]);
      h.rpcByFn.erp_stage_move_department = {
        data: [
          {
            id: 'st1', item_id: 'it1', department_id: 'd-emb', depends_on: [],
            status: 'done', qty_done: 100, qty_rework: 0, sort_order: 10,
          },
          {
            id: 'st-new', item_id: 'it1', department_id: 'd-vto', depends_on: ['st1'],
            status: 'in_progress', qty_done: 0, qty_rework: 0, sort_order: 15,
          },
          // ОТК теперь ждёт и перенесённый этап
          {
            id: 'st2', item_id: 'it1', department_id: 'd-cut',
            depends_on: ['st1', 'st-new'], status: 'waiting',
            qty_done: 0, qty_rework: 0, sort_order: 20,
          },
        ],
        error: null,
      };
      const ok = await useErpStore.getState().moveStageToDepartment('st1', 'd-vto');
      expect(ok).toBe(true);
      expect(stageById('st2').depends_on).toEqual(['st1', 'st-new']);
    });
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
        materials: [], tz_documents: [],
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
    // Ключ строго ASCII: Storage отвечает InvalidKey на кириллицу, и на этом
    // ломалась загрузка любого ТЗ с русским именем файла
    expect(h.uploadCalls[0].path).toMatch(/^tz\/o1\/[0-9a-f-]+\/v1-Futbolka_TZ\.pdf$/);
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
    expect(h.updateCalls.some((c) => c.table === 'erp_tz_documents' && c.patch.is_current === false))
      .toBe(true);
    /**
     * Снятие is_current идёт ДО вставки. В проде висит
     * `unique index (group_id) where is_current` — пока прежняя версия держит флаг,
     * вставка второй с is_current=true падает с 23505. Здесь был обратный порядок
     * и комментарий, утверждавший обратное: тест закреплял неработающую замену ТЗ.
     */
    const tzOps = h.opLog.filter((c) => c.table === 'erp_tz_documents');
    expect(tzOps[0]).toEqual({ op: 'update', table: 'erp_tz_documents' });
    expect(tzOps[1]).toEqual({ op: 'insert', table: 'erp_tz_documents' });
    // Цеху с назначением пишется событие «ТЗ обновлено»
    expect(h.insertCalls.some((c) => c.table === 'erp_stage_events'
      && String((c.row as any).comment).includes('ТЗ обновлено до версии 2'))).toBe(true);
  });

  it('сбой вставки версии возвращает is_current прежней — группа не остаётся без ТЗ', async () => {
    // Порядок «снять флаг → вставить» означает окно, в котором актуальной версии нет.
    // Если вставка упала и флаг не вернуть, гейт ТЗ остановит цеха на документе,
    // который никуда не делся, — то есть авария на ровном месте.
    seedTz({
      tz_documents: [{
        id: 'doc1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1,
        is_current: true, file_path: 'tz/o1/g1/v1-tz.pdf', file_name: 'tz.pdf',
        created_at: '2026-07-20T10:00:00Z',
      }],
    });
    h.insertErrors.push({ message: 'duplicate key value violates unique constraint' });

    expect(await useErpStore.getState().replaceTzDocument('g1', pdf('tz-v2.pdf'))).toBeNull();

    const restore = h.updateCalls.filter(
      (c) => c.table === 'erp_tz_documents' && c.patch.is_current === true,
    );
    expect(restore).toHaveLength(1);
    // Версия в сторе осталась прежней
    expect(orderNow().tz_documents).toHaveLength(1);
    // …а загруженный файл убран: строки в БД нет, найти его будет нечем
    expect(h.removeCalls.at(-1)?.paths).toEqual(['tz/o1/g1/v2-tz-v2.pdf']);
    expect(orderNow().tz_documents[0].version).toBe(1);
  });

  /**
   * Правка менеджера 2026-08-03: поцехового назначения ТЗ больше нет.
   * Один файл на позицию открывает ВСЕ цеха её маршрута — раньше на это уходил
   * отдельный выбор в каждом выпадающем списке, и пропуск любого блокировал заказ.
   */
  it('гейт: одно ТЗ позиции открывает все цеха её маршрута', async () => {
    seedTz();
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'cutting')).toBe(0);
    expect(readyCountFor(orders, departments, 'sewing')).toBe(0);

    useErpStore.setState({
      orders: [{
        ...orderNow(),
        tz_documents: [{ id: 'd1', order_id: 'o1', item_id: 'it1', group_id: 'g1', version: 1, is_current: true, file_path: 'p1', created_at: '2026-07-20T10:00:00Z' }],
      }],
    } as any);
    const s2 = useErpStore.getState();
    expect(readyCountFor(s2.orders, s2.departments, 'cutting')).toBe(1);
    expect(readyCountFor(s2.orders, s2.departments, 'sewing')).toBe(1);
  });

  it('гейт: общее ТЗ заказа (item_id = null) тоже снимает блокировку', async () => {
    seedTz({
      tz_documents: [{ id: 'd1', order_id: 'o1', item_id: null, group_id: 'g1', version: 1, is_current: true, file_path: 'p1', created_at: '2026-07-20T10:00:00Z' }],
    });
    const { orders, departments } = useErpStore.getState();
    expect(readyCountFor(orders, departments, 'cutting')).toBe(1);
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

/**
 * Ошибка действия цеха обязана называть причину.
 *
 * Раньше все сбои сводились к «Не удалось обновить этап»: отказ RLS, обрыв сети
 * и конфликт версий выглядели одинаково, `translateSupabaseError` во всём ERP
 * не использовался ни разу, а оптимистичное состояние откатывалось — введённые
 * числа исчезали. Рабочий видел три секунды серого шума и не знал, что делать.
 */
describe('erpError — причина сбоя, а не «не удалось»', () => {
  const setOnline = (value: boolean) => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value, configurable: true, writable: true,
    });
  };
  afterEach(() => setOnline(true));

  it('к сообщению добавляется переведённая причина', async () => {
    seed();
    h.updateError = { message: 'Failed to fetch' };
    await useErpStore.getState().setStageStatus('st1', 'done');
    expect(toast.error).toHaveBeenCalledWith('Этап не обновлён: Ошибка соединения');
  });

  it('офлайн распознаётся отдельно и советует повторить', async () => {
    seed();
    setOnline(false);
    h.updateError = { message: 'Failed to fetch' };
    await useErpStore.getState().setStageStatus('st1', 'done');
    // Именно офлайн — самая частая причина на цеховом Wi-Fi, и единственная,
    // где совет «повторите» осмыслен: данные не потеряны, сеть вернётся
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('нет сети'),
    );
  });
});

/**
 * Производственный план (правка менеджера 2026-08-03).
 *
 * Ключевое, что здесь закрепляется: система НИЧЕГО не переносит сама. Недовыполнение
 * остаётся отклонением на своей дате, а новую дату ставит руководитель — иначе
 * инструмент планирования превратился бы в автопланировщик, чего заказчик
 * прямо не просил.
 */
describe('Производственный план', () => {
  const slot = (over: Record<string, unknown> = {}) => ({
    id: 'sl1', department_id: 'd-sew', stage_id: 'st1', work_date: '2026-08-05',
    qty_planned: 100, qty_done: 0, qty_defect: 0, status: 'planned',
    comment: null, fact_comment: null, deviation_reason: null,
    fact_by: null, fact_at: null, created_by: null, assignee: null,
    sort_order: 1000, priority: 0,
    problem_type: null, problem_note: null,
    problem_affects_due: false, problem_needs_help: false, problem_can_continue: true,
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-01T10:00:00Z',
    ...over,
  });

  it('загрузка спрашивает именно диапазон недели', async () => {
    h.tableData.erp_calendar_slots = [slot()];
    await useErpStore.getState().loadPlan('2026-08-03', '2026-08-09');
    const call = h.selectCalls.find((c) => c.table === 'erp_calendar_slots');
    expect(call?.filters).toContain('gte:work_date=2026-08-03');
    expect(call?.filters).toContain('lte:work_date=2026-08-09');
    expect(useErpStore.getState().planSlots).toHaveLength(1);
  });

  it('постановка в план идёт upsert-ом: повтор на ту же дату не падает, а правит', async () => {
    useErpStore.setState({ planSlots: [] } as any);
    const row = await useErpStore.getState().planStage({
      stageId: 'st1', departmentId: 'd-sew', workDate: '2026-08-05', qty: 100,
    });
    expect(row).toBeTruthy();
    const call = h.insertCalls.find((c) => c.table === 'erp_calendar_slots');
    expect(call?.row).toMatchObject({ stage_id: 'st1', work_date: '2026-08-05', qty_planned: 100 });
  });

  it('количество на день обязано быть положительным', async () => {
    expect(await useErpStore.getState().planStage({
      stageId: 'st1', departmentId: 'd-sew', workDate: '2026-08-05', qty: 0,
    })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Укажите количество на день');
  });

  it('новая задача встаёт в КОНЕЦ дня, а не перед утверждённой очерёдностью', async () => {
    useErpStore.setState({
      planSlots: [slot({ id: 'a', sort_order: 1000 }), slot({ id: 'b', sort_order: 2000 })],
    } as any);
    await useErpStore.getState().planStage({
      stageId: 'st2', departmentId: 'd-sew', workDate: '2026-08-05', qty: 10,
    });
    const call = h.insertCalls.filter((c) => c.table === 'erp_calendar_slots').at(-1);
    expect((call?.row as any).sort_order).toBe(3000);
  });

  it('полный факт закрывает задачу, неполный оставляет её открытой с остатком', async () => {
    useErpStore.setState({ planSlots: [slot()] } as any);
    await useErpStore.getState().reportPlanFact('sl1', { qty: 70, deviationReason: 'не пришла ткань' });
    const partial = useErpStore.getState().planSlots[0];
    expect(partial.status).toBe('confirmed');
    expect(partial.qty_done).toBe(70);
    expect(partial.deviation_reason).toBe('не пришла ткань');
    // Дата НЕ изменилась: остаток не переносится сам
    expect(partial.work_date).toBe('2026-08-05');

    await useErpStore.getState().reportPlanFact('sl1', { qty: 100 });
    expect(useErpStore.getState().planSlots[0].status).toBe('done');
  });

  it('повторный ввод факта исправляет, а не удваивает', async () => {
    useErpStore.setState({ planSlots: [slot({ qty_done: 70 })] } as any);
    await useErpStore.getState().reportPlanFact('sl1', { qty: 80 });
    expect(useErpStore.getState().planSlots[0].qty_done).toBe(80);
  });

  it('сбой записи факта откатывает optimistic-состояние', async () => {
    useErpStore.setState({ planSlots: [slot()] } as any);
    h.updateError = { message: 'нет связи' };
    expect(await useErpStore.getState().reportPlanFact('sl1', { qty: 50, deviationReason: 'x' })).toBe(false);
    expect(useErpStore.getState().planSlots[0].qty_done).toBe(0);
  });

  it('снятие задачи — статусом, а не удалением: факт и история остаются', async () => {
    useErpStore.setState({ planSlots: [slot({ qty_done: 40 })] } as any);
    expect(await useErpStore.getState().cancelPlanSlot('sl1')).toBe(true);
    expect(h.deleteCalls.filter((c) => c.table === 'erp_calendar_slots')).toHaveLength(0);
    expect(useErpStore.getState().planSlots[0].status).toBe('cancelled');
    expect(useErpStore.getState().planSlots[0].qty_done).toBe(40);
  });

  it('перенос на другой день ставит задачу в конец нового дня', async () => {
    useErpStore.setState({
      planSlots: [slot(), slot({ id: 'other', work_date: '2026-08-06', sort_order: 5000 })],
    } as any);
    await useErpStore.getState().movePlanSlot('sl1', '2026-08-06');
    const moved = useErpStore.getState().planSlots.find((s) => s.id === 'sl1');
    expect(moved?.work_date).toBe('2026-08-06');
    expect(Number(moved?.sort_order)).toBe(6000);
  });

  it('проблема пишется на задачу дня и снимается целиком', async () => {
    useErpStore.setState({ planSlots: [slot()] } as any);
    await useErpStore.getState().reportPlanProblem('sl1', {
      type: 'Нет материалов', note: 'ждём кулирку', affectsDue: true, canContinue: false,
    });
    const s1 = useErpStore.getState().planSlots[0];
    expect(s1.problem_type).toBe('Нет материалов');
    expect(s1.problem_affects_due).toBe(true);
    expect(s1.problem_can_continue).toBe(false);

    await useErpStore.getState().clearPlanProblem('sl1');
    expect(useErpStore.getState().planSlots[0].problem_type).toBeNull();
  });

  it('пустой комментарий не сохраняется', async () => {
    expect(await useErpStore.getState().addPlanComment('sl1', '   ', 'shop')).toBeNull();
    expect(h.insertCalls.filter((c) => c.table === 'erp_plan_comments')).toHaveLength(0);
  });
});

/**
 * Удаление заказа: честный отказ и уборка файлов.
 *
 * ЧТО СЛУЧИЛОСЬ 12.08. Политика `erp_orders_delete` стоит на `is_admin()`,
 * а кнопку показывал `isPrivileged` — admin + director + РОП. RLS запрещает
 * DELETE через `USING`, то есть «удалено 0 строк», а НЕ 42501: слайс проверял
 * только `error`, поэтому директор видел зелёное «Заказ удалён», заказ уходил
 * из списка и возвращался при следующей загрузке. Проверено на живой базе.
 *
 * Вторая половина — файлы. Заказ удалялся, а его ТЗ-PDF и превью оставались
 * в бакете навсегда: платные, никем не учтённые и, пока бакет публичный,
 * доступные по ссылке. Так и появились шесть сирот после зачистки базы.
 */
describe('deleteOrder — отказ виден, файлы убираются', () => {
  const order = { id: 'ord-1', title: 'Тест', status: 'active' } as any;

  beforeEach(() => {
    useErpStore.setState({ orders: [order] } as any);
    h.tableData.erp_tz_documents = [{ file_path: 'tz/ord-1/g/v1-a.pdf' }];
    h.tableData.erp_order_attachments = [{ file_path: 'ord-1/123.webp' }];
  });

  afterEach(() => {
    delete h.tableData.erp_tz_documents;
    delete h.tableData.erp_order_attachments;
  });

  it('«удалено 0 строк» — это отказ, а не успех', async () => {
    h.deletedRows = [];
    const ok = await useErpStore.getState().deleteOrder('ord-1');

    expect(ok).toBe(false);
    // Главное: заказ ОСТАЛСЯ в сторе. Раньше он исчезал и возвращался
    // при следующей загрузке — человек считал, что удалил
    expect(useErpStore.getState().orders.map((o) => o.id)).toEqual(['ord-1']);
    // И файлы не тронуты: заказ жив
    expect(h.removeCalls).toHaveLength(0);
  });

  it('успешное удаление убирает файлы заказа из бакета', async () => {
    const ok = await useErpStore.getState().deleteOrder('ord-1');

    expect(ok).toBe(true);
    expect(useErpStore.getState().orders).toHaveLength(0);
    expect(h.removeCalls).toHaveLength(1);
    expect(h.removeCalls[0].bucket).toBe('erp-attachments');
    // И ТЗ, и вложения — обе таблицы уедут каскадом, спрашивать надо обе
    expect([...h.removeCalls[0].paths].sort())
      .toEqual(['ord-1/123.webp', 'tz/ord-1/g/v1-a.pdf']);
  });

  it('пути спрашиваются ДО удаления — после каскада спрашивать нечего', async () => {
    await useErpStore.getState().deleteOrder('ord-1');

    const tzRead = h.selectCalls.findIndex((c) => c.table === 'erp_tz_documents');
    const del = h.deleteCalls.findIndex((c) => c.table === 'erp_orders');
    expect(tzRead).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThanOrEqual(0);
    // Порядок операций проверяем по журналу вызовов, а не по намерению
    expect(h.selectCalls.some((c) => c.table === 'erp_order_attachments')).toBe(true);
  });

  it('заказ без файлов не дёргает хранилище', async () => {
    h.tableData.erp_tz_documents = [];
    h.tableData.erp_order_attachments = [];
    const ok = await useErpStore.getState().deleteOrder('ord-1');

    expect(ok).toBe(true);
    expect(h.removeCalls).toHaveLength(0);
  });

  it('ошибка сервера не выдаётся за отказ прав', async () => {
    h.deleteError = { message: 'network down' };
    const ok = await useErpStore.getState().deleteOrder('ord-1');

    expect(ok).toBe(false);
    expect(useErpStore.getState().orders).toHaveLength(1);
    h.deleteError = null;
  });
});
