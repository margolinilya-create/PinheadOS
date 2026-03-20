import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpressCalc from './ExpressCalc';
import { useStore } from '../../store/useStore';

function renderExpress() {
  return render(
    <MemoryRouter>
      <ExpressCalc />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useStore.setState({ usdRate: 90 });
});

describe('ExpressCalc', () => {
  it('renders title', () => {
    renderExpress();
    expect(screen.getByText('EXPRESS КАЛЬКУЛЯТОР')).toBeInTheDocument();
  });

  it('shows SKU select', () => {
    renderExpress();
    expect(screen.getByText('Изделие')).toBeInTheDocument();
    expect(screen.getAllByText('— Выберите —').length).toBeGreaterThan(0);
  });

  it('shows fabric select', () => {
    renderExpress();
    expect(screen.getByText('Ткань')).toBeInTheDocument();
  });

  it('shows quantity input', () => {
    renderExpress();
    expect(screen.getByText(/Тираж/)).toBeInTheDocument();
  });

  it('shows empty state when no SKU selected', () => {
    renderExpress();
    expect(screen.getByText(/Выберите изделие/)).toBeInTheDocument();
  });

  it('does not render orphan close button', () => {
    renderExpress();
    expect(screen.queryByText('✕')).not.toBeInTheDocument();
  });

  it('defaults quantity to 100', () => {
    renderExpress();
    const input = screen.getByDisplayValue('100');
    expect(input).toBeInTheDocument();
  });
});
