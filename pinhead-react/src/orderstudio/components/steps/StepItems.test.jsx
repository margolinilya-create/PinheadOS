import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepItems from './StepItems';
import { useStore } from '../../store/useStore';

// Mock pricing
vi.mock('../../utils/pricing', () => ({
  calcItemTotal: vi.fn(() => 5000),
  calcItemBreakdown: vi.fn(() => ({ base: 400, extras: 0, labels: 0, print: 100, pack: 0, discount: 0, urgent: 0, unitPrice: 500, total: 5000, qty: 10 })),
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
    expect(screen.getAllByText('T-Shirt').length).toBeGreaterThan(0);
  });

  it('shows add item button', () => {
    render(<StepItems />);
    expect(screen.getAllByText(/Добавить позицию/).length).toBeGreaterThan(0);
  });

  it('calls addNewItem from tray button', () => {
    const addNewItem = vi.fn();
    useStore.setState({ addNewItem });
    render(<StepItems />);
    const trayBtn = document.querySelector('.item-card-add');
    fireEvent.click(trayBtn);
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

  it('renders prominent add-item button at header level', () => {
    render(<StepItems />);
    const btn = document.querySelector('.btn-add-item');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Добавить позицию');
  });

  it('calls addNewItem from prominent button', () => {
    const addNewItem = vi.fn();
    useStore.setState({ addNewItem });
    render(<StepItems />);
    fireEvent.click(document.querySelector('.btn-add-item'));
    expect(addNewItem).toHaveBeenCalled();
  });

  it('renders summary table with item rows', () => {
    render(<StepItems />);
    const table = screen.getByTestId('items-summary-table');
    expect(table).toBeTruthy();
    expect(table.querySelectorAll('tbody tr').length).toBe(2); // 1 item + 1 total row
  });

  it('shows ИТОГО row in summary table', () => {
    render(<StepItems />);
    const totalRow = document.querySelector('.items-total-row');
    expect(totalRow).toBeTruthy();
    expect(totalRow.textContent).toContain('ИТОГО');
  });

  it('summary table shows correct totals for multiple items', () => {
    useStore.setState({
      items: [
        { type: 'tee', sku: { name: 'Футболка' }, sizes: { M: 10 }, zones: [] },
        { type: 'hoodie', sku: { name: 'Худи' }, sizes: { L: 5 }, zones: [] },
      ],
    });
    render(<StepItems />);
    const rows = document.querySelectorAll('.items-summary-table tbody tr');
    expect(rows.length).toBe(3); // 2 items + 1 total
    const totalRow = document.querySelector('.items-total-row .items-total-sum');
    expect(totalRow.textContent).toContain('₽');
  });
});
