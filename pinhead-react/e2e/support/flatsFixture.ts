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

// ── Флэты сида (веха 5а, задача 8): то же, что кладёт кнопка «Загрузить типовые флэты» ──

type SeedView = { kind: 'front' | 'back'; svg_path: string };
type SeedFlat = { id: string; views: SeedView[] };
type SeedCatalog = { version: number; flats: SeedFlat[] };

const SEED_DIR = new URL('../../src/orderstudio/design/seed/', import.meta.url);
const seedCatalog = (): SeedCatalog => JSON.parse(readFileSync(new URL('garmentFlats.seed.json', SEED_DIR), 'utf8'));

/** Справочник `garmentFlats` из сида: только названные флэты, как есть (новая копия на вызов) */
export function seedFlatsCatalog(ids: string[]): SeedCatalog {
  const all = seedCatalog();
  const flats = ids.map((id) => {
    const f = all.flats.find((x) => x.id === id);
    if (!f) throw new Error(`флэта ${id} нет в сиде`);
    return f;
  });
  return { version: all.version, flats };
}

/** Объекты бакета `garment-flats` для флэтов сида (`flats/<id>/v<N>/<вид>.svg`) */
export function seedFlatObjects(ids: string[]): Record<string, { type: string; body: Buffer }> {
  const out: Record<string, { type: string; body: Buffer }> = {};
  for (const f of seedFlatsCatalog(ids).flats) {
    for (const v of f.views) {
      out[`garment-flats/${v.svg_path}`] = {
        type: 'image/svg+xml',
        body: readFileSync(new URL(`flats/${f.id}-${v.kind}.svg`, SEED_DIR)),
      };
    }
  }
  return out;
}

/** Число флэтов и файлов сида — сверка сценария сида с самим сидом, а не с числом в спеке */
export function seedCounts(): { flats: number; files: number } {
  const all = seedCatalog();
  return { flats: all.flats.length, files: all.flats.reduce((n, f) => n + f.views.length, 0) };
}
