import { describe, it, expect } from 'vitest';
import { areasOutsideFlat } from './zoneFit';
import { area, frontView } from '../fixtures.testutil';

describe('выверка зон: внутри силуэта флэта', () => {
  it('зона внутри viewBox — пусто', () => {
    expect(areasOutsideFlat(frontView(), { w: 600, h: 760 })).toEqual([]);
  });

  it('зона вылезла вправо и вверх — названа по id', () => {
    const v = frontView({
      print_areas: [
        area(),
        area({ id: 'wide', polygon_mm: [[100, 100], [700, 100], [700, 200], [100, 200]] }),
        area({ id: 'high', polygon_mm: [[100, -1], [200, -1], [200, 200], [100, 200]] }),
      ],
    });
    expect(areasOutsideFlat(v, { w: 600, h: 760 })).toEqual(['wide', 'high']);
  });

  it('край зоны ровно по краю флэта — внутри', () => {
    const v = frontView({ print_areas: [area({ polygon_mm: [[0, 0], [600, 0], [600, 760], [0, 760]] })] });
    expect(areasOutsideFlat(v, { w: 600, h: 760 })).toEqual([]);
  });
});
