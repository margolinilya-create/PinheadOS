import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock supabase before importing the store
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      upsert: vi.fn().mockResolvedValue({}),
    })),
  },
}));

// Must import after mock
const { useAuthStore } = await import('./useAuthStore');
const { useErpStore } = await import('../erp/store/useErpStore');
const { useOrdersStore } = await import('./useOrdersStore');

beforeEach(() => {
  useAuthStore.setState({ user: null, profileStatus: 'no_profile', loading: false, error: null, previewRole: null });
});

describe('useAuthStore — state', () => {
  it('initial state has null user', () => {
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('initial loading is false (after reset)', () => {
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('initial error is null', () => {
    expect(useAuthStore.getState().error).toBeNull();
  });
});

describe('useAuthStore — clearError', () => {
  it('clears error', () => {
    useAuthStore.setState({ error: 'test error' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});

describe('useAuthStore — role helpers', () => {
  it('isAdmin returns true for admin', () => {
    useAuthStore.setState({ user: { role: 'admin' } });
    expect(useAuthStore.getState().isAdmin()).toBe(true);
  });

  it('isAdmin returns true for director', () => {
    useAuthStore.setState({ user: { role: 'director' } });
    expect(useAuthStore.getState().isAdmin()).toBe(true);
  });

  it('isAdmin returns false for manager', () => {
    useAuthStore.setState({ user: { role: 'manager' } });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
  });

  it('isROP returns true for rop', () => {
    useAuthStore.setState({ user: { role: 'rop' } });
    expect(useAuthStore.getState().isROP()).toBe(true);
  });

  it('isROP returns true for admin', () => {
    useAuthStore.setState({ user: { role: 'admin' } });
    expect(useAuthStore.getState().isROP()).toBe(true);
  });

  it('isROP returns false for production', () => {
    useAuthStore.setState({ user: { role: 'production' } });
    expect(useAuthStore.getState().isROP()).toBe(false);
  });

  it('isProduction returns true for production', () => {
    useAuthStore.setState({ user: { role: 'production' } });
    expect(useAuthStore.getState().isProduction()).toBe(true);
  });

  it('isProduction returns false for admin', () => {
    useAuthStore.setState({ user: { role: 'admin' } });
    expect(useAuthStore.getState().isProduction()).toBe(false);
  });

  it('isDesigner returns true for designer', () => {
    useAuthStore.setState({ user: { role: 'designer' } });
    expect(useAuthStore.getState().isDesigner()).toBe(true);
  });

  it('isDesigner returns false for manager', () => {
    useAuthStore.setState({ user: { role: 'manager' } });
    expect(useAuthStore.getState().isDesigner()).toBe(false);
  });

  it('isAdmin returns false for null user', () => {
    useAuthStore.setState({ user: null });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
  });
});

describe('useAuthStore — previewRole', () => {
  it('effectiveRole returns user role when no preview', () => {
    useAuthStore.setState({ user: { role: 'admin' } });
    expect(useAuthStore.getState().effectiveRole()).toBe('admin');
  });

  it('effectiveRole returns previewRole when set', () => {
    useAuthStore.setState({ user: { role: 'admin' }, previewRole: 'manager' });
    expect(useAuthStore.getState().effectiveRole()).toBe('manager');
  });

  it('setPreviewRole updates previewRole', () => {
    useAuthStore.getState().setPreviewRole('production');
    expect(useAuthStore.getState().previewRole).toBe('production');
  });

  it('clearPreviewRole resets to null', () => {
    useAuthStore.setState({ previewRole: 'manager' });
    useAuthStore.getState().clearPreviewRole();
    expect(useAuthStore.getState().previewRole).toBeNull();
  });

  it('role helpers use effectiveRole', () => {
    useAuthStore.setState({ user: { role: 'admin' }, previewRole: 'production' });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
    expect(useAuthStore.getState().isProduction()).toBe(true);
  });

  it('role helpers use real role when no preview', () => {
    useAuthStore.setState({ user: { role: 'admin' }, previewRole: null });
    expect(useAuthStore.getState().isAdmin()).toBe(true);
    expect(useAuthStore.getState().isProduction()).toBe(false);
  });
});

describe('useAuthStore — logout', () => {
  it('logout clears user and error', async () => {
    useAuthStore.setState({ user: { id: '1', role: 'admin' }, error: 'test' });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('logout resets profileStatus to no_profile', async () => {
    useAuthStore.setState({ user: { id: '1', role: 'admin' }, profileStatus: 'active' });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().profileStatus).toBe('no_profile');
  });

  /**
   * Общий цеховой планшет: работник A вышел, зашёл B. Раньше logout чистил только
   * localStorage, а сторы оставались в памяти вкладки — и, что хуже, с флагами
   * loaded/myDeptLoaded = true, из-за чего ErpLayout не делал ни одного запроса.
   * B видел заказы A (выборку RLS от чужого имени), его цех и его бейджи, и это
   * состояние не восстанавливалось само — только F5.
   */
  it('logout сбрасывает данные ERP-стора и снимает флаги загрузки', async () => {
    useErpStore.setState({
      orders: [{ id: 'o1', title: 'Заказ работника A' }],
      loaded: true,
      myDeptId: 'd-sew',
      myDeptLoaded: true,
    });

    await useAuthStore.getState().logout();

    const erp = useErpStore.getState();
    expect(erp.orders).toEqual([]);
    expect(erp.loaded).toBe(false);
    expect(erp.myDeptId).toBeNull();
    expect(erp.myDeptLoaded).toBe(false);
    // Действия слайсов пережили сброс — иначе стор стал бы нерабочим
    expect(typeof erp.loadAll).toBe('function');
  });

  it('logout очищает список заказов Order Studio', async () => {
    useOrdersStore.setState({ orders: [{ id: 1 }], search: 'Ромашка', filter: 'draft' });
    await useAuthStore.getState().logout();
    expect(useOrdersStore.getState().orders).toEqual([]);
    expect(useOrdersStore.getState().search).toBe('');
    expect(useOrdersStore.getState().filter).toBe('all');
  });
});

describe('useAuthStore — profileStatus', () => {
  it('fetchProfile sets profileStatus to disabled when active=false', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { name: 'Test', role: 'manager', approved: true, active: false },
      }),
    });
    await useAuthStore.getState().fetchProfile('uid-1', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('disabled');
    expect(useAuthStore.getState().user.active).toBe(false);
  });

  it('fetchProfile sets profileStatus to pending_approval when not approved', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { name: 'Test', role: 'manager', approved: false, active: true },
      }),
    });
    await useAuthStore.getState().fetchProfile('uid-2', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('pending_approval');
  });

  it('fetchProfile sets profileStatus to active for approved active user', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { name: 'Test', role: 'admin', approved: true, active: true },
      }),
    });
    await useAuthStore.getState().fetchProfile('uid-3', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('active');
  });

  it('fetchProfile sets no_profile and user=null when no data', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    });
    await useAuthStore.getState().fetchProfile('uid-4', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('no_profile');
    expect(useAuthStore.getState().user).toBeNull();
  });
});
