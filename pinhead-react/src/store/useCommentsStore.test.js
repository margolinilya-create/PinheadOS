import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const { useCommentsStore } = await import('./useCommentsStore');
const { toast } = await import('./useToastStore');

function mockChain(resolvedValue) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(resolvedValue),
  };
  // For insert().select() chain
  chain.insert.mockReturnValue({ select: vi.fn().mockResolvedValue(resolvedValue) });
  mockFrom.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  useCommentsStore.setState({ comments: {}, loading: {} });
  vi.clearAllMocks();
});

describe('useCommentsStore — initial state', () => {
  it('has empty comments and loading', () => {
    const s = useCommentsStore.getState();
    expect(s.comments).toEqual({});
    expect(s.loading).toEqual({});
  });
});

describe('useCommentsStore — fetchComments', () => {
  it('loads comments for orderId on success', async () => {
    const comments = [{ id: 1, text: 'test', order_id: 'o1' }];
    mockChain({ data: comments, error: null });
    await useCommentsStore.getState().fetchComments('o1');
    expect(useCommentsStore.getState().comments['o1']).toEqual(comments);
    expect(useCommentsStore.getState().loading['o1']).toBe(false);
  });

  it('sets loading true during fetch', async () => {
    let loadingDuringFetch = false;
    const originalFetch = useCommentsStore.getState().fetchComments;
    mockChain({ data: [], error: null });
    // Check loading is set before await resolves
    useCommentsStore.subscribe(s => { if (s.loading['o1']) loadingDuringFetch = true; });
    await originalFetch('o1');
    expect(loadingDuringFetch).toBe(true);
  });

  it('shows toast.error on Supabase error', async () => {
    mockChain({ data: null, error: { message: 'fail' } });
    await useCommentsStore.getState().fetchComments('o1');
    expect(toast.error).toHaveBeenCalledWith('Не удалось загрузить комментарии');
    expect(useCommentsStore.getState().loading['o1']).toBe(false);
  });

  it('keeps other order comments when fetching one', async () => {
    useCommentsStore.setState({ comments: { o2: [{ id: 2, text: 'other' }] } });
    mockChain({ data: [{ id: 1, text: 'new' }], error: null });
    await useCommentsStore.getState().fetchComments('o1');
    expect(useCommentsStore.getState().comments['o2']).toEqual([{ id: 2, text: 'other' }]);
    expect(useCommentsStore.getState().comments['o1']).toEqual([{ id: 1, text: 'new' }]);
  });
});

describe('useCommentsStore — addComment', () => {
  it('appends comment on success', async () => {
    useCommentsStore.setState({ comments: { o1: [{ id: 1, text: 'old' }] } });
    const newComment = { id: 2, text: 'new', order_id: 'o1', author_name: 'Admin' };
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [newComment], error: null }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    await useCommentsStore.getState().addComment('o1', 'new', 'Admin', 'admin');
    expect(useCommentsStore.getState().comments['o1']).toHaveLength(2);
    expect(useCommentsStore.getState().comments['o1'][1].text).toBe('new');
  });

  it('skips empty text', async () => {
    await useCommentsStore.getState().addComment('o1', '  ', 'Admin', 'admin');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('shows toast.error on failure', async () => {
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    await useCommentsStore.getState().addComment('o1', 'text', 'Admin', 'admin');
    expect(toast.error).toHaveBeenCalledWith('Не удалось добавить комментарий');
  });

  it('creates comments array if none exists for orderId', async () => {
    const newComment = { id: 1, text: 'first', order_id: 'o1' };
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [newComment], error: null }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    await useCommentsStore.getState().addComment('o1', 'first', 'Admin', 'admin');
    expect(useCommentsStore.getState().comments['o1']).toEqual([newComment]);
  });
});
