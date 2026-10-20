import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ЧАТ: ЯКОРЬ «СДЕЛКА ИЛИ ЗАДАЧА» (правки 19.10, п. 7, Task 8).
 *
 * Тред бизнес-задачи — тред существующего чата с якорем `task_id`
 * и `order_id = null`. Ломается тихо в двух местах:
 *   · лента задачи уходит с `p_order_id` — сервер отвечает 22023, а в сторе
 *     смешиваются сделка и задача (счётчик сделки гаснет от чтения задачи);
 *   · счётчик списка задач «отмечает прочитанным» — тогда открытие раздела
 *     обнуляло бы непрочитанное, которого человек не видел.
 */

const h = vi.hoisted(() => ({
  rpc: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return h.rpc[fn] ?? { data: null, error: null };
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => 'ok',
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('../../../store/useToastStore', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

const { useErpStore, resetErpStore } = await import('../useErpStore');
const { attachDomainSlices } = await import('../domainSlices');
const { useAuthStore } = await import('../../../store/useAuthStore');
attachDomainSlices();

const MSG = (id: string, author: string, at: string) => ({
  id, thread_id: 'thr-task', author_id: author, body: id, item_id: null, stage_id: null,
  experimental_id: null, reply_to: null, created_at: at, mentions: [], attachments: [], reply: null,
});

const calls = (fn: string) => h.calls.filter((c) => c.fn === fn);

beforeEach(() => {
  resetErpStore();
  h.rpc = {};
  h.calls = [];
  toastError.mockClear();
  useAuthStore.setState({ user: { id: 'u1', name: 'Мария', email: 'm@x', role: 'manager' } } as never);
});

describe('чат: тред задачи', () => {
  it('тред задачи не смешивается с чатом сделки и его счётчиком', async () => {
    useErpStore.setState({
      chatUnread: { o1: { total: 5, byStage: {} } },
      bizTaskUnread: { t1: 1 },
    });
    h.rpc.erp_chat_page = {
      data: {
        messages: [
          MSG('m1', 'u2', '2026-10-20T09:00:00Z'),
          MSG('m2', 'u1', '2026-10-20T09:01:00Z'),
          MSG('m3', 'u2', '2026-10-20T09:02:00Z'),
        ],
        has_more: false,
      },
      error: null,
    };

    await useErpStore.getState().openChat(null, {}, 't1');

    const page = calls('erp_chat_page')[0].args;
    expect(page.p_task_id).toBe('t1');
    expect(page.p_order_id).toBeNull();
    const s = useErpStore.getState();
    expect(s.chatTaskId).toBe('t1');
    expect(s.chatOrderId).toBeNull();
    // Граница — по счётчику ЗАДАЧИ (1 чужое), а не по счётчику сделки (5)
    expect(s.chatUnreadAnchor).toBe('m3');
    expect(s.chatMessages).toHaveLength(3);

    h.rpc.erp_chat_send = { data: { message_id: 'm4', mentioned: [] }, error: null };
    await useErpStore.getState().sendChatMessage({
      taskId: 't1', body: 'Забрал ткань', clientKey: 'k1', context: { stageId: 's9' },
    });
    const sent = calls('erp_chat_send')[0].args;
    expect(sent.p_task_id).toBe('t1');
    expect(sent.p_order_id).toBeNull();
    // Контекст сделки в тред задачи не уходит: этап задачи сервер сверит с её заказом
    expect(sent.p_stage_id).toBeNull();
    // Своя лента перечитывается — по задаче
    expect(calls('erp_chat_page').at(-1)?.args.p_task_id).toBe('t1');

    // Счётчик сделки не тронут ни открытием, ни отправкой
    expect(useErpStore.getState().chatUnread.o1.total).toBe(5);
    expect(calls('erp_chat_mark_read')).toHaveLength(0);
  });

  it('поздний ответ ленты сделки не затирает открытый тред задачи', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.rpc.erp_chat_page = { data: { messages: [MSG('d1', 'u2', '2026-10-20T09:00:00Z')], has_more: false }, error: null };
    const supabase = (await import('../../../lib/supabase')).supabase as unknown as {
      rpc: (fn: string, a: Record<string, unknown>) => Promise<unknown>;
    };
    const original = supabase.rpc;
    supabase.rpc = async (fn, a) => {
      if (a.p_order_id === 'o1') await gate;
      return original(fn, a);
    };
    try {
      const deal = useErpStore.getState().openChat('o1', {});
      h.rpc.erp_chat_page = { data: { messages: [MSG('t-1', 'u2', '2026-10-20T10:00:00Z')], has_more: false }, error: null };
      await useErpStore.getState().openChat(null, {}, 't1');
      h.rpc.erp_chat_page = { data: { messages: [MSG('d1', 'u2', '2026-10-20T09:00:00Z')], has_more: false }, error: null };
      release();
      await deal;
    } finally {
      supabase.rpc = original;
    }
    expect(useErpStore.getState().chatMessages.map((m) => m.id)).toEqual(['t-1']);
    expect(useErpStore.getState().chatTaskId).toBe('t1');
  });

  it('открытие списка задач не отмечает диалог прочитанным', async () => {
    h.rpc.erp_chat_unread_tasks = { data: [{ task_id: 't1', unread: 2 }], error: null };

    await useErpStore.getState().loadChatUnreadTasks(['t1', 't2']);

    expect(calls('erp_chat_unread_tasks')[0].args).toEqual({ p_task_ids: ['t1', 't2'] });
    expect(useErpStore.getState().bizTaskUnread).toEqual({ t1: 2, t2: 0 });
    expect(calls('erp_chat_mark_seen')).toHaveLength(0);
    expect(calls('erp_chat_mark_read')).toHaveLength(0);
  });

  it('закрытие снимает якорь задачи', async () => {
    h.rpc.erp_chat_page = { data: { messages: [], has_more: false }, error: null };
    await useErpStore.getState().openChat(null, {}, 't1');
    useErpStore.getState().closeChat();
    expect(useErpStore.getState().chatTaskId).toBeNull();
  });
});
