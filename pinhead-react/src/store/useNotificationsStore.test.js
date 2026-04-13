import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const fromMock = vi.fn();
const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  },
}));

const { useNotificationsStore } = await import('./useNotificationsStore');

function chain(terminalResult, terminalMethod = 'limit') {
  let proxy;
  const handler = {
    get: (_t, prop) => {
      if (prop === terminalMethod) return vi.fn().mockResolvedValue(terminalResult);
      if (['select', 'order', 'limit', 'eq', 'in', 'is', 'update'].includes(prop)) {
        return vi.fn().mockReturnValue(proxy);
      }
      return undefined;
    },
  };
  proxy = new Proxy({}, handler);
  return proxy;
}

beforeEach(() => {
  useNotificationsStore.setState({
    notifications: [],
    loading: false,
    error: null,
    subscribed: false,
  });
  fromMock.mockReset();
});

describe('useNotificationsStore.unreadCount', () => {
  it('counts rows with read_at = null', () => {
    useNotificationsStore.setState({
      notifications: [
        { id: '1', read_at: null, created_at: '2026-04-14T10:00:00Z' },
        { id: '2', read_at: '2026-04-14T11:00:00Z', created_at: '2026-04-14T11:00:00Z' },
        { id: '3', read_at: null, created_at: '2026-04-14T12:00:00Z' },
      ],
    });
    expect(useNotificationsStore.getState().unreadCount()).toBe(2);
  });

  it('returns 0 when all read', () => {
    useNotificationsStore.setState({
      notifications: [
        { id: '1', read_at: '2026-04-14T11:00:00Z', created_at: '2026-04-14T10:00:00Z' },
      ],
    });
    expect(useNotificationsStore.getState().unreadCount()).toBe(0);
  });
});

describe('useNotificationsStore.loadRecent', () => {
  it('populates notifications from supabase', async () => {
    fromMock.mockReturnValueOnce(chain({
      data: [{ id: 'n1', title: 'Test', read_at: null, created_at: '2026-04-14T10:00:00Z' }],
      error: null,
    }));
    await useNotificationsStore.getState().loadRecent();
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });
});

describe('useNotificationsStore.markOneRead', () => {
  it('updates a single row optimistically', async () => {
    useNotificationsStore.setState({
      notifications: [
        { id: '1', read_at: null },
        { id: '2', read_at: null },
      ],
    });
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }, 'eq'));
    await useNotificationsStore.getState().markOneRead('1');
    const all = useNotificationsStore.getState().notifications;
    expect(all.find((n) => n.id === '1').read_at).toBeTruthy();
    expect(all.find((n) => n.id === '2').read_at).toBeNull();
  });

  it('no-ops when row is already read', async () => {
    useNotificationsStore.setState({
      notifications: [{ id: '1', read_at: '2026-04-14T10:00:00Z' }],
    });
    await useNotificationsStore.getState().markOneRead('1');
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('useNotificationsStore.markAllRead', () => {
  it('no-ops when nothing is unread', async () => {
    useNotificationsStore.setState({
      notifications: [{ id: '1', read_at: '2026-04-14T11:00:00Z' }],
    });
    await useNotificationsStore.getState().markAllRead();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('optimistically stamps read_at on unread rows', async () => {
    useNotificationsStore.setState({
      notifications: [
        { id: '1', read_at: null },
        { id: '2', read_at: null },
      ],
    });
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }, 'in'));
    await useNotificationsStore.getState().markAllRead();
    const all = useNotificationsStore.getState().notifications;
    expect(all.every((n) => n.read_at !== null)).toBe(true);
  });
});
