import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StepSummary from './StepSummary';
import { useStore } from '../../store/useStore';
import { useOrdersStore } from '../../store/useOrdersStore';

// Mock supabase for useOrdersStore
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  isAccessory: vi.fn(() => false),
  calcItemTotal: vi.fn(() => 5000),
  getItemUnitPrice: vi.fn(() => 500),
  getItemTotalQty: vi.fn(() => 10),
}));

// Mock mockup
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg>mock</svg>'),
}));

function renderSummary() {
  return render(
    <MemoryRouter>
      <StepSummary />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useStore.setState({
    items: [
      {
        type: 'tee', fabric: 'cotton', color: 'WHT', fit: 'regular',
        sizes: { M: 10 }, customSizes: [], extras: [], zones: ['front'],
        zoneTechs: { front: 'screen' }, sku: { name: 'T-Shirt' },
      },
    ],
    name: 'Test User',
    contact: '@test',
    email: 'test@test.com',
    phone: '+7999',
    deadline: '2025-12-31',
    address: 'Moscow',
    notes: 'Test notes',
    role: 'manager',
    packOption: false,
    urgentOption: false,
    prevStep: vi.fn(),
    resetOrder: vi.fn(),
    fabricsCatalog: [],
    trimCatalog: [],
    extrasCatalog: [],
    usdRate: 90,
    bitrixDeal: '',
    messenger: '',
    _editingOrderId: null,
    _editingOrderNumber: null,
    _lastSavedOrderNum: null,
  });
  useOrdersStore.setState({
    saveOrder: vi.fn().mockResolvedValue({ id: 1, order_number: 'PH-0001' }),
    updateOrder: vi.fn(),
  });
});

describe('StepSummary', () => {
  it('renders step header', () => {
    renderSummary();
    expect(screen.getByText(/ГОТОВО/)).toBeInTheDocument();
  });

  it('shows item type in summary', () => {
    renderSummary();
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
  });

  it('shows client name', () => {
    renderSummary();
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('shows save button', () => {
    renderSummary();
    expect(screen.getByText(/Сохранить заказ/)).toBeInTheDocument();
  });

  it('shows copy TZ button', () => {
    renderSummary();
    expect(screen.getByText(/Скопировать ТЗ/)).toBeInTheDocument();
  });

  it('shows print button', () => {
    renderSummary();
    expect(screen.getByText(/Печать/)).toBeInTheDocument();
  });

  it('calls prevStep on back', () => {
    const prevStep = vi.fn();
    useStore.setState({ prevStep });
    renderSummary();
    fireEvent.click(screen.getByText(/Назад/));
    expect(prevStep).toHaveBeenCalled();
  });

  it('shows update button when editing existing order', () => {
    useStore.setState({ _editingOrderId: 42 });
    renderSummary();
    expect(screen.getByText(/Обновить заказ/)).toBeInTheDocument();
  });

  it('shows new order button', () => {
    renderSummary();
    expect(screen.getByText('Новый заказ')).toBeInTheDocument();
  });

  it('calls resetOrder when clicking new order', () => {
    const resetOrder = vi.fn();
    useStore.setState({ resetOrder });
    renderSummary();
    fireEvent.click(screen.getByText('Новый заказ'));
    expect(resetOrder).toHaveBeenCalled();
  });

  it('shows total price', () => {
    renderSummary();
    expect(screen.getByText('ИТОГО')).toBeInTheDocument();
  });
});
