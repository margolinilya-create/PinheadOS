import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';
import { useAuthStore } from '../../store/useAuthStore';

// Mock useDraft hook
vi.mock('../../hooks/useDraft', () => ({
  useDraft: () => ({ draftStatus: 'idle', resetDraft: vi.fn() }),
}));

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  calcTotal: vi.fn(() => 0),
}));

function renderHeader(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Header />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: '1', role: 'admin', email: 'test@test.com' }, logout: vi.fn() });
});

describe('Header', () => {
  it('renders logo text', () => {
    renderHeader();
    expect(screen.getByText('pinhead')).toBeInTheDocument();
  });

  it('renders logout button', () => {
    renderHeader();
    expect(screen.getByText('Выйти')).toBeInTheDocument();
  });

  it('shows orders button', () => {
    renderHeader();
    expect(screen.getByText('Заказы')).toBeInTheDocument();
  });

  it('shows admin button for admin role', () => {
    useAuthStore.setState({ user: { role: 'admin' }, logout: vi.fn() });
    renderHeader();
    expect(screen.getByText('Админ')).toBeInTheDocument();
  });

  it('hides admin button for manager role', () => {
    useAuthStore.setState({ user: { role: 'manager' }, logout: vi.fn() });
    renderHeader();
    expect(screen.queryByText('Админ')).not.toBeInTheDocument();
  });

  it('hides Express/SKU/Prices for production role', () => {
    useAuthStore.setState({ user: { role: 'production' }, logout: vi.fn() });
    renderHeader();
    expect(screen.queryByText('Express')).not.toBeInTheDocument();
    expect(screen.queryByText('SKU')).not.toBeInTheDocument();
    expect(screen.queryByText('Цены')).not.toBeInTheDocument();
  });

  it('shows Analytics for admin', () => {
    useAuthStore.setState({ user: { role: 'admin' }, logout: vi.fn() });
    renderHeader();
    expect(screen.getByText('Аналитика')).toBeInTheDocument();
  });

  it('shows Analytics for production', () => {
    useAuthStore.setState({ user: { role: 'production' }, logout: vi.fn() });
    renderHeader();
    expect(screen.getByText('Аналитика')).toBeInTheDocument();
  });

  it('shows Analytics for rop', () => {
    useAuthStore.setState({ user: { role: 'rop' }, logout: vi.fn() });
    renderHeader();
    expect(screen.getByText('Аналитика')).toBeInTheDocument();
  });

  it('hides Analytics for designer', () => {
    useAuthStore.setState({ user: { role: 'designer' }, logout: vi.fn() });
    renderHeader();
    expect(screen.queryByText('Аналитика')).not.toBeInTheDocument();
  });

  it('shows draft section on home page', () => {
    renderHeader('/');
    expect(screen.getByText('черновик')).toBeInTheDocument();
  });

  it('shows total price on home page', () => {
    renderHeader('/');
    expect(screen.getByText('Итого')).toBeInTheDocument();
  });

  it('toggles burger menu', () => {
    renderHeader();
    const burger = screen.getByLabelText('Меню навигации');
    fireEvent.click(burger);
    const nav = screen.getByLabelText('Основная навигация');
    // After click, the nav should have the open class (CSS module hashed)
    expect(nav.className).toMatch(/open/);
  });
});
