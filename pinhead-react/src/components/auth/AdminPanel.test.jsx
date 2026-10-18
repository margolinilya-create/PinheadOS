import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AdminPanel from './AdminPanel';
import { useOrdersStore } from '../../store/useOrdersStore';

/**
 * «Заказы ТЗ» в админке Производства — старые заказы (v3) только просмотр
 * (веха 8, К4/К6): примитивы ERP, без кнопок правки статуса и удаления,
 * без глобальных CSS Order Studio.
 */
const fetchOrders = vi.fn();
const ROWS = [
  { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Алиса' }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: '2026-10-02T10:00:00Z' },
  { id: 2, order_number: 'PH-0002', status: 'done', data: { name: 'Борис' }, item_type: 'hoodie', total_qty: 3, total_sum: 900, created_at: '2026-09-01T10:00:00Z' },
];

const setOrders = (patch = {}) => useOrdersStore.setState({ orders: ROWS, loading: false, loadError: false, fetchOrders, ...patch });

beforeEach(() => {
  fetchOrders.mockReset();
  setOrders();
});

describe('AdminPanel — старые заказы только просмотр', () => {
  it('заголовок раздела h2 (h1 — у принимающего экрана) и пояснение', () => {
    render(<AdminPanel ordersOnly />);
    expect(screen.getByRole('heading', { level: 2, name: 'Старые заказы — только просмотр' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText(/новый заказ заводится в разделе «Оформление заказа»/)).toBeInTheDocument();
    expect(fetchOrders).toHaveBeenCalled();
  });

  it('строки заказов без кнопок правки, удаления и выбора статуса', () => {
    render(<AdminPanel ordersOnly />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('PH-0001')).toBeInTheDocument();
    expect(within(table).getByText('Готов')).toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /Удалить/ })).toBeNull();
    expect(within(table).queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Пользователи')).toBeNull();
  });

  it('поиск и статус сужают список; пусто — «Ничего не найдено» со сбросом', () => {
    render(<AdminPanel />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по номеру или клиенту' }), { target: { value: 'борис' } });
    expect(screen.queryByText('PH-0001')).toBeNull();
    expect(screen.getByText('PH-0002')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Статус' }), { target: { value: 'draft' } });
    expect(screen.getByText(/Ничего не найдено по запросу «борис»/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить поиск и статус' }));
    expect(screen.getByText('PH-0001')).toBeInTheDocument();
  });

  it('сортировка по сумме — кнопкой заголовка, с aria-sort', () => {
    render(<AdminPanel />);
    const sum = screen.getByRole('button', { name: /Сумма/ });
    fireEvent.click(sum);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('PH-0002')).toBeInTheDocument();
    expect(sum.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('счётчик и сумма; «Обновить» перечитывает', () => {
    render(<AdminPanel />);
    expect(screen.getByText(/Показано: 2 из 2 заказов · 5\s900 ₽/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(fetchOrders).toHaveBeenCalledTimes(2);
  });

  it('сбой загрузки — «Не удалось загрузить» с повтором; пусто — «Старых заказов нет»', () => {
    setOrders({ orders: [], loadError: true });
    const { unmount } = render(<AdminPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить старые заказы');
    unmount();
    setOrders({ orders: [] });
    render(<AdminPanel />);
    expect(screen.getByText('Старых заказов нет')).toBeInTheDocument();
  });

  it('без глобальных CSS Order Studio и без записи заказов', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'auth', 'AdminPanel.jsx'), 'utf8');
    expect(src).not.toMatch(/styles\/(forms-buttons|wizard|extras-zones|kanban|editors|responsive)\.css/);
    expect(src).not.toMatch(/PageHeader|updateStatus|deleteOrder|supabase/);
    expect(src).not.toMatch(/style=\{\{/);
  });
});
