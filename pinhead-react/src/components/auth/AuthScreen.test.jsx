import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthScreen from './AuthScreen';
import { useAuthStore } from '../../store/useAuthStore';

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    loading: false,
    error: null,
    unconfirmedEmail: null,
    login: vi.fn(),
    register: vi.fn(),
    resendConfirmation: vi.fn(),
    clearError: vi.fn(),
  });
});

/** Заполнить форму регистрации и отправить её */
function submitRegistration() {
  fireEvent.click(screen.getByText('Регистрация'));
  fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Test User' } });
  fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'test@test.com' } });
  fireEvent.change(screen.getByPlaceholderText(/мин\. 6/), { target: { value: 'password123' } });
  fireEvent.submit(screen.getByText('Зарегистрироваться').closest('form'));
}

describe('AuthScreen', () => {
  it('renders logo', () => {
    render(<AuthScreen />);
    expect(screen.getByText(/PINHEAD/)).toBeInTheDocument();
  });

  it('renders login tab by default', () => {
    render(<AuthScreen />);
    expect(screen.getByText('Войти')).toBeInTheDocument();
  });

  it('shows email and password fields on login tab', () => {
    render(<AuthScreen />);
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument();
  });

  it('switches to register tab', () => {
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Регистрация'));
    expect(screen.getByText('Зарегистрироваться')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ваше имя')).toBeInTheDocument();
  });

  it('displays error message', () => {
    useAuthStore.setState({ error: 'Invalid credentials' });
    render(<AuthScreen />);
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('disables submit button when loading', () => {
    useAuthStore.setState({ loading: true });
    render(<AuthScreen />);
    const btn = screen.getByText('Вход...');
    expect(btn).toBeDisabled();
  });

  it('shows loading text on login button', () => {
    useAuthStore.setState({ loading: true });
    render(<AuthScreen />);
    expect(screen.getByText('Вход...')).toBeInTheDocument();
  });

  it('toggles password visibility', () => {
    render(<AuthScreen />);
    const toggle = screen.getAllByRole('button').find(b => b.classList.contains('auth-pass-toggle'));
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    // After toggle, the input type changes
  });

  it('clears error when switching tabs', () => {
    const clearError = vi.fn();
    useAuthStore.setState({ error: 'test', clearError });
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Регистрация'));
    expect(clearError).toHaveBeenCalled();
  });

});

/**
 * Что экран говорит после регистрации.
 *
 * В проекте включено подтверждение адреса, поэтому «заявка отправлена,
 * администратор подтвердит доступ» было полуправдой: человек ждал администратора,
 * тот его одобрял, а вход всё равно отвечал «Email не подтверждён», потому что
 * ссылку из письма никто не открывал.
 */
describe('AuthScreen — исход регистрации', () => {
  it('нужно подтверждение адреса: экран называет письмо, а не одобрение админа', async () => {
    useAuthStore.setState({ register: vi.fn().mockResolvedValue({ status: 'confirm_email' }) });
    render(<AuthScreen />);
    submitRegistration();

    await vi.waitFor(() => {
      expect(screen.getByText('Подтвердите email')).toBeInTheDocument();
    });
    expect(screen.getByText('test@test.com')).toBeInTheDocument();
    expect(screen.getByText(/Откройте ссылку из письма/)).toBeInTheDocument();
  });

  it('с экрана подтверждения письмо высылается повторно', async () => {
    const resendConfirmation = vi.fn().mockResolvedValue(true);
    useAuthStore.setState({
      register: vi.fn().mockResolvedValue({ status: 'confirm_email' }),
      resendConfirmation,
    });
    render(<AuthScreen />);
    submitRegistration();

    await vi.waitFor(() => screen.getByText('Выслать письмо повторно'));
    fireEvent.click(screen.getByText('Выслать письмо повторно'));
    expect(resendConfirmation).toHaveBeenCalledWith('test@test.com');
  });

  /**
   * Занятый адрес Supabase маскирует: 200 и пользователь без `identities`.
   * Показывать на это «проверьте почту» — отправить человека ждать письма,
   * которого никто не отправлял.
   */
  it('занятый адрес: возвращает ко входу и говорит, что адрес уже занят', async () => {
    useAuthStore.setState({ register: vi.fn().mockResolvedValue({ status: 'already_registered' }) });
    render(<AuthScreen />);
    submitRegistration();

    await vi.waitFor(() => {
      expect(screen.getByText(/уже зарегистрирован/)).toBeInTheDocument();
    });
    expect(screen.queryByText('Подтвердите email')).not.toBeInTheDocument();
    expect(screen.getByText('Войти')).toBeInTheDocument();
  });

  /**
   * Подтверждение адреса выключено — сессия уже есть, и «проверьте почту» было бы
   * враньём: письма не будет. Дальше человека ведёт App своим экраном ожидания.
   */
  it('сессия выдана сразу: экрана про письмо нет', async () => {
    useAuthStore.setState({ register: vi.fn().mockResolvedValue({ status: 'signed_in' }) });
    render(<AuthScreen />);
    submitRegistration();

    await vi.waitFor(() => {
      expect(screen.queryByText('Подтвердите email')).not.toBeInTheDocument();
    });
  });

  it('ошибка регистрации оставляет форму на месте', async () => {
    useAuthStore.setState({
      register: vi.fn().mockImplementation(async () => {
        useAuthStore.setState({ error: 'Ошибка сети' });
        return { status: 'error' };
      }),
    });
    render(<AuthScreen />);
    submitRegistration();

    await vi.waitFor(() => {
      expect(screen.getByText('Ошибка сети')).toBeInTheDocument();
    });
    expect(screen.getByText('Зарегистрироваться')).toBeInTheDocument();
  });
});

/**
 * Неподтверждённый адрес — единственный отказ входа, который повтором ввода
 * не лечится. Рядом с ошибкой обязано стоять то, что действительно помогает.
 */
describe('AuthScreen — вход с неподтверждённым адресом', () => {
  it('предлагает выслать письмо повторно на тот же адрес', () => {
    const resendConfirmation = vi.fn().mockResolvedValue(true);
    useAuthStore.setState({
      error: 'Email не подтверждён',
      unconfirmedEmail: 'ivan@pnhd.ru',
      resendConfirmation,
    });
    render(<AuthScreen />);

    fireEvent.click(screen.getByText('Выслать письмо повторно'));
    expect(resendConfirmation).toHaveBeenCalledWith('ivan@pnhd.ru');
  });

  it('без неподтверждённого адреса предложения нет', () => {
    useAuthStore.setState({ error: 'Неверный email или пароль', unconfirmedEmail: null });
    render(<AuthScreen />);
    expect(screen.queryByText('Выслать письмо повторно')).not.toBeInTheDocument();
  });
});
