import { describe, it, expect } from 'vitest';
import { skuDescription } from './skuDescription';
import { FABRICS_CATALOG_DEFAULT } from '../data/fabricsCatalog';

describe('описание изделия из ткани', () => {
  it('убирает зашитый «хлопок 240 г/м²» и подставляет выбранную ткань', () => {
    const d = skuDescription(
      { description: 'Прямой крой, хлопок 240 г/м², рибана 1×1 на вороте', category: 'tshirts' },
      'tonitex-kulirnaya-100-180', FABRICS_CATALOG_DEFAULT,
    );
    expect(d).toBe('Прямой крой, рибана 1×1 на вороте. Ткань: Кулирка, 100% хб, 180 г/м², ТониТекс');
  });
  it('без выбора — первая ткань категории', () => {
    expect(skuDescription({ description: '', category: 'accessories' }, null, FABRICS_CATALOG_DEFAULT))
      .toBe('Ткань: Саржа, 100% хб, 270 г/м², Зенит');
  });
});
