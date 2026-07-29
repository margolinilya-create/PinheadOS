import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { storageClearAll } from '../lib/storage';
import { toast } from './useToastStore';
import { resetErpStore } from '../erp/store/useErpStore';
import { useOrdersStore } from './useOrdersStore';
import { translateSupabaseError } from '../utils/i18n';
import type { User, UserRole, ProfileStatus } from '../types/auth';

// ─── DEV MODE: bypass авторизации ───
const DEV_MODE = import.meta.env.DEV;

interface AuthStore {
  user: User | null;
  profileStatus: ProfileStatus;
  loading: boolean;
  error: string | null;
  previewRole: UserRole | null;

  init: () => Promise<void>;
  fetchProfile: (id: string, email: string) => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;

  setPreviewRole: (role: UserRole | null) => void;
  clearPreviewRole: () => void;
  effectiveRole: () => UserRole | undefined;
  isAdmin: () => boolean;
  isROP: () => boolean;
  isProduction: () => boolean;
  isDesigner: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  profileStatus: 'no_profile' as ProfileStatus,
  loading: true,
  error: null,
  previewRole: null,

  // Инициализация — проверка сессии
  init: async () => {
    if (DEV_MODE) {
      set({
        user: { id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode', role: 'admin', approved: true, active: true },
        profileStatus: 'active' as ProfileStatus,
        loading: false,
        error: null,
      });
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await get().fetchProfile(session.user.id, session.user.email!);
        }
      } catch {
        if (import.meta.env.DEV) console.log('Supabase offline, running in dev mode');
      }
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await get().fetchProfile(session.user.id, session.user.email!);
      } else {
        set({ loading: false });
      }
    } catch (err) {
      console.error('[auth.init]', err);
      toast.error('Ошибка авторизации');
      set({ loading: false });
    }
  },

  fetchProfile: async (id, email) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      const active = data.active !== false;
      const status: ProfileStatus = !active ? 'disabled' : data.approved ? 'active' : 'pending_approval';
      set({
        user: { id, email, name: data.name || email, role: (data.role as UserRole) || 'manager', approved: data.approved, active },
        profileStatus: status,
        loading: false,
        error: null,
      });
    } else {
      set({ user: null, profileStatus: 'no_profile', loading: false });
    }
  },

  login: async (email, password) => {
    set({ error: null, loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: translateSupabaseError(error.message), loading: false });
      return false;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await get().fetchProfile(session.user.id, session.user.email!);
    }
    return true;
  },

  register: async (name, email, password) => {
    set({ error: null, loading: true });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      set({ error: translateSupabaseError(error.message), loading: false });
      return false;
    }
    if (data?.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        name,
        email,
        role: 'manager',
        approved: false,
      });
      set({
        user: { id: data.user.id, email, name, role: 'manager', approved: false, active: true },
        profileStatus: 'pending_approval' as ProfileStatus,
        loading: false,
      });
    }
    return true;
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(translateSupabaseError(error.message));
    storageClearAll();
    /**
     * Сторы данных чистятся вместе с localStorage. Раньше чистился только он,
     * а данные оставались в памяти вкладки: у ERP-стора флаги `loaded`/`myDeptLoaded`
     * оставались `true`, и `ErpLayout` при следующем входе не делал ни одного запроса —
     * на общем цеховом планшете следующий работник видел заказы предыдущего
     * (выборку RLS уже от чужого имени), его цех и его бейджи.
     */
    resetErpStore();
    useOrdersStore.setState({
      orders: [], loading: false, hasMore: true, loadingMore: false,
      lastCreatedAt: null, filter: 'all', search: '',
    });
    set({ user: null, profileStatus: 'no_profile' as ProfileStatus, error: null });
  },

  clearError: () => set({ error: null }),

  // ─── Preview role ───
  setPreviewRole: (role) => set({ previewRole: role }),
  clearPreviewRole: () => set({ previewRole: null }),
  effectiveRole: () => get().previewRole || get().user?.role,

  // ─── Role helpers ───
  isAdmin: () => ['admin', 'director'].includes(get().effectiveRole() || ''),
  isROP: () => ['admin', 'director', 'rop'].includes(get().effectiveRole() || ''),
  isProduction: () => get().effectiveRole() === 'production',
  isDesigner: () => get().effectiveRole() === 'designer',
}));
