import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../../store/useStore';
import { runAppResets } from '../../store/appReset';
import { bindBuffer, loadItemIntoBuffer, canLoadIntoBuffer } from './itemBuffer';
import { newSalesItem, newSalesPrint } from '../model/factory';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { WizardCatalogs } from '../wizard/wizardAdapter';
import type { SkuItem, Fabric, ZoneDefinition } from '../../types/catalog';
import type { SalesItem } from '../model/types';

const CAT: WizardCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[],
};
const SKU = CAT.skuCatalog[2];

const item = (over: Partial<SalesItem> = {}): SalesItem => newSalesItem({
  sku_code: SKU.code, product_type: SKU.name, fit: SKU.fit || 'regular',
  fabric_code: 'cotton-kulirnaya-100-180', main_fabric: 'Кулирка, ручной текст', color_supplier: 'Белый / ТД Коттон',
  size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10, M: 5 } }] },
  prints: [newSalesPrint({ method: 'silkscreen', zone: 'Грудь' })],
  ...over,
});

const store = () => useStore.getState();

beforeEach(() => {
  store().resetItemFields();
  useStore.setState({ colorSupplier: 'medastex', skuFilter: 'all' });
});

describe('загрузка позиции в буфер', () => {
  it('кладёт модель, ткань, цвет и размеры; палитра — по ткани Коттонпром', () => {
    loadItemIntoBuffer(item(), CAT);
    const s = store();
    expect((s.sku as SkuItem | null)?.code).toBe(SKU.code);
    expect(s.fabric).toBe('cotton-kulirnaya-100-180');
    expect(s.color).toBe('01-01');
    expect((s.sizes as Record<string, number>).S).toBe(10);
    expect(s.colorSupplier).toBe('cottonprom');
  });

  it('фильтр моделей не сбрасывается', () => {
    useStore.setState({ skuFilter: 'hoodies' });
    loadItemIntoBuffer(item(), CAT);
    expect(store().skuFilter).toBe('hoodies');
  });

  it('позиция с несколькими цветами в буфер не грузится — буфер пуст', () => {
    loadItemIntoBuffer(item(), CAT);
    const multi = item({ size_grid: { sizes: ['S'], rows: [{ color: 'A', sizes: { S: 1 } }, { color: 'B', sizes: { S: 1 } }] } });
    expect(canLoadIntoBuffer(multi)).toBe(false);
    loadItemIntoBuffer(multi, CAT);
    expect(store().sku).toBeNull();
    expect(store().fabric).toBe('');
  });
});

describe('связка буфера с позицией', () => {
  it('загрузка, привязка и загрузка каталогов ничего не пишут', () => {
    const a = item();
    loadItemIntoBuffer(a, CAT);
    const onItem = vi.fn();
    const off = bindBuffer(() => a, CAT, onItem);
    // Перезагрузка каталогов приносит НОВЫЕ массивы — как loadCatalogs
    useStore.setState({ skuCatalog: [...SKU_CATALOG_DEFAULT], fabricsCatalog: [...FABRICS_CATALOG_DEFAULT] });
    expect(onItem).not.toHaveBeenCalled();
    off();
  });

  it('смена цвета — ровно одна запись', () => {
    const a = item();
    loadItemIntoBuffer(a, CAT);
    const onItem = vi.fn();
    const off = bindBuffer(() => a, CAT, onItem);
    store().selectColor('15-01');
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(onItem.mock.calls[0][0].size_grid.rows[0].color).toBe('Светло-фиолетовый (15-01)');
    expect(onItem.mock.calls[0][0].prints).toBe(a.prints);
    off();
  });

  it('после отписки и загрузки B правка не попадает в A', () => {
    const a = item();
    const b = item({ size_grid: { sizes: ['L'], rows: [{ color: 'Чёрный', sizes: { L: 3 } }] } });
    loadItemIntoBuffer(a, CAT);
    const onA = vi.fn();
    const offA = bindBuffer(() => a, CAT, onA);
    offA();
    loadItemIntoBuffer(b, CAT);
    const onB = vi.fn();
    const offB = bindBuffer(() => b, CAT, onB);
    store().setSize('L', 7);
    expect(onA).not.toHaveBeenCalled();
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onB.mock.calls[0][0].key).toBe(b.key);
    expect(onB.mock.calls[0][0].size_grid.rows).toEqual([{ color: 'Чёрный', sizes: { L: 7 } }]);
    offB();
  });

  it('правка зон нанесения в буфере позицию не пишет', () => {
    const a = item();
    loadItemIntoBuffer(a, CAT);
    const onItem = vi.fn();
    const off = bindBuffer(() => a, CAT, onItem);
    useStore.setState({ zones: ['back'] });
    expect(onItem).not.toHaveBeenCalled();
    off();
  });

  it('позиция пропала — ничего не пишет', () => {
    loadItemIntoBuffer(item(), CAT);
    const onItem = vi.fn();
    const off = bindBuffer(() => undefined, CAT, onItem);
    store().setSize('S', 99);
    expect(onItem).not.toHaveBeenCalled();
    off();
  });

  it('пишет от свежей позиции: вторая правка накладывается на результат первой', () => {
    let current = item();
    loadItemIntoBuffer(current, CAT);
    const off = bindBuffer(() => current, CAT, (next) => { current = next; });
    store().setSize('S', 11);
    store().selectColor('15-01');
    expect(current.size_grid.rows).toEqual([{ color: 'Светло-фиолетовый (15-01)', sizes: { S: 11, M: 5 } }]);
    off();
  });
});

describe('сброс буфера при выходе', () => {
  it('runAppResets очищает поля позиции, каталоги и фильтр не трогает', () => {
    useStore.setState({ skuFilter: 'hoodies' });
    loadItemIntoBuffer(item(), CAT);
    const catalog = store().skuCatalog;
    runAppResets();
    expect(store().sku).toBeNull();
    expect(store().fabric).toBe('');
    expect(store().skuCatalog).toBe(catalog);
    expect(store().skuFilter).toBe('hoodies');
  });
});
