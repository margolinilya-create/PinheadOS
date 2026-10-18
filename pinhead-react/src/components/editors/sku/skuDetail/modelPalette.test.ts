import { describe, it, expect } from 'vitest';
import { modelFabrics, modelPalettes, paletteCodes } from './modelPalette';
import { allowedFor } from '../../../../orderstudio/catalog/allowedColors';
import { offeredColors } from '../../../../orderstudio/catalog/suppliers';
import { SUPPLIERS_SEED } from '../../../../orderstudio/catalog/seeds';

const FABRICS = [
  { code: 'medas-kulir', supplier: 'Медас', forCategories: ['tshirts'] },
  { code: 'td-kulir', supplier: 'ТД Коттон', forCategories: ['tshirts'] },
  { code: 'medas-futer', supplier: 'Медас', forCategories: ['hoodies'] },
];
const tee = { category: 'tshirts' };
const ids = (blocks: ReturnType<typeof modelPalettes>) => blocks.map((b) => b.supplier.id);

describe('палитра модели — объединение палитр поставщиков её тканей (К10)', () => {
  it('ткани модели — её категории, а при `allowedFabrics` — только они', () => {
    expect(modelFabrics(tee, FABRICS).map((f) => f.code)).toEqual(['medas-kulir', 'td-kulir']);
    expect(modelFabrics({ ...tee, allowedFabrics: ['td-kulir'] }, FABRICS).map((f) => f.code)).toEqual(['td-kulir']);
  });

  it('ткани двух поставщиков — две палитры (Медас → Медастекс, без привязки → по умолчанию)', () => {
    expect(ids(modelPalettes(tee, FABRICS, SUPPLIERS_SEED))).toEqual(['medastex', 'cottonprom']);
  });

  it('ткани одного поставщика — одна палитра, не палитра Медастекса по умолчанию', () => {
    expect(ids(modelPalettes({ ...tee, allowedFabrics: ['td-kulir'] }, FABRICS, SUPPLIERS_SEED))).toEqual(['cottonprom']);
  });

  it('тканей у модели нет — палитра по умолчанию, а не пусто', () => {
    expect(ids(modelPalettes({ category: 'bombers' }, FABRICS, SUPPLIERS_SEED))).toEqual(['cottonprom']);
  });

  it('коды — все предлагаемые цвета палитр без повторов', () => {
    const blocks = modelPalettes(tee, FABRICS, SUPPLIERS_SEED);
    const expected = blocks.flatMap((b) => offeredColors(b.supplier).map((c) => c.code));
    expect(paletteCodes(blocks)).toEqual([...new Set(expected)]);
  });

  it('ограничение кодами Медастекс + ткань другого поставщика → на «Изделии» палитра не пустая', () => {
    const medas = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'medastex'));
    const cotton = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'cottonprom'));
    const rules = { allowedColors: medas.slice(0, 3).map((c) => c.code) };
    expect(allowedFor(rules, cotton)).toBeNull();
    expect(allowedFor(rules, medas)?.length).toBe(3);
  });
});
