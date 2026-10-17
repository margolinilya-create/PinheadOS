import { describe, it, expect } from 'vitest';
import { priceOrder, type PriceCatalogs } from '../../pricing/priceOrder';
import * as core from '../../../utils/pricingCore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import type { SalesPrint } from '../../model/types';
import { PRICES } from '../../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../../data/extras';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { SkuItem, ZoneDefinition } from '../../../types/catalog';
import { flat } from '../fixtures.testutil';
import type { AssetMeta } from '../types';
import { parseLayout, placementOf } from './layout';
import { defaultAreaId, placeArtwork, type PlaceArtworkCtx } from './placeArtwork';

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const FLAT = flat();
const CTX: PlaceArtworkCtx = {
  flat: FLAT, zonesCatalog: ZONES, category: 'tshirts', view: 'front', itemKind: 'sku', method: 'dtf',
};
const PATH = 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/u-logo.png';
const asset = (w = 120, h = 80): AssetMeta => ({
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: w, intrinsic_h_mm: h, px_w: 1417, px_h: 945, dpi: 300,
  size_estimated: false, has_preview: false,
});

describe('defaultAreaId', () => {
  it('первая зона с zone_id; служебная (этикетка) — только если других нет', () => {
    expect(defaultAreaId(FLAT, 'front')).toBe('chest');
    expect(defaultAreaId(FLAT, 'back')).toBe('back');
    const labelOnly = flat({ views: [{ ...FLAT.views[1], print_areas: [FLAT.views[1].print_areas[1]] }] });
    expect(defaultAreaId(labelOnly, 'back')).toBe('label');
    expect(defaultAreaId(flat({ views: [FLAT.views[0]] }), 'back')).toBeNull();
  });
});

describe('placeArtwork', () => {
  it('новое нанесение: зона из справочника зон, мм, отступ, раскладка v1, файл', () => {
    const res = placeArtwork([], asset(), PATH, 'chest', CTX)!;
    expect(res.prints).toHaveLength(1);
    const p = res.prints[0];
    expect(res.key).toBe(p.key);
    expect(p).toMatchObject({ zone: 'Грудь (перед)', method: 'dtf', width_mm: 120, height_mm: 80, artwork_path: PATH, offset_from: 'neck_seam', on: 'cut' });
    expect(parseLayout(p.layout)).toMatchObject({ v: 1, flat_id: FLAT.id, view: 'front', area_id: 'chest' });
  });

  it('существующие нанесения не меняются, новое — в конец (порядок = номер в ТЗ)', () => {
    const other = newSalesPrint({ zone: 'Спина' });
    const res = placeArtwork([other], asset(), PATH, 'chest', CTX)!;
    expect(res.prints[0]).toBe(other);
    expect(res.prints).toHaveLength(2);
  });

  it('зоны нет на виде — null', () => {
    expect(placeArtwork([], asset(), PATH, 'nope', CTX)).toBeNull();
    expect(placeArtwork([], asset(), PATH, 'back', CTX)).toBeNull();
  });

  it('точка сброса (перетаскивание на холст): центр в точке, внутри зоны', () => {
    const res = placeArtwork([], asset(100, 50), PATH, 'chest', CTX, { at: { x_mm: 250, y_mm: 300 } })!;
    const pl = placementOf(res.prints[0], FLAT)!;
    expect(pl.x_mm + pl.width_mm / 2).toBeCloseTo(250, 0);
    expect(pl.y_mm + pl.height_mm / 2).toBeCloseTo(300, 0);
    const edge = placementOf(placeArtwork([], asset(100, 50), PATH, 'chest', CTX, { at: { x_mm: 0, y_mm: 9999 } })!.prints[0], FLAT)!;
    expect(edge.x_mm).toBeCloseTo(150, 0);
    expect(edge.y_mm + edge.height_mm).toBeCloseTo(540, 0);
  });

  describe('без задвоения: неразмещённая строка той же зоны получает раскладку', () => {
    const rowOf = (patch: Partial<SalesPrint> = {}) => newSalesPrint({
      zone: 'Грудь (перед)', method: 'silkscreen', colors: 2, pantone: ['186 C'], comment: 'как в прошлый раз', ...patch,
    });

    it('строка дописана, новое нанесение не создано; техника и поля строки — её', () => {
      const row = rowOf();
      const res = placeArtwork([row], asset(), PATH, 'chest', CTX)!;
      expect(res.prints).toHaveLength(1);
      expect(res.key).toBe(row.key);
      expect(res.prints[0]).toMatchObject({
        key: row.key, method: 'silkscreen', colors: 2, pantone: ['186 C'], comment: 'как в прошлый раз',
        width_mm: 120, height_mm: 80, artwork_path: PATH, offset_from: 'neck_seam',
      });
      expect(parseLayout(res.prints[0].layout)?.area_id).toBe('chest');
    });

    it('строка другой зоны или уже размещённая — не трогается', () => {
      const back = rowOf({ zone: 'Спина' });
      const placed = placeArtwork([], asset(), 'orders/x/logo/a.png', 'chest', CTX)!.prints[0];
      const res = placeArtwork([back, placed], asset(), PATH, 'chest', CTX)!;
      expect(res.prints).toHaveLength(3);
      expect(res.prints[0]).toBe(back);
      expect(res.prints[1]).toBe(placed);
    });

    it('при нескольких строках зоны — сначала без файла или с тем же файлом', () => {
      const withFile = rowOf({ artwork_path: 'orders/x/logo/other.png' });
      const empty = rowOf();
      const res = placeArtwork([withFile, empty], asset(), PATH, 'chest', CTX)!;
      expect(res.key).toBe(empty.key);
      expect(res.prints[0]).toBe(withFile);
    });

    it('цена та же, что у одного нанесения в зоне (а не двух)', () => {
      const P = PRICES as core.PricesExt;
      const CAT: PriceCatalogs = {
        skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[], fabricsCatalog: FABRICS_CATALOG_DEFAULT,
        trimCatalog: TRIM_CATALOG_DEFAULT, extrasCatalog: EXTRAS_CATALOG_DEFAULT, usdRate: 92,
      };
      const total = (prints: SalesPrint[]) => priceOrder(newSalesOrder({ items: [newSalesItem({
        kind: 'sku', sku_code: CAT.skuCatalog[2].code, fabric_code: 'medas-kulirnaya-100-160',
        size_grid: { sizes: ['S', 'M'], rows: [{ color: 'Чёрный', sizes: { S: 20, M: 20 } }] }, prints,
      })] }), P, CAT).total;
      const row = rowOf({ method: 'dtf' });
      const reused = placeArtwork([row], asset(), PATH, 'chest', CTX)!.prints;
      const single = placeArtwork([], asset(), PATH, 'chest', CTX)!.prints;
      expect(total(reused)).toBe(total(single));
      expect(total(reused)).toBeLessThan(total([row, ...single]));
    });
  });
});
