import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrintPreview from './PrintPreview';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  getLabelConfigPrice: vi.fn(() => 0),
  calcItemTotal: vi.fn(() => 5000),
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
        type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 10 },
        customSizes: [], zones: ['front'], zoneTechs: { front: 'screen' },
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
    urgent: false,
    pack: false,
  });
});

describe('PrintPreview', () => {
  it('renders toolbar title', () => {
    renderPrintPreview();
    expect(screen.getAllByText('ТЕХНИЧЕСКОЕ ЗАДАНИЕ').length).toBeGreaterThan(0);
  });

  it('shows print button', () => {
    renderPrintPreview();
    expect(screen.getByText('ПЕЧАТЬ / PDF')).toBeInTheDocument();
  });

  it('shows close button', () => {
    renderPrintPreview();
    expect(screen.getByText('ЗАКРЫТЬ')).toBeInTheDocument();
  });

  it('calls window.print on print button click', () => {
    renderPrintPreview();
    fireEvent.click(screen.getByText('ПЕЧАТЬ / PDF'));
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
    expect(screen.getByText('НАНЕСЕНИЕ')).toBeInTheDocument();
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

  it('shows options section', () => {
    renderPrintPreview();
    expect(screen.getByText('ОПЦИИ')).toBeInTheDocument();
    expect(screen.getByText('Стандартные условия')).toBeInTheDocument();
  });
});
