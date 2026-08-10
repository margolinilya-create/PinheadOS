import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { storageClearAll } from '../lib/storage';
import { toast } from './useToastStore';
import { runAppResets } from './appReset';
import { useOrdersStore } from './useOrdersStore';
import { networkFailureMessage, translateSupabaseError } from '../utils/i18n';
import type { User, UserRole, ProfileStatus } from '../types/auth';

/**
 * Dev-автологин: фиктивный администратор ВМЕСТО отсутствующей сессии.
 *
 * Раньше он включался от `import.meta.env.DEV`, то есть у любого, кто запустил
 * `npm run dev` — в том числе против боевой базы. Интерфейс показывал полный
 * доступ администратора и не показывал формы входа, а запросы уходили в Supabase
 * ролью `anon`: чтение возвращало пусто («Не удалось загрузить производственный
 * план», «…историю заказа», «…заказ»), запись отвечала `new row violates
 * row-level security policy`. Человек не мог понять, что он просто не вошёл.
 *
 * Проверено на проде 10.08.2026: под `authenticated` вставка в `storage.objects`
 * проходит, под `anon` — 42501 с этим самым текстом, который Storage отдаёт как
 * HTTP 400. На этом не загружалось ни одно ТЗ.
 *
 * Теперь режим включается ЯВНО (`VITE_DEV_AUTOLOGIN=1`) и только когда настоящей
 * сессии нет: сессия всегда важнее подделки.
 */
const DEV_AUTOLOGIN = import.meta.env.VITE_DEV_AUTOLOGIN === '1';

const DEV_USER: User = {
  id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode',
  role: 'admin', approved: true, active: true,
};

interface AuthStore {
  user: User | null;
  profileStatus: ProfileStatus;
  loading: boolean;
  error: string | null;
  previewRole: UserRole | null;

  /** true, пока идёт наш собственный выход — чтобы не путать его с потерей сессии */
  signingOut: boolean;

  init: () => Promise<void>;
  fetchProfile: (id: string, email: string) => Promise<void>;
  /** Сессия кончилась не по воле человека: сбросить данные и объяснить, что делать */
  sessionLost: () => void;
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
  signingOut: false,

  // Инициализация — сначала настоящая сессия, и только потом всё остальное
  init: async () => {
    let session = null;
    try {
      const { data } = await supabase.auth.getSession();
      session = data.session;
    } catch (err) {
      // getSession БРОСАЕТ, когда ответа не было (нет сети, клиент не настроен)
      console.error('[auth.init]', err);
      if (!DEV_AUTOLOGIN) {
        toast.error('Ошибка авторизации');
        set({ loading: false });
        return;
      }
    }

    if (session?.user) {
      await get().fetchProfile(session.user.id, session.user.email!);
      return;
    }

    if (DEV_AUTOLOGIN) {
      console.warn(
        '[auth] dev-автологин: настоящей сессии нет. Запросы уходят ролью anon — '
        + 'чтение вернёт пусто, запись откажет по RLS. Войдите, чтобы работать с данными.',
      );
      set({ user: DEV_USER, profileStatus: 'active' as ProfileStatus, loading: false, error: null });
      return;
    }

    set({ loading: false });
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

  /**
   * Сессия кончилась сама: истёк refresh-токен, доступ отозвали, вышли в соседней
   * вкладке. Раньше приложение об этом не узнавало вовсе — оно продолжало
   * показывать заказы из памяти и слать запросы ролью `anon`, а человек получал
   * «нарушение политики безопасности» на каждое действие и не понимал, почему.
   */
  sessionLost: () => {
    if (get().signingOut || !get().user) return;
    /**
     * Dev-автологин сессии и не имел, терять ему нечего. Без этой строки
     * `SIGNED_OUT`, который клиент присылает при старте без действующей сессии,
     * выкидывал бы разработчика (и весь e2e-прогон) на форму входа с сообщением
     * «сессия истекла» — про сессию, которой никогда не было.
     */
    if (get().user?.id === 'dev') return;
    storageClearAll();
    runAppResets();
    useOrdersStore.setState({
      orders: [], loading: false, hasMore: true, loadingMore: false,
      lastCreatedAt: null, filter: 'all', search: '',
    });
    set({
      user: null,
      profileStatus: 'no_profile' as ProfileStatus,
      error: 'Сессия истекла — войдите заново',
      loading: false,
    });
    toast.error('Сессия истекла — войдите заново');
  },

  /**
   * Выход обязан завершить сессию ДАЖЕ когда сервер не ответил.
   *
   * `supabase.auth.signOut()` при сетевом сбое возвращает ошибку ДО того, как
   * удалит сессию: токен остаётся в localStorage. Мы показывали тост, чистили
   * свои сторы и рисовали форму входа — человек уверен, что вышел, а сессия
   * жива. На общем цеховом планшете следующий работник жмёт F5, `init()`
   * находит живой refresh-токен и получает полный доступ ПРЕДЫДУЩЕГО
   * пользователя без пароля. Переживает и закрытие вкладки.
   *
   * `scope: 'local'` в сеть не ходит и удаляет сессию сразу — это и есть
   * настоящий выход, когда до сервера не достучаться.
   *
   * Чистка и снятие флага — в `finally`. Если `signOut()` БРОСИТ, прежний код
   * не чистил ничего и оставлял `signingOut = true` навсегда, а вместе с ним
   * навсегда отключал `sessionLost()`: настоящая потеря сессии переставала
   * сбрасывать сторы и предупреждать человека.
   */
  logout: async () => {
    set({ signingOut: true });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        await supabase.auth.signOut({ scope: 'local' });
        toast.error(translateSupabaseError(error.message));
      }
    } catch (e) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      toast.error(networkFailureMessage(e));
    } finally {
      storageClearAll();
      /**
       * Сторы данных чистятся вместе с localStorage. Раньше чистился только он,
       * а данные оставались в памяти вкладки: у ERP-стора флаги `loaded`/`myDeptLoaded`
       * оставались `true`, и `ErpLayout` при следующем входе не делал ни одного запроса —
       * на общем цеховом планшете следующий работник видел заказы предыдущего
       * (выборку RLS уже от чужого имени), его цех и его бейджи.
       */
      runAppResets();
      useOrdersStore.setState({
        orders: [], loading: false, hasMore: true, loadingMore: false,
        lastCreatedAt: null, filter: 'all', search: '',
      });
      set({
        user: null, profileStatus: 'no_profile' as ProfileStatus, error: null, signingOut: false,
      });
    }
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

/**
 * Следим за сессией всё время работы, а не только на старте.
 *
 * `init()` проверял её ровно один раз при загрузке страницы, и дальше приложение
 * жило с предположением «раз вошли — значит вошли». Смена вкладки, отозванный
 * доступ, истёкший refresh-токен (`Invalid Refresh Token: Refresh Token Not Found`
 * в auth-логах прода) — всё это проходило мимо: интерфейс оставался прежним,
 * запросы уходили ролью `anon`, а человеку доставались отказы RLS вперемешку
 * с сетевыми ошибками.
 *
 * Возвращает функцию отписки — она нужна тестам, приложение живёт до закрытия вкладки.
 */
export function watchAuthState(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const store = useAuthStore.getState();

    if (event === 'SIGNED_OUT') {
      store.sessionLost();
      return;
    }

    // Вошли в соседней вкладке или токен обновился, а профиля в памяти нет —
    // подтягиваем, иначе экран останется формой входа при живой сессии.
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user && !store.user) {
      void store.fetchProfile(session.user.id, session.user.email ?? '');
    }
  });
  return () => data.subscription.unsubscribe();
}
