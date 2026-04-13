import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock toast to silence
vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../lib/domainEvents', () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

// Shared supabase mock — we reassign .from() per-test to stage responses.
const fromMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  },
}));

const { useTechCardStore } = await import('./useTechCardStore');
const { emitDomainEvent } = await import('../lib/domainEvents');

// Helper: build a chain mock that resolves the terminal call with `value`.
// Call order of Supabase builders in the store:
//   from(table).select(...).is(...).order(...)                         → loadCatalog sections/ops
//   from(table).select(...).eq(...).is(...).maybeSingle()              → loadTechCardForOrder card
//   from(table).select(...).eq(...).is(...).order(...)                 → loadTechCardForOrder ops
//   from(table).insert(...).select().single()                          → createDraft / addOperation
//   from(table).update(...).eq(...)                                    → removeOperation / updateQty
//   from(table).update(...).eq(...).select().single()                  → approveTechCard
function chain(terminalResult, terminalMethod = 'order') {
  let proxy;
  const handler = {
    get: (_target, prop) => {
      if (prop === terminalMethod) {
        return vi.fn().mockResolvedValue(terminalResult);
      }
      if (['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'single', 'maybeSingle', 'limit'].includes(prop)) {
        return vi.fn().mockReturnValue(proxy);
      }
      return undefined;
    },
  };
  proxy = new Proxy({}, handler);
  return proxy;
}

beforeEach(() => {
  useTechCardStore.setState({
    sections: [],
    operationTypes: [],
    catalogLoaded: false,
    currentOrderId: null,
    techCard: null,
    operations: [],
    templatesBySku: {},
    templateItems: {},
    loading: false,
    error: null,
  });
  fromMock.mockReset();
  emitDomainEvent.mockClear();
});

describe('useTechCardStore.loadCatalog', () => {
  it('loads sections + operation types and marks catalogLoaded', async () => {
    fromMock
      .mockReturnValueOnce(chain({ data: [{ id: 's1', code: 'cutting' }], error: null }))
      .mockReturnValueOnce(chain({ data: [{ id: 'o1', section_id: 's1', base_rate: 100 }], error: null }));

    await useTechCardStore.getState().loadCatalog();

    const s = useTechCardStore.getState();
    expect(s.sections).toHaveLength(1);
    expect(s.operationTypes).toHaveLength(1);
    expect(s.catalogLoaded).toBe(true);
  });

  it('no-ops if already loaded', async () => {
    useTechCardStore.setState({ catalogLoaded: true });
    await useTechCardStore.getState().loadCatalog();
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('useTechCardStore.addOperation', () => {
  const opType = {
    id: 'op1',
    section_id: 's1',
    name: 'Sew tshirt',
    base_rate: 120,
    base_minutes: 8,
    unit: 'piece',
  };

  beforeEach(() => {
    useTechCardStore.setState({
      techCard: { id: 'tc1', order_id: 'ord1', status: 'draft' },
      operations: [],
      operationTypes: [opType],
    });
  });

  it('snapshots rate/minutes/name/unit from the catalog at insert time', async () => {
    const inserted = {
      id: 'row1',
      tech_card_id: 'tc1',
      order_id: 'ord1',
      operation_type_id: 'op1',
      section_id: 's1',
      qty: 5,
      rate_snapshot: 120,
      minutes_snapshot: 8,
      name_snapshot: 'Sew tshirt',
      unit_snapshot: 'piece',
      sort_order: 0,
    };
    fromMock.mockReturnValueOnce(chain({ data: inserted, error: null }, 'single'));

    await useTechCardStore.getState().addOperation('op1', 5);

    const ops = useTechCardStore.getState().operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].rate_snapshot).toBe(120);
    expect(ops[0].name_snapshot).toBe('Sew tshirt');
  });

  it('refuses to add when tech card is not draft', async () => {
    useTechCardStore.setState({ techCard: { id: 'tc1', order_id: 'ord1', status: 'approved' } });
    await useTechCardStore.getState().addOperation('op1', 5);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('refuses when operation is not in the catalog', async () => {
    await useTechCardStore.getState().addOperation('unknown', 5);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('useTechCardStore.deleteTechCard', () => {
  it('refuses when card not in draft state', async () => {
    useTechCardStore.setState({
      techCard: { id: 'tc1', order_id: 'ord1', status: 'approved' },
      operations: [],
    });
    const removed = await useTechCardStore.getState().deleteTechCard();
    expect(removed).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('soft-deletes draft card and clears operations', async () => {
    useTechCardStore.setState({
      techCard: { id: 'tc1', order_id: 'ord1', status: 'draft' },
      operations: [{ id: 'op1' }],
    });
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }, 'eq'));
    const removed = await useTechCardStore.getState().deleteTechCard();
    expect(removed).toEqual(expect.objectContaining({ id: 'tc1' }));
    expect(useTechCardStore.getState().techCard).toBeNull();
    expect(useTechCardStore.getState().operations).toEqual([]);
  });
});

describe('useTechCardStore.approveTechCard', () => {
  it('skips refresh when snapshot already matches catalog', async () => {
    useTechCardStore.setState({
      techCard: { id: 'tc1', order_id: 'ord1', status: 'draft' },
      operations: [
        { id: 'op-row1', operation_type_id: 'op1', rate_snapshot: 120, minutes_snapshot: 8, name_snapshot: 'Sew', unit_snapshot: 'piece' },
      ],
      operationTypes: [
        { id: 'op1', base_rate: 120, base_minutes: 8, name: 'Sew', unit: 'piece', section_id: 's1' },
      ],
    });
    // approveTechCard calls (1) update order_tech_cards → returns card
    fromMock.mockReturnValueOnce(chain({ data: { id: 'tc1', order_id: 'ord1', status: 'approved', approved_at: 'now', approved_by: 'u1' }, error: null }, 'single'));
    // Then loadTechCardForOrder: card + ops
    fromMock.mockReturnValueOnce(chain({ data: { id: 'tc1', order_id: 'ord1', status: 'approved' }, error: null }, 'maybeSingle'));
    fromMock.mockReturnValueOnce(chain({ data: [], error: null }));

    const ok = await useTechCardStore.getState().approveTechCard();
    expect(ok).toBe(true);
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'tech_card.approved',
        aggregate_type: 'order_tech_card',
        aggregate_id: 'tc1',
      })
    );
  });

  it('returns false when not in draft state', async () => {
    useTechCardStore.setState({
      techCard: { id: 'tc1', order_id: 'ord1', status: 'approved' },
      operations: [],
      operationTypes: [],
    });
    const ok = await useTechCardStore.getState().approveTechCard();
    expect(ok).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
