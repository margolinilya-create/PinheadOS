import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SalesCard from './SalesCard';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { newSalesItem, newSalesOrder } from '../model/factory';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';

vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig()),
  fetchSalesOrder: vi.fn(),
  saveSalesOrder: vi.fn().mockResolvedValue({ id: 'o-1', order_number: 'PH-0042', updated_at: 'now' }),
}));

const SKU = SKU_CATALOG_DEFAULT[2];

function renderCard(order) {
  useSalesStore.setState({ current: order, currentLoading: false, saveState: 'idle' });
  return render(
    <MemoryRouter initialEntries={[`/sales/${order.id}`]}>
      <Routes><Route path="/sales/:id" element={<SalesCard />} /></Routes>
    </MemoryRouter>,
  );
}

const total = () => screen.getByTestId('order-total').textContent;

beforeEach(() => { __resetSalesStoreForTests(); });

describe('SalesCard — карточка заказа v4', () => {
  it('правка тиража в сетке меняет итог', () => {
    renderCard(newSalesOrder({
      id: 'o-1',
      number: 'PH-0042',
      items: [newSalesItem({
        sku_code: SKU.code,
        product_type: SKU.name,
        size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 10 } }] },
      })],
    }));
    const before = total();
    expect(before).toMatch(/₽/);
    fireEvent.change(screen.getByLabelText('Чёрный, M'), { target: { value: '90' } });
    expect(total()).not.toBe(before);
    expect(useSalesStore.getState().saveState).toBe('dirty');
    expect(useSalesStore.getState().current.items[0].size_grid.rows[0].sizes.M).toBe(90);
  });

  it('ручная цена заменяет расчётную в итоге', () => {
    renderCard(newSalesOrder({
      id: 'o-1',
      items: [newSalesItem({
        sku_code: SKU.code,
        size_grid: { sizes: ['S'], rows: [{ color: 'Белый', sizes: { S: 10 } }] },
      })],
    }));
    fireEvent.change(screen.getByLabelText('Ручная цена за штуку'), { target: { value: '1000' } });
    expect(total()).toBe(`${(10000).toLocaleString('ru-RU')} ₽`);
  });

  it('позиция добавляется и удаляется', () => {
    renderCard(newSalesOrder({ id: 'o-1' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Позиция вручную' }));
    expect(screen.getByRole('region', { name: 'Позиция 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить позицию' }));
    expect(screen.queryByRole('region', { name: 'Позиция 1' })).toBeNull();
  });

  it('модель без формулы не молчит — пометка «нужна ручная цена»', () => {
    renderCard(newSalesOrder({
      id: 'o-1',
      items: [newSalesItem({ sku_code: 'NOPE', size_grid: { sizes: ['S'], rows: [{ color: 'Белый', sizes: { S: 5 } }] } })],
    }));
    expect(screen.getByText(/Модель не найдена в прайс-каталоге/)).toBeInTheDocument();
    expect(screen.getByText(/Не все позиции посчитаны/)).toBeInTheDocument();
  });
});
