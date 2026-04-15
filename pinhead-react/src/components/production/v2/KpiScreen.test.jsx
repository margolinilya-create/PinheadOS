import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Stub workshop store: 2 sections, 1 op in section A (120 min * 10 qty = 1200 min = 20h).
const workshopState = {
  sections: [
    { id: 'sec-a', code: 'cutting', name: 'Раскрой' },
    { id: 'sec-b', code: 'sewing', name: 'Пошив' },
  ],
  operationsBySection: {
    'sec-a': [
      {
        id: 'op1',
        section_id: 'sec-a',
        minutes_snapshot: 120,
        rate_snapshot: 50,
        qty: 10,
        created_at: new Date().toISOString(),
      },
    ],
    'sec-b': [],
  },
  loading: false,
  loadBoard: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../../store/useWorkshopStore', () => ({
  useWorkshopStore: (selector) => selector(workshopState),
}));

const ordersState = {
  orders: [
    { id: 'o1', created_at: new Date().toISOString() },
    { id: 'o2', created_at: new Date().toISOString() },
  ],
  fetchOrders: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../../store/useOrdersStore', () => ({
  useOrdersStore: (selector) => selector(ordersState),
}));

vi.mock('../../../hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

vi.mock('../../shared/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

const { default: KpiScreen } = await import('./KpiScreen');

beforeEach(() => cleanup());

describe('KpiScreen', () => {
  it('renders the section load heading and the 3 top-level tiles', () => {
    render(<KpiScreen />);
    expect(screen.getByText('Загрузка участков')).toBeInTheDocument();
    expect(screen.getByText('Участков с операциями')).toBeInTheDocument();
    expect(screen.getByText('Итого часов')).toBeInTheDocument();
    expect(screen.getByText('Сдельная ₽ (план)')).toBeInTheDocument();
  });

  it('computes hours per section (120 min × 10 qty = 20 h for sec-a)', () => {
    render(<KpiScreen />);
    // 20 h appears both in the top tile (total) and the per-section row.
    expect(screen.getAllByText('20 ч').length).toBeGreaterThanOrEqual(1);
  });

  it('renders both sections in the per-section table even if one is empty', () => {
    render(<KpiScreen />);
    expect(screen.getByText('Раскрой')).toBeInTheDocument();
    expect(screen.getByText('Пошив')).toBeInTheDocument();
  });

  it('renders placeholder cards for the blocked KPIs', () => {
    render(<KpiScreen />);
    expect(screen.getByText('Средняя маржа заказа')).toBeInTheDocument();
    expect(screen.getByText('Ждём модель себестоимости')).toBeInTheDocument();
    expect(screen.getByText('On-time delivery')).toBeInTheDocument();
    expect(screen.getByText('Ждём Bitrix baseline')).toBeInTheDocument();
  });

  it('shows the period selector with 4 buttons', () => {
    render(<KpiScreen />);
    expect(screen.getByText('7 дней')).toBeInTheDocument();
    expect(screen.getByText('30 дней')).toBeInTheDocument();
    expect(screen.getByText('90 дней')).toBeInTheDocument();
    expect(screen.getByText('Всё')).toBeInTheDocument();
  });
});
