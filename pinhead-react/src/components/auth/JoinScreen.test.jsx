import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const { supabase } = await import('../../lib/supabase');
const { default: JoinScreen } = await import('./JoinScreen');
const { useAuthStore } = await import('../../store/useAuthStore');

/**
 * Экран приглашения — основной путь появления сотрудника.
 *
 * Прежде человек шёл в четыре шага (регистрация → письмо → одобрение →
 * назначение роли), и на письме застревал: встроенный SMTP Supabase режет
 * частоту и уходит в спам. Здесь письма нет вовсе — роль и цех приезжают
 * в самом коде ссылки.
 */

const INVITE = {
  profile_role: 'production',
  employee_role: 'worker',
  department_name: 'Швейный цех',
  email: null,
  expires_at: '2026-08-20T10:00:00Z',
};

function renderAt(code) {
  const path = code === null ? '/join' : `/join?code=${code}`;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <JoinScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  supabase.rpc.mockReset();
  useAuthStore.setState({
    user: null, loading: false, error: null,
    register: vi.fn().mockResolvedValue('signed_in'),
    clearError: vi.fn(),
  });
});

describe('JoinScreen — действующее приглашение', () => {
  it('называет роль и цех до того, как человек начнёт вводить', async () => {
    supabase.rpc.mockResolvedValue({ data: [INVITE], error: null });
    renderAt('code-1');

    expect(await screen.findByText('Сотрудник цеха')).toBeInTheDocument();
    expect(screen.getByText('Швейный цех')).toBeInTheDocument();
  });

  it('передаёт код в регистрацию — роль и цех проставит сервер', async () => {
    const register = vi.fn().mockResolvedValue('signed_in');
    useAuthStore.setState({ register });
    supabase.rpc.mockResolvedValue({ data: [INVITE], error: null });
    renderAt('code-1');
    await screen.findByText('Сотрудник цеха');

    fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Нина' } });
    fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'nina@pinhead.ru' } });
    fireEvent.change(screen.getByPlaceholderText(/мин\. 6/), { target: { value: 'secret123' } });
    fireEvent.submit(screen.getByText('Начать работу').closest('form'));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith(
        'Нина', 'nina@pinhead.ru', 'secret123', { inviteCode: 'code-1' },
      );
    });
  });

  /**
   * Приглашение на конкретный адрес: другой сервер всё равно не примет, и дать
   * его ввести значит пообещать то, чего не будет.
   */
  it('привязанный адрес подставлен и не редактируется', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ ...INVITE, email: 'nina@pinhead.ru' }], error: null });
    renderAt('code-1');
    await screen.findByText('Сотрудник цеха');

    const field = screen.getByPlaceholderText('email@example.com');
    expect(field).toHaveValue('nina@pinhead.ru');
    expect(field).toBeDisabled();
  });

  it('короткий пароль не уходит на сервер', async () => {
    const register = vi.fn();
    useAuthStore.setState({ register });
    supabase.rpc.mockResolvedValue({ data: [INVITE], error: null });
    renderAt('code-1');
    await screen.findByText('Сотрудник цеха');

    fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Нина' } });
    fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'nina@pinhead.ru' } });
    fireEvent.change(screen.getByPlaceholderText(/мин\. 6/), { target: { value: '123' } });
    fireEvent.submit(screen.getByText('Начать работу').closest('form'));

    await waitFor(() => expect(screen.getByText(/6 символов/)).toBeInTheDocument());
    expect(register).not.toHaveBeenCalled();
  });
});

describe('JoinScreen — ссылка не работает', () => {
  it('пустой ответ читается как недействующая ссылка, а не как сбой', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    renderAt('code-dead');

    expect(await screen.findByText('Ссылка не действует')).toBeInTheDocument();
    // Тупика быть не должно: самостоятельная регистрация осталась запасным путём
    expect(screen.getByText('Обычная регистрация')).toBeInTheDocument();
  });

  it('ссылка без кода — то же самое', async () => {
    renderAt(null);
    expect(await screen.findByText('Ссылка не действует')).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  /**
   * Сбой связи — НЕ «ссылка протухла»: у этих двух состояний разные действия,
   * и предложить человеку просить новую ссылку из-за потерянного вайфая значит
   * отправить его к админу без причины.
   */
  it('обрыв связи отделён от недействующего кода и даёт «Повторить»', async () => {
    supabase.rpc.mockRejectedValueOnce(new TypeError('Load failed'));
    renderAt('code-1');

    expect(await screen.findByText('Не удалось проверить приглашение')).toBeInTheDocument();

    supabase.rpc.mockResolvedValue({ data: [INVITE], error: null });
    fireEvent.click(screen.getByText('Повторить'));

    expect(await screen.findByText('Сотрудник цеха')).toBeInTheDocument();
  });
});

/**
 * Приглашение выписали на адрес, у которого уже есть учётная запись.
 *
 * `signUp` вторую учётку не создаёт, поэтому ссылка не сработает НИКОГДА.
 * На проде человек нажал девять раз подряд, каждый раз получая одно и то же
 * «Пользователь уже зарегистрирован» — экран не говорил, куда идти.
 */
describe('JoinScreen — адрес уже заведён', () => {
  it('объясняет тупик и ведёт ко входу, а не показывает сухую ошибку', async () => {
    const register = vi.fn().mockResolvedValue('already_registered');
    useAuthStore.setState({ register });
    supabase.rpc.mockResolvedValue({ data: [INVITE], error: null });
    renderAt('code-1');
    await screen.findByText('Сотрудник цеха');

    fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Нина' } });
    fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'za@pnhd.ru' } });
    fireEvent.change(screen.getByPlaceholderText(/мин\. 6/), { target: { value: 'secret123' } });
    fireEvent.submit(screen.getByText('Начать работу').closest('form'));

    expect(await screen.findByText('Такой сотрудник уже заведён')).toBeInTheDocument();
    expect(screen.getByText('za@pnhd.ru')).toBeInTheDocument();
    expect(screen.getByText(/Забыли пароль/)).toBeInTheDocument();
    expect(screen.getByText('Перейти ко входу')).toBeInTheDocument();
  });
});
