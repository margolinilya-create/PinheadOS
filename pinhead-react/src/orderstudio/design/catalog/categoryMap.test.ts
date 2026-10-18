import { describe, it, expect } from 'vitest';
import { GARMENT_TYPE_CATEGORY, isAccessoryType, typesOfCategory } from './categoryMap';
import { GARMENT_TYPES } from '../types';
import { SKU_CATEGORIES } from '../../../data/skuCatalog';

describe('тип DM ↔ категория прайс-каталога', () => {
  it('у каждого типа DM есть категория, и она есть в SKU_CATEGORIES', () => {
    const known = new Set((SKU_CATEGORIES as { id: string }[]).map((c) => c.id));
    for (const t of GARMENT_TYPES) {
      expect(known.has(GARMENT_TYPE_CATEGORY[t]), `нет категории у «${t}»`).toBe(true);
    }
    expect(Object.keys(GARMENT_TYPE_CATEGORY).sort()).toEqual([...GARMENT_TYPES].sort());
  });

  it('таблица решения плана', () => {
    expect(GARMENT_TYPE_CATEGORY).toMatchObject({
      tshirt: 'tshirts', longsleeve: 'longsleeves', sweatshirt: 'sweatshirts', hoodie: 'hoodies',
      zip_hoodie: 'ziphoodies', half_zip: 'halfzips', polo: 'polo', olympic: 'polo',
      bomber: 'bombers', pants: 'pants', shopper: 'accessories',
    });
  });

  it('шоппер — аксессуар, остальные — одежда', () => {
    expect(isAccessoryType('shopper')).toBe(true);
    expect(GARMENT_TYPES.filter(isAccessoryType)).toEqual(['shopper']);
  });

  it('обратно: категория → типы', () => {
    expect(typesOfCategory('polo').sort()).toEqual(['olympic', 'polo']);
    expect(typesOfCategory('shorts')).toEqual([]);
  });
});
