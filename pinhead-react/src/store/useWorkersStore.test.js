import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const fromMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

const { useWorkersStore } = await import('./useWorkersStore');

function chain(terminalResult, terminalMethod = 'order') {
  let proxy;
  const handler = {
    get: (_t, prop) => {
      if (prop === terminalMethod) return vi.fn().mockResolvedValue(terminalResult);
      if (['select', 'insert', 'update', 'delete', 'eq', 'is', 'single', 'order'].includes(prop)) {
        return vi.fn().mockReturnValue(proxy);
      }
      return undefined;
    },
  };
  proxy = new Proxy({}, handler);
  return proxy;
}

beforeEach(() => {
  useWorkersStore.setState({ workers: [], loading: false, error: null });
  fromMock.mockReset();
});

describe('useWorkersStore.loadAll', () => {
  it('stores returned rows', async () => {
    fromMock.mockReturnValueOnce(chain({ data: [{ id: 'w1', full_name: 'Ivan' }], error: null }));
    await useWorkersStore.getState().loadAll();
    expect(useWorkersStore.getState().workers).toHaveLength(1);
  });

  it('keeps empty list on error', async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }));
    await useWorkersStore.getState().loadAll();
    expect(useWorkersStore.getState().workers).toEqual([]);
    expect(useWorkersStore.getState().error).toBe('boom');
  });
});

describe('useWorkersStore.update', () => {
  beforeEach(() => {
    useWorkersStore.setState({
      workers: [{ id: 'w1', full_name: 'Ivan', hourly_rate: 300 }],
    });
  });

  it('applies optimistic update on success', async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }, 'eq'));
    await useWorkersStore.getState().update('w1', { hourly_rate: 400 });
    expect(useWorkersStore.getState().workers[0].hourly_rate).toBe(400);
  });

  it('rolls back optimistic update on error', async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: { message: 'denied' } }, 'eq'));
    await useWorkersStore.getState().update('w1', { hourly_rate: 999 });
    expect(useWorkersStore.getState().workers[0].hourly_rate).toBe(300);
  });
});

describe('useWorkersStore.softDelete', () => {
  it('removes row from list on success', async () => {
    useWorkersStore.setState({ workers: [{ id: 'w1' }, { id: 'w2' }] });
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }, 'eq'));
    await useWorkersStore.getState().softDelete('w1');
    expect(useWorkersStore.getState().workers.map((w) => w.id)).toEqual(['w2']);
  });

  it('keeps row when db rejects', async () => {
    useWorkersStore.setState({ workers: [{ id: 'w1' }] });
    fromMock.mockReturnValueOnce(chain({ data: null, error: { message: 'nope' } }, 'eq'));
    await useWorkersStore.getState().softDelete('w1');
    expect(useWorkersStore.getState().workers).toHaveLength(1);
  });
});
