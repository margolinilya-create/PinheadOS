import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const fromMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));

const { usePayrollStore } = await import('./usePayrollStore');

function chain(terminalResult, terminalMethod) {
  let proxy;
  const handler = {
    get: (_t, prop) => {
      if (prop === terminalMethod) return vi.fn().mockResolvedValue(terminalResult);
      if (['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'single', 'order', 'limit'].includes(prop)) {
        return vi.fn().mockReturnValue(proxy);
      }
      return undefined;
    },
  };
  proxy = new Proxy({}, handler);
  return proxy;
}

beforeEach(() => {
  usePayrollStore.setState({
    batches: [],
    entriesByBatch: {},
    loading: false,
    error: null,
  });
  fromMock.mockReset();
});

describe('usePayrollStore.closeBatch', () => {
  it('stamps paid_at on entries BEFORE updating the batch', async () => {
    // Track call order
    const callOrder = [];
    fromMock.mockImplementation((table) => {
      callOrder.push(table);
      if (table === 'piecework_entries') {
        return chain({ data: null, error: null }, 'is');
      }
      if (table === 'piecework_batches') {
        return chain(
          { data: { id: 'b1', status: 'closed', closed_at: 'now', closed_by: 'u1' }, error: null },
          'single'
        );
      }
      return chain({ data: null, error: null });
    });

    usePayrollStore.setState({
      batches: [{ id: 'b1', status: 'open' }],
    });

    const ok = await usePayrollStore.getState().closeBatch('b1');

    expect(ok).toBe(true);
    expect(callOrder).toEqual(['piecework_entries', 'piecework_batches']);
    expect(usePayrollStore.getState().batches[0].status).toBe('closed');
  });

  it('returns false and does NOT flip batch when entry stamping fails', async () => {
    const callOrder = [];
    fromMock.mockImplementation((table) => {
      callOrder.push(table);
      if (table === 'piecework_entries') {
        return chain({ data: null, error: { message: 'fail' } }, 'is');
      }
      return chain({ data: null, error: null }, 'single');
    });

    usePayrollStore.setState({ batches: [{ id: 'b1', status: 'open' }] });

    const ok = await usePayrollStore.getState().closeBatch('b1');

    expect(ok).toBe(false);
    expect(callOrder).toEqual(['piecework_entries']);
    expect(usePayrollStore.getState().batches[0].status).toBe('open');
  });
});

describe('usePayrollStore.createEntry', () => {
  it('appends to the batch cache map', async () => {
    const row = { id: 'e1', batch_id: 'b1', worker_id: 'w1', amount: 500 };
    fromMock.mockReturnValueOnce(chain({ data: row, error: null }, 'single'));

    const created = await usePayrollStore.getState().createEntry({
      batch_id: 'b1', worker_id: 'w1', tech_operation_id: 'op1',
      entry_type: 'accrual', qty: 5, rate: 100, amount: 500,
      reason: null, reversal_of: null,
    });

    expect(created).toEqual(row);
    expect(usePayrollStore.getState().entriesByBatch.b1).toHaveLength(1);
  });

  it('returns null and does not touch cache on error', async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: { message: 'nope' } }, 'single'));

    const created = await usePayrollStore.getState().createEntry({
      batch_id: 'b1', worker_id: 'w1', tech_operation_id: 'op1',
      entry_type: 'accrual', qty: 1, rate: 100, amount: 100,
      reason: null, reversal_of: null,
    });

    expect(created).toBeNull();
    expect(usePayrollStore.getState().entriesByBatch).toEqual({});
  });
});
