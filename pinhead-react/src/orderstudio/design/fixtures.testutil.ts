/**
 * Общие заготовки тестов дизайна: вид переда футболки (эталон DM
 * `tshirt-classic`, горловина 92, ось 300, грудь 150..450 × 140..540) и флэт.
 */
import type { FlatView, GarmentFlat, GarmentFlatsCatalog, PrintArea } from './types';

export const NECKLINE_Y = 92;
export const CENTER_X = 300;

export function area(patch: Partial<PrintArea> = {}): PrintArea {
  return {
    id: 'chest',
    name: 'Грудь',
    zone_id: 'front',
    polygon_mm: [[150, 140], [450, 140], [450, 540], [150, 540]],
    safe_inset_mm: 15,
    ...patch,
  };
}

export function frontView(patch: Partial<FlatView> = {}): FlatView {
  return {
    kind: 'front',
    svg_path: 'flats/tshirt-test/v1/front.svg',
    scale_mm_per_unit: 1,
    anchors: { neckline_point: { x: CENTER_X, y: NECKLINE_Y }, center_axis_x: CENTER_X },
    print_areas: [area()],
    ...patch,
  };
}

export function backView(patch: Partial<FlatView> = {}): FlatView {
  return frontView({
    kind: 'back',
    svg_path: 'flats/tshirt-test/v1/back.svg',
    anchors: { neckline_point: { x: CENTER_X, y: 40 }, center_axis_x: CENTER_X },
    print_areas: [
      area({ id: 'back', name: 'Спина', zone_id: 'back', polygon_mm: [[150, 100], [450, 100], [450, 500], [150, 500]] }),
      area({ id: 'label', name: 'Этикетка', zone_id: null, polygon_mm: [[260, 48], [340, 48], [340, 80], [260, 80]], safe_inset_mm: 5 }),
    ],
    ...patch,
  });
}

export function flat(patch: Partial<GarmentFlat> = {}): GarmentFlat {
  const id = patch.id ?? 'tshirt-test';
  const version = patch.version ?? 1;
  return {
    id,
    name: 'Футболка (тест)',
    garment_type: 'tshirt',
    typical: true,
    active: true,
    version,
    sku_codes: [],
    categories: ['tshirts'],
    fits: ['regular'],
    base_size: 'M',
    sizes: ['M'],
    views: [
      frontView({ svg_path: `flats/${id}/v${version}/front.svg` }),
      backView({ svg_path: `flats/${id}/v${version}/back.svg` }),
    ],
    ...patch,
  };
}

export function catalog(flats: GarmentFlat[] = [flat()]): GarmentFlatsCatalog {
  return { version: 1, flats };
}

/** Глубокая копия JSON-значения (для порчи образца в тестах) */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
