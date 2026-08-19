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

  /**
   * Канбан заказов ТЗ и аналитика Order Studio убраны (решение заказчика,
   * сессия 33): оба дублировали поверхности ERP. Пункт меню, ведущий
   * в несуществующий раздел, — это переход в пустоту, а не «просто лишняя
   * кнопка», поэтому сторожим отсутствие.
   */
  it('пунктов убранных разделов в меню нет', () => {
    useAuthStore.setState({ user: { role: 'admin' }, logout: vi.fn() });
    renderHeader();
    expect(screen.queryByText('Заказы')).not.toBeInTheDocument();
    expect(screen.queryByText('Аналитика')).not.toBeInTheDocument();
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
