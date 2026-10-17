import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SalesStaff from './SalesStaff';
import { fetchSalesStaff, setSalesStaff } from '../api/salesStaff';

vi.mock('../api/salesStaff', () => ({
  fetchSalesStaff: vi.fn(),
  setSalesStaff: vi.fn(),
}));

const ROWS = [
  { id: 'p-1', name: 'Анна', email: 'a@pinhead.ru', role: 'manager', active: true, approved: true, is_sales: false },
  { id: 'p-2', name: 'Борис', email: 'b@pinhead.ru', role: 'manager', active: true, approved: true, is_sales: true },
  // отключённый с признаком: в счётчик «Отмечено» не входит
  { id: 'p-3', name: 'Вера', email: 'v@pinhead.ru', role: 'manager', active: false, approved: true, is_sales: true },
];

/** Переключатель строки по доступному имени */
const toggleOf = (name) => screen.getByRole('checkbox', { name: `Менеджер продаж: ${name}` });

describe('SalesStaff', () => {
  beforeEach(() => {
    vi.mocked(fetchSalesStaff).mockReset().mockResolvedValue(ROWS.map((r) => ({ ...r })));
    vi.mocked(setSalesStaff).mockReset();
  });

  it('показывает профили и признак', async () => {
    render(<SalesStaff />);
    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(toggleOf('Анна')).not.toBeChecked();
    expect(toggleOf('Борис')).toBeChecked();
    expect(toggleOf('Вера')).toBeChecked();
    // Вера отключена — признак есть, но продавцом не считается
    expect(screen.getByText('Отмечено: 1')).toBeInTheDocument();
  });

  it('переключатель сохраняет признак через RPC', async () => {
    vi.mocked(setSalesStaff).mockResolvedValue(true);
    render(<SalesStaff />);
    await screen.findByText('Анна');
    fireEvent.click(toggleOf('Анна'));
    expect(toggleOf('Анна')).toBeChecked();
    await waitFor(() => expect(toggleOf('Анна')).not.toBeDisabled());
    expect(setSalesStaff).toHaveBeenCalledWith('p-1', true);
    expect(toggleOf('Анна')).toBeChecked();
    expect(screen.getByText('Отмечено: 2')).toBeInTheDocument();
  });

  it('отказ сервера откатывает переключатель', async () => {
    let resolve;
    vi.mocked(setSalesStaff).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SalesStaff />);
    await screen.findByText('Борис');
    fireEvent.click(toggleOf('Борис'));
    // optimistic: снят сразу, пока ждём ответ — заблокирован
    expect(toggleOf('Борис')).not.toBeChecked();
    expect(toggleOf('Борис')).toBeDisabled();
    resolve(false);
    await waitFor(() => expect(toggleOf('Борис')).toBeChecked());
    expect(toggleOf('Борис')).not.toBeDisabled();
    expect(setSalesStaff).toHaveBeenCalledWith('p-2', false);
    expect(screen.getByText('Отмечено: 1')).toBeInTheDocument();
  });

  it('список не загрузился — кнопка повтора', async () => {
    vi.mocked(fetchSalesStaff).mockResolvedValueOnce(null);
    render(<SalesStaff />);
    const retry = await screen.findByRole('button', { name: 'Загрузить снова' });
    fireEvent.click(retry);
    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(fetchSalesStaff).toHaveBeenCalledTimes(2);
  });
});
