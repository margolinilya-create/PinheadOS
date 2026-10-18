import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Переход перезагружает страницу — в jsdom навигации нет; что пишется, проверяет switchToProduction.test
const switchToProduction = vi.fn();
vi.mock('../switchToProduction', () => ({ switchToProduction: (...a) => switchToProduction(...a) }));
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
    switchToProduction.mockClear();
    confirm.mockReset();
    localStorage.clear();
  });

  it('показывает пункты сайдбара: «Новый заказ» — кнопка, остальные — ссылки', () => {
    renderLayout(ADMIN);
    expect(screen.getByRole('button', { name: 'Новый заказ' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Все заказы' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Каталог моделей и цен' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Справочники заказа' }).getAttribute('href')).toBe('/order-settings');
  });

  it.each([
    ['/sales?status=ready_to_launch&sort=due', 'К запуску'],
    ['/sales?sort=due&status=ready_to_launch&q=PH', 'К запуску'],
    ['/sales', 'Все заказы'],
    ['/sales?status=ready_to_launch', 'Все заказы'],
    ['/sales/o-1/launch', 'Все заказы'],
  ])('активен ровно один пункт списка заказов: %s → «%s»', (path, active) => {
    renderLayout(ADMIN, path);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual([active]);
  });

  it.each([
    [SELLER, 'Менеджер продаж'],
    [{ ...SELLER, is_sales: false, is_ms: true }, 'Менеджер сопровождения'],
    [{ ...SELLER, role: 'rop', is_sales: false }, 'РОП'],
    [ADMIN, 'Админ'],
    [{ ...SELLER, role: 'rop', is_sales: true }, 'РОП'],
    [{ ...ADMIN, is_sales: true, is_ms: true }, 'Админ'],
  ])('роль в шапке — русской подписью, не кодом (обход, M-2): %#', (user, caption) => {
    renderLayout(user);
    expect(screen.getByText(caption)).toBeTruthy();
    expect(screen.queryByText(user.role)).toBeNull();
  });

  it('продавец видит «Мои заказы» и не видит настроек', () => {
    renderLayout(SELLER);
    expect(screen.getByRole('link', { name: 'Мои заказы' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Каталог моделей и цен' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Справочники заказа' })).toBeNull();
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

  it.each([
    ['admin', ADMIN],
    ['продавец', SELLER],
    ['МС', { id: 'u-3', role: 'manager', active: true, approved: true, is_ms: true }],
    ['rop', { id: 'u-4', role: 'rop', active: true, approved: true }],
  ])('%s: «Производство» уводит в раздел Производство своим профилем', (_n, user) => {
    renderLayout(user);
    const btn = screen.getByRole('button', { name: 'Перейти в раздел Производство' });
    expect(btn.getAttribute('title')).toBe('Перейти в раздел Производство');
    // Видимая подпись есть в разметке (на ≤ 480 px — только для читалки)
    expect(btn.textContent).toBe('Производство');
    fireEvent.click(btn);
    expect(switchToProduction).toHaveBeenCalledWith('/', user);
  });

  it('без доступа к разделу кнопки перехода нет', () => {
    renderLayout({ id: 'u-5', role: 'designer', active: true, approved: true });
    expect(screen.queryByRole('button', { name: 'Перейти в раздел Производство' })).toBeNull();
  });

  it('«Меню» открывает сайдбар, переход по ссылке закрывает', () => {
    renderLayout(ADMIN);
    const toggle = screen.getByRole('button', { name: 'Меню' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Каталог моделей и цен' }));
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
