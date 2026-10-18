import { describe, it, expect } from 'vitest';
import { priceItem, DEFAULT_PRICE_RULES } from './priceOrder';
import type { PriceCatalogs } from './priceOrder';
import type * as core from '../../utils/pricingCore';
import { newSalesItem, newSalesPrint } from '../model/factory';
import type { SalesPrint } from '../model/types';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { SkuItem } from '../../types/catalog';

/**
 * Карман DTG по коду зоны (веха 8, К5): `zone_id` нанесения → строка ТЗ зоны
 * справочника (`tzRowOfZone`, «Карман»). По названию (регэксп) — только у строк
 * без кода: переименование зоны цену не меняет.
 */
const P = PRICES as core.PricesExt;
const ZONES = ZONES_CATALOG_DEFAULT.map((z) => ({ id: z.id, name: z.name }));
const CAT: PriceCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
  zonesCatalog: ZONES,
};
const SKU = CAT.skuCatalog[2];

const unitOf = (print: Partial<SalesPrint>, cat: PriceCatalogs = CAT): number => {
  const it = newSalesItem({
    kind: 'sku', sku_code: SKU.code, fabric_code: 'medas-kulirnaya-100-160',
    size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 40 } }] },
    prints: [newSalesPrint({ method: 'dtg', width_mm: 100, height_mm: 100, ...print })],
  });
  return priceItem(it, P, cat, DEFAULT_PRICE_RULES, false).prints[0].unit;
};

describe('priceOrder — карман DTG по zone_id', () => {
  const standard = unitOf({ zone: 'Спина' });
  const pocket = unitOf({ zone: 'Карман' });

  it('надбавка кармана есть (иначе остальные проверки ничего не доказывают)', () => {
    expect(pocket).toBeGreaterThan(standard);
  });

  it('на всех зонах справочника по умолчанию цена с кодом = цене по названию', () => {
    for (const z of ZONES) {
      expect(unitOf({ zone: z.name, zone_id: z.id }), z.id).toBe(unitOf({ zone: z.name }));
    }
  });

  it('зону-карман переименовали, код прежний — карман по-прежнему считается', () => {
    const renamed = { ...CAT, zonesCatalog: ZONES.map((z) => (z.id === 'pocket' ? { ...z, name: 'Нагрудный' } : z)) };
    expect(unitOf({ zone: 'Нагрудный', zone_id: 'pocket' }, renamed)).toBe(pocket);
  });

  it('код есть, а названия в справочнике нет — не по регэкспу имени', () => {
    expect(unitOf({ zone: 'Карман', zone_id: 'front' })).toBe(standard);
    expect(unitOf({ zone: 'Нагрудный', zone_id: 'pocket' }, { ...CAT, zonesCatalog: [] })).toBe(pocket);
  });

  it('своя зона справочника со строкой ТЗ «Карман» — карман', () => {
    const own = { ...CAT, zonesCatalog: [...ZONES, { id: 'chest-pocket', name: 'Нагрудный', tz_row: 'pocket' }] };
    expect(unitOf({ zone: 'Нагрудный', zone_id: 'chest-pocket' }, own)).toBe(pocket);
  });

  it('без кода — по названию, как до вехи 8', () => {
    expect(unitOf({ zone: 'pocket left' })).toBe(pocket);
    expect(unitOf({ zone: 'Спина' })).toBe(standard);
  });
});
