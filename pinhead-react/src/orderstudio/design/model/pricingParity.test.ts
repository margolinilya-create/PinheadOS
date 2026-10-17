/**
 * Review Focus 1 плана вехи 5а: «цена не расходится с холстом». Нанесение,
 * поставленное на холст (`newPlacedPrint` → `applyPlacement`), и то же
 * нанесение, введённое строкой (`PrintRow`), дают одну цену `priceOrder`.
 *
 * Ловушка — зона: DTG в кармане дороже (× 1,2 по НАЗВАНИЮ зоны, `priceOrder`),
 * а у зоны флэта своё имя («Кенгуру»). Холст обязан писать имя зоны из
 * справочника зон по `zone_id` («Карман»). Мутация: `zone: area.name` в
 * `applyPlacement` — тест «DTG в кармане» краснеет.
 */
import { describe, it, expect } from 'vitest';
import { priceOrder, type PriceCatalogs } from '../../pricing/priceOrder';
import * as core from '../../../utils/pricingCore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import type { SalesPrint, SalesPrintMethod } from '../../model/types';
import { PRICES } from '../../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../../data/extras';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { SkuItem, ZoneDefinition } from '../../../types/catalog';
import { newPlacedPrint } from './layout';
import { area, flat, frontView } from '../fixtures.testutil';
import type { AssetMeta } from '../types';

const P = PRICES as core.PricesExt;
const CAT: PriceCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
};
const SKU = CAT.skuCatalog[2];
const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];

const FLAT = flat({
  views: [frontView({
    svg_path: 'flats/tshirt-test/v1/front.svg',
    print_areas: [
      area(),
      area({ id: 'kangaroo', name: 'Кенгуру', zone_id: 'pocket', polygon_mm: [[180, 380], [420, 380], [420, 540], [180, 540]], safe_inset_mm: 10 }),
    ],
  })],
});

const asset = (w: number, h: number): AssetMeta => ({
  type: 'svg', source_file: 'logo.svg', intrinsic_w_mm: w, intrinsic_h_mm: h, size_estimated: false, has_preview: false,
});

function placed(method: SalesPrintMethod, areaId: string, w: number, h: number): SalesPrint {
  const p = newPlacedPrint(asset(w, h), 'orders/o/logo.svg', areaId, {
    flat: FLAT, zonesCatalog: ZONES, category: 'tshirts', view: 'front', itemKind: 'sku', method,
  });
  if (!p) throw new Error('зона не найдена');
  return p;
}

function total(print: SalesPrint): number {
  const item = newSalesItem({
    kind: 'sku',
    sku_code: SKU.code,
    fabric_code: 'medas-kulirnaya-100-160',
    size_grid: { sizes: ['S', 'M', 'L'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 20, L: 10 } }] },
    prints: [print],
  });
  return priceOrder(newSalesOrder({ items: [item] }), P, CAT).total;
}

/** Та же строка, что менеджер ввёл бы на вкладке «Изделие» */
function row(from: SalesPrint, zone: string): SalesPrint {
  return newSalesPrint({ method: from.method, zone, width_mm: from.width_mm, height_mm: from.height_mm, on: from.on });
}

describe('паритет цены: холст = строка', () => {
  it('DTG в кармане: зона «Карман» по zone_id, × 1,2 к груди', () => {
    const canvas = placed('dtg', 'kangaroo', 100, 80);
    expect(canvas.zone).toBe('Карман');
    expect(total(canvas)).toBe(total(row(canvas, 'Карман')));
    expect(total(canvas)).toBeGreaterThan(total(row(canvas, 'Грудь (перед)')));
  });

  it('DTF 120×80 на груди', () => {
    const canvas = placed('dtf', 'chest', 120, 80);
    expect([canvas.width_mm, canvas.height_mm]).toEqual([120, 80]);
    expect(total(canvas)).toBe(total(row(canvas, 'Грудь (перед)')));
  });

  it('шелкография A4 на груди', () => {
    const canvas = placed('silkscreen', 'chest', 210, 297);
    expect([canvas.width_mm, canvas.height_mm]).toEqual([210, 297]);
    expect(total(canvas)).toBe(total(row(canvas, 'Грудь (перед)')));
  });

  it('нанесение с холста посчитано (цена больше, чем без нанесения)', () => {
    const bare = priceOrder(newSalesOrder({ items: [newSalesItem({
      kind: 'sku', sku_code: SKU.code, fabric_code: 'medas-kulirnaya-100-160',
      size_grid: { sizes: ['S', 'M', 'L'], rows: [{ color: 'Чёрный', sizes: { S: 10, M: 20, L: 10 } }] },
    })] }), P, CAT).total;
    expect(total(placed('dtf', 'chest', 120, 80))).toBeGreaterThan(bare);
  });
});
