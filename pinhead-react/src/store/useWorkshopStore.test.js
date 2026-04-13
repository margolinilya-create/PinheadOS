import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const fromMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

const { useWorkshopStore } = await import('./useWorkshopStore');

function chain(terminalResult, terminalMethod = 'in') {
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
  useWorkshopStore.setState({
    sections: [],
    operationsBySection: {},
    loading: false,
    error: null,
  });
  fromMock.mockReset();
});

describe('useWorkshopStore.loadBoard', () => {
  it('groups operations by section_id', async () => {
    fromMock
      .mockReturnValueOnce(chain(
        { data: [{ id: 's1', code: 'cut' }, { id: 's2', code: 'sew' }], error: null },
        'order'
      ))
      .mockReturnValueOnce(chain(
        {
          data: [
            {
              id: 'op1', section_id: 's1', tech_card_id: 'tc1', order_id: 'ord1',
              qty: 5, rate_snapshot: 100, minutes_snapshot: 5,
              name_snapshot: 'A', unit_snapshot: 'piece', sort_order: 0,
              order_tech_cards: { status: 'approved' }, orders: { order_number: 'PH-0001' },
            },
            {
              id: 'op2', section_id: 's2', tech_card_id: 'tc1', order_id: 'ord1',
              qty: 3, rate_snapshot: 200, minutes_snapshot: 10,
              name_snapshot: 'B', unit_snapshot: 'piece', sort_order: 1,
              order_tech_cards: { status: 'locked' }, orders: null,
            },
          ],
          error: null,
        },
        'in'
      ));

    await useWorkshopStore.getState().loadBoard();

    const s = useWorkshopStore.getState();
    expect(s.sections).toHaveLength(2);
    expect(s.operationsBySection.s1).toHaveLength(1);
    expect(s.operationsBySection.s2).toHaveLength(1);
    expect(s.operationsBySection.s1[0].tech_card_status).toBe('approved');
    expect(s.operationsBySection.s1[0].order_number).toBe('PH-0001');
    expect(s.operationsBySection.s2[0].order_number).toBeUndefined();
  });

  it('sets error + stops loading when sections query fails', async () => {
    // Promise.all fires both queries in parallel; stage both even though
    // the store short-circuits on the first error.
    fromMock
      .mockReturnValueOnce(chain({ data: null, error: { message: 'db dead' } }, 'order'))
      .mockReturnValueOnce(chain({ data: [], error: null }, 'in'));

    await useWorkshopStore.getState().loadBoard();

    const s = useWorkshopStore.getState();
    expect(s.error).toBe('db dead');
    expect(s.loading).toBe(false);
    expect(s.sections).toEqual([]);
  });
});

describe('useWorkshopStore.reset', () => {
  it('returns to initial state', () => {
    useWorkshopStore.setState({
      sections: [{ id: 's1' }],
      operationsBySection: { s1: [{ id: 'op1' }] },
    });
    useWorkshopStore.getState().reset();
    const s = useWorkshopStore.getState();
    expect(s.sections).toEqual([]);
    expect(s.operationsBySection).toEqual({});
  });
});
