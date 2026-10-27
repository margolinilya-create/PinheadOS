import { describe, it, expect } from 'vitest';
import { buildPatternSvg, pieceLabel } from './buildPatternSvg';
import { backView, frontView } from '../fixtures.testutil';
import type { Placement } from '../types';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const pl: Placement = {
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 200, y_mm: 200, width_mm: 100, height_mm: 50,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf',
  asset: { type: 'png', source_file: 'a.png', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false },
  artwork_path: 'orders/x/a.png', stale: false,
};
const pattern = { contour_mm: [[20, 10], [580, 10], [600, 730], [0, 730]] as [number, number][], count: 1 };

describe('buildPatternSvg — лист «Выкройка» (веха 5в, Э2б)', () => {
  it('детали с лекалом рядом; подпись с размером и кроем; нанесение — картинкой с клипом; линейка 10 см', () => {
    const svg = buildPatternSvg({
      pieces: [
        { view: { ...frontView(), pattern }, title: 'Перед', placements: [pl], images: { p1: PNG } },
        { view: { ...backView(), pattern: { ...pattern, count: 2 } }, title: 'Спина', placements: [], images: {} },
      ],
      garmentColor: '#111111',
    })!;
    expect(svg).toContain('Перед · 60 × 72 см · крой: 1');
    expect(svg).toContain('Спина · 60 × 72 см · крой: 2');
    expect(svg).toContain('10 см');
    expect(svg).toContain('fill="#111111"');
    expect((svg.match(/<image /g) ?? []).length).toBe(1);
    expect(svg).toMatch(/clip-path="url\(#pp-0-0\)"/);
    // вторая деталь — правее первой: поле 30 + ширина 600 + зазор 40
    expect(svg).toMatch(/translate\(670 /);
  });
  it('без лекал — null; цвет не hex — белый; вредный текст подписи — экранирован', () => {
    expect(buildPatternSvg({ pieces: [{ view: frontView(), title: 'Перед', placements: [], images: {} }] })).toBeNull();
    const svg = buildPatternSvg({ pieces: [{ view: { ...frontView(), pattern }, title: '<script>x</script>', placements: [], images: {} }], garmentColor: 'red" onload="x' })!;
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload');
    expect(svg).toContain('fill="#ffffff"');
  });
  it('pieceLabel', () => {
    expect(pieceLabel('Рукав', 405, 250, 2)).toBe('Рукав · 40,5 × 25 см · крой: 2');
  });
});
