import { describe, it, expect } from 'vitest';
import { zonesForSku } from './skuRules';
import { ZONES_CATALOG_DEFAULT } from '../data/constants';
import type { SkuItem, ZoneDefinition } from '../types/catalog';
import { SKU_CATALOG_DEFAULT } from '../data';

const Z = ZONES_CATALOG_DEFAULT as ZoneDefinition[];
const ids = (sku: Parameters<typeof zonesForSku>[1], extras: string[] = [], cat = [] as { code: string; name?: string }[]) =>
  zonesForSku(Z, sku, extras, cat).map((z) => z.id);

describe('зоны по модели (правка 13.10, п. 11)', () => {
  it('рукава — у футболок, но не у штанов, шорт и сумок', () => {
    expect(ids({ category: 'tshirts', zones: [] })).toEqual(expect.arrayContaining(['sleeve-l', 'sleeve-r']));
    for (const category of ['pants', 'shorts', 'accessories']) {
      expect(ids({ category, zones: [] })).not.toContain('sleeve-l');
    }
  });
  it('у сумок — стороны A и B, у штанов — штанины', () => {
    expect(ids({ category: 'accessories', zones: [] })).toEqual(['side-a', 'side-b']);
    expect(ids({ category: 'pants', zones: [] })).toEqual(expect.arrayContaining(['leg-l', 'leg-r']));
  });
  it('капюшон — только у модели с капюшоном', () => {
    expect(ids({ category: 'halfzips', zones: ['front', 'hood'] })).toEqual(['front']);
    expect(ids({ category: 'hoodies', hasHood: true, zones: ['front', 'hood'] })).toEqual(['front', 'hood']);
  });
  it('карман — по конструкции или выбранной обработке', () => {
    expect(ids({ category: 'tshirts', zones: [] })).not.toContain('pocket');
    expect(ids({ category: 'hoodies', hasPocket: true, zones: [] })).toContain('pocket');
    expect(ids({ category: 'tshirts', zones: ['front'] }, ['chest-pocket'], [{ code: 'chest-pocket', name: 'Нагрудный карман' }]))
      .toEqual(['front', 'pocket']);
  });
});

describe('зоны штанов (веха 5а, ответ владельца 17.10)', () => {
  const zone = (id: string) => Z.find((z) => z.id === id);

  it('«Штанина перед» и «Штанина зад» — отдельные зоны только у штанов', () => {
    expect(zone('pants-front')).toMatchObject({ name: 'Штанина перед', forCategories: ['pants'] });
    expect(zone('pants-back')).toMatchObject({ name: 'Штанина зад', forCategories: ['pants'] });
  });

  it('«Грудь (перед)» и «Спина» у штанов не предлагаются', () => {
    expect(ids({ category: 'pants', zones: [] })).not.toContain('front');
    expect(ids({ category: 'pants', zones: [] })).not.toContain('back');
    expect(ids({ category: 'pants', zones: [] })).toEqual(expect.arrayContaining(['pants-front', 'pants-back']));
    expect(ids({ category: 'tshirts', zones: [] })).not.toContain('pants-front');
  });

  it('у штанов каталога по умолчанию видны новые зоны', () => {
    const pants = (SKU_CATALOG_DEFAULT as SkuItem[]).filter((s) => s.category === 'pants');
    expect(pants.length).toBeGreaterThan(0);
    for (const sku of pants) {
      expect(ids(sku)).toEqual(expect.arrayContaining(['pants-front', 'pants-back']));
    }
  });

  it('id зон уникальны, у каждой зоны модели каталога есть определение', () => {
    expect(new Set(Z.map((z) => z.id)).size).toBe(Z.length);
    const known = new Set(Z.map((z) => z.id));
    const missing = (SKU_CATALOG_DEFAULT as SkuItem[]).flatMap((s) => (s.zones ?? []).filter((id) => !known.has(id)).map((id) => `${s.code}: ${id}`));
    expect(missing).toEqual([]);
  });
});
