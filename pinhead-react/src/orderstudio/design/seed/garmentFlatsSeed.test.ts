import { describe, it, expect } from 'vitest';
import seed from './garmentFlats.seed.json';
import { SEED_FLATS_COUNT, SEED_FILES_COUNT } from './seedInfo';
import { parseFlatsCatalog } from '../catalog/flatsSchema';
import { GARMENT_TYPE_CATEGORY, isAccessoryType } from '../catalog/categoryMap';
import { autoPickFlat } from '../catalog/pickFlat';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { FLAT_MAX_BYTES, flatSvgPath, isFlatPath } from '../../api/garmentFlats';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import type { GarmentFlat, GarmentFlatsCatalog } from '../types';
import type { SkuItem } from '../../../types/catalog';

/**
 * Сторож СИДА флэтов (веха 5а, задача 4): проверка на результате конвертера
 * `scripts/flats-seed-convert.mjs`, а не на самом скрипте. Тексты SVG — тем же
 * `import.meta.glob`, что у `seedFlats.ts` (без чтения файловой системы).
 *
 * Санитайзер работает на `DOMParser` — поэтому jsdom, а не node.
 */
const FILES = import.meta.glob('./flats/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const catalog = seed as unknown as GarmentFlatsCatalog;
const flats: GarmentFlat[] = catalog.flats;
const fileOf = (id: string, kind: string) => `./flats/${id}-${kind}.svg`;

const FIT_WORDS: Record<string, string> = { freefit: 'free', oversize: 'oversize', regular: 'regular', classic: 'classic' };
const zoneById = new Map(ZONES_CATALOG_DEFAULT.map((z) => [z.id, z]));

describe('сид флэтов — справочник', () => {
  it('проходит схему справочника целиком, 35 моделей', () => {
    const r = parseFlatsCatalog(seed);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.catalog.flats).toHaveLength(SEED_FLATS_COUNT);
    expect(SEED_FLATS_COUNT).toBe(35);
  });

  it('влезает в лимит записи справочника (1 МБ)', () => {
    expect(new TextEncoder().encode(JSON.stringify(seed)).length).toBeLessThanOrEqual(1048576);
  });

  it('флэт: типовой, активный, версия 1, путь SVG по форме бакета', () => {
    for (const f of flats) {
      expect(f, f.id).toMatchObject({ typical: true, active: true, version: 1 });
      for (const v of f.views) {
        expect(v.svg_path, `${f.id}/${v.kind}`).toBe(flatSvgPath(f.id, 1, v.kind));
        expect(isFlatPath(v.svg_path)).toBe(true);
      }
    }
  });

  it('виды — только перед и спина; у шоппера — один перед', () => {
    for (const f of flats) {
      const kinds = f.views.map((v) => v.kind);
      expect(kinds, f.id).toEqual(f.garment_type === 'shopper' ? ['front'] : ['front', 'back']);
    }
  });

  it('категория — по типу DM (categoryMap), посадка — из слов id (у аксессуаров посадки нет)', () => {
    for (const f of flats) {
      expect(f.categories, f.id).toEqual([GARMENT_TYPE_CATEGORY[f.garment_type]]);
      const words = isAccessoryType(f.garment_type) ? [] : f.id.split('-');
      const fits = [...new Set(words.map((w) => FIT_WORDS[w]).filter(Boolean))];
      expect(f.fits, f.id).toEqual(fits);
    }
  });

  it('эталон помечен в названии, остальные — как в DM', () => {
    const marked = flats.filter((f) => f.name.includes('эталон')).map((f) => f.id);
    expect(marked).toEqual(['tshirt-freefit']);
  });

  it('точные модели есть в прайс-каталоге и не повторяются', () => {
    const codes = new Set(SKU_CATALOG_DEFAULT.map((s) => s.code));
    const all = flats.flatMap((f) => f.sku_codes);
    expect(all.filter((c) => !codes.has(c))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('сид флэтов — зоны', () => {
  it('каждый zone_id есть в справочнике зон и предлагается категории флэта', () => {
    for (const f of flats) {
      const category = f.categories[0];
      for (const v of f.views) {
        for (const a of v.print_areas) {
          if (a.zone_id === null) continue;
          const zone = zoneById.get(a.zone_id);
          expect(zone, `${f.id}/${v.kind}/${a.id}: ${a.zone_id}`).toBeDefined();
          if (zone?.forCategories) expect(zone.forCategories, `${f.id}: ${a.zone_id}`).toContain(category);
        }
      }
    }
  });

  it('зона без zone_id — только этикетка; у одежды других служебных зон нет', () => {
    for (const f of flats) {
      for (const v of f.views) {
        for (const a of v.print_areas) {
          if (a.zone_id !== null) continue;
          expect(a.id, `${f.id}/${v.kind}`).toBe('label');
          expect(a.name).toBe('Этикетка');
          expect(isAccessoryType(f.garment_type)).toBe(false);
        }
      }
    }
  });

  it('зона вида соответствует виду: перед → грудь, штанина перед или сторона A; спина → спина, штанина зад', () => {
    const FRONT: Record<string, string> = { pants: 'pants-front', shopper: 'side-a' };
    const BACK: Record<string, string> = { pants: 'pants-back' };
    for (const f of flats) {
      for (const v of f.views) {
        const zones = v.print_areas.filter((a) => a.zone_id !== null).map((a) => a.zone_id);
        const want = v.kind === 'front' ? (FRONT[f.garment_type] ?? 'front') : (BACK[f.garment_type] ?? 'back');
        expect(zones, `${f.id}/${v.kind}`).toEqual([want]);
      }
    }
  });

  it('имя зоны флэта = имя зоны справочника (его получит нанесение)', () => {
    for (const f of flats) {
      for (const v of f.views) {
        for (const a of v.print_areas) {
          if (a.zone_id !== null) expect(a.name, `${f.id}/${a.id}`).toBe(zoneById.get(a.zone_id)?.name);
        }
      }
    }
  });

  it('tz_row пуст (веха 5б), методов и техники по умолчанию сид не задаёт', () => {
    for (const a of flats.flatMap((f) => f.views.flatMap((v) => v.print_areas))) {
      expect(a.tz_row).toBeUndefined();
      expect(a.methods).toBeUndefined();
      expect(a.default_method).toBeUndefined();
    }
  });
});

describe('сид флэтов — файлы SVG', () => {
  it('у каждого вида есть файл, и каждый файл чей-то', () => {
    const expected = flats.flatMap((f) => f.views.map((v) => fileOf(f.id, v.kind))).sort();
    expect(Object.keys(FILES).sort()).toEqual(expected);
    expect(expected).toHaveLength(SEED_FILES_COUNT);
    expect(SEED_FILES_COUNT).toBe(67);
  });

  it('все SVG проходят санитайзер без единой правки, в каждом — группа перекраски', () => {
    const dirty: string[] = [];
    for (const [name, text] of Object.entries(FILES)) {
      expect(new TextEncoder().encode(text).length, name).toBeLessThanOrEqual(FLAT_MAX_BYTES);
      const r = sanitizeSvg(text);
      if (!r.ok) {
        dirty.push(`${name}: ${r.error}`);
        continue;
      }
      if (r.removed.length) dirty.push(`${name}: ${r.removed.join(', ')}`);
      const doc = new DOMParser().parseFromString(r.svg, 'image/svg+xml');
      expect(doc.querySelector('g[id="garment"]'), name).not.toBeNull();
    }
    expect(dirty).toEqual([]);
  });
});

describe('сид флэтов — подбор силуэта для моделей прайс-каталога', () => {
  /** Ожидаемый флэт каждой модели по умолчанию; `null` — силуэта нет (плашка) */
  const EXPECTED: Record<string, string | null> = {
    'T-001': 'tshirt-classic', 'T-002': 'tshirt-classic', 'T-003': 'tshirt-regular',
    'T-004': 'tshirt-freefit', 'T-005': 'tshirt-oversize', 'T-006': 'tshirt-oversizecrop',
    'LS-001': 'longsleeve-classic-w', 'LS-002': 'longsleeve-regular', 'LS-003': 'longsleeve-freefit', 'LS-004': 'longsleeve-oversize',
    'SW-001': 'sweatshirt-classic', 'SW-002': 'sweatshirt-regular', 'SW-003': 'sweatshirt-freefit', 'SW-004': 'sweatshirt-oversize',
    'HZ-001': 'half-zip-regular', 'HZ-002': 'half-zip-regular', 'HZ-003': 'half-zip-freefit',
    'HZ-004': 'half-zip-freefit', 'HZ-005': 'half-zip-oversize', 'HZ-006': 'half-zip-oversize',
    'H-001': 'hoodie-classic', 'H-002': 'hoodie-regular', 'H-003': 'hoodie-freefit', 'H-004': 'hoodie-oversize', 'H-005': 'hoodie-reglan',
    'ZH-001': 'zip-hoodie-regular', 'ZH-002': 'zip-hoodie-freefit', 'ZH-003': 'zip-hoodie-oversize',
    'ZH-004': 'zip-hoodie-regular', 'ZH-005': 'zip-hoodie-freefit', 'ZH-006': 'zip-hoodie-oversize',
    'PL-001': 'polo-regular', 'PL-002': 'polo-oversize', 'RG-001': 'polo-regular', 'RG-002': 'polo-oversize',
    'OL-001': 'olympic-freefit',
    'BM-001': 'bomber-basic', 'BM-002': 'bomber-zip',
    'P-001': 'pants-women', 'P-002': 'pants-women', 'P-003': 'pants-regular',
    'P-004': 'pants-regular', 'P-005': 'pants-freefit', 'P-006': 'pants-freefit',
    'SH-001': null, 'SH-002': null,
    'BAG-001': 'shopper-classic', 'BAG-002': 'shopper-composite', 'BAG-003': 'shopper-classic', 'BAG-004': 'shopper-horizontal',
  };

  it('у каждой модели прайс-каталога записано ожидание (новая модель — решение вслух)', () => {
    expect(SKU_CATALOG_DEFAULT.map((s) => s.code).filter((c) => !(c in EXPECTED))).toEqual([]);
  });

  it.each(Object.entries(EXPECTED))('%s → %s', (code, want) => {
    // Сид каталога — JS: посадка у него строкой, а не объединением SkuItem['fit']
    const sku = SKU_CATALOG_DEFAULT.find((s) => s.code === code) as SkuItem | undefined;
    expect(sku).toBeDefined();
    const got = autoPickFlat({ flat_id: '', sku_code: code, fit: '' }, sku, catalog);
    expect(got?.flat.id ?? null).toBe(want);
  });
});
