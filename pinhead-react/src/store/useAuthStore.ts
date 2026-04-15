import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { storageClearAll } from '../lib/storage';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';
import type { User, UserRole, SubRole, ProfileStatus } from '../types/auth';

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
  isHr: () => boolean;
  isSeniorForeman: () => boolean;
  // Who is allowed to close payroll batches: director + senior_foreman + hr.
  // Mirrors the RLS policy piecework_batches_write_admin_senior_hr from
  // 20260530_hr_role_and_payroll_close.
  canClosePayroll: () => boolean;
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
        user: { id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode', role: 'admin', sub_role: null, approved: true, active: true },
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
        user: {
          id,
          email,
          name: data.name || email,
          role: (data.role as UserRole) || 'manager',
          sub_role: (data.sub_role as SubRole) || null,
          approved: data.approved,
          active,
        },
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
        user: { id: data.user.id, email, name, role: 'manager', sub_role: null, approved: false, active: true },
        profileStatus: 'pending_approval' as ProfileStatus,
        loading: false,
      });
    }
    return true;
  },

  logout: async () => {
    await supabase.auth.signOut();
    storageClearAll();
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
  isHr: () => get().effectiveRole() === 'hr',
  // sub_role is a real profile attribute, not something previewRole flips.
  // Preview-as-hr doesn't pretend to be a foreman.
  isSeniorForeman: () => {
    const u = get().user;
    return u?.role === 'production' && u?.sub_role === 'senior_foreman';
  },
  canClosePayroll: () => {
    const { effectiveRole, isSeniorForeman } = get();
    const r = effectiveRole();
    return r === 'admin' || r === 'director' || r === 'hr' || isSeniorForeman();
  },
}));
