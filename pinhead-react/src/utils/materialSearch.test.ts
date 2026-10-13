import { describe, it, expect } from 'vitest';
import { searchFabrics } from './materialSearch';
import { FABRICS_CATALOG_DEFAULT } from '../data/fabricsCatalog';
import { SKU_CATEGORIES, SKU_CATALOG_DEFAULT } from '../data/skuCatalog';

const find = (q: string) => searchFabrics(FABRICS_CATALOG_DEFAULT, q, SKU_CATEGORIES, SKU_CATALOG_DEFAULT);

describe('поиск тканей по каталогу', () => {
  it('сочетание модели, поставщика и ткани', () => {
    const r = find('худи тонитекс футер 380');
    expect(r.map((f) => f.code)).toEqual(['tonitex-futher-100-380']);
  });
  it('по модели: шоппер находит ткани сумок', () => {
    expect(find('шоппер саржа').map((f) => f.supplier).sort()).toEqual(['Балтекс', 'Зенит']);
  });
  it('регистр и ё не важны', () => {
    expect(find('НАЧЁС медас').length).toBeGreaterThan(0);
    expect(find('начес медас')).toEqual(find('НАЧЁС медас'));
  });
  it('нет совпадения — пустой список (интерфейс показывает сообщение)', () => {
    expect(find('бархат рутекс')).toEqual([]);
  });
});
