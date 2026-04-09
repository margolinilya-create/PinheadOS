import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock supabase
const mockRpc = vi.fn().mockResolvedValue({ data: 'PH-0001', error: null });
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    rpc: (...args) => mockRpc(...args),
  },
}));

// Mock useAuthStore
vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'dev', role: 'admin' } })),
  },
}));

const { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } = await import('./useOrdersStore');

beforeEach(async () => {
  useOrdersStore.setState({ orders: [], loading: false, filter: 'all', search: '' });
  mockRpc.mockReset().mockResolvedValue({ data: 'PH-0001', error: null });
  // Restore default from() mock chain
  const { supabase } = await import('../lib/supabase');
  supabase.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  });
});

describe('useOrdersStore — exports', () => {
  it('STATUS_LIST has 5 statuses', () => {
    expect(STATUS_LIST).toEqual(['draft', 'review', 'approved', 'production', 'done']);
  });

  it('STATUS_LABELS has labels for all statuses', () => {
    for (const s of STATUS_LIST) {
      expect(STATUS_LABELS[s]).toBeDefined();
    }
  });

  it('STATUS_COLORS has bg/text/bar for all statuses', () => {
    for (const s of STATUS_LIST) {
      expect(STATUS_COLORS[s]).toHaveProperty('bg');
      expect(STATUS_COLORS[s]).toHaveProperty('text');
      expect(STATUS_COLORS[s]).toHaveProperty('bar');
      expect(STATUS_COLORS[s].bar).toMatch(/^#/);
    }
  });
});

describe('useOrdersStore — filter & search', () => {
  it('setFilter updates filter', () => {
    useOrdersStore.getState().setFilter('draft');
    expect(useOrdersStore.getState().filter).toBe('draft');
  });

  it('setSearch updates search', () => {
    useOrdersStore.getState().setSearch('test');
    expect(useOrdersStore.getState().search).toBe('test');
  });
});

describe('useOrdersStore — getFiltered', () => {
  beforeEach(() => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', item_type: 'tee', data: { name: 'Alpha' } },
        { id: 2, order_number: 'PH-0002', status: 'approved', item_type: 'hoodie', data: { name: 'Beta' } },
        { id: 3, order_number: 'PH-0003', status: 'done', item_type: 'tee', data: { name: 'Gamma' } },
      ],
    });
  });

  it('returns all when filter=all and no search', () => {
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(3);
  });

  it('filters by status', () => {
    useOrdersStore.getState().setFilter('draft');
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(1);
    expect(useOrdersStore.getState().getFiltered()[0].status).toBe('draft');
  });

  it('filters by search (order_number)', () => {
    useOrdersStore.getState().setSearch('PH-0002');
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(1);
    expect(useOrdersStore.getState().getFiltered()[0].id).toBe(2);
  });

  it('filters by search (name)', () => {
    useOrdersStore.getState().setSearch('alpha');
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(1);
  });

  it('filters by search (item_type)', () => {
    useOrdersStore.getState().setSearch('hoodie');
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(1);
  });

  it('combined filter + search', () => {
    useOrdersStore.getState().setFilter('tee');
    useOrdersStore.getState().setSearch('gamma');
    // filter=tee doesn't match any status, so 0 results
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(0);
  });

  it('empty search returns all', () => {
    useOrdersStore.getState().setSearch('   ');
    expect(useOrdersStore.getState().getFiltered()).toHaveLength(3);
  });
});

describe('useOrdersStore — deleteOrder', () => {
  it('removes order after Supabase success (non-optimistic)', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    useOrdersStore.setState({
      orders: [
        { id: 1, status: 'draft' },
        { id: 2, status: 'draft' },
      ],
    });
    await useOrdersStore.getState().deleteOrder(1);
    expect(useOrdersStore.getState().orders).toHaveLength(1);
    expect(useOrdersStore.getState().orders[0].id).toBe(2);
  });

  it('keeps order in list when Supabase delete fails', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
      }),
    });
    useOrdersStore.setState({
      orders: [
        { id: 1, status: 'draft' },
        { id: 2, status: 'draft' },
      ],
    });
    const result = await useOrdersStore.getState().deleteOrder(1);
    expect(result).toBe(false);
    expect(useOrdersStore.getState().orders).toHaveLength(2);
  });
});

describe('useOrdersStore — generateOrderNumber via RPC', () => {
  it('saveOrder uses supabase.rpc for order number', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'PH-0042', error: null });
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: 99, order_number: 'PH-0042', status: 'draft' }],
          error: null,
        }),
      }),
    });

    const result = await useOrdersStore.getState().saveOrder({ type: 'tee' });
    expect(mockRpc).toHaveBeenCalledWith('generate_order_number');
    expect(result.order_number).toBe('PH-0042');
  });

  it('returns null when rpc and insert both fail', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
      }),
    });

    const result = await useOrdersStore.getState().saveOrder({ type: 'tee' });
    expect(result).toBeNull();
  });
});

describe('useOrdersStore — updateStatus', () => {
  it('updates status optimistically on Supabase success', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    useOrdersStore.setState({
      orders: [{ id: 1, status: 'draft' }],
    });
    await useOrdersStore.getState().updateStatus(1, 'approved');
    expect(useOrdersStore.getState().orders[0].status).toBe('approved');
  });

  it('rolls back to previous status on Supabase failure', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
      }),
    });
    useOrdersStore.setState({
      orders: [{ id: 1, status: 'draft' }],
    });
    await useOrdersStore.getState().updateStatus(1, 'approved');
    expect(useOrdersStore.getState().orders[0].status).toBe('draft');
  });
});
