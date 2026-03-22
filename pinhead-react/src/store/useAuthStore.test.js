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

beforeEach(() => {
  useAuthStore.setState({ user: null, loading: false, error: null, previewRole: null });
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
});
