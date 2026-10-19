import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * СТОР БИЗНЕС-ЗАДАЧ (правки 19.10, п. 7).
 *
 * Клиент задачи только читает; пишут RPC. Отсюда три правила, и каждое ломается
 * тихо:
 *   · двойной клик «Создать задачу» — один вызов и одна строка (`client_key`);
 *   · ответ писателя кладётся ЦЕЛИКОМ (в нём новый `updated_at` — без него
 *     следующая правка получит ложный «Задача изменена»), без оптимистики;
 *   · отказ — `toast.error` и `null`, состояние не трогается.
 */

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
  gate: null as null | Promise<void>,
}));

vi.mock('../../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const query = (table: string): any => {
    const log = (op: string, args: unknown[]) => h.calls.push({ table, op, args });
    const q: any = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit']) {
      q[op] = (...args: unknown[]) => { log(op, args); return q; };
    }
    q.then = (res: any, rej: any) => Promise.resolve({ data: h.tables[table] ?? [], error: null }).then(res, rej);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: async (...args: unknown[]) => {
        h.calls.push({ table: 'rpc', op: String(args[0]), args });
        if (h.gate) await h.gate;
        return h.rpc[String(args[0])] ?? { data: null, error: null };
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: async () => 'ok',
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

const toastError = vi.hoisted(() => vi.fn());
vi.mock('../../../store/useToastStore', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

const { useErpStore, resetErpStore } = await import('../useErpStore');
const { attachDomainSlices } = await import('../domainSlices');
const { useAuthStore } = await import('../../../store/useAuthStore');
attachDomainSlices();

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  order_id: 'o1',
  title: 'Заказать молнии',
  kind: 'purchase',
  description: null,
  assignee_id: 'u2',
  creator_id: 'u1',
  due_at: '2026-10-20T15:00:00.000Z',
  status: 'new',
  review_required: false,
  pause_reason: null,
  cancel_reason: null,
  return_reason: null,
  result_text: null,
  result_message_id: null,
  submitted_at: null,
  reviewed_at: null,
  completed_at: null,
  cancelled_at: null,
  client_key: 'k1',
  created_at: '2026-10-19T09:00:00.000Z',
  updated_at: '2026-10-19T09:00:00.000Z',
  ...over,
});

const rpcCalls = (fn: string) => h.calls.filter((c) => c.table === 'rpc' && c.op === fn);

beforeEach(() => {
  resetErpStore();
  h.tables = {};
  h.rpc = {};
  h.calls = [];
  h.gate = null;
  toastError.mockClear();
  useAuthStore.setState({ user: { id: 'u1', name: 'Мария', email: 'm@x', role: 'manager' } } as never);
});

describe('создание', () => {
  it('createBizTask передаёт clientKey, повтор не дублирует', async () => {
    h.rpc.erp_biz_task_create = { data: ROW(), error: null };
    let open!: () => void;
    h.gate = new Promise((r) => { open = r; });
    const input = {
      order_id: 'o1', title: 'Заказать молнии', kind: 'purchase' as const,
      assignee_id: 'u2', due_at: '2026-10-20T15:00:00.000Z', watchers: ['u3'],
    };

    // Двойной клик: второй вызов идёт, пока первый не вернулся
    const a = useErpStore.getState().createBizTask(input, 'k1');
    const b = useErpStore.getState().createBizTask(input, 'k1');
    open();
    const [ra, rb] = await Promise.all([a, b]);

    expect(rpcCalls('erp_biz_task_create')).toHaveLength(1);
    expect(rpcCalls('erp_biz_task_create')[0].args[1]).toEqual({ p_task: input, p_client_key: 'k1' });
    expect(ra?.id).toBe('t1');
    expect(rb?.id).toBe('t1');

    // Повтор после ответа (оборванная сеть): сервер вернул ту же строку — в сторе одна
    h.gate = null;
    await useErpStore.getState().createBizTask(input, 'k1');
    expect(Object.keys(useErpStore.getState().bizTasks)).toEqual(['t1']);
    expect(useErpStore.getState().bizTasks.t1.watchers).toEqual(['u3']);
  });

  it('отказ — toast.error и null, в сторе пусто', async () => {
    h.rpc.erp_biz_task_create = { data: null, error: { message: 'Заказ закрыт — новые задачи к нему не ставятся' } };
    const r = await useErpStore.getState().createBizTask(
      { order_id: 'o1', title: 'x', kind: 'other', assignee_id: 'u2', due_at: '2026-10-20T15:00:00.000Z' }, 'k2',
    );
    expect(r).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(useErpStore.getState().bizTasks).toEqual({});
  });
});

describe('переходы и правки', () => {
  it('переход шлёт известную версию и кладёт ответ целиком', async () => {
    useErpStore.setState({ bizTasks: { t1: { ...ROW(), watchers: ['u3'], order: null } as never } });
    h.rpc.erp_biz_task_transition = {
      data: ROW({ status: 'in_progress', updated_at: '2026-10-19T10:00:00.000Z' }), error: null,
    };
    const r = await useErpStore.getState().bizTaskTransition('t1', 'start', null);
    expect(rpcCalls('erp_biz_task_transition')[0].args[1]).toEqual({
      p_id: 't1', p_action: 'start', p_text: null, p_expected_updated_at: '2026-10-19T09:00:00.000Z',
    });
    const t = useErpStore.getState().bizTasks.t1;
    expect(r?.status).toBe('in_progress');
    expect(t.status).toBe('in_progress');
    expect(t.updated_at).toBe('2026-10-19T10:00:00.000Z');
    // Наблюдатели в ответе писателя не приходят — и не теряются
    expect(t.watchers).toEqual(['u3']);
  });

  it('отказ перехода — статус на экране прежний (без оптимистики)', async () => {
    useErpStore.setState({ bizTasks: { t1: { ...ROW(), watchers: [], order: null } as never } });
    h.rpc.erp_biz_task_transition = { data: null, error: { message: 'Это действие — для ответственного' } };
    const r = await useErpStore.getState().bizTaskTransition('t1', 'start', null);
    expect(r).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(useErpStore.getState().bizTasks.t1.status).toBe('new');
  });

  it('незагруженную задачу не трогаем — версии нет', async () => {
    const r = await useErpStore.getState().updateBizTask('t9', { title: 'x' });
    expect(r).toBeNull();
    expect(rpcCalls('erp_biz_task_update')).toHaveLength(0);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('смена наблюдателей перечитывает участников с сервера', async () => {
    useErpStore.setState({ bizTasks: { t1: { ...ROW(), watchers: ['u3'], order: null } as never } });
    h.rpc.erp_biz_task_update = { data: ROW({ updated_at: '2026-10-19T11:00:00.000Z' }), error: null };
    h.tables.erp_biz_tasks = [{ ...ROW({ updated_at: '2026-10-19T11:00:00.000Z' }), watchers: [{ user_id: 'u4' }], order: null }];
    await useErpStore.getState().updateBizTask('t1', { watchers: ['u4'] });
    expect(rpcCalls('erp_biz_task_update')[0].args[1]).toEqual({
      p_id: 't1', p_patch: { watchers: ['u4'] }, p_expected_updated_at: '2026-10-19T09:00:00.000Z',
    });
    expect(useErpStore.getState().bizTasks.t1.watchers).toEqual(['u4']);
  });
});

describe('чтение', () => {
  it('«Мне» — по ответственному, с непрочитанным', async () => {
    h.tables.erp_biz_tasks = [{ ...ROW(), watchers: [{ user_id: 'u3' }], order: { id: 'o1', bitrix_id: 'PH-1234', title: 'Худи' } }];
    h.rpc.erp_chat_unread_tasks = { data: [{ task_id: 't1', unread: 2 }], error: null };
    const rows = await useErpStore.getState().loadBizTasks({ scope: 'assignee', statuses: ['new', 'in_progress'] });
    expect(rows?.map((r) => r.id)).toEqual(['t1']);
    expect(h.calls).toContainEqual({ table: 'erp_biz_tasks', op: 'eq', args: ['assignee_id', 'u1'] });
    expect(h.calls).toContainEqual({ table: 'erp_biz_tasks', op: 'in', args: ['status', ['new', 'in_progress']] });
    const s = useErpStore.getState();
    expect(s.bizTasks.t1.watchers).toEqual(['u3']);
    expect(s.bizTasks.t1.order?.bitrix_id).toBe('PH-1234');
    expect(s.bizTaskUnread.t1).toBe(2);
  });

  it('«Наблюдаю» — через свои строки наблюдателя; пусто — без второго запроса', async () => {
    h.tables.erp_biz_task_watchers = [];
    const rows = await useErpStore.getState().loadBizTasks({ scope: 'watcher' });
    expect(rows).toEqual([]);
    expect(h.calls).toContainEqual({ table: 'erp_biz_task_watchers', op: 'eq', args: ['user_id', 'u1'] });
    expect(h.calls.some((c) => c.table === 'erp_biz_tasks')).toBe(false);
  });

  it('карточка — участники, чек-лист, история и файлы задачи', async () => {
    h.tables.erp_biz_tasks = [{ ...ROW(), watchers: [{ user_id: 'u3' }], order: null }];
    h.tables.erp_biz_task_checklist = [{ id: 'c1', task_id: 't1', text: 'Позвонить', done: false, sort: 0, done_by: null, done_at: null }];
    h.tables.erp_biz_task_events = [{ id: 1, task_id: 't1', kind: 'created', actor: 'u1', payload: {}, due_at: null, at: '2026-10-19T09:00:00Z' }];
    h.tables.erp_order_attachments = [];
    const d = await useErpStore.getState().loadBizTask('t1');
    expect(d?.checklist.map((c) => c.id)).toEqual(['c1']);
    expect(d?.events.map((e) => e.kind)).toEqual(['created']);
    expect(h.calls).toContainEqual({ table: 'erp_order_attachments', op: 'eq', args: ['biz_task_id', 't1'] });
    expect(useErpStore.getState().bizTaskDetails.t1.watchers).toEqual(['u3']);
  });
});

describe('звонок realtime', () => {
  it('события задачи и её истории — один звонок на серию, отдельно от чата', async () => {
    vi.useFakeTimers();
    try {
      const ev = (table: string) => ({ table, eventType: 'INSERT' as const, new: { id: 'x' }, old: null });
      useErpStore.getState().applyRealtimeEvent(ev('erp_biz_tasks'));
      useErpStore.getState().applyRealtimeEvent(ev('erp_biz_task_events'));
      // Сообщение чата в той же серии не глушит звонок задачи (и наоборот)
      useErpStore.getState().applyRealtimeEvent(ev('erp_chat_messages'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(useErpStore.getState().bizTaskPing).toBe(1);
      expect(useErpStore.getState().chatPing).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
