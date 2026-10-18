import { describe, it, expect } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import { flat } from '../fixtures.testutil';
import type { AssetMeta } from '../types';
import { orderArtworks } from './orderArtworks';
import { placeArtwork } from './placeArtwork';

const CTX = {
  flat: flat(), zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[], category: 'tshirts',
  view: 'front' as const, itemKind: 'sku' as const, method: 'dtf' as const,
};
const asset = (name: string): AssetMeta => ({
  type: 'svg', source_file: name, intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false,
});
const placed = (path: string, name: string) => placeArtwork([], asset(name), path, 'chest', CTX)!.prints[0];

describe('orderArtworks — «Логотипы заказа»', () => {
  it('файлы с раскладкой из всех позиций, без повторов, по порядку', () => {
    const a = placed('orders/o/logo/a.svg', 'a.svg');
    const b = placed('orders/o/logo/b.svg', 'b.svg');
    const again = placed('orders/o/logo/a.svg', 'a-copy.svg');
    const order = newSalesOrder({ items: [
      newSalesItem({ prints: [a, newSalesPrint({ artwork_path: 'orders/o/logo/row.png' })] }),
      newSalesItem({ prints: [again, b] }),
    ] });
    expect(orderArtworks(order)).toEqual([
      { path: 'orders/o/logo/a.svg', asset: asset('a.svg') },
      { path: 'orders/o/logo/b.svg', asset: asset('b.svg') },
    ]);
  });

  it('строка без раскладки и битая раскладка — не логотип холста', () => {
    const broken = { ...placed('orders/o/logo/c.svg', 'c.svg'), layout: { v: 1, x_mm: 'evil' } };
    expect(orderArtworks(newSalesOrder({ items: [newSalesItem({ prints: [broken] })] }))).toEqual([]);
    expect(orderArtworks(null)).toEqual([]);
  });
});
