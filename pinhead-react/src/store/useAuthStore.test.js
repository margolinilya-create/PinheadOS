import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../lib/supabase';

// Mock supabase before importing the store
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'new-id' }, session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
      resend: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      upsert: vi.fn().mockResolvedValue({}),
    })),
  },
}));

// Must import after mock
const { useAuthStore, watchAuthState } = await import('./useAuthStore');
const { useErpStore } = await import('../erp/store/useErpStore');
const { useOrdersStore } = await import('./useOrdersStore');

beforeEach(() => {
  useAuthStore.setState({
    user: null, profileStatus: 'no_profile', loading: false, error: null,
    previewRole: null, signingOut: false,
    awaitingEmailConfirm: null, resendingConfirm: false, checkingProfile: false,
    resetSentTo: null, sendingReset: false, passwordRecovery: false, savingPassword: false,
    initializing: false,
  });
});

/**
 * Первичная проверка сессии — своё состояние, отдельное от `loading`.
 *
 * `loading` поднимает каждое действие авторизации, и пока экран загрузки
 * приложения стоял на нём, форма на время входа размонтировалась и возвращалась
 * с пустыми полями, а исход регистрации приходил в компонент, которого больше
 * нет. Флаг обязан сниматься на ЛЮБОМ выходе из `init()` — оставшийся поднятым
 * означает белый экран навсегда.
 */
describe('useAuthStore — первичная проверка сессии', () => {
  it('снимается, когда сессии нет', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    useAuthStore.setState({ initializing: true });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().initializing).toBe(false);
  });

  it('снимается и когда сессию не удалось спросить вовсе', async () => {
    const { supabase } = await import('../lib/supabase');
    // getSession БРОСАЕТ, когда ответа не было (нет сети, клиент не настроен)
    supabase.auth.getSession.mockRejectedValueOnce(new TypeError('Load failed'));
    useAuthStore.setState({ initializing: true });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().initializing).toBe(false);
  });

  it('действие авторизации его не поднимает — иначе экран пересоберётся', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null }, error: { message: 'Invalid login credentials' },
    });

    await useAuthStore.getState().login('za@pnhd.ru', 'wrong');

    expect(useAuthStore.getState().initializing).toBe(false);
  });
});

/**
 * Регистрация при включённом подтверждении адреса.
 *
 * `signUp` не создаёт сессию, пока человек не откроет ссылку из письма. Прежний
 * код клал `user` в стор при любом исходе — App рисовал стену «аккаунт ещё
 * не подтверждён администратором», хотя администратор мог одобрить доступ сразу
 * (в базе `approved=true`), а не хватало подтверждения ПОЧТЫ. Сессии при этом
 * нет: перечитать профиль нечем, F5 уносит на форму входа, вход отвечает
 * `email_not_confirmed`. Так застряли две учётные записи, обе одобренные.
 */
describe('useAuthStore — регистрация и подтверждение адреса', () => {
  it('без сессии не подделывает пользователя, а просит подтвердить почту', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'new-id' }, session: null }, error: null,
    });

    const outcome = await useAuthStore.getState().register('Марина', 'm@pinhead.ru', 'secret123');

    expect(outcome).toBe('confirm_email');
    expect(useAuthStore.getState().awaitingEmailConfirm).toBe('m@pinhead.ru');
    // Именно это и рисовало ложную стену «ждите администратора»
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('имя уходит в метаданные — профиль заводит серверный триггер', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'new-id' }, session: null }, error: null,
    });

    await useAuthStore.getState().register('Марина', 'm@pinhead.ru', 'secret123');

    expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'm@pinhead.ru',
      options: expect.objectContaining({ data: { name: 'Марина' } }),
    }));
  });

  it('с сессией (подтверждение выключено) читает профиль из базы', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u9' }, session: { user: { id: 'u9', email: 'm@pinhead.ru' } } },
      error: null,
    });
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { name: 'Марина', role: 'manager', approved: false, active: true }, error: null,
      }),
    });

    const outcome = await useAuthStore.getState().register('Марина', 'm@pinhead.ru', 'secret123');

    expect(outcome).toBe('signed_in');
    expect(useAuthStore.getState().profileStatus).toBe('pending_approval');
    expect(useAuthStore.getState().user?.name).toBe('Марина');
  });

  it('signUp БРОСАЕТ (нет сети) — кнопка не остаётся в «Регистрация...»', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockRejectedValueOnce(new TypeError('Load failed'));

    const outcome = await useAuthStore.getState().register('Марина', 'm@pinhead.ru', 'secret123');

    expect(outcome).toBe('failed');
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/нет связи с сервером/);
  });

  it('вход в неподтверждённый аккаунт ведёт на экран письма, а не в красную строку', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null }, error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    const ok = await useAuthStore.getState().login('m@pinhead.ru', 'secret123');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().awaitingEmailConfirm).toBe('m@pinhead.ru');
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('неверный пароль остаётся обычной ошибкой формы', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null }, error: { message: 'Invalid login credentials' },
    });

    await useAuthStore.getState().login('m@pinhead.ru', 'wrong');

    expect(useAuthStore.getState().awaitingEmailConfirm).toBeNull();
    expect(useAuthStore.getState().error).toBe('Неверный email или пароль');
  });

  it('повторная отправка письма шлёт запрос на сохранённый адрес', async () => {
    const { supabase } = await import('../lib/supabase');
    useAuthStore.setState({ awaitingEmailConfirm: 'm@pinhead.ru' });

    const ok = await useAuthStore.getState().resendConfirmation();

    expect(ok).toBe(true);
    expect(supabase.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'm@pinhead.ru' }),
    );
    expect(useAuthStore.getState().resendingConfirm).toBe(false);
  });
});

/**
 * Одобрение админом происходит в другой вкладке, и подписки на собственный
 * профиль нет: без ручной перепроверки человек стоит на стене уже одобренным.
 */
describe('useAuthStore — refreshProfile', () => {
  it('перечитывает профиль и снимает стену после одобрения', async () => {
    const { supabase } = await import('../lib/supabase');
    useAuthStore.setState({
      user: { id: 'u1', email: 'm@pinhead.ru', name: 'Марина', role: 'manager', approved: false, active: true },
      profileStatus: 'pending_approval',
    });
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { name: 'Марина', role: 'manager', approved: true, active: true }, error: null,
      }),
    });

    await useAuthStore.getState().refreshProfile();

    expect(useAuthStore.getState().profileStatus).toBe('active');
    expect(useAuthStore.getState().checkingProfile).toBe(false);
  });

  /**
   * Сбой запроса — не «профиля нет». Прежний `fetchProfile` смотрел только
   * на `data`, и обрыв связи выкидывал человека с живой сессией на форму входа.
   */
  it('сбой запроса не выкидывает на форму входа', async () => {
    const { supabase } = await import('../lib/supabase');
    useAuthStore.setState({
      user: { id: 'u1', email: 'm@pinhead.ru', name: 'Марина', role: 'manager', approved: false, active: true },
      profileStatus: 'pending_approval',
    });
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new TypeError('Load failed')),
    });

    await useAuthStore.getState().refreshProfile();

    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(useAuthStore.getState().profileStatus).toBe('pending_approval');
    expect(useAuthStore.getState().checkingProfile).toBe(false);
  });
});

/**
 * Сессия и dev-автологин.
 *
 * До 10.08.2026 `init()` в dev-сборке подставлял фиктивного администратора, НЕ проверив
 * сессию, и приложение выглядело рабочим, пока запросы уходили ролью `anon`: чтение
 * возвращало пусто, запись отвечала «new row violates row-level security policy».
 * Тесты закрепляют обратный порядок: сначала настоящая сессия, автологин — только
 * вместо её отсутствия и только когда его включили явно.
 */
describe('useAuthStore — init и сессия', () => {
  it('без сессии и без автологина показывает форму входа, а не фиктивного админа', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    useAuthStore.setState({ loading: true });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('настоящая сессия важнее: профиль берётся из базы', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'uid-real', email: 'real@pinhead.ru' } } },
    });
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { name: 'Настоящий', role: 'manager', approved: true, active: true },
      }),
    });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().user?.id).toBe('uid-real');
    expect(useAuthStore.getState().user?.name).toBe('Настоящий');
  });

  it('getSession БРОСАЕТ (нет сети) — не виснем в загрузке', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.getSession.mockRejectedValueOnce(new TypeError('Load failed'));
    useAuthStore.setState({ loading: true });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('useAuthStore — потеря сессии', () => {
  it('sessionLost сбрасывает пользователя и объясняет причину', () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', approved: true, active: true },
      profileStatus: 'active',
    });

    useAuthStore.getState().sessionLost();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profileStatus).toBe('no_profile');
    expect(useAuthStore.getState().error).toMatch(/Сессия истекла/);
  });

  it('собственный выход потерей сессии не считается', () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', approved: true, active: true },
      signingOut: true,
    });

    useAuthStore.getState().sessionLost();

    // Стор чистит сам logout; sessionLost не должен показывать «сессия истекла»
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('watchAuthState на SIGNED_OUT сбрасывает данные', async () => {
    const { supabase } = await import('../lib/supabase');
    let handler = null;
    supabase.auth.onAuthStateChange.mockImplementationOnce((cb) => {
      handler = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', approved: true, active: true },
      profileStatus: 'active',
    });

    const unsubscribe = watchAuthState();
    handler('SIGNED_OUT', null);

    expect(useAuthStore.getState().user).toBeNull();
    unsubscribe();
  });
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

  /**
   * ПРЕДПРОСМОТР РОЛИ НЕ ПЕРЕЖИВАЕТ СМЕНУ ЧЕЛОВЕКА.
   *
   * `logout()` и `sessionLost()` перечисляли поля поимённо, каждый свой набор,
   * и `previewRole` не попал ни в один. Админ смотрел раздел глазами дизайнера,
   * выходил, на том же цеховом планшете входил менеджер — и получал интерфейс
   * дизайнера: `OrderStudioApp` считает `effectiveRole = previewRole ||
   * user.role`. Снять предпросмотр менеджер не мог, потому что
   * `RolePreviewBar` рисуется только тем, чья НАСТОЯЩАЯ роль admin/director.
   */
  it('выход снимает предпросмотр роли', async () => {
    useAuthStore.setState({ user: { id: '1', role: 'admin' }, previewRole: 'designer' });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().previewRole).toBeNull();
  });

  it('потеря сессии снимает предпросмотр роли', () => {
    useAuthStore.setState({
      user: { id: '1', role: 'admin' }, previewRole: 'designer', signingOut: false,
    });
    useAuthStore.getState().sessionLost();
    expect(useAuthStore.getState().previewRole).toBeNull();
    // …и объяснение остаётся: тем сброс и отличается от обычного выхода
    expect(useAuthStore.getState().error).toBeTruthy();
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
      maybeSingle: vi.fn().mockResolvedValue({
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
      maybeSingle: vi.fn().mockResolvedValue({
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
      maybeSingle: vi.fn().mockResolvedValue({
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
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });
    await useAuthStore.getState().fetchProfile('uid-4', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('no_profile');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

/**
 * Выход при обрыве связи.
 *
 * `signOut()` на сетевом сбое возвращает ошибку ДО удаления сессии — токен
 * остаётся в localStorage. Экран показывал форму входа, а сессия была жива:
 * на общем цеховом планшете следующий работник жал F5 и получал полный доступ
 * предыдущего пользователя без пароля.
 */
describe('logout завершает сессию даже без сети', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', email: 'a@b.c', role: 'admin' }, signingOut: false });
  });

  it('при ошибке сервера рвёт сессию локально', async () => {
    const calls = [];
    supabase.auth.signOut = vi.fn(async (opts) => {
      calls.push(opts?.scope ?? 'global');
      return calls.length === 1 ? { error: { message: 'Failed to fetch' } } : { error: null };
    });
    await useAuthStore.getState().logout();
    expect(calls).toEqual(['global', 'local']);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('при БРОСКЕ тоже рвёт сессию и снимает флаг', async () => {
    const calls = [];
    supabase.auth.signOut = vi.fn(async (opts) => {
      if (!opts) throw new Error('Failed to fetch');
      calls.push(opts.scope);
      return { error: null };
    });
    await useAuthStore.getState().logout();
    expect(calls).toEqual(['local']);
    expect(useAuthStore.getState().user).toBeNull();
    // Флаг обязан сняться: иначе sessionLost() навсегда становится no-op
    expect(useAuthStore.getState().signingOut).toBe(false);
  });

  it('успешный выход второй раз не зовёт', async () => {
    const calls = [];
    supabase.auth.signOut = vi.fn(async (opts) => {
      calls.push(opts?.scope ?? 'global');
      return { error: null };
    });
    await useAuthStore.getState().logout();
    expect(calls).toEqual(['global']);
    expect(useAuthStore.getState().signingOut).toBe(false);
  });
});

/**
 * Забытый пароль и приглашение на уже заведённый адрес.
 *
 * На проде это сошлось в один тупик: приглашение выписали на адрес, у которого
 * уже была (отключённая) учётная запись. Девять попыток регистрации подряд —
 * все `422 user_already_exists`, две попытки входа — обе мимо пароля,
 * а восстановления пароля в интерфейсе не было вовсе.
 */
describe('useAuthStore — тупик «адрес уже заведён»', () => {
  it('повторная регистрация отличается от ошибки формы', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    });

    const outcome = await useAuthStore.getState().register('Нина', 'za@pnhd.ru', 'secret123');

    expect(outcome).toBe('already_registered');
    // Красной строки быть не должно: человеку нужен вход, а не исправление формы
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('прочие отказы регистрации остаются ошибкой формы', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters' },
    });

    const outcome = await useAuthStore.getState().register('Нина', 'n@pinhead.ru', '123');

    expect(outcome).toBe('failed');
    expect(useAuthStore.getState().error).toMatch(/не короче 6/);
  });
});

describe('useAuthStore — восстановление пароля', () => {
  it('письмо уходит на указанный адрес и экран его называет', async () => {
    const { supabase } = await import('../lib/supabase');

    const ok = await useAuthStore.getState().requestPasswordReset('za@pnhd.ru');

    expect(ok).toBe(true);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'za@pnhd.ru', expect.objectContaining({ redirectTo: expect.any(String) }),
    );
    expect(useAuthStore.getState().resetSentTo).toBe('za@pnhd.ru');
    expect(useAuthStore.getState().sendingReset).toBe(false);
  });

  it('сбой отправки называет причину и не показывает ложный успех', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'Email rate limit exceeded' },
    });

    const ok = await useAuthStore.getState().requestPasswordReset('za@pnhd.ru');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().resetSentTo).toBeNull();
    expect(useAuthStore.getState().error).toMatch(/Слишком много запросов/);
  });

  /**
   * Ссылка восстановления ВХОДИТ человека. Без этой ветки он попал бы прямо
   * в оболочку, так и не задав пароль, и вернулся бы за новой ссылкой.
   */
  it('событие восстановления поднимает форму нового пароля', async () => {
    const { supabase } = await import('../lib/supabase');
    let handler = null;
    supabase.auth.onAuthStateChange.mockImplementationOnce((cb) => {
      handler = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const unsubscribe = watchAuthState();
    handler('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'za@pnhd.ru' } });

    expect(useAuthStore.getState().passwordRecovery).toBe(true);
    unsubscribe();
  });

  it('новый пароль сохраняется и снимает форму', async () => {
    const { supabase } = await import('../lib/supabase');
    useAuthStore.setState({ passwordRecovery: true });
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });

    const ok = await useAuthStore.getState().completePasswordReset('newsecret123');

    expect(ok).toBe(true);
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newsecret123' });
    expect(useAuthStore.getState().passwordRecovery).toBe(false);
    expect(useAuthStore.getState().savingPassword).toBe(false);
  });

  it('отказ смены пароля оставляет форму на месте', async () => {
    const { supabase } = await import('../lib/supabase');
    useAuthStore.setState({ passwordRecovery: true });
    supabase.auth.updateUser.mockResolvedValueOnce({ error: { message: 'Auth session missing!' } });

    const ok = await useAuthStore.getState().completePasswordReset('newsecret123');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().passwordRecovery).toBe(true);
    expect(useAuthStore.getState().error).toBeTruthy();
  });
});
