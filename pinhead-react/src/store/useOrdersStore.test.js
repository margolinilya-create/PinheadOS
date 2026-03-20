import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock supabase
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
  },
}));

// Mock useAuthStore
vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'dev', role: 'admin' } })),
  },
}));

const { useOrdersStore, STATUS_LIST, STATUS_LABELS, STATUS_COLORS } = await import('./useOrdersStore');

beforeEach(() => {
  useOrdersStore.setState({ orders: [], loading: false, filter: 'all', search: '' });
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
  it('removes order optimistically', async () => {
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
});

describe('useOrdersStore — updateStatus', () => {
  it('updates status optimistically', async () => {
    useOrdersStore.setState({
      orders: [{ id: 1, status: 'draft' }],
    });
    await useOrdersStore.getState().updateStatus(1, 'approved');
    expect(useOrdersStore.getState().orders[0].status).toBe('approved');
  });
});
