import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transferWizardToSales } from './transferToSales';
import { useStore } from '../../store/useStore';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { defaultItemFields } from '../../store/slices/helpers';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';

const api = vi.hoisted(() => ({ saveSalesOrder: vi.fn() }));
vi.mock('../api/salesOrders', async (orig) => ({
  ...(await orig()),
  saveSalesOrder: api.saveSalesOrder,
}));

const item = {
  ...JSON.parse(JSON.stringify(defaultItemFields)),
  sku: SKU_CATALOG_DEFAULT[2],
  fabric: 'medas-kulirnaya-100-180',
  color: '01-01',
  sizes: { ...defaultItemFields.sizes, M: 60 },
  zones: ['front'],
  zoneTechs: { front: 'screen' },
  zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
};

beforeEach(() => {
  __resetSalesStoreForTests();
  api.saveSalesOrder.mockReset();
  useStore.setState({
    items: [item], name: 'ООО Ромашка', notes: 'позвонить',
    skuCatalog: SKU_CATALOG_DEFAULT, fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  });
});

describe('«Оформить как заказ v4»', () => {
  it('первая запись несёт позиции и снимок цены — список не покажет пустую сумму', async () => {
    api.saveSalesOrder.mockResolvedValue({ id: 'o-1', order_number: 'PH-0042', updated_at: 'now' });
    const r = await transferWizardToSales('Илья');
    expect(r).toEqual({ id: 'o-1', number: 'PH-0042', notes: 'позвонить' });
    const payload = api.saveSalesOrder.mock.calls[0][0];
    expect(payload).toMatchObject({ id: null, customer: 'ООО Ромашка', manager: 'Илья' });
    expect(payload.items).toHaveLength(1);
    expect(payload.price_total).toBeGreaterThan(0);
    expect(useSalesStore.getState().current?.items[0].sku_code).toBe(SKU_CATALOG_DEFAULT[2].code);
  });

  it('сбой создания — null, визард главной не тронут', async () => {
    api.saveSalesOrder.mockResolvedValue(null);
    expect(await transferWizardToSales()).toBeNull();
    expect(useStore.getState().items).toHaveLength(1);
    expect(useStore.getState().name).toBe('ООО Ромашка');
  });
});
