import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../lib/supabase';

// Mock supabase before importing the store
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null }),
      resend: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({}),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
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
const { useAuthStore, watchAuthState } = await import('./useAuthStore');
const { useErpStore } = await import('../erp/store/useErpStore');
const { useOrdersStore } = await import('./useOrdersStore');

beforeEach(() => {
  useAuthStore.setState({
    user: null, profileStatus: 'no_profile', loading: false, error: null,
    previewRole: null, signingOut: false, unconfirmedEmail: null,
  });
});

/**
 * Регистрация.
 *
 * Проверено на проде 13.08.2026: в проекте включено подтверждение адреса, поэтому
 * `signUp` возвращает пользователя БЕЗ сессии, а профиль создаёт серверный триггер
 * `handle_new_user` из метаданных. Клиентский `upsert` в `profiles`, стоявший здесь
 * с прежних времён, отвечал 42501 на КАЖДОЙ регистрации — результат не проверялся.
 */
describe('useAuthStore — регистрация', () => {
  it('имя уходит в метаданные: оттуда его берёт серверный триггер', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u-new', identities: [{ id: 'i1' }] }, session: null }, error: null,
    });

    await useAuthStore.getState().register('Иван Петров', 'ivan@pnhd.ru', 'secret123');

    const args = supabase.auth.signUp.mock.calls.at(-1)[0];
    expect(args.options.data).toEqual({ name: 'Иван Петров' });
    // Иначе ссылка из письма ведёт на Site URL проекта — один на все окружения
    expect(args.options.emailRedirectTo).toBeTruthy();
  });

  it('мёртвого upsert в profiles больше нет: профиль пишет триггер', async () => {
    supabase.from.mockClear();
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u-new', identities: [{ id: 'i1' }] }, session: null }, error: null,
    });

    await useAuthStore.getState().register('Иван', 'ivan@pnhd.ru', 'secret123');

    expect(supabase.from).not.toHaveBeenCalledWith('profiles');
  });

  /**
   * Сессии нет — значит человек НЕ вошёл. Прежний код всё равно писал его в стор:
   * приложение считало его вошедшим и слало запросы ролью `anon` (чтение пусто,
   * запись отказ по RLS).
   */
  it('без сессии пользователь в стор не пишется', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u-new', identities: [{ id: 'i1' }] }, session: null }, error: null,
    });

    const outcome = await useAuthStore.getState().register('Иван', 'ivan@pnhd.ru', 'secret123');

    expect(outcome).toEqual({ status: 'confirm_email' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });

  /**
   * Занятый адрес Supabase не называет прямо (защита от перебора почт): 200
   * и пользователь с пустым `identities`. Прежний код считал это успехом.
   */
  it('занятый адрес отличается от успеха', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u-fake', identities: [] }, session: null }, error: null,
    });

    const outcome = await useAuthStore.getState().register('Иван', 'mib@pnhd.ru', 'secret123');

    expect(outcome).toEqual({ status: 'already_registered' });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('подтверждение выключено: сессия есть — читаем профиль', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: {
        user: { id: 'u-new', identities: [{ id: 'i1' }] },
        session: { user: { id: 'u-new', email: 'ivan@pnhd.ru' } },
      },
      error: null,
    });
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { name: 'Иван', role: 'manager', approved: false, active: true },
      }),
    });

    const outcome = await useAuthStore.getState().register('Иван', 'ivan@pnhd.ru', 'secret123');

    expect(outcome).toEqual({ status: 'signed_in' });
    expect(useAuthStore.getState().user?.name).toBe('Иван');
    expect(useAuthStore.getState().profileStatus).toBe('pending_approval');
  });

  /**
   * supabase-js БРОСАЕТ, когда ответа не было вовсе. Без try/catch отклонение
   * всплывало наружу, а `loading` оставался true — кнопка навсегда «Регистрация...».
   */
  it('при БРОСКЕ не виснет в загрузке и называет причину', async () => {
    supabase.auth.signUp.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const outcome = await useAuthStore.getState().register('Иван', 'ivan@pnhd.ru', 'secret123');

    expect(outcome).toEqual({ status: 'error' });
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/нет связи с сервером/);
  });

  it('отказ сервера показывается по-русски и не роняет флаг занятости', async () => {
    supabase.auth.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters' },
    });

    const outcome = await useAuthStore.getState().register('Иван', 'ivan@pnhd.ru', '123');

    expect(outcome).toEqual({ status: 'error' });
    expect(useAuthStore.getState().error).toMatch(/не короче 6 символов/);
    expect(useAuthStore.getState().loading).toBe(false);
  });
});

describe('useAuthStore — вход и подтверждение адреса', () => {
  it('неподтверждённый адрес запоминается — его предложат подтвердить заново', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
    });

    const ok = await useAuthStore.getState().login('ivan@pnhd.ru', 'secret123');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().unconfirmedEmail).toBe('ivan@pnhd.ru');
    expect(useAuthStore.getState().error).toBe('Email не подтверждён');
  });

  it('неверный пароль адрес не запоминает: письмо тут ни при чём', async () => {
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
    });

    await useAuthStore.getState().login('ivan@pnhd.ru', 'wrong');

    expect(useAuthStore.getState().unconfirmedEmail).toBeNull();
  });

  it('вход при БРОСКЕ не виснет в загрузке', async () => {
    supabase.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Load failed'));

    const ok = await useAuthStore.getState().login('ivan@pnhd.ru', 'secret123');

    expect(ok).toBe(false);
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/нет связи с сервером/);
  });

  it('resendConfirmation шлёт письмо на указанный адрес', async () => {
    const ok = await useAuthStore.getState().resendConfirmation('ivan@pnhd.ru');

    expect(ok).toBe(true);
    expect(supabase.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'ivan@pnhd.ru' }),
    );
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('clearError снимает и предложение выслать письмо', () => {
    useAuthStore.setState({ error: 'Email не подтверждён', unconfirmedEmail: 'ivan@pnhd.ru' });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().unconfirmedEmail).toBeNull();
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
      single: vi.fn().mockResolvedValue({
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
      single: vi.fn().mockResolvedValue({
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
      single: vi.fn().mockResolvedValue({
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
      single: vi.fn().mockResolvedValue({
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
      single: vi.fn().mockResolvedValue({ data: null }),
    });
    await useAuthStore.getState().fetchProfile('uid-4', 'test@test.com');
    expect(useAuthStore.getState().profileStatus).toBe('no_profile');
    expect(useAuthStore.getState().user).toBeNull();
  });

  /**
   * Вошёл — и вернулся на форму входа без единого слова: при `user === null`
   * App рисует именно её. Отсутствие профиля обязано быть НАЗВАНО, иначе
   * успешный вход выглядит как несработавший.
   */
  it('нет профиля при живой сессии — причина названа', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
    });
    await useAuthStore.getState().fetchProfile('uid-5', 'test@test.com');
    expect(useAuthStore.getState().error).toMatch(/Профиль не найден/);
  });

  it('сбой запроса профиля отличается от его отсутствия', async () => {
    const { supabase } = await import('../lib/supabase');
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await useAuthStore.getState().fetchProfile('uid-6', 'test@test.com');
    expect(useAuthStore.getState().error).toMatch(/нет связи с сервером/);
    expect(useAuthStore.getState().loading).toBe(false);
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
