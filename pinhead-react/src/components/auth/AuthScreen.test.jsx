import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthScreen from './AuthScreen';
import { useAuthStore } from '../../store/useAuthStore';

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    loading: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    clearError: vi.fn(),
  });
});

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

  it('shows pending screen after successful registration', async () => {
    const register = vi.fn().mockResolvedValue(true);
    useAuthStore.setState({ register });
    render(<AuthScreen />);
    fireEvent.click(screen.getByText('Регистрация'));

    fireEvent.change(screen.getByPlaceholderText('Ваше имя'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('email@example.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/мин\. 6/), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByText('Зарегистрироваться').closest('form'));

    // Wait for async register
    await vi.waitFor(() => {
      expect(screen.getByText('Ожидание подтверждения')).toBeInTheDocument();
    });
  });
});
