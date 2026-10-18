import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SalesStaff from './SalesStaff';
import { eventText, eventWhen } from './SalesStaffJournalText';
import { fetchSalesStaff, fetchStaffEvents, setSalesStaff } from '../api/salesStaff';

vi.mock('../api/salesStaff', () => ({
  fetchSalesStaff: vi.fn(),
  setSalesStaff: vi.fn(),
  fetchStaffEvents: vi.fn(),
  STAFF_EVENTS_LIMIT: 50,
}));

/**
 * Журнал «Кто и когда менял» (веха 8, К6): события `sales_staff_events`,
 * имена — из списка экрана, служебная смена — «служебно», пусто — «Отметок
 * ещё не меняли»; после принятой отметки журнал перечитывается.
 */
const ROWS = [
  { id: 'p-1', name: 'Петрова П.', email: 'p@pinhead.ru', role: 'manager', active: true, approved: true, is_sales: false, is_ms: false },
  { id: 'p-2', name: 'Иванова И.', email: 'i@pinhead.ru', role: 'rop', active: true, approved: true, is_sales: false, is_ms: false },
];
const at = new Date(2026, 9, 17, 14, 3).toISOString();
const EVENTS = [
  { id: 2, profile_id: 'p-1', kind: 'sales', on_value: true, actor: 'p-2', source: 'rpc', at },
  { id: 1, profile_id: 'p-1', kind: 'ms', on_value: false, actor: null, source: 'service', at },
];

const nameOf = (id) => ROWS.find((r) => r.id === id)?.name ?? 'профиль не найден';

describe('строка журнала', () => {
  it('«17.10, 14:03 — Петрова П.: „Ведёт заказы“ — да (Иванова И.)»', () => {
    expect(eventText(EVENTS[0], nameOf)).toBe('17.10, 14:03 — Петрова П.: „Ведёт заказы“ — да (Иванова И.)');
  });

  it('служебная смена — «служебно»; МС — «МС»', () => {
    expect(eventText(EVENTS[1], nameOf)).toBe('17.10, 14:03 — Петрова П.: „МС“ — нет (служебно)');
  });

  it('не дата — пустое время, неизвестный профиль — «профиль не найден»', () => {
    expect(eventWhen('мусор')).toBe('');
    expect(eventText({ ...EVENTS[0], profile_id: 'x' }, nameOf)).toMatch(/— профиль не найден:/);
  });
});

describe('SalesStaff — блок журнала', () => {
  beforeEach(() => {
    vi.mocked(fetchSalesStaff).mockReset().mockResolvedValue(ROWS.map((r) => ({ ...r })));
    vi.mocked(setSalesStaff).mockReset();
    vi.mocked(fetchStaffEvents).mockReset();
  });

  it('свёрнутый <details> с заголовком и строками', async () => {
    vi.mocked(fetchStaffEvents).mockResolvedValue(EVENTS);
    const { container } = render(<SalesStaff />);
    const summary = await screen.findByText('Кто и когда менял (последние 50)');
    expect(summary.tagName).toBe('SUMMARY');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('17.10, 14:03 — Петрова П.: „Ведёт заказы“ — да (Иванова И.)')).toBeInTheDocument();
  });

  it('пусто — «Отметок ещё не меняли»', async () => {
    vi.mocked(fetchStaffEvents).mockResolvedValue([]);
    render(<SalesStaff />);
    expect(await screen.findByText('Отметок ещё не меняли')).toBeInTheDocument();
  });

  it('не загрузился — повтор перечитывает', async () => {
    vi.mocked(fetchStaffEvents).mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    render(<SalesStaff />);
    fireEvent.click(await screen.findByRole('button', { name: 'Загрузить журнал снова' }));
    expect(await screen.findByText('Отметок ещё не меняли')).toBeInTheDocument();
    expect(fetchStaffEvents).toHaveBeenCalledTimes(2);
  });

  it('принятая отметка перечитывает журнал, отказ — нет', async () => {
    vi.mocked(fetchStaffEvents).mockResolvedValue([]);
    vi.mocked(setSalesStaff).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<SalesStaff />);
    const box = await screen.findByRole('checkbox', { name: 'Ведёт заказы: Петрова П.' });
    await waitFor(() => expect(fetchStaffEvents).toHaveBeenCalledTimes(1));
    fireEvent.click(box);
    await waitFor(() => expect(fetchStaffEvents).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('checkbox', { name: 'МС: Петрова П.' }));
    await waitFor(() => expect(setSalesStaff).toHaveBeenCalledTimes(2));
    expect(fetchStaffEvents).toHaveBeenCalledTimes(2);
  });
});
