import { describe, it, expect } from 'vitest';
import { addSize, removeSize, setBaseSize } from './flatSizes';
import { parseFlatsCatalog } from '../catalog/flatsSchema';
import { flat, frontView } from '../fixtures.testutil';

describe('размеры флэта (К13)', () => {
  it('addSize: без повторов и пустых, по порядку размеров (регресс дефекта 4 DM)', () => {
    let f = flat({ sizes: ['M'] });
    f = addSize(f, ' XL ');
    f = addSize(f, 'S');
    f = addSize(f, '3XL');
    f = addSize(f, 'XS');
    expect(f.sizes).toEqual(['XS', 'S', 'M', 'XL', '3XL']);
    expect(addSize(f, 'M')).toBe(f);
    expect(addSize(f, '  ')).toBe(f);
  });

  it('removeSize чистит size_anchors во всех видах (регресс дефекта 3 DM); базовый — отказ', () => {
    const anchors = { neckline_point: { x: 300, y: 92 }, center_axis_x: 300 };
    const f = flat({ sizes: ['M', 'L', 'XL'], views: [frontView({ size_anchors: { L: anchors, XL: anchors } })] });
    expect(parseFlatsCatalog({ version: 1, flats: [f] }).issues).toEqual([]);
    const noL = removeSize(f, 'L');
    expect(noL.sizes).toEqual(['M', 'XL']);
    expect(Object.keys(noL.views[0].size_anchors ?? {})).toEqual(['XL']);
    expect(parseFlatsCatalog({ version: 1, flats: [noL] }).issues).toEqual([]);
    const noXl = removeSize(noL, 'XL');
    expect('size_anchors' in noXl.views[0]).toBe(false);
    expect(removeSize(noXl, 'M')).toBe(noXl);
    expect(removeSize(noXl, '9XL')).toBe(noXl);
  });

  it('setBaseSize — только из списка размеров', () => {
    const f = flat({ sizes: ['M', 'L'] });
    expect(setBaseSize(f, 'L').base_size).toBe('L');
    expect(setBaseSize(f, 'XL')).toBe(f);
    expect(setBaseSize(flat({ sizes: [] }), 'S').base_size).toBe('S');
  });
});
