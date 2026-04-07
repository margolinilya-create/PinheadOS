import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

vi.mock('./useToastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('./useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'user-1', role: 'admin' } })),
  },
}));

const { useTemplatesStore } = await import('./useTemplatesStore');
const { toast } = await import('./useToastStore');
const { useAuthStore } = await import('./useAuthStore');

beforeEach(() => {
  useTemplatesStore.setState({ templates: [], loading: false });
  vi.clearAllMocks();
  useAuthStore.getState.mockReturnValue({ user: { id: 'user-1', role: 'admin' } });
});

describe('useTemplatesStore — initial state', () => {
  it('has empty templates and loading false', () => {
    const s = useTemplatesStore.getState();
    expect(s.templates).toEqual([]);
    expect(s.loading).toBe(false);
  });
});

describe('useTemplatesStore — fetchTemplates', () => {
  it('loads templates on success', async () => {
    const templates = [{ id: 1, name: 'Футболка', data: {} }];
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: templates, error: null }),
    };
    mockFrom.mockReturnValue(chain);
    await useTemplatesStore.getState().fetchTemplates();
    expect(useTemplatesStore.getState().templates).toEqual(templates);
    expect(useTemplatesStore.getState().loading).toBe(false);
  });

  it('shows toast.error on failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
    };
    mockFrom.mockReturnValue(chain);
    await useTemplatesStore.getState().fetchTemplates();
    expect(toast.error).toHaveBeenCalledWith('Не удалось загрузить шаблоны');
    expect(useTemplatesStore.getState().loading).toBe(false);
  });

  it('sets loading true during fetch', async () => {
    let loadingDuringFetch = false;
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFrom.mockReturnValue(chain);
    useTemplatesStore.subscribe(s => { if (s.loading) loadingDuringFetch = true; });
    await useTemplatesStore.getState().fetchTemplates();
    expect(loadingDuringFetch).toBe(true);
  });
});

describe('useTemplatesStore — saveTemplate', () => {
  it('saves template and prepends to list', async () => {
    const saved = { id: 1, name: 'Тест', data: { type: 'tee' }, created_by: 'user-1' };
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [saved], error: null }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    const result = await useTemplatesStore.getState().saveTemplate('Тест', { type: 'tee' });
    expect(result).toEqual(saved);
    expect(useTemplatesStore.getState().templates[0]).toEqual(saved);
    expect(toast.success).toHaveBeenCalled();
  });

  it('returns null on Supabase error', async () => {
    const chain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    const result = await useTemplatesStore.getState().saveTemplate('Тест', {});
    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Не удалось сохранить шаблон');
  });

  it('rejects dev mode user', async () => {
    useAuthStore.getState.mockReturnValue({ user: { id: 'dev', role: 'admin' } });
    const result = await useTemplatesStore.getState().saveTemplate('Тест', {});
    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Шаблоны недоступны в dev-режиме');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects when no userId', async () => {
    useAuthStore.getState.mockReturnValue({ user: null });
    const result = await useTemplatesStore.getState().saveTemplate('Тест', {});
    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useTemplatesStore — deleteTemplate', () => {
  it('removes template on success', async () => {
    useTemplatesStore.setState({ templates: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
    const chain = {
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    const result = await useTemplatesStore.getState().deleteTemplate(1);
    expect(result).toBe(true);
    expect(useTemplatesStore.getState().templates).toHaveLength(1);
    expect(useTemplatesStore.getState().templates[0].id).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('Шаблон удалён');
  });

  it('keeps template on Supabase error', async () => {
    useTemplatesStore.setState({ templates: [{ id: 1, name: 'A' }] });
    const chain = {
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
      }),
    };
    mockFrom.mockReturnValue(chain);
    const result = await useTemplatesStore.getState().deleteTemplate(1);
    expect(result).toBe(false);
    expect(useTemplatesStore.getState().templates).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith('Не удалось удалить шаблон');
  });
});
