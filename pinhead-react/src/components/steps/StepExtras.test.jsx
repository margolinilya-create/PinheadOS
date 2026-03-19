import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepExtras from './StepExtras';
import { useStore } from '../../store/useStore';

beforeEach(() => {
  useStore.setState({
    sku: null,
    extras: [],
    extrasCatalog: [
      { code: 'ex1', name: 'Обработка 1', price: 50 },
      { code: 'ex2', name: 'Обработка 2', price: 100, forCategories: ['tshirts'] },
    ],
    toggleExtra: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
  });
});

describe('StepExtras', () => {
  it('renders step header', () => {
    render(<StepExtras />);
    expect(screen.getByText('ОБРАБОТКИ')).toBeInTheDocument();
  });

  it('shows empty state when no SKU selected', () => {
    render(<StepExtras />);
    expect(screen.getByText(/Сначала выберите/)).toBeInTheDocument();
  });

  it('shows extras when SKU is selected', () => {
    useStore.setState({ sku: { code: 'test', name: 'Test', category: 'tshirts' } });
    render(<StepExtras />);
    expect(screen.getByText('Обработка 2')).toBeInTheDocument();
  });

  it('shows all extras without category filter', () => {
    useStore.setState({ sku: { code: 'test', name: 'Test', category: 'tshirts' } });
    render(<StepExtras />);
    expect(screen.getByText('Обработка 1')).toBeInTheDocument();
    expect(screen.getByText('Обработка 2')).toBeInTheDocument();
  });

  it('shows no extras message for category without extras', () => {
    useStore.setState({
      sku: { code: 'test', name: 'Test', category: 'rare' },
      extrasCatalog: [{ code: 'ex1', name: 'Extra', price: 50, forCategories: ['tshirts'] }],
    });
    render(<StepExtras />);
    expect(screen.getByText(/нет доступных обработок/)).toBeInTheDocument();
  });

  it('calls toggleExtra when clicking an extra', () => {
    const toggleExtra = vi.fn();
    useStore.setState({
      sku: { code: 'test', name: 'Test', category: 'tshirts' },
      toggleExtra,
    });
    render(<StepExtras />);
    fireEvent.click(screen.getByText('Обработка 1'));
    expect(toggleExtra).toHaveBeenCalledWith('ex1');
  });

  it('shows extras summary when extras selected', () => {
    useStore.setState({
      sku: { code: 'test', name: 'Test', category: 'tshirts' },
      extras: ['ex1'],
    });
    render(<StepExtras />);
    expect(screen.getByText(/Выбрано/)).toBeInTheDocument();
  });

  it('calls prevStep when clicking back', () => {
    const prevStep = vi.fn();
    useStore.setState({ prevStep });
    render(<StepExtras />);
    fireEvent.click(screen.getByText(/Назад/));
    expect(prevStep).toHaveBeenCalled();
  });

  it('calls nextStep when clicking next', () => {
    const nextStep = vi.fn();
    useStore.setState({ nextStep });
    render(<StepExtras />);
    fireEvent.click(screen.getByText('Далее'));
    expect(nextStep).toHaveBeenCalled();
  });
});
