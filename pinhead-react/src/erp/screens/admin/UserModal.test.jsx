import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const { UserModal } = await import('./UserModal');
const { useErpStore } = await import('../../store/useErpStore');
const { attachDomainSlices } = await import('../../store/domainSlices');
const { useAuthStore } = await import('../../../store/useAuthStore');
const { useConfirmStore } = await import('../../../store/useConfirmStore');
const { useToastStore } = await import('../../../store/useToastStore');

/**
 * Карточка учётной записи.
 *
 * До неё в списке правились только роль, цех и цеховая роль — то, что живёт
 * в обычных таблицах под RLS. Имя, адрес входа и пароль лежат в `auth.users`,
 * и починить их можно было исключительно в дашборде Supabase. На этом проект
 * встал: сотруднику выписали приглашение на адрес с забытым паролем, и вернуть
 * его в систему было нечем.
 */

const PROFILE = {
  id: 'u-1', name: 'Нина', email: 'nina@pinhead.ru',
  role: 'production', approved: true, active: true,
};

const DEPARTMENTS = [{ id: 'd-sew', name: 'Швейный цех', active: true }];

let actions;

beforeEach(() => {
  attachDomainSlices();
  actions = {
    createUserAccount: vi.fn().mockResolvedValue(true),
    setUserPassword: vi.fn().mockResolvedValue(true),
    setUserEmail: vi.fn().mockResolvedValue(true),
    deleteUserAccount: vi.fn().mockResolvedValue(true),
    updateProfile: vi.fn().mockResolvedValue(true),
    updateEmployee: vi.fn().mockResolvedValue(true),
  };
  useErpStore.setState({
    departments: DEPARTMENTS,
    employees: [{ id: 'e-1', profile_id: 'u-1', full_name: 'Нина', role: 'worker', active: true }],
    ...actions,
  });
  useAuthStore.setState({ user: { id: 'admin-1', role: 'admin', email: 'a@pnhd.ru' } });
  useConfirmStore.setState({ open: false, prompt: null, _resolver: null });
  useToastStore.setState({ toasts: [] });
});

describe('UserModal — заведение', () => {
  it('пароль задаёт админ, и он уходит вместе с ролью и цехом', async () => {
    render(<UserModal profile={null} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Имя/), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'petr@pinhead.ru' } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText('Цех'), { target: { value: 'd-sew' } });
    fireEvent.click(screen.getByText('Завести доступ'));

    await waitFor(() => expect(actions.createUserAccount).toHaveBeenCalledWith({
      name: 'Пётр', email: 'petr@pinhead.ru', password: 'secret123',
      profile_role: 'production', employee_role: 'worker', department_id: 'd-sew',
    }));
  });

  /** Короткий пароль сервер и так не примет — но незачем гонять его туда */
  it('короткий пароль не уходит на сервер', async () => {
    render(<UserModal profile={null} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Имя/), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'petr@pinhead.ru' } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: '123' } });
    fireEvent.click(screen.getByText('Завести доступ'));

    expect(await screen.findByText(/не менее 6 символов/)).toBeInTheDocument();
    expect(actions.createUserAccount).not.toHaveBeenCalled();
  });

  it('окно закрывается только после успеха', async () => {
    actions.createUserAccount.mockResolvedValue(false);
    const onClose = vi.fn();
    render(<UserModal profile={null} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/^Имя/), { target: { value: 'Пётр' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'petr@pinhead.ru' } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('Завести доступ'));

    await waitFor(() => expect(actions.createUserAccount).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('UserModal — правка', () => {
  /**
   * Имя живёт в ДВУХ местах: `profiles` (списки, авторство) и `erp_employees`
   * (исполнитель этапа). Поправить одно — значит получить человека, который
   * в заказе Иванов, а в очереди цеха всё ещё «ivan@…».
   */
  it('переименование правит и профиль, и строку сотрудника', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Нина Петрова' } });
    fireEvent.click(screen.getByText('Переименовать'));

    await waitFor(() => expect(actions.updateProfile)
      .toHaveBeenCalledWith('u-1', { name: 'Нина Петрова' }));
    expect(actions.updateEmployee).toHaveBeenCalledWith('e-1', { full_name: 'Нина Петрова' });
  });

  it('пароль задаётся своей кнопкой, а не общим «Сохранить»', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'newsecret' } });
    fireEvent.click(screen.getByText('Задать пароль'));

    await waitFor(() => expect(actions.setUserPassword).toHaveBeenCalledWith('u-1', 'newsecret'));
  });

  it('короткий пароль не уходит и здесь', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Задать пароль'));

    expect(await screen.findByText(/не менее 6 символов/)).toBeInTheDocument();
    expect(actions.setUserPassword).not.toHaveBeenCalled();
  });

  it('адрес меняется отдельным действием', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Email \(логин\)/), { target: { value: 'nina@pnhd.ru' } });
    fireEvent.click(screen.getByText('Сменить'));

    await waitFor(() => expect(actions.setUserEmail).toHaveBeenCalledWith('u-1', 'nina@pnhd.ru'));
  });

  /** Ничего не изменили — кнопке нечего сохранять, и она об этом говорит */
  it('неизменённое поле не отправляется', () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    expect(screen.getByText('Переименовать')).toBeDisabled();
    expect(screen.getByText('Сменить')).toBeDisabled();
    expect(screen.getByText('Задать пароль')).toBeDisabled();
  });
});

describe('UserModal — удаление', () => {
  /**
   * Удаление безвозвратно и стоит в одном окне с обычными правками. «Да/Нет»
   * на такое нажимают не глядя, поэтому подтверждение требует ВПЕЧАТАТЬ адрес.
   */
  it('требует впечатать адрес', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Удалить навсегда'));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    expect(useConfirmStore.getState().prompt?.label).toBe('nina@pinhead.ru');

    useConfirmStore.getState()._close(true, 'nina@pinhead.ru');

    await waitFor(() => expect(actions.deleteUserAccount).toHaveBeenCalledWith('u-1'));
  });

  it('несовпавший адрес не удаляет ничего', async () => {
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Удалить навсегда'));
    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(true, 'не тот адрес');

    await waitFor(() => expect(useToastStore.getState().toasts.length).toBe(1));
    expect(actions.deleteUserAccount).not.toHaveBeenCalled();
  });

  /**
   * Админ, оставшийся без админа, — это правка руками в дашборде Supabase.
   * Сервер это тоже запрещает; здесь кнопки просто нет, чтобы не предлагать
   * действие, которое всё равно откажет.
   */
  it('себя удалить нельзя — кнопки нет', () => {
    useAuthStore.setState({ user: { id: 'u-1', role: 'admin', email: 'nina@pinhead.ru' } });
    render(<UserModal profile={PROFILE} onClose={vi.fn()} />);

    expect(screen.queryByText('Удалить навсегда')).toBeNull();
    expect(screen.getByText(/Свою учётную запись удалить нельзя/)).toBeInTheDocument();
  });
});
