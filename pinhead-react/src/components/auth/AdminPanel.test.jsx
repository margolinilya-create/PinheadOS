import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPanel from './AdminPanel';
import { useOrdersStore } from '../../store/useOrdersStore';

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
      single: vi.fn().mockResolvedValue({ data: null }),
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

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminPanel />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useOrdersStore.setState({
    orders: [
      { id: 1, order_number: 'PH-0001', status: 'draft', data: { name: 'Alice' }, item_type: 'tee', total_qty: 10, total_sum: 5000, created_at: new Date().toISOString() },
    ],
    loading: false,
    fetchOrders: vi.fn(),
    updateStatus: vi.fn(),
    deleteOrder: vi.fn(),
  });
});

describe('AdminPanel', () => {
  it('renders title', () => {
    renderAdmin();
    expect(screen.getByText('Админ-панель')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    renderAdmin();
    expect(screen.getByText('Заказы')).toBeInTheDocument();
    expect(screen.getByText('Пользователи')).toBeInTheDocument();
  });

  it('shows orders tab by default', () => {
    renderAdmin();
    expect(screen.getByText('PH-0001')).toBeInTheDocument();
  });

  it('shows order stats', () => {
    renderAdmin();
    expect(screen.getByText(/1 заказов/)).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderAdmin();
    expect(screen.getByPlaceholderText(/Поиск/)).toBeInTheDocument();
  });

  it('shows refresh button', () => {
    renderAdmin();
    expect(screen.getByText('Обновить')).toBeInTheDocument();
  });

  it('shows status filter', () => {
    renderAdmin();
    expect(screen.getByText('Все статусы')).toBeInTheDocument();
  });
});
