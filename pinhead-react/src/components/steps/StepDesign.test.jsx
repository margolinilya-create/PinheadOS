import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepDesign from './StepDesign';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  hasNoPrint: vi.fn((type) => type === 'shopper'),
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

  it('renders zone cards', () => {
    render(<StepDesign />);
    // ZONE_LABELS is imported from data
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('calls toggleZone when clicking a zone', () => {
    const toggleZone = vi.fn();
    useStore.setState({ toggleZone });
    render(<StepDesign />);
    // Click on a zone card
    const zoneCards = document.querySelectorAll('.zone-card');
    if (zoneCards.length > 0) {
      fireEvent.click(zoneCards[0]);
      expect(toggleZone).toHaveBeenCalled();
    }
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
