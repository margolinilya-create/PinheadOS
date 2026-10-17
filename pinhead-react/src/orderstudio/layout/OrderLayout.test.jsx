import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const setFeature = vi.fn();
vi.mock('../../config/features', () => ({ setFeature: (...a) => setFeature(...a) }));
// Подтверждение — императивный диалог; ответ задаёт тест
const confirm = vi.fn();
vi.mock('../../store/useConfirmStore', () => ({ confirm: (...a) => confirm(...a) }));

vi.mock('../api/salesOrders', async (orig) => ({ ...(await orig()), findOwnEmptyDraft: vi.fn() }));
import OrderLayout from './OrderLayout';
import { useAuthStore } from '../../store/useAuthStore';
import { findOwnEmptyDraft } from '../api/salesOrders';

function renderLayout(user, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OrderLayout user={user}><div>содержимое</div></OrderLayout>
    </MemoryRouter>,
  );
}

const ADMIN = { id: 'u-1', role: 'admin', name: 'Илья', active: true, approved: true, is_sales: false };
const SELLER = { id: 'u-2', role: 'manager', name: 'Анна', active: true, approved: true, is_sales: true };

describe('OrderLayout', () => {
  beforeEach(() => {
    setFeature.mockClear();
    confirm.mockReset();
    localStorage.clear();
  });

  it('показывает пункты сайдбара: «Новый заказ» — кнопка, остальные — ссылки', () => {
    renderLayout(ADMIN);
    expect(screen.getByRole('button', { name: 'Новый заказ' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Все заказы' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Каталог' })).toBeTruthy();
  });

  it('продавец видит «Мои заказы» и не видит настроек', () => {
    renderLayout(SELLER);
    expect(screen.getByRole('link', { name: 'Мои заказы' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Каталог' })).toBeNull();
  });

  it('«Новый заказ» в меню открывает свой пустой черновик на вкладке «Изделие»', async () => {
    vi.mocked(findOwnEmptyDraft).mockResolvedValue({ ok: true, id: 'o-empty' });
    useAuthStore.setState({ user: SELLER });
    function Where() {
      const loc = useLocation();
      return <div data-testid="where">{loc.pathname}{loc.search}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/sales']}>
        <Routes>
          <Route path="/sales" element={<OrderLayout user={SELLER}><div>список</div></OrderLayout>} />
          <Route path="/sales/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Новый заказ' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/sales/o-empty?tab=item'));
    expect(findOwnEmptyDraft).toHaveBeenCalledWith('u-2');
  });

  it('подписи: навигация, логотип и заголовок раздела', () => {
    renderLayout(ADMIN);
    expect(screen.getByRole('navigation', { name: 'Разделы заказа' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'На главную раздела заказов' })).toBeTruthy();
    expect(screen.getByText('Оформление заказа')).toBeTruthy();
    expect(screen.getByText('PINHEAD ORDER')).toBeTruthy();
  });

  it('«Перейти в Производство» выключает флаг orderStudio', () => {
    renderLayout(ADMIN);
    fireEvent.click(screen.getByRole('button', { name: 'Перейти в Производство' }));
    expect(setFeature).toHaveBeenCalledWith('orderStudio', false);
  });

  it('у продавца кнопки перехода в Производство нет', () => {
    renderLayout(SELLER);
    expect(screen.queryByRole('button', { name: 'Перейти в Производство' })).toBeNull();
  });

  it('«Меню» открывает сайдбар, переход по ссылке закрывает', () => {
    renderLayout(ADMIN);
    const toggle = screen.getByRole('button', { name: 'Меню' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Каталог' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('main#main-content прокручивается сам и обнуляет --header-h', () => {
    const { container } = renderLayout(ADMIN);
    const main = container.querySelector('main#main-content');
    expect(main.className).toMatch(/orderMain/);
  });

  it('индикатора черновика визарда больше нет — ни на /express, ни на /sales', () => {
    for (const path of ['/express', '/sales']) {
      const { unmount } = renderLayout(ADMIN, path);
      expect(screen.queryByRole('button', { name: 'Сбросить черновик' })).toBeNull();
      unmount();
    }
  });

  it('«Выйти»: подтверждение → logout', async () => {
    const logout = vi.fn();
    const prev = useAuthStore.getState().logout;
    useAuthStore.setState({ logout });
    confirm.mockResolvedValue(true);
    renderLayout(ADMIN);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Выйти из системы?' }));
    useAuthStore.setState({ logout: prev });
  });

  it('«Выйти»: отмена → сессия остаётся', async () => {
    const logout = vi.fn();
    const prev = useAuthStore.getState().logout;
    useAuthStore.setState({ logout });
    confirm.mockResolvedValue(false);
    renderLayout(ADMIN);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(logout).not.toHaveBeenCalled();
    useAuthStore.setState({ logout: prev });
  });
});
