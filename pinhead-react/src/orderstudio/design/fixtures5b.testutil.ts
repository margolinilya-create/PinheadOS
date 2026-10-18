/**
 * Заготовки тестов вехи 5б, задача 5: рукава и флэт с историей версий.
 *
 * - `sleeveView` — рукав: низ рукава 500, ось 150, зона 80..220 × 200..480;
 * - `versionedFlat` — флэт v2 с историей v1: на v1 у переда есть карман,
 *   на v2 его нет, грудь сдвинута, горловина ниже; метаданные зоны груди
 *   на v2 другие (строка ТЗ «Полочка Л», только DTF) — их видит и v1.
 */
import type { FlatView, FlatViewKind, GarmentFlat } from './types';
import { area, backView, flat, frontView } from './fixtures.testutil';

export const SLEEVE_BOTTOM_Y = 500;
export const SLEEVE_CENTER_X = 150;

export function sleeveView(kind: Extract<FlatViewKind, 'sleeve_left' | 'sleeve_right'>, svgPath: string, patch: Partial<FlatView> = {}): FlatView {
  const left = kind === 'sleeve_left';
  return {
    kind,
    svg_path: svgPath,
    scale_mm_per_unit: 1,
    anchors: { sleeve_bottom_y: SLEEVE_BOTTOM_Y, sleeve_center_x: SLEEVE_CENTER_X },
    print_areas: [area({
      id: left ? 'sleeve-l' : 'sleeve-r',
      name: left ? 'Левый рукав' : 'Правый рукав',
      zone_id: left ? 'sleeve-l' : 'sleeve-r',
      polygon_mm: [[80, 200], [220, 200], [220, 480], [80, 480]],
      safe_inset_mm: 5,
    })],
    ...patch,
  };
}

/** Флэт с рукавами (одна версия) */
export function sleevedFlat(id = 'tshirt-test', version = 1, kinds: ('sleeve_left' | 'sleeve_right')[] = ['sleeve_left', 'sleeve_right']): GarmentFlat {
  const base = flat({ id, version });
  return { ...base, views: [...base.views, ...kinds.map((k) => sleeveView(k, `flats/${id}/v${version}/${k}.svg`))] };
}

const POCKET = area({ id: 'pocket', name: 'Карман', zone_id: 'pocket', polygon_mm: [[320, 300], [420, 300], [420, 400], [320, 400]], safe_inset_mm: 5 });

/** Виды версии 1: перед с грудью и карманом, спина, левый рукав */
export function v1Views(id = 'tshirt-test'): FlatView[] {
  return [
    frontView({ svg_path: `flats/${id}/v1/front.svg`, print_areas: [area(), POCKET] }),
    backView({ svg_path: `flats/${id}/v1/back.svg` }),
    sleeveView('sleeve_left', `flats/${id}/v1/sleeve_left.svg`),
  ];
}

/** Флэт v2 (кармана нет, грудь и горловина ниже) с историей v1 */
export function versionedFlat(id = 'tshirt-test'): GarmentFlat {
  const chestV2 = area({ polygon_mm: [[150, 160], [450, 160], [450, 560], [150, 560]], tz_row: 'front_l', methods: ['dtf'], name: 'Грудь новая' });
  return {
    ...flat({ id, version: 2 }),
    views: [
      frontView({ svg_path: `flats/${id}/v2/front.svg`, anchors: { neckline_point: { x: 300, y: 112 }, center_axis_x: 300 }, print_areas: [chestV2] }),
      backView({ svg_path: `flats/${id}/v2/back.svg` }),
      sleeveView('sleeve_left', `flats/${id}/v2/sleeve_left.svg`, { anchors: { sleeve_bottom_y: 520, sleeve_center_x: 160 } }),
    ],
    history: [{ version: 1, views: v1Views(id) }],
  };
}
