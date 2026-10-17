/**
 * Фикстура флэтов для e2e (веха 5а, миграция H): один типовой флэт футболки
 * FreeFit (перед и спина из сида дизайн-мейкера) — справочник
 * `app_config.garmentFlats` и объекты бакета `garment-flats` с телом.
 *
 * Подключение в спеке:
 *   installSupabaseMock(page, {
 *     catalogs: { app_config: { garmentFlats: GARMENT_FLATS_FIXTURE } },
 *     storageObjects: flatStorageObjects(),
 *   });
 *
 * Форма справочника — та, что принимает `catalog_value_check` миграции H:
 * `svg_path` = `flats/<id>/v<версия>/<вид>.svg`, методы — коды CHECK нанесения.
 * Схема клиента (`design/catalog/flatsSchema.ts`, задача 3) обязана её принимать;
 * задачи 4 и 8 дополняют фикстуру после слияния.
 */
import { readFileSync } from 'node:fs';

const FLAT_ID = 'tshirt-freefit';
const VERSION = 1;
const svgPath = (kind: 'front' | 'back') => `flats/${FLAT_ID}/v${VERSION}/${kind}.svg`;

export const GARMENT_FLATS_FIXTURE = {
  version: 1,
  flats: [{
    id: FLAT_ID,
    version: VERSION,
    active: true,
    name: 'Футболка FreeFit',
    categories: ['tshirts'],
    fits: ['oversize'],
    sku_codes: [],
    views: [
      {
        kind: 'front',
        svg_path: svgPath('front'),
        scale_mm_per_unit: 1,
        anchors: { neckline_point: { x: 477.6, y: 118.8 }, center_axis_x: 477.6 },
        print_areas: [{
          id: 'chest', name: 'Грудь', zone_id: 'front',
          polygon_mm: [[337.6, 198.8], [617.6, 198.8], [617.6, 558.8], [337.6, 558.8]],
          safe_inset_mm: 20, methods: ['silkscreen', 'dtf', 'dtg', 'heat_transfer', 'embroidery'], default_method: null,
        }],
      },
      {
        kind: 'back',
        svg_path: svgPath('back'),
        scale_mm_per_unit: 1,
        anchors: { neckline_point: { x: 472.7, y: 36.3 }, center_axis_x: 472.7 },
        print_areas: [
          {
            id: 'back', name: 'Спина', zone_id: 'back',
            polygon_mm: [[322.7, 106.3], [622.7, 106.3], [622.7, 506.3], [322.7, 506.3]],
            safe_inset_mm: 20, methods: ['silkscreen', 'dtf', 'dtg', 'heat_transfer', 'embroidery'], default_method: null,
          },
          {
            id: 'label', name: 'Этикетка', zone_id: null,
            polygon_mm: [[432.7, 44.3], [512.7, 44.3], [512.7, 79.3], [432.7, 79.3]],
            safe_inset_mm: 6, methods: ['dtf', 'silkscreen'], default_method: 'dtf',
          },
        ],
      },
    ],
  }],
};

const fixtureSvg = (kind: 'front' | 'back') =>
  readFileSync(new URL(`../fixtures/flats/${FLAT_ID}-${kind}.svg`, import.meta.url));

/** Объекты бакета для `MockExtras.storageObjects` (новая карта на вызов — у спеки своё состояние) */
export function flatStorageObjects(): Record<string, { type: string; body: Buffer }> {
  return {
    [`garment-flats/${svgPath('front')}`]: { type: 'image/svg+xml', body: fixtureSvg('front') },
    [`garment-flats/${svgPath('back')}`]: { type: 'image/svg+xml', body: fixtureSvg('back') },
  };
}
