import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
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

// Mock Recharts to avoid rendering issues
vi.mock('recharts', () => ({
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  PieChart: ({ children }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Legend: () => null,
  AreaChart: ({ children }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useOrdersStore.setState({
    orders: [
      { id: 1, order_number: 'PH-0001', status: 'done', data: { name: 'Alice' }, item_type: 'tee', total_qty: 50, total_sum: 25000, created_at: new Date().toISOString() },
      { id: 2, order_number: 'PH-0002', status: 'production', data: { name: 'Bob', deadline: '2025-12-31' }, item_type: 'hoodie', total_qty: 20, total_sum: 15000, created_at: new Date().toISOString() },
    ],
    fetchOrders: vi.fn(),
  });
  useStore.setState({ loadOrder: vi.fn() });
});

describe('Dashboard', () => {
  it('renders title', () => {
    renderDashboard();
    expect(screen.getByText('ДАШБОРД')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    renderDashboard();
    expect(screen.getByText('Аналитика')).toBeInTheDocument();
    expect(screen.getByText('Производство')).toBeInTheDocument();
  });

  it('shows analytics tab by default', () => {
    renderDashboard();
    expect(screen.getAllByText('Заказов').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Сумма').length).toBeGreaterThan(0);
  });

  it('shows period buttons', () => {
    renderDashboard();
    expect(screen.getByText('7 дней')).toBeInTheDocument();
    expect(screen.getByText('30 дней')).toBeInTheDocument();
    expect(screen.getByText('90 дней')).toBeInTheDocument();
    expect(screen.getByText('Всё')).toBeInTheDocument();
  });

  it('shows export CSV button', () => {
    renderDashboard();
    expect(screen.getByText('Экспорт CSV')).toBeInTheDocument();
  });

  it('shows metrics', () => {
    renderDashboard();
    expect(screen.getByText('Ср. чек')).toBeInTheDocument();
    expect(screen.getByText('Конверсия')).toBeInTheDocument();
  });

  it('switches to production tab', () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Производство'));
    expect(screen.getByText('Текущая загрузка')).toBeInTheDocument();
  });

  it('shows production stats', () => {
    renderDashboard();
    fireEvent.click(screen.getByText('Производство'));
    expect(screen.getByText(/В ПРОИЗВОДСТВЕ/)).toBeInTheDocument();
    expect(screen.getByText(/ПОДТВЕРЖДЕНО/)).toBeInTheDocument();
  });

  it('shows recent orders table', () => {
    renderDashboard();
    expect(screen.getByText('Последние заказы')).toBeInTheDocument();
    expect(screen.getByText('PH-0001')).toBeInTheDocument();
  });

  it('calls fetchOrders on mount', () => {
    const fetchOrders = vi.fn();
    useOrdersStore.setState({ fetchOrders });
    renderDashboard();
    expect(fetchOrders).toHaveBeenCalled();
  });
});
