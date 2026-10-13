import { describe, it, expect } from 'vitest';
import { zonesForSku } from './skuRules';
import { ZONES_CATALOG_DEFAULT } from '../data/constants';
import type { ZoneDefinition } from '../types/catalog';

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
