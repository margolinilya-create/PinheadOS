// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { convertSku, fitsOf, seedFileName, zoneIdOf } from '../../../../scripts/flats-seed-convert.mjs';

/**
 * Разовый конвертер сида DM (`scripts/flats-seed-convert.mjs`): правила,
 * которых нет в самом сиде, — отказ на незнакомой зоне (иначе новая зона DM
 * молча ушла бы в справочник без `zone_id`). Результат целиком сторожит
 * `garmentFlatsSeed.test.ts`.
 */
const dmSku = (patch: Record<string, unknown> = {}) => ({
  id: 'tshirt-regular',
  name: 'Футболка Regular',
  type: 'tshirt',
  product_kind: 'finished',
  base_size: 'M',
  sizes: ['M'],
  views: [{
    id: 'tshirt-regular-front',
    kind: 'front',
    flat_svg: '/seed/flats/tshirt-regular-front.svg',
    scale_mm_per_unit: 1,
    anchors: { neckline_point: { x: 400, y: 120 }, center_axis_x: 400 },
    print_areas: [{ id: 'front', name: 'Перёд', polygon_mm: [[300, 200], [500, 200], [500, 500], [300, 500]], safe_inset_mm: 20 }],
  }],
  ...patch,
});

describe('конвертер сида флэтов', () => {
  it('SKU DM → флэт нашей формы', () => {
    const f = convertSku(dmSku());
    expect(f).toMatchObject({
      id: 'tshirt-regular', typical: true, active: true, version: 1, sku_codes: [],
      categories: ['tshirts'], fits: ['regular'], garment_type: 'tshirt',
    });
    expect(f.views[0]).toMatchObject({ kind: 'front', svg_path: 'flats/tshirt-regular/v1/front.svg' });
    expect(f.views[0].print_areas[0]).toMatchObject({ id: 'front', name: 'Грудь (перед)', zone_id: 'front' });
    expect(f.views[0]).not.toHaveProperty('id');
    expect(f.views[0]).not.toHaveProperty('flat_svg');
  });

  it('незнакомая зона или тип DM — отказ, а не зона без связи', () => {
    expect(() => zoneIdOf('tshirt', 'front', 'pocket')).toThrow(/pocket/);
    expect(() => zoneIdOf('tshirt', 'back', 'chest')).toThrow();
    expect(() => convertSku(dmSku({ type: 'cap' }))).toThrow(/cap/);
  });

  it('зоны: шоппер — сторона A, штаны — штанины перед/зад, этикетка — служебная', () => {
    expect(zoneIdOf('shopper', 'front', 'front')).toBe('side-a');
    expect(zoneIdOf('pants', 'front', 'front')).toBe('pants-front');
    expect(zoneIdOf('pants', 'back', 'back')).toBe('pants-back');
    expect(zoneIdOf('tshirt', 'front', 'chest')).toBe('front');
    expect(zoneIdOf('tshirt', 'back', 'label')).toBeNull();
  });

  it('посадка из слов id; кроп и реглан посадкой не считаются', () => {
    expect(fitsOf('tshirt-freefit')).toEqual(['free']);
    expect(fitsOf('tshirt-oversizecrop')).toEqual([]);
    expect(fitsOf('longsleeve-classic-w')).toEqual(['classic']);
    expect(fitsOf('hoodie-reglan')).toEqual([]);
  });

  it('у аксессуара посадки нет, даже если она в id', () => {
    const bag = convertSku(dmSku({
      id: 'shopper-classic', type: 'shopper',
      views: [{ ...dmSku().views[0], anchors: { center_axis_x: 175 } }],
    }));
    expect(bag.fits).toEqual([]);
    expect(bag.categories).toEqual(['accessories']);
    expect(bag.views[0].print_areas[0].zone_id).toBe('side-a');
  });

  it('имя файла сида — id флэта и вид', () => {
    expect(seedFileName('tshirt-freefit', 'front')).toBe('tshirt-freefit-front.svg');
  });
});
