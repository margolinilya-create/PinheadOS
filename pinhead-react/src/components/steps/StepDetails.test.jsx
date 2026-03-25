import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StepDetails from './StepDetails';
import { useStore } from '../../store/useStore';

beforeEach(() => {
  useStore.setState({
    name: '',
    contact: '',
    email: '',
    phone: '',
    messenger: '',
    bitrixDeal: '',
    deadline: '',
    address: '',
    notes: '',
    role: 'manager',
    packOption: false,
    packType: 'none',
    urgentOption: false,
    setField: vi.fn(),
    togglePack: vi.fn(),
    setPackType: vi.fn(),
    toggleUrgent: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
  });
});

describe('StepDetails', () => {
  it('renders step header', () => {
    render(<StepDetails />);
    expect(screen.getByText(/ДЕТАЛИ/)).toBeInTheDocument();
  });

  it('shows role buttons', () => {
    render(<StepDetails />);
    expect(screen.getByText(/Менеджер/)).toBeInTheDocument();
    expect(screen.getByText(/Клиент/)).toBeInTheDocument();
    expect(screen.getByText(/Партнёр/)).toBeInTheDocument();
  });

  it('shows name field as required', () => {
    render(<StepDetails />);
    expect(screen.getByPlaceholderText('Иванов Иван')).toBeInTheDocument();
  });

  it('shows validation error when name empty and next clicked', () => {
    render(<StepDetails />);
    fireEvent.click(screen.getByText('Далее'));
    expect(screen.getByText('Обязательное поле')).toBeInTheDocument();
  });

  it('does not show error initially', () => {
    render(<StepDetails />);
    expect(screen.queryByText('Обязательное поле')).not.toBeInTheDocument();
  });

  it('calls nextStep when name is filled', () => {
    const nextStep = vi.fn();
    useStore.setState({ name: 'Test User', nextStep });
    render(<StepDetails />);
    fireEvent.click(screen.getByText('Далее'));
    expect(nextStep).toHaveBeenCalled();
  });

  it('shows pack options', () => {
    render(<StepDetails />);
    expect(screen.getByText('Без упаковки')).toBeInTheDocument();
    expect(screen.getByText('БОПП пакет')).toBeInTheDocument();
    expect(screen.getByText('ЗИП пакет')).toBeInTheDocument();
  });

  it('shows urgent toggle', () => {
    render(<StepDetails />);
    expect(screen.getByText(/Срочное производство/)).toBeInTheDocument();
  });

  it('calls setPackType when clicking pack button', () => {
    const setPackType = vi.fn();
    useStore.setState({ setPackType });
    render(<StepDetails />);
    fireEvent.click(screen.getByText('БОПП пакет'));
    expect(setPackType).toHaveBeenCalledWith('bopp');
  });

  it('calls prevStep on back button', () => {
    const prevStep = vi.fn();
    useStore.setState({ prevStep });
    render(<StepDetails />);
    fireEvent.click(screen.getByText(/Назад/));
    expect(prevStep).toHaveBeenCalled();
  });

  it('calls setField when role button clicked', () => {
    const setField = vi.fn();
    useStore.setState({ setField });
    render(<StepDetails />);
    fireEvent.click(screen.getByText(/Клиент/));
    expect(setField).toHaveBeenCalledWith('role', 'client');
  });
});
