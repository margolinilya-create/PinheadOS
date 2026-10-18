import { describe, it, expect } from 'vitest';
import { priceOrder } from './priceOrder';
import type { PriceCatalogs } from './priceOrder';
import * as core from '../../utils/pricingCore';
import { DTG_SIZES } from '../../utils/printRules';
import { garmentPatch, salesItemToWizard } from '../wizard/wizardAdapter';
import { SUPPLIERS_SEED } from '../catalog/seeds';
import type { GarmentSnap } from '../wizard/wizardAdapter';
import { newSalesItem, newSalesLabel, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesItem, SalesLabel, SalesOrder, SalesPrint } from '../model/types';
import { defaultItemFields } from '../../store/slices/helpers';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { Fabric, SkuItem, ZoneDefinition } from '../../types/catalog';

/**
 * Сверка цены рабочего места (веха 3) с формулой визарда — по тем путям,
 * которыми позиция живёт теперь:
 *  - «одежда» пишется из буфера визарда в позицию `garmentPatch` — сверка
 *    буфер → `garmentPatch` → `priceOrder` против `calcTotalBreakdown` буфера;
 *  - нанесения правятся строками v4 (`PrintRow`) и читаются визардом через
 *    `salesItemToWizard` — сверка позиция → `salesItemToWizard` → визард.
 * Прежняя сверка шла через перенос «Оформить как заказ v4»
 * (`wizardOrderToSales`), убранный вместе с визардом v3.
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
const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const WIZ_CAT = {
  skuCatalog: PRICE_CAT.skuCatalog,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES,
  suppliers: SUPPLIERS_SEED,
};
const SKU = PRICE_CAT.skuCatalog[2];
const FABRIC = 'medas-kulirnaya-100-160';
const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;

type Over = Record<string, unknown>;

/** Буфер визарда — поля «Изделия» одной позиции: 10 S + 20 M + 10 L */
const GARMENT: GarmentSnap = {
  sku: SKU, fabric: FABRIC, color: '01-01', colorSupplier: '',
  sizes: { ...defaultItemFields.sizes, S: 10, M: 20, L: 10 },
  customSizes: [], extras: [], fit: 'regular', clientFabric: false,
};
const EMPTY_BUFFER: GarmentSnap = {
  sku: null, fabric: '', color: '', colorSupplier: '',
  sizes: { ...defaultItemFields.sizes }, customSizes: [], extras: [], fit: '', clientFabric: false,
};

/** Позиция рабочего места после правки «Изделия» в буфере */
function itemFromBuffer(): SalesItem {
  const item = garmentPatch(EMPTY_BUFFER, GARMENT, newSalesItem({ kind: 'sku' }), WIZ_CAT);
  if (!item) throw new Error('garmentPatch ничего не записал');
  return item;
}

/** Состояние визарда для формулы: умолчания + поля позиции, прочитанные визардом */
function wizardState(item: SalesItem, over: Over = {}) {
  return {
    ...JSON.parse(JSON.stringify(defaultItemFields)),
    type: 'tee',
    customSizes: [], zones: [], zoneTechs: {}, labelConfig: null,
    ...salesItemToWizard(item, WIZ_CAT),
    ...over,
  };
}

function compare(opts: { prints?: SalesPrint[]; labels?: SalesLabel[]; wizard?: Over; order?: Partial<SalesOrder> } = {}) {
  const item = { ...itemFromBuffer(), prints: opts.prints ?? [], labels: opts.labels ?? [] };
  const wizard = core.calcTotalBreakdown(P, { ...PRICE_CAT, ...wizardState(item, opts.wizard) }).unitPrice;
  const v4 = priceOrder(newSalesOrder({ ...opts.order, items: [item] }), P, PRICE_CAT).items[0];
  return { wizard, v4: v4.calc_unit };
}

const close = ({ wizard, v4 }: { wizard: number; v4: number }) => {
  expect(v4).toBeGreaterThanOrEqual(wizard);
  expect(v4 - wizard).toBeLessThanOrEqual(5);
};

const dtgMm = (key: string) => {
  const s = DTG_SIZES.find((d) => d.key === key)!;
  return { width_mm: s.w, height_mm: s.h };
};
const sheetMm = (fmt: string) => (fmt === 'Max' ? { width_mm: 400, height_mm: 500 }
  : { width_mm: core.FMT_SIZES[fmt].w, height_mm: core.FMT_SIZES[fmt].h });

describe('цена рабочего места = цена визарда', () => {
  it('буфер → garmentPatch: модель, ткань, цвет, размеры', () => {
    const item = itemFromBuffer();
    expect(item.sku_code).toBe(SKU.code);
    expect(item.fabric_code).toBe(FABRIC);
    expect(item.size_grid.rows).toHaveLength(1);
    close(compare());
  });

  it('нанесение видят обе формулы: сверка не пустая', () => {
    const base = compare();
    const withPrint = compare({
      prints: [newSalesPrint({ method: 'dtg', zone: zoneName('back'), textile: 'white', ...dtgMm('A4') })],
    });
    expect(withPrint.wizard).toBeGreaterThan(base.wizard);
    expect(withPrint.v4).toBeGreaterThan(base.v4);
  });

  it.each(['A6', 'A5', 'A4', 'A3', '40x45'])('DTG %s', (key) => close(compare({
    prints: [newSalesPrint({ method: 'dtg', zone: zoneName('back'), textile: 'white', ...dtgMm(key) })],
  })));

  it.each(['A4', 'A3', 'A3+', 'Max'])('шелкография %s', (fmt) => close(compare({
    prints: [newSalesPrint({ method: 'silkscreen', zone: zoneName('back'), colors: 2, textile: 'white', ...sheetMm(fmt) })],
  })));

  it.each(['cut', 'finished'] as const)('вышивка «%s» с обеими надбавками', (on) => close(compare({
    prints: [newSalesPrint({
      method: 'embroidery', zone: zoneName('front'), width_mm: 80, height_mm: 60, fill: 1, special: 'metallic+puff', on,
    })],
  })));

  // Бирок визарда v3 больше нет (веха 8, задача 4: UI убран в вехе 3, мёртвый расчёт
  // `labelConfig` удалён). Сверка — с прежними ставками визарда напрямую: бирки v4
  // идут сверху цены изделия ровно на их сумму.
  it('бирки: составник с логотипом, своя основная на канве, хэнгтег — по ставкам визарда', () => {
    const { wizard, v4 } = compare({
      labels: [
        newSalesLabel({ label_type: 'composition', variant_id: 'my-logo' }),
        newSalesLabel({ label_type: 'brand', variant_id: 'custom:canvas', place: 'Горловина' }),
        newSalesLabel({ label_type: 'hangtag', variant_id: 'custom' }),
      ],
    });
    const labels = core.careLabelPrice('my-logo') + core.mainLabelPrice('custom', 'canvas') + core.hangTagPrice('custom');
    expect(labels).toBe(110);
    close({ wizard: wizard + labels, v4 });
  });

  it.each(['bopp', 'zip'])('упаковка %s', (packType) => close(compare({
    order: { packaging: packType },
    wizard: { packType },
  })));
});
