import { describe, it, expect } from 'vitest';
import { buildDimensionLines } from './dimensionLines';
import type { FlatView as View } from '../types';
import { frontView } from '../fixtures.testutil';

const view: View = frontView();

const find = (
  s: ReturnType<typeof buildDimensionLines>,
  k: string,
) => s.lines.find((l) => l.kind === k)!;

describe('buildDimensionLines — обвязка как объект', () => {
  const scene = buildDimensionLines(
    view,
    { x: 200, y: 200, w: 100, h: 100 },
    0,
    undefined,
    'chest',
  );

  it('ровно 6 размерных линий', () => {
    expect(scene.lines).toHaveLength(6);
  });

  it('отступы до краёв зоны вычислены из геометрии (мм)', () => {
    expect(find(scene, 'left').value).toBe(50); // 200−150
    expect(find(scene, 'right').value).toBe(150); // 450−300
    expect(find(scene, 'top').value).toBe(60); // 200−140
    expect(find(scene, 'bottom').value).toBe(240); // 540−300
  });

  it('вертикаль от горловины и горизонталь от центра', () => {
    const v = find(scene, 'vertical-anchor');
    expect(v.value).toBe(108); // 200 − 92
    expect(v.from).toEqual({ x: 300, y: 92 }); // от горловины
    expect(v.to).toEqual({ x: 300, y: 250 }); // до центра макета
    expect(find(scene, 'horizontal-anchor').value).toBe(-50); // (250) − 300
  });

  it('линии ссылаются на точки зоны/макета (не нарисованы)', () => {
    expect(find(scene, 'left').from).toEqual({ x: 150, y: 250 }); // край зоны
    expect(find(scene, 'left').to).toEqual({ x: 200, y: 250 }); // край макета
  });

  it('число пересчитывается при сдвиге макета (single source)', () => {
    const moved = buildDimensionLines(
      view,
      { x: 250, y: 200, w: 100, h: 100 },
      0,
      undefined,
      'chest',
    );
    expect(find(moved, 'left').value).toBe(100); // 250−150 (было 50)
  });

  it('anchorKind = neckline для одежды', () => {
    expect(scene.anchorKind).toBe('neckline');
  });

  it('выход за зону → danger на соответствующей линии', () => {
    const out = buildDimensionLines(
      view,
      { x: 140, y: 200, w: 100, h: 100 }, // x<150 → left отрицательный
      0,
      undefined,
      'chest',
    );
    expect(find(out, 'left').value).toBeLessThan(0);
    expect(find(out, 'left').danger).toBe(true);
    expect(find(out, 'right').danger).toBe(false);
  });
});

describe('buildDimensionLines — аксессуар без горловины (панель)', () => {
  // Ось намеренно смещена от центра зоны (центр зоны = 300, ось = 280).
  const shopperView: View = {
    ...view,
    anchors: { center_axis_x: 280 },
  };
  const scene = buildDimensionLines(
    shopperView,
    { x: 200, y: 200, w: 100, h: 100 },
    0,
    undefined,
    'chest',
  );

  it('anchorKind = panel, отсчёт от верха зоны и оси изделия', () => {
    expect(scene.anchorKind).toBe('panel');
    expect(scene.anchorY).toBe(140); // верх зоны
    expect(scene.centerX).toBe(280); // ось изделия, не центр зоны
    expect(find(scene, 'vertical-anchor').value).toBe(60); // 200 − 140
    expect(find(scene, 'horizontal-anchor').value).toBe(-30); // 250 − 280
  });

  it('изделие без оси — центр зоны', () => {
    const label: View = { ...view, anchors: {} };
    const s = buildDimensionLines(
      label,
      { x: 200, y: 200, w: 100, h: 100 },
      0,
      undefined,
      'chest',
    );
    expect(s.anchorKind).toBe('panel');
    expect(s.centerX).toBe(300); // центр зоны
    expect(s.anchorY).toBe(140);
  });
});
