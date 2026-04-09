import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { storageClearAll } from '../lib/storage';
import { toast } from './useToastStore';
import { translateSupabaseError } from '../utils/i18n';

// ─── DEV MODE: bypass авторизации ───
// В dev-режиме (vite dev) — пропускаем логин, role = admin
// В production-билде — требуется настоящий логин через Supabase
const DEV_MODE = import.meta.env.DEV;

export const useAuthStore = create((set, get) => ({
  user: null,       // { id, email, name, role }
  loading: true,
  error: null,
  previewRole: null, // null = своя роль, иначе — превью (только в памяти)

  // Инициализация — проверка сессии
  init: async () => {
    // ─── DEV MODE bypass (как initAuth() в оригинале) ───
    if (DEV_MODE) {
      set({
        user: { id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode', role: 'admin', approved: true },
        loading: false,
        error: null,
      });
      // Попытаться подключиться к Supabase в фоне
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await get().fetchProfile(session.user.id, session.user.email);
        }
      } catch {
        if (import.meta.env.DEV) console.log('Supabase offline, running in dev mode');
      }
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await get().fetchProfile(session.user.id, session.user.email);
      } else {
        set({ loading: false });
      }
    } catch (err) {
      console.error('[auth.init]', err);
      toast.error('Ошибка авторизации');
      set({ loading: false });
    }
  },

  // Получить профиль из таблицы profiles
  fetchProfile: async (id, email) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    if (data) {
      set({
        user: { id, email, name: data.name || email, role: data.role || 'manager', approved: data.approved },
        loading: false,
        error: null,
      });
    } else {
      set({ user: { id, email, name: email, role: 'manager', approved: false }, loading: false });
    }
  },

  // Вход
  login: async (email, password) => {
    set({ error: null, loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: translateSupabaseError(error.message), loading: false });
      return false;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await get().fetchProfile(session.user.id, session.user.email);
    }
    return true;
  },

  // Регистрация
  register: async (name, email, password) => {
    set({ error: null, loading: true });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      set({ error: translateSupabaseError(error.message), loading: false });
      return false;
    }
    // Создаём профиль
    if (data?.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        name,
        email,
        role: 'manager',
        approved: false,
      });
      set({
        user: { id: data.user.id, email, name, role: 'manager', approved: false },
        loading: false,
      });
    }
    return true;
  },

  // Выход
  logout: async () => {
    await supabase.auth.signOut();
    storageClearAll();
    set({ user: null, error: null });
  },

  clearError: () => set({ error: null }),

  // ─── Preview role (admin/director only, in-memory) ───
  setPreviewRole: (role) => set({ previewRole: role }),
  clearPreviewRole: () => set({ previewRole: null }),
  effectiveRole: () => get().previewRole || get().user?.role,

  // ─── Role helpers (use effectiveRole for UI visibility) ───
  isAdmin: () => ['admin', 'director'].includes(get().effectiveRole()),
  isROP: () => ['admin', 'director', 'rop'].includes(get().effectiveRole()),
  isProduction: () => get().effectiveRole() === 'production',
  isDesigner: () => get().effectiveRole() === 'designer',
}));
