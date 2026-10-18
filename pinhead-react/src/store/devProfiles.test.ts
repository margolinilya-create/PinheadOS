import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEV_PROFILES, DEV_PROFILE_KEY, devProfileFromStorage } from './devProfiles';

/**
 * Подмена профиля dev-автологина (веха 8, задача 9, К12): ключ
 * `localStorage['pinhead_dev_profile']` работает только в ветке автологина —
 * когда настоящей сессии нет. При настоящей сессии ключ игнорируется.
 */

const getSession = vi.fn();
const maybeSingle = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      signOut: vi.fn().mockResolvedValue({}),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle })),
  },
}));

/** Стор входа заново, с автологином: флаг читается при загрузке модуля */
async function freshStore() {
  vi.resetModules();
  vi.stubEnv('VITE_DEV_AUTOLOGIN', '1');
  const { useAuthStore } = await import('./useAuthStore');
  return useAuthStore;
}

beforeEach(() => {
  localStorage.clear();
  getSession.mockReset();
  maybeSingle.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('devProfileFromStorage', () => {
  it('каждое имя — свой профиль, копией', () => {
    for (const name of ['seller', 'ms', 'rop', 'designer', 'admin'] as const) {
      const store = { getItem: (k: string) => (k === DEV_PROFILE_KEY ? name : null) };
      const user = devProfileFromStorage(store);
      expect(user).toEqual(DEV_PROFILES[name]);
      expect(user).not.toBe(DEV_PROFILES[name]);
    }
  });

  it('нет ключа, чужое значение, недоступное хранилище — null', () => {
    expect(devProfileFromStorage({ getItem: () => null })).toBeNull();
    expect(devProfileFromStorage({ getItem: () => 'superuser' })).toBeNull();
    expect(devProfileFromStorage({ getItem: () => '__proto__' })).toBeNull();
    expect(devProfileFromStorage({ getItem: () => { throw new Error('SecurityError'); } })).toBeNull();
    expect(devProfileFromStorage(null)).toBeNull();
  });

  it('роли и признаки — как у людей фикстур, id разные', () => {
    const p = DEV_PROFILES;
    expect([p.seller.is_sales, p.seller.is_ms, p.seller.role]).toEqual([true, false, 'manager']);
    expect([p.ms.is_sales, p.ms.is_ms]).toEqual([false, true]);
    expect(p.rop.role).toBe('rop');
    expect(p.designer.role).toBe('designer');
    expect(p.admin.id).toBe('dev');
    expect(new Set(Object.values(p).map((u) => u.id)).size).toBe(5);
    // Продавец — «Мария» из staffFx, МС — `MS` из orderFlowFx (мок RPC называет тех же людей)
    expect([p.seller.id, p.ms.id]).toEqual(['p-maria', 'p-ms']);
  });
});

describe('useAuthStore: подмена профиля только без настоящей сессии', () => {
  it('сессии нет, ключ «seller» — вошла продавец, а не dev-админ', async () => {
    localStorage.setItem(DEV_PROFILE_KEY, 'seller');
    getSession.mockResolvedValue({ data: { session: null } });
    const store = await freshStore();
    await store.getState().init();
    expect(store.getState().user).toEqual(DEV_PROFILES.seller);
    expect(store.getState().profileStatus).toBe('active');
  });

  it('сессии нет, ключа нет — прежний dev-админ', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const store = await freshStore();
    await store.getState().init();
    expect(store.getState().user?.id).toBe('dev');
    expect(store.getState().user?.role).toBe('admin');
  });

  it('настоящая сессия — ключ игнорируется, профиль из базы', async () => {
    localStorage.setItem(DEV_PROFILE_KEY, 'admin');
    getSession.mockResolvedValue({ data: { session: { user: { id: 'uid-real', email: 'real@pinhead.ru' } } } });
    maybeSingle.mockResolvedValue({ data: { name: 'Настоящая', role: 'designer', approved: true, active: true }, error: null });
    const store = await freshStore();
    await store.getState().init();
    expect(store.getState().user?.id).toBe('uid-real');
    expect(store.getState().user?.role).toBe('designer');
  });

  it('подменённый профиль — тоже подделка: не перечитывается из базы и не «теряет сессию»', async () => {
    localStorage.setItem(DEV_PROFILE_KEY, 'ms');
    getSession.mockResolvedValue({ data: { session: null } });
    const store = await freshStore();
    await store.getState().init();
    await store.getState().refreshProfile();
    expect(maybeSingle).not.toHaveBeenCalled();
    store.getState().sessionLost();
    expect(store.getState().user).toEqual(DEV_PROFILES.ms);
  });

  it('после выхода настоящий пользователь — уже не подделка', async () => {
    localStorage.setItem(DEV_PROFILE_KEY, 'seller');
    getSession.mockResolvedValue({ data: { session: null } });
    const store = await freshStore();
    await store.getState().init();
    await store.getState().logout();
    store.setState({ user: { ...DEV_PROFILES.rop, id: 'uid-real' } });
    store.getState().sessionLost();
    expect(store.getState().user).toBeNull();
  });
});
