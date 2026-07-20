import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KanbanBoard from './KanbanBoard';
import { useOrdersStore } from '../../../store/useOrdersStore';
import { useStore } from '../../store/useStore';

// Mock supabase
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock useAuthStore as a Zustand-like hook with getState
const mockAuthState = { user: { id: 'dev', role: 'admin', name: 'Dev Mode' } };
vi.mock('../../../store/useAuthStore', () => {
  const hook = (selector) => selector ? selector(mockAuthState) : mockAuthState;
  hook.getState = () => mockAuthState;
  return { useAuthStore: hook };
});

function renderKanban() {
  return render(
    <MemoryRouter>
      <KanbanBoard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useOrdersStore.setState({
    orders: [],
    loading: false,
    search: '',
    setSearch: vi.fn(),
    fetchOrders: vi.fn(),
    updateStatus: vi.fn(),
    deleteOrder: vi.fn(),
    duplicateOrder: vi.fn(),
  });
  useStore.setState({ loadOrder: vi.fn() });
});

describe('KanbanBoard', () => {
  it('renders filters bar', () => {
    renderKanban();
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
    expect(screen.getByTestId('type-filter')).toBeInTheDocument();
  });

  it('renders 5 status columns', () => {
    renderKanban();
    expect(screen.getByText('Черновик')).toBeInTheDocument();
    expect(screen.getByText('На проверке')).toBeInTheDocument();
    expect(screen.getByText('Подтверждён')).toBeInTheDocument();
    expect(screen.getByText('В производстве')).toBeInTheDocument();
    expect(screen.getByText('Готов')).toBeInTheDocument();
  });

  it('shows empty columns', () => {
    renderKanban();
    const empties = document.querySelectorAll('.kb-empty-col');
    expect(empties).toHaveLength(5);
  });

  it('shows loading state', () => {
    useOrdersStore.setState({ loading: true });
    renderKanban();
    expect(document.querySelector('.skeleton-card')).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderKanban();
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
  });

  it('renders stats bar', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: {}, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    expect(screen.getByText(/заказов/)).toBeInTheDocument();
  });

  it('renders order cards in correct columns', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice' }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
        { id: 2, order_number: 'PH-0002', status: 'approved', data: { name: 'Bob' }, item_type: 'hoodie', total_qty: 20, total_sum: 10000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows manager initials in avatar', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice', managerName: 'Ivan Petrov' }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    const avatar = document.querySelector('.kb-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar.textContent).toBe('IP');
    expect(avatar.title).toBe('Ivan Petrov');
  });

  it('shows stats bar', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: {}, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    expect(screen.getByText(/заказов/)).toBeInTheDocument();
  });

  it('shows type filter select', () => {
    renderKanban();
    const filter = screen.getByTestId('type-filter');
    expect(filter).toBeInTheDocument();
    expect(filter.value).toBe('');
  });

  it('populates type filter with order types', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { items: [{ type: 'tee' }] }, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
        { id: 2, order_number: 'PH-0002', status: 'review', data: { items: [{ type: 'hoodie' }] }, total_qty: 5, total_sum: 3000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    const filter = screen.getByTestId('type-filter');
    const options = filter.querySelectorAll('option');
    expect(options.length).toBe(3); // "Все типы" + tee + hoodie
  });

  it('filters orders by type when selected', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice', items: [{ type: 'tee' }] }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
        { id: 2, order_number: 'PH-0002', status: 'draft', data: { name: 'Bob', items: [{ type: 'hoodie' }] }, item_type: 'hoodie', total_qty: 5, total_sum: 3000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    const filter = screen.getByTestId('type-filter');
    fireEvent.change(filter, { target: { value: 'tee' } });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('shows deadline badge on card with deadline', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice', deadline: tomorrow.toISOString().slice(0, 10) }, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    const badge = document.querySelector('.kb-deadline-badge');
    expect(badge).toBeTruthy();
  });

  it('shows overdue badge for past deadlines', () => {
    const past = new Date();
    past.setDate(past.getDate() - 2);
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice', deadline: past.toISOString().slice(0, 10) }, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    const badge = document.querySelector('.kb-deadline-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('ПРОСРОЧЕН');
  });
});
