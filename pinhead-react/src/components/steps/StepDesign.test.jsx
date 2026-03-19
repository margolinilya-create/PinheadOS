import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepDesign from './StepDesign';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  hasNoPrint: vi.fn((type) => type === 'shopper'),
  getZoneSurcharge: vi.fn(() => 490),
  getTotalQty: vi.fn(() => 100),
  TECH_TABS: [
    { key: 'screen', label: 'Шелкография' },
    { key: 'flex', label: 'Flex' },
    { key: 'dtg', label: 'DTG' },
    { key: 'embroidery', label: 'Вышивка' },
    { key: 'dtf', label: 'DTF' },
  ],
  SCREEN_FX: [{ key: 'none', label: 'Нет', mult: 1 }],
  FLEX_FORMATS: ['A6', 'A5', 'A4', 'A3'],
  FLEX_MAX_COLORS: 3,
}));

beforeEach(() => {
  useStore.setState({
    sku: { code: 'tee-001', name: 'T-Shirt', zones: ['front', 'back'] },
    type: 'tee',
    zones: [],
    toggleZone: vi.fn(),
    noPrint: false,
    toggleNoPrint: vi.fn(),
    designNotes: '',
    setField: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    sizes: { M: 100 },
    customSizes: [],
    zoneTechs: {},
  });
});

describe('StepDesign', () => {
  it('renders step header', () => {
    render(<StepDesign />);
    expect(screen.getByText('ДИЗАЙН')).toBeInTheDocument();
  });

  it('shows empty state when no SKU', () => {
    useStore.setState({ sku: null });
    render(<StepDesign />);
    expect(screen.getByText(/Сначала выберите/)).toBeInTheDocument();
  });

  it('renders zone cards including disabled ones', () => {
    render(<StepDesign />);
    const zoneCards = document.querySelectorAll('.zone-card');
    // ALL_ZONES has 5 zones, sku.zones has 2 available
    expect(zoneCards.length).toBe(5);
    const disabled = document.querySelectorAll('.zone-card.disabled');
    expect(disabled.length).toBe(3);
  });

  it('disabled zone has tooltip', () => {
    render(<StepDesign />);
    const disabled = document.querySelector('.zone-card.disabled');
    expect(disabled.getAttribute('title')).toBe('Недоступно для этого изделия');
  });

  it('calls toggleZone when clicking available zone', () => {
    const toggleZone = vi.fn();
    useStore.setState({ toggleZone });
    render(<StepDesign />);
    const available = document.querySelectorAll('.zone-card:not(.disabled)');
    if (available.length > 0) {
      fireEvent.click(available[0]);
      expect(toggleZone).toHaveBeenCalled();
    }
  });

  it('does not call toggleZone when clicking disabled zone', () => {
    const toggleZone = vi.fn();
    useStore.setState({ toggleZone });
    render(<StepDesign />);
    const disabled = document.querySelector('.zone-card.disabled');
    fireEvent.click(disabled);
    expect(toggleZone).not.toHaveBeenCalled();
  });

  it('shows mini-summary on active zone', () => {
    useStore.setState({ zones: ['front'] });
    render(<StepDesign />);
    const summary = document.querySelector('.zone-mini-summary');
    expect(summary).toBeTruthy();
    expect(summary.textContent).toContain('+490 ₽');
  });

  it('shows no-print button', () => {
    render(<StepDesign />);
    expect(screen.getByText('Без нанесения')).toBeInTheDocument();
  });

  it('calls toggleNoPrint', () => {
    const toggleNoPrint = vi.fn();
    useStore.setState({ toggleNoPrint });
    render(<StepDesign />);
    fireEvent.click(screen.getByText('Без нанесения'));
    expect(toggleNoPrint).toHaveBeenCalled();
  });

  it('shows noPrint message for shopper type', () => {
    useStore.setState({ type: 'shopper' });
    render(<StepDesign />);
    expect(screen.getByText(/нанесение не предусмотрено/)).toBeInTheDocument();
  });

  it('shows design notes textarea', () => {
    render(<StepDesign />);
    expect(screen.getByPlaceholderText(/Описание дизайна/)).toBeInTheDocument();
  });

  it('shows LabelConfigurator section', () => {
    render(<StepDesign />);
    expect(screen.getByText('Бирки и этикетки')).toBeInTheDocument();
  });

  it('calls prevStep on back', () => {
    const prevStep = vi.fn();
    useStore.setState({ prevStep, noPrint: true });
    render(<StepDesign />);
    fireEvent.click(screen.getByText(/Назад/));
    expect(prevStep).toHaveBeenCalled();
  });
});
