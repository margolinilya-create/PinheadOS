import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SummaryTab from './SummaryTab';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { useStore } from '../../store/useStore';
import { PRICES } from '../../data/prices';

const item = (patch) => newSalesItem({
  kind: 'blank',
  product_type: 'Футболка',
  size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 10 } }] },
  ...patch,
});

const renderSummary = (order) => render(
  <MemoryRouter>
    <SummaryTab order={order} price={null} readOnly={false} itemHref={(k) => `/sales/1?item=${k}`} onDiscount={() => {}} />
  </MemoryRouter>,
);

afterEach(() => useStore.setState({ prices: PRICES }));

describe('SummaryTab — подпись упаковки из «Справочников заказа» (веха 4)', () => {
  it('переименованный в админке вид упаковки виден в сводке', () => {
    useStore.setState({
      prices: { ...PRICES, packOptions: [{ key: 'zip', name: 'ЗИП-лок с бегунком', price: 45 }] },
    });
    renderSummary(newSalesOrder({ packaging: 'zip', items: [item({ packaging: 'inherit' })] }));
    expect(screen.getByText('Упаковка: ЗИП-лок с бегунком')).toBeInTheDocument();
  });

  it('у позиции своя упаковка — её подпись, а не заказа', () => {
    useStore.setState({
      prices: { ...PRICES, packOptions: [{ key: 'bopp', name: 'Пакет БОПП 30 мкм', price: 20 }] },
    });
    renderSummary(newSalesOrder({ packaging: 'zip', items: [item({ packaging: 'bopp' })] }));
    expect(screen.getByText('Упаковка: Пакет БОПП 30 мкм')).toBeInTheDocument();
  });

  it('без упаковки — строки нет', () => {
    renderSummary(newSalesOrder({ packaging: 'none', items: [item({ packaging: 'inherit' })] }));
    expect(screen.queryByText(/^Упаковка:/)).not.toBeInTheDocument();
  });
});
