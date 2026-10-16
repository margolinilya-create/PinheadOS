import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const setFeature = vi.fn();
vi.mock('../../config/features', () => ({ setFeature: (...a) => setFeature(...a) }));

import OrderLayout from './OrderLayout';

function renderLayout(user) {
  return render(
    <MemoryRouter>
      <OrderLayout user={user}><div>содержимое</div></OrderLayout>
    </MemoryRouter>,
  );
}

describe('OrderLayout', () => {
  beforeEach(() => setFeature.mockClear());

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
});
