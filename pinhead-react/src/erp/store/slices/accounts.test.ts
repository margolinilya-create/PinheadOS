import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const { supabase } = await import('../../../lib/supabase');
/** Мок объявлен выше: настоящая сигнатура `invoke` здесь только мешает */
const invoke = supabase.functions.invoke as unknown as Mock;
const { useErpStore } = await import('../useErpStore');
const { attachDomainSlices } = await import('../domainSlices');
const { useToastStore } = await import('../../../store/useToastStore');

/**
 * Действия администратора над учётными записями.
 *
 * Всё это умеет только Admin API GoTrue, а он требует `service_role` — ключ,
 * обходящий RLS целиком, и в браузере его не бывает. Поэтому клиент здесь
 * ничего не решает: он зовёт серверную функцию и честно показывает её ответ.
 * Проверяем ровно это — что уходит, что происходит с локальным списком
 * и что видно человеку при отказе.
 */

const PROFILE = {
  id: 'u-1', name: 'Нина', email: 'nina@pinhead.ru',
  role: 'production', approved: true, active: true,
};

/** Ошибка того же вида, что отдаёт supabase-js на не-2xx от функции */
const httpError = (message: string) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { json: () => Promise.resolve({ error: message }) },
});

beforeEach(() => {
  attachDomainSlices();
  invoke.mockReset();
  useToastStore.setState({ toasts: [] });
  useErpStore.setState({
    profilesList: [PROFILE],
    employees: [{
      id: 'e-1', profile_id: 'u-1', full_name: 'Нина', role: 'worker', active: true,
      department_id: null, extra_department_ids: [], notes: null,
      created_at: '2026-08-14T10:00:00Z', updated_at: '2026-08-14T10:00:00Z',
    }],
    loadEmployees: vi.fn().mockResolvedValue(undefined),
  });
});

describe('заведение пользователя', () => {
  it('роль, цех и пароль уходят на сервер одним действием', async () => {
    invoke.mockResolvedValue({ data: { id: 'u-2' }, error: null });

    const ok = await useErpStore.getState().createUserAccount({
      name: 'Пётр', email: 'petr@pinhead.ru', password: 'secret123',
      profile_role: 'production', employee_role: 'worker', department_id: 'd-sew',
    });

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'create',
        name: 'Пётр', email: 'petr@pinhead.ru', password: 'secret123',
        profile_role: 'production', employee_role: 'worker', department_id: 'd-sew',
      },
    });
  });

  /**
   * Профиль и строку сотрудника пишет ТРИГГЕР регистрации. Собрать их на
   * клиенте — значит угадывать, что именно он записал; список перечитываем.
   */
  it('список перечитывается, а не достраивается по памяти', async () => {
    invoke.mockResolvedValue({ data: { id: 'u-2' }, error: null });

    await useErpStore.getState().createUserAccount({
      name: 'Пётр', email: 'petr@pinhead.ru', password: 'secret123',
      profile_role: 'production', employee_role: 'worker', department_id: null,
    });

    expect(useErpStore.getState().loadEmployees).toHaveBeenCalled();
  });

  it('отказ сервера показывается его словами, а не «не удалось»', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError('Учётная запись с таким адресом уже есть — откройте её в списке'),
    });

    const ok = await useErpStore.getState().createUserAccount({
      name: 'Пётр', email: 'za@pnhd.ru', password: 'secret123',
      profile_role: 'production', employee_role: 'worker', department_id: null,
    });

    expect(ok).toBe(false);
    expect(useErpStore.getState().loadEmployees).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0].message)
      .toContain('Учётная запись с таким адресом уже есть');
  });
});

describe('смена пароля', () => {
  it('уходит на сервер вместе с пользователем', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const ok = await useErpStore.getState().setUserPassword('u-1', 'newsecret');

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_password', user_id: 'u-1', password: 'newsecret' },
    });
  });

  it('отказ виден человеку', async () => {
    invoke.mockResolvedValue({
      data: null, error: httpError('Доступ только у администратора'),
    });

    expect(await useErpStore.getState().setUserPassword('u-1', 'newsecret')).toBe(false);
    expect(useToastStore.getState().toasts[0].message).toContain('Доступ только у администратора');
  });
});

describe('смена адреса входа', () => {
  /** Адрес — логин: регистр не должен создавать «второго» человека */
  it('приводится к нижнему регистру и обновляет список', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await useErpStore.getState().setUserEmail('u-1', '  Nina@Pinhead.RU ');

    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_email', user_id: 'u-1', email: 'nina@pinhead.ru' },
    });
    expect(useErpStore.getState().profilesList[0].email).toBe('nina@pinhead.ru');
  });

  it('при отказе список не трогается', async () => {
    invoke.mockResolvedValue({
      data: null, error: httpError('Этот адрес занят другой учётной записью'),
    });

    await useErpStore.getState().setUserEmail('u-1', 'x@pnhd.ru');

    expect(useErpStore.getState().profilesList[0].email).toBe('nina@pinhead.ru');
  });
});

describe('удаление пользователя', () => {
  /**
   * Не оптимистично: правило проекта — удаление ждёт ответа. RLS на DELETE
   * отказывает «нулём строк», а не ошибкой, и оптимистичное удаление уже
   * однажды показывало зелёное «Заказ удалён» на неудавшемся удалении.
   */
  it('строка уходит из списка только после ответа сервера', async () => {
    let resolve: (v: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((r) => { resolve = r; }));

    const pending = useErpStore.getState().deleteUserAccount('u-1');
    expect(useErpStore.getState().profilesList).toHaveLength(1);

    resolve({ data: { ok: true }, error: null });
    expect(await pending).toBe(true);
    expect(useErpStore.getState().profilesList).toHaveLength(0);
    // Строка сотрудника ссылалась на профиль — без неё в цехе остался бы призрак
    expect(useErpStore.getState().employees).toHaveLength(0);
  });

  it('отказ сервера оставляет человека на месте и называет причину', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError('За человеком числятся заказы (3) — удалить нельзя'),
    });

    expect(await useErpStore.getState().deleteUserAccount('u-1')).toBe(false);
    expect(useErpStore.getState().profilesList).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toContain('числятся заказы (3)');
  });
});
