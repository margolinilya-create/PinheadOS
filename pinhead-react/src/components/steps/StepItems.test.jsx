import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepItems from './StepItems';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  calcItemTotal: vi.fn(() => 5000),
  getItemUnitPrice: vi.fn(() => 500),
  getItemTotalQty: vi.fn(() => 10),
}));

// Mock mockup
vi.mock('../../utils/mockup', () => ({
  getGarmentSVG: vi.fn(() => '<svg>mock</svg>'),
}));

beforeEach(() => {
  useStore.setState({
    items: [
      { type: 'tee', fabric: 'cotton', color: 'WHT', sizes: { M: 10 }, sku: { name: 'T-Shirt' }, zones: ['front'] },
    ],
    activeItemIdx: 0,
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    addNewItem: vi.fn(),
    editItem: vi.fn(),
    removeItem: vi.fn(),
    fabricsCatalog: [],
    trimCatalog: [],
    extrasCatalog: [],
    usdRate: 90,
    packOption: false,
    urgentOption: false,
  });
});

describe('StepItems', () => {
  it('renders step header', () => {
    render(<StepItems />);
    expect(screen.getByText(/ПОЗИЦИИ/)).toBeInTheDocument();
  });

  it('shows item count in description', () => {
    render(<StepItems />);
    expect(screen.getByText(/1 позиция/)).toBeInTheDocument();
  });

  it('renders item card with SKU name', () => {
    render(<StepItems />);
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
  });

  it('shows add item button', () => {
    render(<StepItems />);
    expect(screen.getByText('Добавить позицию')).toBeInTheDocument();
  });

  it('calls addNewItem', () => {
    const addNewItem = vi.fn();
    useStore.setState({ addNewItem });
    render(<StepItems />);
    fireEvent.click(screen.getByText('Добавить позицию'));
    expect(addNewItem).toHaveBeenCalled();
  });

  it('shows edit button on item card', () => {
    render(<StepItems />);
    const editBtn = screen.getByTitle('Изменить');
    expect(editBtn).toBeInTheDocument();
  });

  it('calls editItem on edit button click', () => {
    const editItem = vi.fn();
    useStore.setState({ editItem });
    render(<StepItems />);
    fireEvent.click(screen.getByTitle('Изменить'));
    expect(editItem).toHaveBeenCalledWith(0);
  });

  it('does not show delete button for single item', () => {
    render(<StepItems />);
    expect(screen.queryByTitle('Удалить')).not.toBeInTheDocument();
  });

  it('shows delete button for multiple items', () => {
    useStore.setState({
      items: [
        { type: 'tee', sku: { name: 'A' }, sizes: {}, zones: [] },
        { type: 'hoodie', sku: { name: 'B' }, sizes: {}, zones: [] },
      ],
    });
    render(<StepItems />);
    expect(screen.getAllByTitle('Удалить')).toHaveLength(2);
  });

  it('disables next when no items', () => {
    useStore.setState({ items: [] });
    render(<StepItems />);
    const nextBtn = screen.getByText('Далее');
    expect(nextBtn.className).toContain('disabled');
  });

  it('calls prevStep on back', () => {
    const prevStep = vi.fn();
    useStore.setState({ prevStep });
    render(<StepItems />);
    fireEvent.click(screen.getByText(/Назад/));
    expect(prevStep).toHaveBeenCalled();
  });
});
