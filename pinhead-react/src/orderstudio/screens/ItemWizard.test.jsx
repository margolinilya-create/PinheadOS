import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ItemWizard from './ItemWizard';
import { useStore } from '../../store/useStore';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { endItemSession } from '../wizard/itemSession';
import { newSalesOrder, newSalesItem, newSalesPrint } from '../model/factory';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';

vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig()),
  fetchSalesOrder: vi.fn(),
  saveSalesOrder: vi.fn().mockResolvedValue({ id: 'o-1', order_number: 'PH-0042', updated_at: 'now' }),
}));

const SKU = SKU_CATALOG_DEFAULT[2];

/**
 * Шаги визарда подменены: как настоящие, они пишут в общий стор и зовут
 * `nextStep`. Шаг «Дизайн» со своего «Далее» переводит визард на шаг 2 —
 * для страницы это «позиция готова».
 */
vi.mock('../../components/steps/StepGarment', () => ({
  default: () => (
    <button type="button" onClick={() => {
      const s = useStore.getState();
      s.selectSku(SKU);
      useStore.setState({ fabric: 'medas-kulirnaya-100-180', color: '01-01', sizes: { ...s.sizes, M: 30 } });
      useStore.getState().nextStep();
    }}>Изделие: далее</button>
  ),
}));
vi.mock('../../components/steps/StepDesign', () => ({
  default: () => (
    <button type="button" onClick={() => {
      useStore.setState({ zones: ['back'], zoneTechs: { back: 'screen' }, zonePrints: { back: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } } });
      useStore.getState().nextStep();
    }}>Дизайн: далее</button>
  ),
}));

const MAIN = { step: 2, maxStep: 3, name: 'Главный визард', items: [{ type: 'tee' }], activeItemIdx: 0, saved: false };

function renderAt(path, order) {
  useSalesStore.setState({ current: order, currentLoading: false, saveState: 'idle' });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales/:id/item/:key" element={<ItemWizard />} />
        <Route path="/sales/:id" element={<div>Карточка заказа</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  endItemSession();
  __resetSalesStoreForTests();
  useStore.setState(JSON.parse(JSON.stringify(MAIN)));
});

const pickMain = () => Object.fromEntries(Object.keys(MAIN).map((k) => [k, useStore.getState()[k]]));

describe('ItemWizard — визард позиции в карточке v4', () => {
  it('новая позиция: два шага → позиция в заказе, возврат в карточку, главный визард цел', async () => {
    renderAt('/sales/o-1/item/new', newSalesOrder({ id: 'o-1', number: 'PH-0042' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Изделие: далее' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Дизайн: далее' }));
    expect(await screen.findByText('Карточка заказа')).toBeInTheDocument();

    const [item] = useSalesStore.getState().current.items;
    expect(item).toMatchObject({ sku_code: SKU.code, fabric_code: 'medas-kulirnaya-100-180' });
    expect(item.size_grid.rows).toEqual([{ color: 'Белый (01-01)', sizes: { M: 30 } }]);
    expect(item.prints[0]).toMatchObject({ method: 'silkscreen', zone: 'Спина', colors: 2 });
    expect(useSalesStore.getState().saveState).toBe('dirty');
    expect(pickMain()).toEqual(MAIN);
  });

  it('правка: позиция заменяется на месте, доработанное в карточке остаётся', async () => {
    const it0 = newSalesItem({
      sku_code: SKU.code,
      size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 10 } }] },
      prints: [newSalesPrint({ method: 'silkscreen', zone: 'Спина', pantone: ['186 C'] })],
      sewing_note: 'двойная строчка',
    });
    renderAt(`/sales/o-1/item/${it0.key}`, newSalesOrder({ id: 'o-1', items: [it0, newSalesItem()] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Изделие: далее' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Дизайн: далее' }));
    await screen.findByText('Карточка заказа');

    const { items } = useSalesStore.getState().current;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: it0.key, sewing_note: 'двойная строчка' });
    expect(items[0].size_grid.rows[0].sizes).toEqual({ M: 30 });
    expect(items[0].prints[0].pantone).toEqual(['186 C']);
  });

  it('отмена: заказ не меняется, главный визард цел', async () => {
    renderAt('/sales/o-1/item/new', newSalesOrder({ id: 'o-1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Изделие: далее' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await screen.findByText('Карточка заказа');
    expect(useSalesStore.getState().current.items).toEqual([]);
    expect(pickMain()).toEqual(MAIN);
  });

  it('несуществующая позиция — сообщение, сессия не начинается', async () => {
    renderAt('/sales/o-1/item/nope', newSalesOrder({ id: 'o-1' }));
    expect(await screen.findByText('Позиция не найдена')).toBeInTheDocument();
    expect(pickMain()).toEqual(MAIN);
  });
});
