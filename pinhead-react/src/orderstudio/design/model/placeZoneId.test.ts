import { describe, it, expect } from 'vitest';
import { newSalesPrint } from '../../model/factory';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import type { AssetMeta } from '../types';
import { area, flat, frontView } from '../fixtures.testutil';
import { applyPlacement, placementOf, type PlaceCtx } from './layout';
import { placeArtwork, type PlaceArtworkCtx } from './placeArtwork';

/**
 * Веха 8 (К5): холст пишет код зоны `zone_id` вместе с названием `zone` —
 * цена кармана и строка ТЗ читают код. Служебная зона флэта (без связи
 * со справочником) — `zone_id` null.
 */
const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const FLAT = flat();
const CTX: PlaceCtx = { flat: FLAT, zonesCatalog: ZONES, category: 'tshirts' };
const ASSET: AssetMeta = {
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 50,
  px_w: 1181, px_h: 591, dpi: 300, size_estimated: false, has_preview: false,
};
const PATH = 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/u-logo.png';

describe('холст пишет zone_id', () => {
  it('новое нанесение: код зоны справочника вместе с названием', () => {
    const res = placeArtwork([], ASSET, PATH, 'chest', { ...CTX, view: 'front', itemKind: 'sku', method: 'dtf' } as PlaceArtworkCtx)!;
    expect(res.prints[0]).toMatchObject({ zone: 'Грудь (перед)', zone_id: 'front' });
  });

  it('свободная строка той же зоны получает код при размещении', () => {
    const row = newSalesPrint({ zone: 'Грудь (перед)', method: 'silkscreen' });
    const res = placeArtwork([row], ASSET, PATH, 'chest', { ...CTX, view: 'front', itemKind: 'sku', method: 'dtf' } as PlaceArtworkCtx)!;
    expect(res.key).toBe(row.key);
    expect(res.prints[0]).toMatchObject({ zone: 'Грудь (перед)', zone_id: 'front', method: 'silkscreen' });
  });

  it('перенос в зону другой связи меняет код; служебная зона — null', () => {
    const placed = placeArtwork([], ASSET, PATH, 'chest', { ...CTX, view: 'front', itemKind: 'sku', method: 'dtf' } as PlaceArtworkCtx)!.prints[0];
    const pl = placementOf(placed, FLAT)!;
    const label = applyPlacement(placed, { ...pl, view: 'back', area_id: 'label', x_mm: 280, y_mm: 55, width_mm: 40, height_mm: 20 }, CTX);
    expect(label).toMatchObject({ zone: 'Этикетка', zone_id: null });
    const back = applyPlacement(placed, { ...pl, view: 'back', area_id: 'back', x_mm: 250, y_mm: 200 }, CTX);
    expect(back).toMatchObject({ zone: 'Спина', zone_id: 'back' });
  });

  it('код зоны флэта не по формату справочника — null', () => {
    const odd = flat({ views: [frontView({ print_areas: [area({ zone_id: 'Bad Zone' })] })] });
    const p = placeArtwork([], ASSET, PATH, 'chest', { ...CTX, flat: odd, view: 'front', itemKind: 'sku', method: 'dtf' } as PlaceArtworkCtx);
    expect(p?.prints[0].zone_id ?? null).toBeNull();
  });
});
