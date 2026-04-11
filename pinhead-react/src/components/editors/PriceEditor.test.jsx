import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PriceEditor from './PriceEditor';

function renderPriceEditor() {
  return render(
    <MemoryRouter>
      <PriceEditor />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('PriceEditor', () => {
  it('renders actions bar with title', () => {
    renderPriceEditor();
    expect(screen.getByText('Редактор цен')).toBeInTheDocument();
  });

  it('renders pricing tab content with save button', () => {
    renderPriceEditor();
    expect(screen.getByText('Сохранить цены')).toBeInTheDocument();
    expect(screen.getByText('Экспорт')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    renderPriceEditor();
    expect(screen.getByText('Шелкография')).toBeInTheDocument();
    expect(screen.getByText('Вышивка')).toBeInTheDocument();
    expect(screen.getByText('DTF')).toBeInTheDocument();
    expect(screen.getByText('DTG')).toBeInTheDocument();
    expect(screen.getByText('Флекс')).toBeInTheDocument();
    expect(screen.getByText('Доп')).toBeInTheDocument();
    expect(screen.getByText('История')).toBeInTheDocument();
  });

  it('shows screen tab by default', () => {
    renderPriceEditor();
    expect(screen.getByText('Матрица шелкографии')).toBeInTheDocument();
  });

  it('switches to embroidery tab', () => {
    renderPriceEditor();
    fireEvent.click(screen.getByText('Вышивка'));
    expect(screen.getByText(/Стежков на 1 см²/)).toBeInTheDocument();
  });

  it('switches to DTF tab', () => {
    renderPriceEditor();
    fireEvent.click(screen.getByText('DTF'));
    expect(screen.getByText(/Цена метра плёнки/)).toBeInTheDocument();
  });

  it('switches to history tab', () => {
    renderPriceEditor();
    fireEvent.click(screen.getByText('История'));
    expect(screen.getByText('Нет изменений')).toBeInTheDocument();
  });

  it('shows export/import/reset buttons', () => {
    renderPriceEditor();
    expect(screen.getByText('Экспорт')).toBeInTheDocument();
    expect(screen.getByText('Импорт')).toBeInTheDocument();
    expect(screen.getByText('Сброс')).toBeInTheDocument();
  });

  it('shows individual FX surcharges', () => {
    renderPriceEditor();
    expect(screen.getByText('К. база')).toBeInTheDocument();
    expect(screen.getByText('PUFF')).toBeInTheDocument();
    expect(screen.getByText('Металлик')).toBeInTheDocument();
    expect(screen.getByText('Флюр')).toBeInTheDocument();
  });
});
