import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SalesStaff from './SalesStaff';
import { fetchSalesStaff, fetchStaffEvents, setSalesStaff } from '../api/salesStaff';

vi.mock('../api/salesStaff', () => ({
  fetchSalesStaff: vi.fn(),
  setSalesStaff: vi.fn(),
  fetchStaffEvents: vi.fn(),
  STAFF_EVENTS_LIMIT: 50,
}));

const ROWS = [
  { id: 'p-1', name: 'Анна', email: 'a@pinhead.ru', role: 'manager', active: true, approved: true, is_sales: false, is_ms: false },
  { id: 'p-2', name: 'Борис', email: 'b@pinhead.ru', role: 'manager', active: true, approved: true, is_sales: true, is_ms: true },
  // отключённая с признаками: в счётчики не входит
  { id: 'p-3', name: 'Вера', email: 'v@pinhead.ru', role: 'rop', active: false, approved: true, is_sales: true, is_ms: true },
];

/** Переключатели строки по доступному имени */
const salesOf = (name) => screen.getByRole('checkbox', { name: `Ведёт заказы: ${name}` });
const msOf = (name) => screen.getByRole('checkbox', { name: `МС: ${name}` });

/** Обещание, которое тест разрешает сам */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('SalesStaff', () => {
  beforeEach(() => {
    vi.mocked(fetchSalesStaff).mockReset().mockResolvedValue(ROWS.map((r) => ({ ...r })));
    vi.mocked(setSalesStaff).mockReset();
    vi.mocked(fetchStaffEvents).mockReset().mockResolvedValue([]);
  });

  it('заголовок, две колонки признаков, роль профиля и счётчики', async () => {
    render(<SalesStaff />);
    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Сотрудники продаж' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ведёт заказы' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Запускает в производство (МС)' })).toBeInTheDocument();
    expect(screen.getByText('РОП')).toBeInTheDocument();
    expect(salesOf('Анна')).not.toBeChecked();
    expect(msOf('Анна')).not.toBeChecked();
    expect(salesOf('Борис')).toBeChecked();
    expect(msOf('Борис')).toBeChecked();
    // Вера отключена — признаки есть, но в счётчики не входит
    expect(screen.getByText('Продавцов: 1 · МС: 1')).toBeInTheDocument();
  });

  it('подзаголовок объясняет оба признака', async () => {
    render(<SalesStaff />);
    await screen.findByText('Анна');
    expect(screen.getByText(/«Ведёт заказы» — заводит и ведёт свои заказы/)).toBeInTheDocument();
    expect(screen.getByText(/«МС» — видит заказы в работе и запускает их в производство/)).toBeInTheDocument();
  });

  it('«МС» сохраняется через RPC с видом ms', async () => {
    vi.mocked(setSalesStaff).mockResolvedValue(true);
    render(<SalesStaff />);
    await screen.findByText('Анна');
    fireEvent.click(msOf('Анна'));
    expect(msOf('Анна')).toBeChecked();
    await waitFor(() => expect(msOf('Анна')).not.toBeDisabled());
    expect(setSalesStaff).toHaveBeenCalledWith('p-1', 'ms', true);
    expect(msOf('Анна')).toBeChecked();
    expect(salesOf('Анна')).not.toBeChecked();
    expect(screen.getByText('Продавцов: 1 · МС: 2')).toBeInTheDocument();
  });

  it('«Ведёт заказы» сохраняется через RPC с видом sales', async () => {
    vi.mocked(setSalesStaff).mockResolvedValue(true);
    render(<SalesStaff />);
    await screen.findByText('Анна');
    fireEvent.click(salesOf('Анна'));
    await waitFor(() => expect(salesOf('Анна')).not.toBeDisabled());
    expect(setSalesStaff).toHaveBeenCalledWith('p-1', 'sales', true);
    expect(screen.getByText('Продавцов: 2 · МС: 1')).toBeInTheDocument();
  });

  it('отказ сервера откатывает только свой признак; второй переключатель строки не заблокирован', async () => {
    const ms = deferred();
    const sales = deferred();
    vi.mocked(setSalesStaff).mockImplementation((_id, kind) => (kind === 'ms' ? ms.promise : sales.promise));
    render(<SalesStaff />);
    await screen.findByText('Борис');

    fireEvent.click(msOf('Борис'));
    // optimistic: снят сразу; пока ждём ответ — заблокирован только он
    expect(msOf('Борис')).not.toBeChecked();
    expect(msOf('Борис')).toBeDisabled();
    expect(salesOf('Борис')).not.toBeDisabled();

    fireEvent.click(salesOf('Борис'));
    expect(salesOf('Борис')).not.toBeChecked();

    ms.resolve(false);
    await waitFor(() => expect(msOf('Борис')).toBeChecked());
    expect(msOf('Борис')).not.toBeDisabled();
    // «Ведёт заказы» ждёт свой ответ и не откатывается чужим отказом
    expect(salesOf('Борис')).not.toBeChecked();
    expect(salesOf('Борис')).toBeDisabled();

    sales.resolve(true);
    await waitFor(() => expect(salesOf('Борис')).not.toBeDisabled());
    expect(salesOf('Борис')).not.toBeChecked();
    expect(setSalesStaff).toHaveBeenCalledWith('p-2', 'ms', false);
    expect(setSalesStaff).toHaveBeenCalledWith('p-2', 'sales', false);
    expect(screen.getByText('Продавцов: 0 · МС: 1')).toBeInTheDocument();
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
