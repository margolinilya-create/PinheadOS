import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SkuEditor from './SkuEditor';
import { useStore } from '../../store/useStore';

function renderSkuEditor() {
  return render(
    <MemoryRouter>
      <SkuEditor />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    skuCatalog: [
      { code: 'tee-001', name: 'T-Shirt Basic', category: 'tshirts', fit: 'regular', sewingPrice: 200, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, zones: ['front', 'back'] },
    ],
    fabricsCatalog: [
      { code: 'cotton-30', name: 'Cotton 30/1', priceUSD: 3.5, forCategories: ['tshirts'] },
    ],
    trimCatalog: [
      { code: 'ribana-1x1', name: 'Рибана 1x1', priceUSD: 2.5 },
    ],
    usdRate: 90,
    setField: vi.fn(),
  });
});

describe('SkuEditor', () => {
  it('renders actions bar', () => {
    renderSkuEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Excel ↓')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    renderSkuEditor();
    expect(screen.getByText('Изделия')).toBeInTheDocument();
    expect(screen.getByText('Основная ткань')).toBeInTheDocument();
    expect(screen.getByText('Отделочная ткань')).toBeInTheDocument();
    expect(screen.getByText('Обработки')).toBeInTheDocument();
    expect(screen.getByText('Фурнитура')).toBeInTheDocument();
  });

  it('shows items tab by default', () => {
    renderSkuEditor();
    expect(screen.getByDisplayValue('T-Shirt Basic')).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderSkuEditor();
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
  });

  it('shows add button', () => {
    renderSkuEditor();
    expect(screen.getByText('+ Добавить')).toBeInTheDocument();
  });

  it('shows save button', () => {
    renderSkuEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
  });

  it('switches to fabrics tab', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('Основная ткань'));
    expect(screen.getByDisplayValue('Cotton 30/1')).toBeInTheDocument();
  });

  it('switches to trims tab', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('Отделочная ткань'));
    expect(screen.getByDisplayValue('Рибана 1x1')).toBeInTheDocument();
  });

  it('shows exchange rate bar', () => {
    renderSkuEditor();
    expect(screen.getByText('КУРС ЦБ:')).toBeInTheDocument();
    expect(screen.getByText('ВНУТРЕННИЙ:')).toBeInTheDocument();
  });

  it('shows add modal when clicking add', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('+ Добавить'));
    expect(screen.getByText('Добавить изделие')).toBeInTheDocument();
  });

  it('shows SKU count', () => {
    renderSkuEditor();
    expect(screen.getByText(/Всего: 1 SKU/)).toBeInTheDocument();
  });
});
