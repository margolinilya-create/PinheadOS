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
      if (['select', 'order', 'limit', 'eq', 'in', 'is'].includes(prop)) {
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
    events: [],
    seenAt: null,
    loading: false,
    error: null,
    subscribed: false,
  });
  fromMock.mockReset();
});

describe('useNotificationsStore.unreadCount', () => {
  it('equals events.length when seenAt is null', () => {
    useNotificationsStore.setState({
      events: [
        { id: 'e1', created_at: '2026-04-14T10:00:00Z' },
        { id: 'e2', created_at: '2026-04-14T11:00:00Z' },
      ],
      seenAt: null,
    });
    expect(useNotificationsStore.getState().unreadCount()).toBe(2);
  });

  it('counts only events newer than seenAt', () => {
    useNotificationsStore.setState({
      events: [
        { id: 'e1', created_at: '2026-04-14T10:00:00Z' },
        { id: 'e2', created_at: '2026-04-14T12:00:00Z' },
        { id: 'e3', created_at: '2026-04-14T13:00:00Z' },
      ],
      seenAt: '2026-04-14T11:00:00Z',
    });
    expect(useNotificationsStore.getState().unreadCount()).toBe(2);
  });
});

describe('useNotificationsStore.markAllSeen', () => {
  it('advances seenAt to now', () => {
    const before = useNotificationsStore.getState().seenAt;
    useNotificationsStore.getState().markAllSeen();
    const after = useNotificationsStore.getState().seenAt;
    expect(after).not.toBe(before);
    expect(typeof after).toBe('string');
  });
});

describe('useNotificationsStore.loadRecent', () => {
  it('populates events from supabase', async () => {
    fromMock.mockReturnValueOnce(chain({ data: [{ id: 'e1', created_at: '2026-04-14T10:00:00Z' }], error: null }));
    await useNotificationsStore.getState().loadRecent();
    expect(useNotificationsStore.getState().events).toHaveLength(1);
  });
});
