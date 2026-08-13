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

/**
 * Чем кончилась регистрация.
 *
 * Булев ответ здесь не годится: после регистрации экран обязан сказать РАЗНОЕ —
 * «проверьте почту», «вы уже вошли, ждите одобрения» и «этот адрес уже занят».
 * По `true/false` их не различить, и прежний код показывал всем троим один и тот
 * же текст «Администратор подтвердит доступ».
 */
export type RegisterOutcome =
  /** Аккаунт создан, адрес нужно подтвердить письмом — сессии ещё нет */
  | { status: 'confirm_email' }
  /** Подтверждение адреса выключено: сессия выдана сразу, дальше решает админ */
  | { status: 'signed_in' }
  /** Адрес уже занят (Supabase не говорит этого прямо — см. register) */
  | { status: 'already_registered' }
  /** Причина в `error` стора */
  | { status: 'error' };

interface AuthStore {
  user: User | null;
  profileStatus: ProfileStatus;
  loading: boolean;
  error: string | null;
  previewRole: UserRole | null;

  /** true, пока идёт наш собственный выход — чтобы не путать его с потерей сессии */
  signingOut: boolean;

  /**
   * Адрес, вход которому закрыт неподтверждённой почтой. Держим отдельно от
   * `error`: это единственный отказ входа, который лечится не повтором ввода,
   * а письмом, — и экран предлагает выслать его заново.
   */
  unconfirmedEmail: string | null;

  init: () => Promise<void>;
  fetchProfile: (id: string, email: string) => Promise<void>;
  /** Сессия кончилась не по воле человека: сбросить данные и объяснить, что делать */
  sessionLost: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<RegisterOutcome>;
  /** Выслать письмо с подтверждением адреса заново */
  resendConfirmation: (email: string) => Promise<boolean>;
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
  unconfirmedEmail: null,

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
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
      if (data) {
        const active = data.active !== false;
        const status: ProfileStatus = !active ? 'disabled' : data.approved ? 'active' : 'pending_approval';
        set({
          user: { id, email, name: data.name || email, role: (data.role as UserRole) || 'manager', approved: data.approved, active },
          profileStatus: status,
          loading: false,
          error: null,
        });
        return;
      }

      /**
       * Сессия есть, а профиля нет — молчать здесь нельзя.
       *
       * При `user === null` App рисует форму входа, и человек, только что
       * успешно вошедший, возвращается на неё без единого слова: выглядит
       * это как «вход не сработал», хотя пароль верный и сессия выдана.
       * Ровно так и стояли зарегистрировавшиеся до серверного триггера
       * (их профили достроены миграцией 20260813110000).
       *
       * Отсутствие строки (`PGRST116` от `.single()`) и сбой запроса —
       * разные причины, и советы у них разные.
       */
      const missing = !error || error.code === 'PGRST116';
      set({
        user: null,
        profileStatus: 'no_profile',
        loading: false,
        error: missing
          ? 'Профиль не найден. Обратитесь к администратору — учётную запись нужно завести заново.'
          : `Не удалось загрузить профиль: ${translateSupabaseError(error.message)}`,
      });
    } catch (e) {
      // supabase-js БРОСАЕТ, когда ответа не было вовсе (нет сети, CORS)
      console.error('[auth.fetchProfile]', e);
      set({
        user: null,
        profileStatus: 'no_profile',
        loading: false,
        error: `Не удалось загрузить профиль: ${networkFailureMessage(e)}`,
      });
    }
  },

  /**
   * Вход. Сетевой вызов идёт в try/catch, флаг занятости снимается в `finally`:
   * `signInWithPassword` БРОСАЕТ, когда ответа не было вовсе (нет сети, CORS),
   * и без этого кнопка навсегда оставалась в состоянии «Вход...».
   */
  login: async (email, password) => {
    set({ error: null, unconfirmedEmail: null, loading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        /**
         * «Email not confirmed» — не опечатка в пароле, а незавершённая
         * регистрация: письмо не открыли. Повтор ввода тут не поможет никогда,
         * поэтому адрес запоминается, и экран предлагает выслать письмо заново.
         */
        const needsConfirm = error.code === 'email_not_confirmed'
          || /email not confirmed/i.test(error.message);
        set({
          error: translateSupabaseError(error.message),
          unconfirmedEmail: needsConfirm ? email : null,
        });
        return false;
      }
      if (data?.session?.user) {
        await get().fetchProfile(data.session.user.id, data.session.user.email ?? email);
      }
      return true;
    } catch (e) {
      console.error('[auth.login]', e);
      set({ error: `Не удалось войти: ${networkFailureMessage(e)}` });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  /**
   * Регистрация. Профиль создаёт СЕРВЕРНЫЙ триггер `handle_new_user`
   * (миграция 20260722215558): он обходит RLS как `security definer`.
   *
   * Клиентский `upsert` в `profiles`, стоявший здесь, эту же миграцию и пережил,
   * хотя работать перестал: политика `profiles_insert` требует `is_admin()`,
   * а у регистранта в этот момент нет даже сессии. Каждая регистрация молча
   * получала 42501 (проверено на проде 13.08.2026) — результат не проверялся
   * вовсе. Единственное, что этот вызов ещё нёс, — имя; теперь оно уходит
   * в метаданные, откуда его и берёт триггер.
   */
  register: async (name, email, password) => {
    set({ error: null, unconfirmedEmail: null, loading: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          /**
           * Имя обязано уехать сюда: триггер читает
           * `raw_user_meta_data->>'name'`, а без него подставляет email. Здесь
           * имя не передавалось — и у каждого зарегистрировавшегося в списке
           * пользователей вместо имени стоял его адрес.
           */
          data: { name },
          /**
           * Ссылка из письма обязана вести туда, где человек регистрировался.
           * Без этого адрес берётся из настройки Site URL — одной на все
           * окружения, и зарегистрировавшийся на боевом домене получал ссылку
           * на localhost. Адрес должен стоять в списке Redirect URLs проекта:
           * посторонний Supabase молча заменит на Site URL.
           */
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        set({ error: translateSupabaseError(error.message) });
        return { status: 'error' };
      }

      /**
       * Занятый адрес Supabase прямо не называет — это защита от перебора почт:
       * приходит 200 и пользователь БЕЗ `identities` (проверено на проде
       * 13.08.2026). Прежний код считал такой ответ успехом и отправлял человека
       * ждать письма, которого никто не отправлял.
       */
      if (data.user && data.user.identities?.length === 0) {
        return { status: 'already_registered' };
      }

      /**
       * Подтверждение адреса включено — сессии нет, и писать пользователя в стор
       * НЕЛЬЗЯ. Прежний код его писал: приложение считало человека вошедшим,
       * а запросы уходили ролью `anon` — чтение пусто, запись отказ по RLS.
       * Это ровно тот случай, ради которого dev-автологин сделали явным.
       */
      if (!data.session) return { status: 'confirm_email' };

      // Подтверждение выключено: сессия выдана сразу, дальше решает админ.
      await get().fetchProfile(data.session.user.id, data.session.user.email ?? email);
      return { status: 'signed_in' };
    } catch (e) {
      console.error('[auth.register]', e);
      set({ error: `Не удалось зарегистрироваться: ${networkFailureMessage(e)}` });
      return { status: 'error' };
    } finally {
      set({ loading: false });
    }
  },

  resendConfirmation: async (email) => {
    set({ error: null, loading: true });
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        set({ error: translateSupabaseError(error.message) });
        return false;
      }
      toast.success(`Письмо отправлено повторно на ${email}`);
      return true;
    } catch (e) {
      console.error('[auth.resendConfirmation]', e);
      set({ error: `Не удалось отправить письмо: ${networkFailureMessage(e)}` });
      return false;
    } finally {
      set({ loading: false });
    }
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
        unconfirmedEmail: null,
      });
    }
  },

  // Предложение «выслать письмо повторно» снимается вместе с ошибкой: оно
  // относилось к конкретной неудачной попытке входа, а не к экрану вообще.
  clearError: () => set({ error: null, unconfirmedEmail: null }),

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
