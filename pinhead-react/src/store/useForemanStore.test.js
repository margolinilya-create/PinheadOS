import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const fromMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

const { useForemanStore } = await import('./useForemanStore');

function chain(terminalResult, terminalMethod) {
  let proxy;
  const handler = {
    get: (_t, prop) => {
      if (prop === terminalMethod) return vi.fn().mockResolvedValue(terminalResult);
      if (['select', 'eq', 'is', 'in', 'order', 'single'].includes(prop)) {
        return vi.fn().mockReturnValue(proxy);
      }
      return undefined;
    },
  };
  proxy = new Proxy({}, handler);
  return proxy;
}

beforeEach(() => {
  useForemanStore.setState({
    sectionId: null,
    operations: [],
    sectionWorkers: [],
    loading: false,
    error: null,
  });
  fromMock.mockReset();
});

describe('useForemanStore.loadSection', () => {
  it('loads ops + workers for a section in parallel', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'order_tech_operations') {
        return chain({
          data: [{
            id: 'op1', section_id: 's1', tech_card_id: 'tc1', order_id: 'ord1',
            qty: 5, rate_snapshot: 100, minutes_snapshot: 5,
            name_snapshot: 'A', unit_snapshot: 'piece', sort_order: 0,
            order_tech_cards: { status: 'approved' }, orders: { order_number: 'PH-001' },
          }],
          error: null,
        }, 'in');
      }
      if (table === 'workers') {
        return chain({
          data: [{ id: 'w1', full_name: 'Ivan', section_id: 's1', hourly_rate: 300 }],
          error: null,
        }, 'order');
      }
      return chain({ data: [], error: null });
    });

    await useForemanStore.getState().loadSection('s1');

    const s = useForemanStore.getState();
    expect(s.sectionId).toBe('s1');
    expect(s.operations).toHaveLength(1);
    expect(s.operations[0].tech_card_status).toBe('approved');
    expect(s.operations[0].order_number).toBe('PH-001');
    expect(s.sectionWorkers).toHaveLength(1);
  });

  it('aborts and surfaces error when ops query fails', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'order_tech_operations') {
        return chain({ data: null, error: { message: 'nope' } }, 'in');
      }
      return chain({ data: [], error: null }, 'order');
    });

    await useForemanStore.getState().loadSection('s1');

    const s = useForemanStore.getState();
    expect(s.error).toBe('nope');
    expect(s.operations).toEqual([]);
  });
});

describe('useForemanStore.refresh', () => {
  it('reloads the current section when one is set', async () => {
    useForemanStore.setState({ sectionId: 's1' });
    fromMock.mockImplementation((table) => {
      if (table === 'order_tech_operations') {
        return chain({ data: [], error: null }, 'in');
      }
      return chain({ data: [], error: null }, 'order');
    });

    await useForemanStore.getState().refresh();

    // Both queries should have fired
    expect(fromMock).toHaveBeenCalledWith('order_tech_operations');
    expect(fromMock).toHaveBeenCalledWith('workers');
  });

  it('no-ops when no section is set', async () => {
    useForemanStore.setState({ sectionId: null });
    await useForemanStore.getState().refresh();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
