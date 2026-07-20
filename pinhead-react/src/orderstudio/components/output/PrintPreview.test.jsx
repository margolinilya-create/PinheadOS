import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrintPreview from './PrintPreview';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  getLabelConfigPrice: vi.fn(() => 0),
  calcItemTotal: vi.fn(() => 5000),
  calcItemBreakdown: vi.fn(() => ({ base: 400, extras: 0, labels: 0, print: 100, pack: 0, discount: 0, urgent: 0, unitPrice: 500, total: 5000, qty: 10 })),
  getItemUnitPrice: vi.fn(() => 500),
  getItemTotalQty: vi.fn(() => 10),
}));

function renderPrintPreview() {
  return render(
    <MemoryRouter>
      <PrintPreview />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useStore.setState({
    items: [
      {
        type: 'tee', fabric: 'cotton', color: 'WHT', fit: 'regular',
        sizes: { M: 10 }, customSizes: [], extras: [], zones: ['front'],
        zoneTechs: { front: 'screen' }, zonePrints: { front: { size: 'A4', colors: 2 } },
        noPrint: false, sku: { name: 'T-Shirt', category: 'tshirts' },
        labelConfig: { careLabel: { enabled: false }, mainLabel: { option: 'none' }, hangTag: { option: 'none' } },
      },
    ],
    fabricsCatalog: [],
    trimCatalog: [],
    extrasCatalog: [],
    usdRate: 90,
    packOption: false,
    urgentOption: false,
    name: 'Test Client',
    phone: '+7999',
    contact: '@test',
    email: 'test@test.com',
    address: 'Moscow',
    deadline: '2025-12-31',
    notes: 'Test notes',
    _editingOrderNumber: null,
  });
});

describe('PrintPreview', () => {
  it('renders toolbar title', () => {
    renderPrintPreview();
    expect(screen.getAllByText('ТЕХНИЧЕСКОЕ ЗАДАНИЕ').length).toBeGreaterThan(0);
  });

  it('shows print and pdf buttons', () => {
    renderPrintPreview();
    expect(screen.getByText('ПЕЧАТЬ')).toBeInTheDocument();
    expect(screen.getByText('СКАЧАТЬ PDF')).toBeInTheDocument();
  });

  it('shows close button', () => {
    renderPrintPreview();
    expect(screen.getByText('ЗАКРЫТЬ')).toBeInTheDocument();
  });

  it('calls window.print on print button click', () => {
    renderPrintPreview();
    fireEvent.click(screen.getByText('ПЕЧАТЬ'));
    expect(window.print).toHaveBeenCalled();
  });

  it('shows product type', () => {
    renderPrintPreview();
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
  });

  it('shows section headers', () => {
    renderPrintPreview();
    expect(screen.getAllByText('ИЗДЕЛИЕ').length).toBeGreaterThan(0);
    expect(screen.getByText('РАЗМЕРЫ И ТИРАЖ')).toBeInTheDocument();
    expect(screen.getByText('ЗОНЫ НАНЕСЕНИЯ')).toBeInTheDocument();
  });

  it('shows client info when name provided', () => {
    renderPrintPreview();
    expect(screen.getByText('Test Client')).toBeInTheDocument();
  });

  it('shows notes section', () => {
    renderPrintPreview();
    expect(screen.getByText('Test notes')).toBeInTheDocument();
  });

  it('shows grand total', () => {
    renderPrintPreview();
    expect(screen.getAllByText(/ИТОГО/).length).toBeGreaterThan(0);
  });

  it('shows PINHEAD logo', () => {
    renderPrintPreview();
    expect(screen.getAllByText('PINHEAD').length).toBeGreaterThan(0);
  });

  it('shows options section with standard conditions', () => {
    renderPrintPreview();
    expect(screen.getByText('ОПЦИИ')).toBeInTheDocument();
    expect(screen.getByText('Стандартные условия')).toBeInTheDocument();
  });

  // ── New tests ──

  it('shows zone parameters in zones table', () => {
    renderPrintPreview();
    expect(screen.getByText('A4, 2 цв.')).toBeInTheDocument();
  });

  it('shows fabric and color in item section', () => {
    renderPrintPreview();
    expect(screen.getByText('Ткань')).toBeInTheDocument();
    expect(screen.getByText('Цвет')).toBeInTheDocument();
  });

  it('shows urgent badge when urgentOption is true', () => {
    useStore.setState({ urgentOption: true });
    renderPrintPreview();
    const badge = screen.getByTestId('pp-urgent-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('СРОЧНО');
  });

  it('does not show urgent badge when urgentOption is false', () => {
    renderPrintPreview();
    expect(screen.queryByTestId('pp-urgent-badge')).not.toBeInTheDocument();
  });

  it('shows urgentOption in options section', () => {
    useStore.setState({ urgentOption: true });
    renderPrintPreview();
    expect(screen.getByText('Срочный заказ')).toBeInTheDocument();
    expect(screen.queryByText('Стандартные условия')).not.toBeInTheDocument();
  });

  it('shows packType in options section', () => {
    useStore.setState({ packOption: true, packType: 'bopp' });
    renderPrintPreview();
    expect(screen.getByText('БОПП пакет')).toBeInTheDocument();
  });

  it('renders multi-item position headers', () => {
    useStore.setState({
      items: [
        { type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 5 }, customSizes: [], extras: [], zones: [], zoneTechs: {}, noPrint: false, sku: { name: 'Футболка' }, labelConfig: {} },
        { type: 'hoodie', fabric: 'cotton', color: 'BLK', sizes: { L: 3 }, customSizes: [], extras: [], zones: [], zoneTechs: {}, noPrint: false, sku: { name: 'Худи' }, labelConfig: {} },
      ],
    });
    renderPrintPreview();
    expect(screen.getByText(/ПОЗИЦИЯ 1 ИЗ 2/)).toBeInTheDocument();
    expect(screen.getByText(/ПОЗИЦИЯ 2 ИЗ 2/)).toBeInTheDocument();
  });

  it('renders multi-item summary table', () => {
    useStore.setState({
      items: [
        { type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 5 }, customSizes: [], extras: [], zones: [], zoneTechs: {}, noPrint: false, sku: { name: 'Футболка' }, labelConfig: {} },
        { type: 'hoodie', fabric: 'cotton', color: 'BLK', sizes: { L: 3 }, customSizes: [], extras: [], zones: [], zoneTechs: {}, noPrint: false, sku: { name: 'Худи' }, labelConfig: {} },
      ],
    });
    renderPrintPreview();
    const table = screen.getByTestId('pp-summary-table');
    expect(table).toBeTruthy();
    expect(screen.getByText('СВОДНАЯ ТАБЛИЦА')).toBeInTheDocument();
  });

  it('does not show summary table for single item', () => {
    renderPrintPreview();
    expect(screen.queryByTestId('pp-summary-table')).not.toBeInTheDocument();
  });

  it('shows labels section when labelConfig has enabled labels', () => {
    useStore.setState({
      items: [{
        type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 10 }, customSizes: [], extras: [], zones: ['front'],
        zoneTechs: { front: 'screen' }, zonePrints: { front: { size: 'A4', colors: 1 } },
        noPrint: false, sku: { name: 'T-Shirt', category: 'tshirts' },
        labelConfig: { careLabel: { enabled: true, logoOption: 'standard' }, mainLabel: { option: 'none' }, hangTag: { option: 'none' } },
      }],
    });
    renderPrintPreview();
    expect(screen.getByText('БИРКИ И ЭТИКЕТКИ')).toBeInTheDocument();
    expect(screen.getByText('Бирка по уходу')).toBeInTheDocument();
  });
});
