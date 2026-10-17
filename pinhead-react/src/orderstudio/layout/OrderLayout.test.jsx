import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const setFeature = vi.fn();
vi.mock('../../config/features', () => ({ setFeature: (...a) => setFeature(...a) }));
// Подтверждение — императивный диалог; ответ задаёт тест
const confirm = vi.fn();
vi.mock('../../store/useConfirmStore', () => ({ confirm: (...a) => confirm(...a) }));

// useDraft НЕ мокается: сторож проверяет, что оболочка правда пишет черновик
import OrderLayout from './OrderLayout';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';

function renderLayout(user, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OrderLayout user={user}><div>содержимое</div></OrderLayout>
    </MemoryRouter>,
  );
}

const ADMIN = { role: 'admin', name: 'Илья' };

describe('OrderLayout', () => {
  beforeEach(() => {
    setFeature.mockClear();
    confirm.mockReset();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('показывает ссылки сайдбара', () => {
    renderLayout({ role: 'admin', name: 'Илья' });
    expect(screen.getByRole('link', { name: 'Новый заказ' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Каталог' })).toBeTruthy();
  });

  it('подписи: навигация, логотип и заголовок раздела', () => {
    renderLayout({ role: 'admin', name: 'Илья' });
    expect(screen.getByRole('navigation', { name: 'Разделы заказа' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'На главную раздела заказов' })).toBeTruthy();
    expect(screen.getByText('Оформление заказа')).toBeTruthy();
    expect(screen.getByText('PINHEAD ORDER')).toBeTruthy();
  });

  it('«Перейти в Производство» выключает флаг orderStudio', () => {
    renderLayout({ role: 'admin', name: 'Илья' });
    fireEvent.click(screen.getByRole('button', { name: 'Перейти в Производство' }));
    expect(setFeature).toHaveBeenCalledWith('orderStudio', false);
  });

  it('у менеджера кнопки перехода в Производство нет', () => {
    renderLayout({ role: 'manager', name: 'Анна' });
    expect(screen.queryByRole('button', { name: 'Перейти в Производство' })).toBeNull();
  });

  it('«Меню» открывает сайдбар, переход по ссылке закрывает', () => {
    renderLayout({ role: 'admin', name: 'Илья' });
    const toggle = screen.getByRole('button', { name: 'Меню' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Каталог' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('main#main-content прокручивается сам и обнуляет --header-h', () => {
    const { container } = renderLayout({ role: 'admin', name: 'Илья' });
    const main = container.querySelector('main#main-content');
    expect(main.className).toMatch(/orderMain/);
  });

  it('автосохранение: правка визарда попадает в pinhead_draft', () => {
    vi.useFakeTimers();
    renderLayout(ADMIN);
    act(() => useStore.setState({ notes: 'черновик из оболочки' }));
    // SAVE_DELAY в hooks/useDraft.js — 800 мс
    act(() => vi.advanceTimersByTime(800));
    expect(JSON.parse(localStorage.getItem('pinhead_draft')).notes).toBe('черновик из оболочки');
    expect(screen.getByText('сохранено')).toBeTruthy();
  });

  it('индикатор и «Сбросить черновик» есть на /', () => {
    renderLayout(ADMIN, '/');
    expect(screen.getByRole('button', { name: 'Сбросить черновик' })).toBeTruthy();
    expect(screen.getByText('черновик')).toBeTruthy();
  });

  it('«Сбросить черновик» на /express тоже есть', () => {
    renderLayout(ADMIN, '/express');
    expect(screen.getByRole('button', { name: 'Сбросить черновик' })).toBeTruthy();
  });

  it('на /sales индикатора черновика нет', () => {
    renderLayout(ADMIN, '/sales');
    expect(screen.queryByRole('button', { name: 'Сбросить черновик' })).toBeNull();
  });

  it('сброс черновика: подтверждение → черновик удалён и визард сброшен', async () => {
    const resetOrder = vi.fn();
    const prev = useStore.getState().resetOrder;
    useStore.setState({ resetOrder });
    localStorage.setItem('pinhead_draft', '{"notes":"x"}');
    confirm.mockResolvedValue(true);
    renderLayout(ADMIN, '/');
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить черновик' }));
    await waitFor(() => expect(resetOrder).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Сбросить черновик?',
      message: 'Введённые данные заказа будут удалены.',
      confirmLabel: 'Сбросить',
    }));
    expect(localStorage.getItem('pinhead_draft')).toBeNull();
    useStore.setState({ resetOrder: prev });
  });

  it('сброс черновика: отмена → ничего не сброшено', async () => {
    const resetOrder = vi.fn();
    const prev = useStore.getState().resetOrder;
    useStore.setState({ resetOrder });
    confirm.mockResolvedValue(false);
    renderLayout(ADMIN, '/');
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить черновик' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(resetOrder).not.toHaveBeenCalled();
    useStore.setState({ resetOrder: prev });
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
