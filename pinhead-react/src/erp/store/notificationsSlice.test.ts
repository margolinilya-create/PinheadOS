import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * КОЛОКОЛ: ЧИСЛО, ПРОЧИТАННОСТЬ, ЗВУК (правка заказчика 01.10, п. 4).
 *
 * Каждое из требований ломается тихо — экран выглядит рабочим:
 *
 *   · «счётчики должны показывать реальное число непрочитанных» — число
 *     приходит с сервера (`count`), а не длиной загруженных 50 строк;
 *   · «…прочитанным, когда сотрудник увидел его в чате» — показ сообщения
 *     (`markChatSeen`) гасит уведомление о нём сразу и без второго запроса;
 *   · «повторное подключение не создаёт дубли» — перечитывание после
 *     разрыва не объявляет уже виденное второй раз;
 *   · «звук и уведомления браузера работают по настройкам сотрудника» —
 *     настройки из `erp_user_settings`, с откатом при отказе записи.
 */

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  count: 0 as number | null,
  settings: [] as Record<string, unknown>[],
  upsertError: null as { message: string } | null,
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rpcData: 1 as unknown,
}));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const query = (table: string): any => {
    let head = false;
    let result: () => unknown = () => ({ data: table === 'erp_user_settings' ? h.settings : h.rows, error: null });
    const log = (op: string, args: unknown[]) => h.calls.push({ table, op, args });
    const q: any = {
      select: (...args: unknown[]) => {
        log('select', args);
        head = Boolean((args[1] as { head?: boolean } | undefined)?.head);
        if (head) result = () => ({ data: null, error: null, count: h.count });
        return q;
      },
      eq: (...args: unknown[]) => { log('eq', args); return q; },
      is: (...args: unknown[]) => { log('is', args); return q; },
      in: (...args: unknown[]) => { log('in', args); return q; },
      order: () => q,
      limit: () => q,
      update: (...args: unknown[]) => { log('update', args); result = () => ({ data: [], error: null }); return q; },
      upsert: (...args: unknown[]) => {
        log('upsert', args);
        return Promise.resolve({ data: null, error: h.upsertError });
      },
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: (...args: unknown[]) => {
        h.calls.push({ table: 'rpc', op: String(args[0]), args });
        return Promise.resolve({ data: h.rpcData, error: null });
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: async () => 'ok',
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

const announce = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock('../utils/desktopNotify', () => ({ announceNotice: announce }));

const { useErpStore, resetErpStore } = await import('./useErpStore');
const { attachDomainSlices } = await import('./domainSlices');
const { useAuthStore } = await import('../../store/useAuthStore');
attachDomainSlices();

const N = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  kind: 'chat_mention',
  order_id: 'o1',
  title: `Уведомление ${id}`,
  body: null,
  link: `/orders/o1?tab=chat&msg=m-${id}`,
  message_id: `m-${id}`,
  created_at: '2026-10-01T10:00:00Z',
  read_at: null,
  ...over,
});

/** Дать отработать динамическому импорту `desktopNotify` */
const flush = () => new Promise((r) => { setTimeout(r, 0); });

beforeEach(() => {
  resetErpStore();
  localStorage.clear();
  h.rows = [];
  h.count = 0;
  h.settings = [];
  h.upsertError = null;
  h.calls = [];
  announce.mockClear();
  useAuthStore.setState({ user: { id: 'u1', name: 'Мария', email: 'm@x', role: 'manager' } } as never);
});

describe('счётчик колокола', () => {
  it('число непрочитанных — с сервера, а не длина загруженных строк', async () => {
    h.rows = [N('a'), N('b')];
    h.count = 75;
    await useErpStore.getState().loadNotifications();
    expect(useErpStore.getState().notificationsUnread).toBe(75);
    // Счёт спрашивается без строк и только по непрочитанным
    const head = h.calls.find((c) => c.op === 'select' && (c.args[1] as { head?: boolean })?.head);
    expect(head?.table).toBe('erp_notifications');
    expect(h.calls).toContainEqual({ table: 'erp_notifications', op: 'is', args: ['read_at', null] });
  });

  it('счёт не пришёл — fail-open на загруженные строки', async () => {
    h.rows = [N('a'), N('b', { read_at: '2026-10-01T10:01:00Z' })];
    h.count = null;
    await useErpStore.getState().loadNotifications();
    expect(useErpStore.getState().notificationsUnread).toBe(1);
  });
});

describe('прочитанность: показ сообщения в чате', () => {
  it('markChatSeen гасит уведомления о показанных сообщениях без второго запроса', async () => {
    h.rows = [N('a'), N('b')];
    h.count = 2;
    await useErpStore.getState().loadNotifications();
    useErpStore.setState({ noticePopups: [N('a') as never] });
    h.calls = [];

    await useErpStore.getState().markChatSeen(['m-a']);

    const s = useErpStore.getState();
    expect(s.notifications.find((n) => n.id === 'a')?.read_at).toBeTruthy();
    expect(s.notifications.find((n) => n.id === 'b')?.read_at).toBeNull();
    expect(s.notificationsUnread).toBe(1);
    // Карточка о прочитанном уходит с экрана
    expect(s.noticePopups).toEqual([]);
    // Один вызов — сама отметка просмотра; по уведомлениям запроса нет
    expect(h.calls.map((c) => c.table)).toEqual(['rpc']);
  });

  it('отказ отметки просмотра колокол не трогает', async () => {
    h.rows = [N('a')];
    h.count = 1;
    await useErpStore.getState().loadNotifications();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = await import('../../lib/supabase');
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValueOnce(
      { data: null, error: { message: 'нет' } } as never,
    );
    await useErpStore.getState().markChatSeen(['m-a']);
    expect(useErpStore.getState().notificationsUnread).toBe(1);
    rpc.mockRestore();
  });

  it('«Отметить все» — все непрочитанные адресата, а не загруженные', async () => {
    h.rows = [N('a')];
    h.count = 60;
    await useErpStore.getState().loadNotifications();
    h.calls = [];
    expect(await useErpStore.getState().markAllNotificationsRead()).toBe(true);
    expect(useErpStore.getState().notificationsUnread).toBe(0);
    expect(h.calls.map((c) => c.op)).toEqual(['update', 'eq', 'is']);
    // Без `in(ids)`: иначе погасли бы только 50 видимых
    expect(h.calls.some((c) => c.op === 'in')).toBe(false);
  });
});

describe('звук и окно браузера: один раз и по настройкам', () => {
  it('первая загрузка молчит, новое — объявляется по настройкам сотрудника', async () => {
    h.rows = [N('a')];
    await useErpStore.getState().loadNotifications();
    await flush();
    expect(announce).not.toHaveBeenCalled();

    h.rows = [N('b'), N('a')];
    await useErpStore.getState().loadNotifications();
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toMatchObject({ id: 'b' });
    expect(announce.mock.calls[0][1]).toEqual({ sound: true, desktop: false });
  });

  it('переподключение (resync) не объявляет уже виденное второй раз', async () => {
    h.rows = [N('a')];
    await useErpStore.getState().loadNotifications();
    h.rows = [N('b'), N('a')];
    await useErpStore.getState().loadNotifications();
    await flush();
    announce.mockClear();
    useErpStore.setState({ loadAll: vi.fn(async () => {}) });

    await useErpStore.getState().resyncRealtime();
    await flush();
    await flush();
    expect(announce).not.toHaveBeenCalled();
    expect(useErpStore.getState().noticePopups.map((n) => n.id)).toEqual(['b']);
  });

  it('и звук, и окно выключены — модуль сигналов не трогается вовсе', async () => {
    useErpStore.setState({ noticeSettings: { sound: false, desktop: false } });
    h.rows = [N('a')];
    await useErpStore.getState().loadNotifications();
    h.rows = [N('b'), N('a')];
    await useErpStore.getState().loadNotifications();
    await flush();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('настройки сотрудника', () => {
  it('приходят из базы и кэшируются под учётной записью', async () => {
    h.settings = [{ chat_sound: false, chat_desktop: true }];
    await useErpStore.getState().loadNoticeSettings();
    expect(useErpStore.getState().noticeSettings).toEqual({ sound: false, desktop: true });
    expect(h.calls).toContainEqual({ table: 'erp_user_settings', op: 'eq', args: ['user_id', 'u1'] });
    expect(JSON.parse(localStorage.getItem('erp_notice_settings') as string))
      .toEqual({ user: 'u1', sound: false, desktop: true });
  });

  it('строки нет — умолчание базы: звук включён, окно выключено', async () => {
    await useErpStore.getState().loadNoticeSettings();
    expect(useErpStore.getState().noticeSettings).toEqual({ sound: true, desktop: false });
  });

  it('кэш чужой учётной записи не применяется', async () => {
    localStorage.setItem('erp_notice_settings', JSON.stringify({ user: 'u2', sound: false, desktop: true }));
    await useErpStore.getState().loadNoticeSettings();
    expect(useErpStore.getState().noticeSettings).toEqual({ sound: true, desktop: false });
  });

  it('переключение пишется в базу своей строкой', async () => {
    expect(await useErpStore.getState().saveNoticeSettings({ sound: false })).toBe(true);
    const up = h.calls.find((c) => c.op === 'upsert');
    expect(up?.table).toBe('erp_user_settings');
    expect(up?.args[0]).toEqual({ user_id: 'u1', chat_sound: false, chat_desktop: false });
    expect(useErpStore.getState().noticeSettings.sound).toBe(false);
  });

  it('отказ записи откатывает переключатель', async () => {
    h.upsertError = { message: 'нет прав' };
    expect(await useErpStore.getState().saveNoticeSettings({ desktop: true })).toBe(false);
    expect(useErpStore.getState().noticeSettings).toEqual({ sound: true, desktop: false });
  });
});
