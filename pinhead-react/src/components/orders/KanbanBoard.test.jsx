import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import KanbanBoard from './KanbanBoard';
import { useOrdersStore } from '../../store/useOrdersStore';
import { useStore } from '../../store/useStore';

// Mock supabase
vi.mock('../../lib/supabase', () => ({
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

// Mock useAuthStore
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: 'dev', role: 'admin' } })),
  },
}));

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
  it('renders board title', () => {
    renderKanban();
    expect(screen.getByText('ЗАКАЗЫ')).toBeInTheDocument();
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
    const empties = screen.getAllByText('Пусто');
    expect(empties).toHaveLength(5);
  });

  it('shows loading state', () => {
    useOrdersStore.setState({ loading: true });
    renderKanban();
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderKanban();
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
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

  it('shows stats bar', () => {
    useOrdersStore.setState({
      orders: [
        { id: 1, order_number: 'PH-0001', status: 'draft', data: {}, total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
      ],
    });
    renderKanban();
    expect(screen.getByText(/заказов/)).toBeInTheDocument();
  });
});
