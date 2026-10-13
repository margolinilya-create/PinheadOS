import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StepSummary from './StepSummary';
import { useStore } from '../../store/useStore';
import { useOrdersStore } from '../../store/useOrdersStore';
import { useAuthStore } from '../../store/useAuthStore';

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
  calcItemBreakdown: vi.fn(() => ({ base: 400, extras: 0, labels: 0, print: 100, pack: 0, discount: 0, urgent: 0, unitPrice: 500, total: 5000, qty: 10 })),
  getItemUnitPrice: vi.fn(() => 500),
  getItemTotalQty: vi.fn(() => 10),
  getTotalSurcharge: vi.fn(() => 0),
  getLabelConfigPrice: vi.fn(() => 0),
  calcExtrasCost: vi.fn(() => 0),
}));

// Перенос в «Заказы v4» — модуль грузится по клику, здесь подменён
const transfer = vi.hoisted(() => ({ transferWizardToSales: vi.fn() }));
vi.mock('../../orderstudio/wizard/transferToSales', () => transfer);

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
    phone: '+79991234567',
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
    goToStep: vi.fn(),
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

  it('renders edit buttons on section headers', () => {
    renderSummary();
    const editBtns = document.querySelectorAll('.summary-edit-btn');
    expect(editBtns.length).toBeGreaterThanOrEqual(3);
  });

  it('calls goToStep when edit button is clicked', () => {
    const goToStep = vi.fn();
    useStore.setState({ goToStep });
    renderSummary();
    const editBtns = document.querySelectorAll('.summary-edit-btn');
    fireEvent.click(editBtns[0]);
    expect(goToStep).toHaveBeenCalled();
  });

  it('shows zones block with zone names', () => {
    renderSummary();
    expect(screen.getByText('Зоны нанесения')).toBeInTheDocument();
  });

  it('shows urgent surcharge line when urgentOption is true', () => {
    useStore.setState({ urgentOption: true });
    renderSummary();
    const urgentLine = screen.getByTestId('urgent-line');
    expect(urgentLine).toBeTruthy();
    expect(urgentLine.textContent).toContain('Срочный');
  });

  it('does not show urgent line when urgentOption is false', () => {
    renderSummary();
    expect(screen.queryByTestId('urgent-line')).not.toBeInTheDocument();
  });

  it('shows price breakdown toggle', () => {
    renderSummary();
    expect(screen.getByText(/Из чего цена/)).toBeInTheDocument();
  });

  it('toggles price breakdown details on click', () => {
    renderSummary();
    expect(screen.queryByTestId('price-details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Из чего цена/));
    expect(screen.getByTestId('price-details')).toBeInTheDocument();
  });

  it('shows no validation errors when data is complete', () => {
    renderSummary();
    expect(screen.queryByTestId('validation-errors')).not.toBeInTheDocument();
  });

  it('shows validation error when name is empty', () => {
    useStore.setState({ name: '' });
    renderSummary();
    const errBlock = screen.getByTestId('validation-errors');
    expect(errBlock).toBeTruthy();
    expect(errBlock.textContent).toContain('имя клиента');
  });

  it('shows validation error when no SKU selected', () => {
    useStore.setState({
      items: [{ type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 10 }, customSizes: [], extras: [], zones: [], zoneTechs: {}, sku: null }],
    });
    renderSummary();
    const errBlock = screen.getByTestId('validation-errors');
    expect(errBlock.textContent).toContain('артикул');
  });

  it('shows validation error when quantity is zero', async () => {
    const { getItemTotalQty } = await import('../../utils/pricing');
    getItemTotalQty.mockReturnValue(0);
    useStore.setState({
      items: [{ type: 'tee', fabric: 'cotton', color: 'WHT', sizes: {}, customSizes: [], extras: [], zones: [], zoneTechs: {}, sku: { name: 'T-Shirt' } }],
    });
    renderSummary();
    const errBlock = screen.getByTestId('validation-errors');
    expect(errBlock.textContent).toContain('количество');
    getItemTotalQty.mockReturnValue(10); // restore
  });

  it('disables save button when validation errors exist', () => {
    useStore.setState({ name: '' });
    renderSummary();
    const saveBtn = screen.getByText(/Сохранить заказ/);
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.getAttribute('title')).toBe('Заполните обязательные поля');
  });
});

describe('StepSummary — «Оформить как заказ v4»', () => {
  const V4 = 'Оформить как заказ v4';
  const renderRoutes = () => render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StepSummary />} />
        <Route path="/sales/:id" element={<div>Карточка v4</div>} />
      </Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    transfer.transferWizardToSales.mockReset();
    useAuthStore.setState({ user: { name: 'Илья', role: 'admin' }, previewRole: null });
  });

  it('кнопки нет у менеджера и в просмотре «как менеджер»', () => {
    useAuthStore.setState({ user: { name: 'Аня', role: 'manager' } });
    const { unmount } = renderSummary();
    expect(screen.queryByText(V4)).toBeNull();
    unmount();
    useAuthStore.setState({ user: { name: 'Илья', role: 'admin' }, previewRole: 'manager' });
    renderSummary();
    expect(screen.queryByText(V4)).toBeNull();
  });

  it('кнопки нет при правке заказа из канбана — перенос не плодит копию', () => {
    useStore.setState({ _editingOrderId: 'old-1' });
    renderSummary();
    expect(screen.queryByText(V4)).toBeNull();
  });

  it('перенос: карточка v4 открыта, черновик главной стёрт, визард сброшен', async () => {
    const resetOrder = vi.fn();
    useStore.setState({ resetOrder });
    localStorage.setItem('pinhead_draft', '{"step":4}');
    transfer.transferWizardToSales.mockResolvedValue({ id: 'o-1', number: 'PH-0042', notes: '' });
    renderRoutes();
    fireEvent.click(screen.getByText(V4));
    expect(await screen.findByText('Карточка v4')).toBeInTheDocument();
    expect(transfer.transferWizardToSales).toHaveBeenCalledWith('Илья');
    expect(resetOrder).toHaveBeenCalled();
    expect(localStorage.getItem('pinhead_draft')).toBeNull();
  });

  it('сбой переноса — остаёмся в «Итоге», визард и черновик целы', async () => {
    const resetOrder = vi.fn();
    useStore.setState({ resetOrder });
    localStorage.setItem('pinhead_draft', '{"step":4}');
    transfer.transferWizardToSales.mockResolvedValue(null);
    renderRoutes();
    fireEvent.click(screen.getByText(V4));
    expect(await screen.findByText(V4)).toBeInTheDocument();
    expect(transfer.transferWizardToSales).toHaveBeenCalled();
    expect(resetOrder).not.toHaveBeenCalled();
    expect(localStorage.getItem('pinhead_draft')).toBe('{"step":4}');
  });

  it('заблокирована, пока в заказе ошибки', () => {
    useStore.setState({ name: '' });
    renderSummary();
    expect(screen.getByText(V4).closest('button').disabled).toBe(true);
  });
});
