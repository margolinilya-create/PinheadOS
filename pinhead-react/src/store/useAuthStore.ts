import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { storageClearAll } from '../lib/storage';
import { toast } from './useToastStore';
import { runAppResets } from './appReset';
import { useOrdersStore } from './useOrdersStore';
import { networkFailureMessage, translateSupabaseError } from '../utils/i18n';
import type { User, UserRole, ProfileStatus, Profile } from '../types/auth';

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
 * Что человеку делать дальше после регистрации.
 *
 * `confirm_email` — сессии нет, в проекте включено подтверждение адреса:
 * пока не пройдена ссылка из письма, войти нельзя ничем.
 * `signed_in` — сессия есть, дальше решает ПРОФИЛЬ: пришедший по приглашению
 * попадает прямо в оболочку (он уже одобрен), пришедший сам — на стену
 * ожидания. Исход не называется «ждите одобрения» именно поэтому: с приходом
 * приглашений это перестало быть правдой для основного пути.
 */
export type RegisterOutcome = 'confirm_email' | 'signed_in' | 'already_registered' | 'failed';

/**
 * Куда вернуть человека по ссылке из письма — в то приложение, откуда он
 * регистрировался. Без этого адрес берётся из Site URL проекта, а там может
 * стоять чей-то `localhost`, и ссылка уводит в никуда.
 */
function appOrigin(): string | undefined {
  return typeof window !== 'undefined' ? window.location.origin : undefined;
}

/**
 * Адрес уже заведён.
 *
 * Для приглашения это ТУПИК, а не обычная ошибка формы: `signUp` вторую учётную
 * запись на существующий адрес не создаёт, поэтому ссылка не сработает никогда,
 * сколько её ни открывай. На проде так и вышло — девять попыток подряд с одним
 * и тем же `422 user_already_exists`, потому что экран показывал сухое
 * «Пользователь уже зарегистрирован» и не говорил, куда идти.
 */
function isAlreadyRegistered(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'user_already_exists' || error.message === 'User already registered';
}

/** Отказ входа именно из-за неподтверждённого адреса, а не из-за пароля */
function isEmailNotConfirmed(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'email_not_confirmed' || error.message === 'Email not confirmed';
}

interface AuthStore {
  user: User | null;
  profileStatus: ProfileStatus;
  /** Идёт действие авторизации: вход, регистрация. Гасит кнопку формы */
  loading: boolean;
  /**
   * Идёт ПЕРВИЧНАЯ проверка сессии — единственное состояние, ради которого
   * приложение имеет право показать пустой экран загрузки вместо формы.
   *
   * Отдельный флаг, а не `loading`: на общем App подменял форму глобальным
   * «Загрузка…» на время КАЖДОГО входа и КАЖДОЙ регистрации, а по возвращении
   * монтировал её заново — с пустыми полями и потерянным состоянием экрана.
   * На приглашении это съедало объяснение «такой сотрудник уже заведён»
   * (`already_registered` приходил в размонтированный компонент), а на входе —
   * набранный адрес: человек после неудачной попытки вводил всё заново.
   */
  initializing: boolean;
  error: string | null;
  previewRole: UserRole | null;

  /** true, пока идёт наш собственный выход — чтобы не путать его с потерей сессии */
  signingOut: boolean;

  /** Адрес, ждущий подтверждения по письму: регистрация или вход в неподтверждённый аккаунт */
  awaitingEmailConfirm: string | null;
  /** Идёт повторная отправка письма с подтверждением */
  resendingConfirm: boolean;
  /** Идёт ручная перепроверка профиля («Проверить снова» на стене ожидания) */
  checkingProfile: boolean;

  /** Адрес, на который ушло письмо восстановления пароля */
  resetSentTo: string | null;
  sendingReset: boolean;
  /** Человек пришёл по ссылке восстановления: форма нового пароля перекрывает всё */
  passwordRecovery: boolean;
  savingPassword: boolean;

  init: () => Promise<void>;
  fetchProfile: (id: string, email: string) => Promise<void>;
  /** Перечитать свой профиль по требованию — админ мог одобрить доступ только что */
  refreshProfile: () => Promise<void>;
  /** Сессия кончилась не по воле человека: сбросить данные и объяснить, что делать */
  sessionLost: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  register: (
    name: string,
    email: string,
    password: string,
    options?: { inviteCode?: string },
  ) => Promise<RegisterOutcome>;
  /** Выслать письмо с подтверждением адреса заново */
  resendConfirmation: () => Promise<boolean>;
  /** Уйти с экрана «подтвердите адрес» обратно на форму входа */
  clearEmailConfirm: () => void;
  /** Выслать письмо со ссылкой на смену пароля */
  requestPasswordReset: (email: string) => Promise<boolean>;
  /** Задать новый пароль, придя по ссылке из письма */
  completePasswordReset: (password: string) => Promise<boolean>;
  clearPasswordReset: () => void;
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
  loading: false,
  initializing: true,
  error: null,
  previewRole: null,
  signingOut: false,
  awaitingEmailConfirm: null,
  resendingConfirm: false,
  checkingProfile: false,
  resetSentTo: null,
  sendingReset: false,
  passwordRecovery: false,
  savingPassword: false,

  // Инициализация — сначала настоящая сессия, и только потом всё остальное
  init: async () => {
    // `finally`, а не строка в конце: у веток ниже свои `return`, и экран
    // загрузки, оставшийся висеть на одной из них, — это белый экран навсегда
    try {
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
    } finally {
      set({ initializing: false });
    }
  },

  /**
   * Профиль из базы.
   *
   * `maybeSingle`, а не `single`: у `single` отсутствие строки — это ОШИБКА
   * (`PGRST116`), и отличить «профиля ещё нет» от «запрос не прошёл» стало бы
   * нельзя. Прежний код смотрел только на `data` и обе беды называл одинаково:
   * сбой сети при живой сессии превращался в `no_profile`, то есть в форму
   * входа без единого слова о том, что случилось.
   */
  fetchProfile: async (id, email) => {
    let data: Partial<Profile> | null = null;
    let error: { message: string } | null = null;
    try {
      ({ data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle());
    } catch (e) {
      // supabase-js БРОСАЕТ, когда ответа не было вовсе (нет сети, CORS)
      error = { message: networkFailureMessage(e) };
    }

    if (error) {
      // Пользователя в памяти НЕ трогаем: на стене ожидания это кнопка
      // «Проверить снова», и обрыв связи не должен выкидывать на форму входа.
      set({ loading: false });
      toast.error(`Не удалось загрузить профиль: ${translateSupabaseError(error.message)}`);
      return;
    }

    if (data) {
      const active = data.active !== false;
      const approved = data.approved === true;
      const status: ProfileStatus = !active ? 'disabled' : approved ? 'active' : 'pending_approval';
      set({
        user: { id, email, name: data.name || email, role: (data.role as UserRole) || 'manager', approved, active },
        profileStatus: status,
        loading: false,
        error: null,
      });
    } else {
      set({ user: null, profileStatus: 'no_profile', loading: false });
    }
  },

  /**
   * Перечитать свой профиль по требованию.
   *
   * Одобрение админом меняет строку в `profiles`, но вкладка человека об этом
   * не узнаёт: подписки на собственный профиль нет, а `fetchProfile` зовётся
   * только при старте и при входе. Человек, стоящий на стене ожидания, видел
   * её и после одобрения — до тех пор, пока сам не догадается нажать F5.
   */
  refreshProfile: async () => {
    const current = get().user;
    if (!current || current.id === 'dev' || get().checkingProfile) return;
    set({ checkingProfile: true });
    try {
      await get().fetchProfile(current.id, current.email);
    } finally {
      set({ checkingProfile: false });
    }
  },

  login: async (email, password) => {
    set({ error: null, loading: true, awaitingEmailConfirm: null });

    let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    try {
      result = await supabase.auth.signInWithPassword({ email, password });
    } catch (e) {
      // Ответа не было вовсе — без этой ветки кнопка навсегда остаётся «Вход...»
      set({ error: `Не удалось войти: ${networkFailureMessage(e)}`, loading: false });
      return false;
    }

    if (result.error) {
      /**
       * «Email не подтверждён» — это не ошибка ввода, а незаконченная
       * регистрация, и человеку нужно не исправить пароль, а открыть письмо.
       * Прежде здесь была одна строка красным текстом без единой подсказки,
       * что делать дальше: две учётные записи так и остались невошедшими.
       */
      if (isEmailNotConfirmed(result.error)) {
        set({ awaitingEmailConfirm: email, error: null, loading: false });
        return false;
      }
      set({ error: translateSupabaseError(result.error.message), loading: false });
      return false;
    }

    const session = result.data.session;
    if (session?.user) {
      await get().fetchProfile(session.user.id, session.user.email ?? email);
    } else {
      set({ loading: false });
    }
    return true;
  },

  /**
   * Регистрация.
   *
   * `signUp` НЕ создаёт сессию, когда в проекте включено подтверждение адреса
   * («Confirm email»): человек получает письмо, и до перехода по ссылке войти
   * нельзя ничем. Прежний код этого не различал — он клал `user` в стор при
   * любом исходе, и App рисовал стену «Ваш аккаунт ещё не подтверждён
   * администратором». Администратор при этом мог одобрить доступ хоть сразу
   * (`approved=true` в базе), а стена не менялась: сессии нет, перечитать
   * профиль нечем, F5 уносит на форму входа, а вход отвечает
   * `email_not_confirmed`. Человеку показывали ожидание того, что уже сделано,
   * и ни словом не упоминали письмо — на этом застряли ДВЕ учётные записи,
   * обе одобренные администратором.
   *
   * Имя уходит в метаданные: профиль заводит серверный триггер
   * `handle_new_user`, он читает `raw_user_meta_data->>'name'`. Клиентский
   * `profiles.upsert` стоял здесь зря — RLS разрешает INSERT и UPDATE только
   * `is_admin()`, а его ошибку молча игнорировали, поэтому у всех, кто
   * регистрировался сам, имя в базе равно адресу почты.
   */
  register: async (name, email, password, options) => {
    set({ error: null, loading: true, awaitingEmailConfirm: null });

    let result: Awaited<ReturnType<typeof supabase.auth.signUp>>;
    try {
      result = await supabase.auth.signUp({
        email,
        password,
        options: {
          /**
           * Код приглашения уходит теми же метаданными, что и имя, и его читает
           * тот же серверный триггер. Проверяется он ТОЛЬКО там: сюда его кладёт
           * клиент, а значит подделать можно что угодно. Триггер гасит код
           * атомарным `update … returning` — по сроку, отзыву и адресу.
           */
          data: options?.inviteCode ? { name, invite_code: options.inviteCode } : { name },
          emailRedirectTo: appOrigin(),
        },
      });
    } catch (e) {
      set({ error: `Не удалось зарегистрироваться: ${networkFailureMessage(e)}`, loading: false });
      return 'failed';
    }

    if (result.error) {
      if (isAlreadyRegistered(result.error)) {
        // Не ошибка ввода: исправлять человеку нечего, ему нужен вход
        set({ error: null, loading: false });
        return 'already_registered';
      }
      set({ error: translateSupabaseError(result.error.message), loading: false });
      return 'failed';
    }

    const session = result.data.session;
    if (!session) {
      set({
        user: null,
        profileStatus: 'no_profile' as ProfileStatus,
        awaitingEmailConfirm: email,
        loading: false,
      });
      return 'confirm_email';
    }

    await get().fetchProfile(session.user.id, session.user.email ?? email);
    return 'signed_in';
  },

  /**
   * Повторная отправка письма. Встроенный SMTP Supabase режет частоту и охотно
   * попадает в спам, поэтому «письмо не пришло» — обычный случай, а не редкость,
   * и выход из него должен быть на самом экране.
   */
  resendConfirmation: async () => {
    const email = get().awaitingEmailConfirm;
    if (!email || get().resendingConfirm) return false;
    set({ resendingConfirm: true, error: null });
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: appOrigin() },
      });
      if (error) {
        set({ error: translateSupabaseError(error.message) });
        return false;
      }
      toast.success('Письмо отправлено повторно');
      return true;
    } catch (e) {
      set({ error: `Не удалось отправить письмо: ${networkFailureMessage(e)}` });
      return false;
    } finally {
      set({ resendingConfirm: false });
    }
  },

  clearEmailConfirm: () => set({ awaitingEmailConfirm: null, error: null }),

  /**
   * Забытый пароль.
   *
   * Восстановления не было ВООБЩЕ — ни кнопки, ни экрана. Человек, не помнящий
   * пароль, упирался в «Неверный email или пароль» и не имел ни одного выхода:
   * повторная регистрация отвечает «адрес уже заведён», а сменить пароль
   * некому — админ этого не умеет. Именно в эту дыру и попал сотрудник,
   * которому выписали приглашение на уже существующий адрес.
   */
  requestPasswordReset: async (email) => {
    if (!email || get().sendingReset) return false;
    set({ sendingReset: true, error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appOrigin(),
      });
      if (error) {
        set({ error: translateSupabaseError(error.message) });
        return false;
      }
      set({ resetSentTo: email });
      return true;
    } catch (e) {
      set({ error: `Не удалось отправить письмо: ${networkFailureMessage(e)}` });
      return false;
    } finally {
      set({ sendingReset: false });
    }
  },

  /**
   * Новый пароль по ссылке из письма.
   *
   * Ссылка восстановления ВХОДИТ человека — Supabase выдаёт сессию и присылает
   * `PASSWORD_RECOVERY`. Без этого экрана он оказался бы просто внутри, так
   * и не задав пароль, и в следующий раз пришёл бы за новой ссылкой. Поэтому
   * форма перекрывает всё остальное, пока пароль не сменён.
   */
  completePasswordReset: async (password) => {
    if (get().savingPassword) return false;
    set({ savingPassword: true, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        set({ error: translateSupabaseError(error.message) });
        return false;
      }
      set({ passwordRecovery: false });
      toast.success('Пароль изменён');
      // Профиль подтянется сам: сессия уже есть, дальше решает стена или оболочка
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        await get().fetchProfile(data.session.user.id, data.session.user.email ?? '');
      }
      return true;
    } catch (e) {
      set({ error: `Не удалось сменить пароль: ${networkFailureMessage(e)}` });
      return false;
    } finally {
      set({ savingPassword: false });
    }
  },

  clearPasswordReset: () => set({ resetSentTo: null, error: null }),

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
        awaitingEmailConfirm: null, resetSentTo: null, passwordRecovery: false,
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

    /**
     * Ссылка восстановления вошла человека в систему. Без этой ветки он попал бы
     * прямо в оболочку, так и не задав пароль, — и в следующий раз пришёл бы
     * за новой ссылкой.
     */
    if (event === 'PASSWORD_RECOVERY') {
      useAuthStore.setState({ passwordRecovery: true, resetSentTo: null });
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
