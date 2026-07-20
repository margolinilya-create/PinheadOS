import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepGarment from './StepGarment';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  getSkuEstPrice: vi.fn(() => 500),
  isAccessory: vi.fn((type) => type === 'shopper'),
  getTotalQty: vi.fn(() => 0),
  getUnitPrice: vi.fn(() => 500),
  calcExtrasCost: vi.fn(() => 0),
}));

// Mock mockup
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg>mock</svg>'),
}));

const baseSku = { code: 'tee-001', name: 'T-Shirt', category: 'tshirts', fit: 'regular', zones: ['front'] };

beforeEach(() => {
  useStore.setState({
    nextStep: vi.fn(),
    type: '',
    color: '',
    fabric: '',
    sku: null,
    sizes: {},
    customSizes: [],
    skuCatalog: [baseSku],
    skuFilter: 'all',
    setSkuFilter: vi.fn(),
    selectSku: vi.fn(),
    reorderSku: vi.fn(),
    selectFabric: vi.fn(),
    selectColor: vi.fn(),
    colorSupplier: 'medastex',
    setColorSupplier: vi.fn(),
    setSize: vi.fn(),
    setOneSizeQty: vi.fn(),
    addCustomSize: vi.fn(),
    removeCustomSize: vi.fn(),
    setCustomSizeQty: vi.fn(),
    setCustomSizeLabel: vi.fn(),
    fabricsCatalog: [],
    trimCatalog: [],
    usdRate: 90,
    fit: 'regular',
    fitChosen: false,
  });
});

// Helper: set state so all sections are visible (garment→fabric→color→sizes)
const setFullState = () => {
  useStore.setState({
    sku: baseSku,
    type: 'tee',
    fabric: 'kulirnaya',
    color: '01-01',
  });
};

describe('StepGarment', () => {
  it('renders step header', () => {
    render(<StepGarment />);
    expect(screen.getByText('ИЗДЕЛИЕ')).toBeInTheDocument();
  });

  it('renders SKU list section', () => {
    render(<StepGarment />);
    expect(screen.getByText('Изделие')).toBeInTheDocument();
  });

  it('shows next button', () => {
    render(<StepGarment />);
    expect(screen.getByText('Далее')).toBeInTheDocument();
  });

  it('disables next when no type selected', () => {
    render(<StepGarment />);
    const btn = screen.getByText('Далее');
    expect(btn.className).toContain('disabled');
  });

  it('hides fabric section when no SKU selected', () => {
    render(<StepGarment />);
    expect(screen.queryByText('Ткань')).toBeNull();
  });

  it('hides color section when no fabric selected', () => {
    useStore.setState({ sku: baseSku, type: 'tee' });
    render(<StepGarment />);
    expect(screen.queryByText('Цвет базы')).toBeNull();
  });

  it('hides sizes section when no color selected', () => {
    useStore.setState({ sku: baseSku, type: 'tee', fabric: 'kulirnaya' });
    render(<StepGarment />);
    expect(screen.queryByText('Размеры')).toBeNull();
  });

  it('shows sizes section when color is selected', () => {
    setFullState();
    render(<StepGarment />);
    expect(screen.getByText('Размеры')).toBeInTheDocument();
  });

  it('renders supplier tabs when fabric is selected', () => {
    useStore.setState({ sku: baseSku, type: 'tee', fabric: 'kulirnaya' });
    render(<StepGarment />);
    const tabs = document.querySelectorAll('.supplier-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Medastex');
    expect(tabs[1].textContent).toContain('CottonProm');
  });

  it('highlights active supplier tab', () => {
    useStore.setState({ sku: baseSku, type: 'tee', fabric: 'kulirnaya' });
    render(<StepGarment />);
    const activeTab = document.querySelector('.supplier-tab.active');
    expect(activeTab).toBeTruthy();
    expect(activeTab.textContent).toContain('Medastex');
  });

  it('calls setColorSupplier when clicking supplier tab', () => {
    const setColorSupplier = vi.fn();
    useStore.setState({ sku: baseSku, type: 'tee', fabric: 'kulirnaya', setColorSupplier });
    render(<StepGarment />);
    const tabs = document.querySelectorAll('.supplier-tab');
    fireEvent.click(tabs[1]);
    expect(setColorSupplier).toHaveBeenCalledWith('cottonprom');
  });

  it('shows fabric color count when fabric is selected', () => {
    useStore.setState({
      type: 'tee',
      fabric: 'kulirnaya',
      sku: baseSku,
      fabricsCatalog: [
        { code: 'kulirnaya', name: 'Кулирка', priceUSD: 2.80, forCategories: ['tshirts'], supplier: 'Medastex' },
      ],
    });
    render(<StepGarment />);
    expect(screen.getByText(/Доступные цвета:/)).toBeInTheDocument();
  });

  it('renders size inputs with tabIndex for tab navigation', () => {
    setFullState();
    render(<StepGarment />);
    const inputs = document.querySelectorAll('.size-table-desktop .qty-input[type="number"]');
    expect(inputs.length).toBeGreaterThan(0);
    expect(parseInt(inputs[0].getAttribute('tabindex'))).toBeGreaterThan(0);
  });

  it('disables sizes from sku.availableSizes', () => {
    useStore.setState({
      sku: { ...baseSku, availableSizes: ['M', 'L', 'XL'] },
      type: 'tee', fabric: 'kulirnaya', color: '01-01',
    });
    render(<StepGarment />);
    const disabledRows = document.querySelectorAll('.size-table-desktop .size-row-disabled');
    expect(disabledRows.length).toBe(5);
  });

  it('shows tooltip on disabled size row', () => {
    useStore.setState({
      sku: { ...baseSku, availableSizes: ['M'] },
      type: 'tee', fabric: 'kulirnaya', color: '01-01',
    });
    render(<StepGarment />);
    const disabledRow = document.querySelector('.size-table-desktop .size-row-disabled');
    expect(disabledRow.getAttribute('title')).toContain('недоступен');
  });

  it('renders mobile size list', () => {
    setFullState();
    render(<StepGarment />);
    const mobileList = document.querySelector('.size-list-mobile');
    expect(mobileList).toBeTruthy();
    const mobileRows = mobileList.querySelectorAll('.size-mobile-row');
    expect(mobileRows.length).toBe(8);
  });

  it('shows total in mobile layout', () => {
    setFullState();
    render(<StepGarment />);
    const mobileTotal = document.querySelector('.size-mobile-total');
    expect(mobileTotal).toBeTruthy();
    expect(mobileTotal.textContent).toContain('Итого:');
  });
});
