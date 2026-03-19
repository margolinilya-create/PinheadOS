import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ZoneTechBlock from './ZoneTechBlock';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  TECH_TABS: [
    { key: 'screen', label: 'Шелкография' },
    { key: 'flex', label: 'Flex' },
    { key: 'dtg', label: 'DTG' },
    { key: 'embroidery', label: 'Вышивка' },
    { key: 'dtf', label: 'DTF' },
  ],
  getZoneSurcharge: vi.fn(() => 120),
  SCREEN_FX: [
    { key: 'none', label: 'Нет', mult: 1 },
    { key: 'puff', label: 'Puff', mult: 2 },
  ],
  FLEX_FORMATS: ['A6', 'A5', 'A4', 'A3'],
  FLEX_MAX_COLORS: 3,
  getTotalQty: vi.fn(() => 100),
}));

beforeEach(() => {
  useStore.setState({
    zoneTechs: { front: 'screen' },
    setZoneTech: vi.fn(),
    zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    flexZones: {},
    dtgZones: {},
    embZones: {},
    dtfZones: {},
    setZoneParam: vi.fn(),
    sizes: { M: 100 },
    customSizes: [],
  });
});

describe('ZoneTechBlock', () => {
  it('renders zone label', () => {
    render(<ZoneTechBlock zone="front" />);
    // ZONE_LABELS['front'] should render
    expect(screen.getByText(/\+120 ₽\/шт/)).toBeInTheDocument();
  });

  it('renders tech tabs', () => {
    render(<ZoneTechBlock zone="front" />);
    expect(screen.getByText('Шелкография')).toBeInTheDocument();
    expect(screen.getByText('Flex')).toBeInTheDocument();
    expect(screen.getByText('DTG')).toBeInTheDocument();
    expect(screen.getByText('Вышивка')).toBeInTheDocument();
    expect(screen.getByText('DTF')).toBeInTheDocument();
  });

  it('calls setZoneTech when switching tech', () => {
    const setZoneTech = vi.fn();
    useStore.setState({ setZoneTech });
    render(<ZoneTechBlock zone="front" />);
    fireEvent.click(screen.getByText('Flex'));
    expect(setZoneTech).toHaveBeenCalledWith('front', 'flex');
  });

  it('shows screen params by default', () => {
    render(<ZoneTechBlock zone="front" />);
    // Screen params should show format buttons
    expect(screen.getByText('A4')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
  });

  it('shows flex params when flex selected', () => {
    useStore.setState({ zoneTechs: { front: 'flex' } });
    render(<ZoneTechBlock zone="front" />);
    expect(screen.getByText('A6')).toBeInTheDocument();
  });

  it('shows embroidery params when selected', () => {
    useStore.setState({ zoneTechs: { front: 'embroidery' } });
    render(<ZoneTechBlock zone="front" />);
    expect(screen.getByText(/до 7см/)).toBeInTheDocument();
  });

  it('shows surcharge amount', () => {
    render(<ZoneTechBlock zone="front" />);
    expect(screen.getByText('+120 ₽/шт')).toBeInTheDocument();
  });
});
