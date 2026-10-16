import { describe, it, expect } from 'vitest';
import { priceOrder } from './priceOrder';
import type { PriceCatalogs } from './priceOrder';
import * as core from '../../utils/pricingCore';
import { wizardOrderToSalesOrder } from '../wizard/wizardOrderToSales';
import { newSalesOrder } from '../model/factory';
import { defaultItemFields } from '../../store/slices/helpers';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { Fabric, SkuItem, ZoneDefinition } from '../../types/catalog';

/**
 * СКВОЗНАЯ сверка цены: заказ визарда → «Оформить как заказ v4»
 * (`wizardOrderToSalesOrder`) → `priceOrder`. Прежняя сверка строила позицию
 * v4 руками, мимо переноса, и не видела, что DTG дорожал на ступень, Max
 * дешевел на 39 %, а бирки и упаковка выпадали из цены (обход 16.10).
 *
 * Допуск — округление: v4 берёт цену за штуку вверх до 5 ₽, визард до рубля.
 */
const P = PRICES as core.PricesExt;
const PRICE_CAT: PriceCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
};
const WIZ_CAT = {
  skuCatalog: PRICE_CAT.skuCatalog,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[],
};
const SKU = PRICE_CAT.skuCatalog[2];
const FABRIC = 'medas-kulirnaya-100-160';

type Over = Record<string, unknown>;

/** Одна позиция визарда: 10 S + 20 M + 10 L */
const snap = (over: Over = {}) => ({
  ...JSON.parse(JSON.stringify(defaultItemFields)),
  sku: SKU, type: 'tee', fabric: FABRIC, fit: 'regular', color: '01-01',
  sizes: { ...defaultItemFields.sizes, S: 10, M: 20, L: 10 },
  customSizes: [], zones: [], zoneTechs: {}, labelConfig: null,
  ...over,
});

function compare(item: Over, order: Over = {}) {
  const s = snap(item);
  const wizard = core.calcTotalBreakdown(P, { ...PRICE_CAT, ...order, ...s }).unitPrice;
  const { order: seed } = wizardOrderToSalesOrder({ items: [s], ...order }, WIZ_CAT);
  const v4 = priceOrder(newSalesOrder(seed), P, PRICE_CAT).items[0];
  return { wizard, v4: v4.calc_unit };
}

const close = ({ wizard, v4 }: { wizard: number; v4: number }) => {
  expect(v4).toBeGreaterThanOrEqual(wizard);
  expect(v4 - wizard).toBeLessThanOrEqual(5);
};

describe('цена визарда = цена v4 после переноса', () => {
  it('без нанесений', () => close(compare({})));

  it.each(['A6', 'A5', 'A4', 'A3', 'A3+'])('DTG %s', (size) => close(compare({
    zones: ['back'], zoneTechs: { back: 'dtg' }, dtgZones: { back: { size, textile: 'white' } },
  })));

  it.each(['A4', 'A3', 'A3+', 'Max'])('шелкография %s', (size) => close(compare({
    zones: ['back'], zoneTechs: { back: 'screen' },
    zonePrints: { back: { colors: 2, size, textile: 'white', fx: 'none' } },
  })));

  it.each(['cut', 'garment'])('вышивка «%s» с обеими надбавками', (mode) => close(compare({
    zones: ['front'], zoneTechs: { front: 'embroidery' },
    embZones: { front: { width_mm: 80, height_mm: 60, fill: 1, extra: 'metallic', extras: ['puff'], mode } },
  })));

  it('бирки: составник с логотипом, своя основная на канве, хэнгтег', () => close(compare({
    labelConfig: {
      careLabel: { enabled: true, logoOption: 'my-logo', composition: '', country: '', uploadData: null, comments: '' },
      mainLabel: { option: 'custom', placement: 'neck', material: 'canvas', color: 'white', uploadData: null, comments: '' },
      hangTag: { option: 'custom', uploadData: null, comments: '' },
    },
  })));

  it.each(['bopp', 'zip'])('упаковка %s', (packType) => close(compare({}, { packType })));
});
