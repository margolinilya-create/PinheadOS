import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StepGarment from './StepGarment';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  getSkuEstPrice: vi.fn(() => 500),
  isAccessory: vi.fn((type) => type === 'shopper'),
  getTotalQty: vi.fn(() => 0),
  getUnitPrice: vi.fn(() => 500),
}));

// Mock mockup
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg>mock</svg>'),
}));

beforeEach(() => {
  useStore.setState({
    nextStep: vi.fn(),
    type: '',
    color: '',
    fabric: '',
    sku: null,
    sizes: {},
    customSizes: [],
    skuCatalog: [
      { code: 'tee-001', name: 'T-Shirt', category: 'tshirts', fit: 'regular', zones: ['front'] },
    ],
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

  it('renders sizes section', () => {
    render(<StepGarment />);
    expect(screen.getByText('Размеры')).toBeInTheDocument();
  });
});
