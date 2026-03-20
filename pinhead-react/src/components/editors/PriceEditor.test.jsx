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
  it('renders actions bar', () => {
    renderPriceEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
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
    expect(screen.getByText(/Базовая цена/)).toBeInTheDocument();
  });

  it('switches to DTF tab', () => {
    renderPriceEditor();
    fireEvent.click(screen.getByText('DTF'));
    expect(screen.getByText(/Надбавки за формат/)).toBeInTheDocument();
  });

  it('switches to history tab', () => {
    renderPriceEditor();
    fireEvent.click(screen.getByText('История'));
    expect(screen.getByText('Нет изменений')).toBeInTheDocument();
  });

  it('shows save button', () => {
    renderPriceEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
  });

  it('shows export/import buttons', () => {
    renderPriceEditor();
    expect(screen.getByText('Экспорт')).toBeInTheDocument();
    expect(screen.getByText('Импорт')).toBeInTheDocument();
  });

  it('shows reset button', () => {
    renderPriceEditor();
    expect(screen.getByText('Сброс')).toBeInTheDocument();
  });

  it('shows stale banner when usdUpdatedAt is missing', () => {
    renderPriceEditor();
    expect(screen.getByText(/Дата обновления курса \$ неизвестна/)).toBeInTheDocument();
    expect(screen.getByText('Обновить')).toBeInTheDocument();
  });

  it('shows stale banner when usdUpdatedAt is old', () => {
    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const prices = { usdUpdatedAt: oldDate, screenTiers: [], screenFormats: [] };
    localStorage.setItem('ph_prices', JSON.stringify(prices));
    renderPriceEditor();
    expect(screen.getByText(/Курс \$ не обновлялся 3 дн/)).toBeInTheDocument();
  });

  it('hides stale banner when usdUpdatedAt is recent', () => {
    const recentDate = new Date().toISOString();
    const prices = { usdUpdatedAt: recentDate, screenTiers: [], screenFormats: [] };
    localStorage.setItem('ph_prices', JSON.stringify(prices));
    renderPriceEditor();
    expect(screen.queryByText(/Курс \$ не обновлялся/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Дата обновления курса/)).not.toBeInTheDocument();
  });
});
