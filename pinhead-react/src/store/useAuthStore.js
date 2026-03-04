import { create } from 'zustand';
import { supabase } from '../lib/supabase';

// ─── DEV MODE: bypass авторизации (как в оригинале v1.7) ───
// Если true — пропускаем логин, role = manager, userName = 'Test User'
const DEV_MODE = true;

export const useAuthStore = create((set, get) => ({
  user: null,       // { id, email, name, role }
  loading: true,
  error: null,

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
        console.log('Supabase offline, running in dev mode');
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
    } catch {
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
      set({ error: error.message, loading: false });
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
      set({ error: error.message, loading: false });
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
    set({ user: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
