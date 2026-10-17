#!/usr/bin/env node
/**
 * РАЗОВЫЙ конвертер сида флэтов дизайн-мейкера (DM) в справочник
 * `app_config.garmentFlats` (веха 5а, задача 4). Лежит в репозитории ради
 * повторяемости: сид пересобирается той же командой, а не руками.
 *
 *   node scripts/flats-seed-convert.mjs <путь к репозиторию DM>
 *
 * Читает `public/seed/skus.json` и `public/seed/flats/*.svg` дизайн-мейкера,
 * пишет в `src/orderstudio/design/seed/`:
 *   · `flats/<id флэта>-<вид>.svg` — SVG байт в байт, имя — по `views[].flat_svg`
 *     (у эталона DM файл `freefit-front.svg`, у нас `tshirt-freefit-front.svg`);
 *   · `garmentFlats.seed.json` — справочник в нашей форме (`design/types.ts`).
 *
 * Правила (план вехи 5а, задача 4 и «Проверка скиллами»):
 *   · SKU DM → флэт: `id` = id SKU, `typical: true`, `active: true`, `version: 1`;
 *   · `categories` — категория прайс-каталога по типу DM (`catalog/categoryMap.ts`);
 *   · `fits` — из слов id: freefit → free, oversize, regular, classic; у аксессуаров
 *     (шопперы) посадки нет — пусто, как `fit: null` у их моделей в прайс-каталоге;
 *   · `sku_codes` — точные модели прайс-каталога (`EXACT_SKU_CODES`), где
 *     подбор по крою ошибся бы (реглан, кроп, бомберы, женские штаны, шопперы);
 *   · `svg_path` — `flats/<id>/v1/<вид>.svg` (форма миграции H);
 *   · зоны: `chest`/`front` у одежды → `front`, `back` → `back`, `front` у шоппера →
 *     `side-a`, у штанов → `pants-front`/`pants-back`, `label` → `null` («Этикетка»);
 *     имя зоны — из справочника зон по умолчанию (то же имя получит нанесение);
 *   · `tz_row` пуст (веха 5б); эталон `tshirt-freefit` помечен в имени, у остальных
 *     зоны предварительные — как в DM.
 *
 * Результат сторожит `src/orderstudio/design/seed/garmentFlatsSeed.test.ts`
 * (проверка на результате, а не на скрипте): схема, санитайзер, категории,
 * зоны, подбор флэта для каждой модели прайс-каталога.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ZONES_CATALOG_DEFAULT } from '../src/data/constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/orderstudio/design/seed');

/** Тип DM → категория прайс-каталога; зеркало `catalog/categoryMap.ts`, сверяется тестом сида */
const TYPE_CATEGORY = {
  tshirt: 'tshirts',
  longsleeve: 'longsleeves',
  sweatshirt: 'sweatshirts',
  hoodie: 'hoodies',
  zip_hoodie: 'ziphoodies',
  half_zip: 'halfzips',
  polo: 'polo',
  olympic: 'polo',
  bomber: 'bombers',
  pants: 'pants',
  shopper: 'accessories',
};

/** Слово id SKU DM → посадка прайс-каталога (`SkuItem.fit`) */
const FIT_WORDS = { freefit: 'free', oversize: 'oversize', regular: 'regular', classic: 'classic' };

/** Точные модели прайс-каталога (`SkuItem.code`) */
export const EXACT_SKU_CODES = {
  'tshirt-oversizecrop': ['T-006'],
  'longsleeve-classic-w': ['LS-001'],
  'hoodie-reglan': ['H-005'],
  'olympic-freefit': ['OL-001'],
  'bomber-basic': ['BM-001'],
  'bomber-zip': ['BM-002'],
  'pants-women': ['P-001', 'P-002'],
  'shopper-classic': ['BAG-001'],
  'shopper-composite': ['BAG-002'],
  'shopper-horizontal': ['BAG-004'],
};

const REFERENCE_FLAT = 'tshirt-freefit';
const LABEL_NAME = 'Этикетка';

/** Имя файла сида: `<id>-<вид>.svg` — ключ `import.meta.glob` в `seedFlats.ts` */
export function seedFileName(id, kind) {
  return `${id}-${kind}.svg`;
}

/** Посадки из слов id: `tshirt-freefit` → `['free']`, `pants-women` → `[]` */
export function fitsOf(id) {
  return [...new Set(id.split('-').map((w) => FIT_WORDS[w]).filter(Boolean))];
}

/** Зона справочника для зоны DM; `null` — служебная (этикетка) */
export function zoneIdOf(type, kind, areaId) {
  if (areaId === 'label') return null;
  if (type === 'shopper' && areaId === 'front') return 'side-a';
  if (type === 'pants') {
    if (areaId === 'front' && kind === 'front') return 'pants-front';
    if (areaId === 'back' && kind === 'back') return 'pants-back';
  } else if ((areaId === 'chest' || areaId === 'front') && kind === 'front') return 'front';
  else if (areaId === 'back' && kind === 'back') return 'back';
  throw new Error(`зона DM «${areaId}» (${type}, ${kind}) — не знаю, куда её отнести`);
}

function zoneName(zoneId) {
  if (zoneId === null) return LABEL_NAME;
  const zone = ZONES_CATALOG_DEFAULT.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`зоны «${zoneId}» нет в ZONES_CATALOG_DEFAULT`);
  return zone.name;
}

function convertArea(type, kind, a) {
  const zoneId = zoneIdOf(type, kind, a.id);
  return {
    id: a.id,
    name: zoneName(zoneId),
    zone_id: zoneId,
    polygon_mm: a.polygon_mm,
    safe_inset_mm: a.safe_inset_mm,
  };
}

function convertView(sku, v) {
  return {
    kind: v.kind,
    svg_path: `flats/${sku.id}/v1/${v.kind}.svg`,
    scale_mm_per_unit: v.scale_mm_per_unit,
    anchors: v.anchors,
    print_areas: v.print_areas.map((a) => convertArea(sku.type, v.kind, a)),
  };
}

/** SKU DM → флэт справочника */
export function convertSku(sku) {
  const category = TYPE_CATEGORY[sku.type];
  if (!category) throw new Error(`тип DM «${sku.type}» (${sku.id}) — нет категории`);
  return {
    id: sku.id,
    name: sku.id === REFERENCE_FLAT ? `${sku.name} — эталон` : sku.name,
    garment_type: sku.type,
    typical: true,
    active: true,
    version: 1,
    sku_codes: EXACT_SKU_CODES[sku.id] ?? [],
    categories: [category],
    fits: category === 'accessories' ? [] : fitsOf(sku.id),
    base_size: sku.base_size,
    sizes: sku.sizes,
    views: sku.views.map((v) => convertView(sku, v)),
  };
}

/** `skus.json` DM → значение `app_config.garmentFlats` */
export function convertDmCatalog(dm) {
  return { version: 1, flats: dm.skus.map(convertSku) };
}

function main(dmRoot) {
  const seedDir = join(resolve(dmRoot), 'public/seed');
  const dm = JSON.parse(readFileSync(join(seedDir, 'skus.json'), 'utf8'));
  const catalog = convertDmCatalog(dm);
  const flatsOut = join(OUT_DIR, 'flats');
  rmSync(flatsOut, { recursive: true, force: true });
  mkdirSync(flatsOut, { recursive: true });
  for (const sku of dm.skus) {
    for (const v of sku.views) {
      copyFileSync(join(seedDir, 'flats', basename(v.flat_svg)), join(flatsOut, seedFileName(sku.id, v.kind)));
    }
  }
  // Пара координат — в строку: справочник читается и сравнивается по точкам, а не по числам
  const json = JSON.stringify(catalog, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]');
  writeFileSync(join(OUT_DIR, 'garmentFlats.seed.json'), `${json}\n`);
  const files = readdirSync(flatsOut).length;
  console.log(`✓ флэтов ${catalog.flats.length}, SVG ${files} → ${OUT_DIR}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dmRoot = process.argv[2];
  if (!dmRoot) {
    console.error('Укажите путь к репозиторию дизайн-мейкера: node scripts/flats-seed-convert.mjs <путь>');
    process.exit(1);
  }
  main(dmRoot);
}
