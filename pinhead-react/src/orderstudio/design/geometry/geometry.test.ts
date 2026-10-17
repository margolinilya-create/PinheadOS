// Перенос DM `lib/geometry/geometry.test.ts` без ростовки (веха 5б) и зон по размеру.
import { describe, it, expect } from 'vitest';
import { polygonToZone, rotatedAabb, type Bbox } from './coords';
import { verticalFromNeckline, horizontalFromCenter, verticalFromBottom, fullDimensions } from './dimension';
import { checkZone } from './zone';
import { CENTER_X, NECKLINE_Y } from '../fixtures.testutil';

const CHEST_ZONE = polygonToZone([[150, 140], [450, 140], [450, 540], [150, 540]]);

describe('dimension', () => {
  it('vertical_from_neckline = bbox.y − neckline.y', () => {
    expect(verticalFromNeckline({ x: 225, y: 150, w: 150, h: 200 }, NECKLINE_Y)).toBe(58);
  });

  it('horizontal_from_center = 0 для центрированного макета', () => {
    expect(horizontalFromCenter({ x: 225, y: 150, w: 150, h: 200 }, CENTER_X)).toBe(0);
  });

  it('horizontal_from_center положителен при сдвиге вправо', () => {
    expect(horizontalFromCenter({ x: 245, y: 150, w: 150, h: 200 }, CENTER_X)).toBe(20);
  });

  it('vertical_from_bottom для рукава', () => {
    expect(verticalFromBottom({ x: 80, y: 90, w: 80, h: 60 }, 180)).toBe(30);
  });

  it('полная обвязка груди', () => {
    const d = fullDimensions({ x: 200, y: 200, w: 200, h: 250 }, CHEST_ZONE);
    expect(d).toEqual({ left: 50, right: 50, top: 60, bottom: 90, printWidth: 200, printHeight: 250 });
  });
});

describe('zone', () => {
  it('внутри зоны — не предупреждаем', () => {
    const c = checkZone({ x: 200, y: 200, w: 200, h: 250 }, CHEST_ZONE, 15);
    expect(c.out_of_zone).toBe(false);
    expect(c.out_of_safe_zone).toBe(false);
  });

  it('выход за зону → out_of_zone', () => {
    const c = checkZone({ x: 120, y: 200, w: 200, h: 250 }, CHEST_ZONE, 15);
    expect(c.out_of_zone).toBe(true);
    expect(c.dimensions.left).toBe(-30);
  });

  it('safe-zone строже обычной', () => {
    const c = checkZone({ x: 155, y: 200, w: 200, h: 250 }, CHEST_ZONE, 15);
    expect(c.out_of_zone).toBe(false);
    expect(c.out_of_safe_zone).toBe(true);
  });

  it('отступ ровно = safeInsetMm → out_of_safe_zone=false', () => {
    const c = checkZone({ x: 165, y: 200, w: 270, h: 250 }, CHEST_ZONE, 15);
    expect(c.dimensions.left).toBe(15);
    expect(c.out_of_safe_zone).toBe(false);
  });

  it('отступ ровно 0 → out_of_zone=false', () => {
    const c = checkZone({ x: 150, y: 200, w: 300, h: 250 }, CHEST_ZONE, 15);
    expect(c.dimensions.left).toBe(0);
    expect(c.out_of_zone).toBe(false);
  });
});

describe('rotatedAabb', () => {
  it('поворот на 90° меняет местами ширину и высоту, центр сохраняется', () => {
    const a = rotatedAabb({ x: 100, y: 100, w: 200, h: 100 }, 90);
    expect(a.w).toBeCloseTo(100, 6);
    expect(a.h).toBeCloseTo(200, 6);
    expect(a.x + a.w / 2).toBeCloseTo(200, 6);
    expect(a.y + a.h / 2).toBeCloseTo(150, 6);
  });

  it('поворот на 0° не меняет bbox', () => {
    const bbox: Bbox = { x: 10, y: 20, w: 30, h: 40 };
    expect(rotatedAabb(bbox, 0)).toEqual(bbox);
  });

  it('поворот на 45° квадрата 100×100 → ≈141.42', () => {
    const a = rotatedAabb({ x: 0, y: 0, w: 100, h: 100 }, 45);
    expect(a.w).toBeCloseTo(141.4213562, 6);
    expect(a.h).toBeCloseTo(141.4213562, 6);
  });

  it('поворот на 30° прямоугольника 200×100 → w≈223.205, h≈186.603', () => {
    const a = rotatedAabb({ x: 0, y: 0, w: 200, h: 100 }, 30);
    expect(a.w).toBeCloseTo(223.2050808, 6);
    expect(a.h).toBeCloseTo(186.6025404, 6);
  });

  it('поворот на −30° и 330° дают тот же AABB, что 30°', () => {
    const b = { x: 0, y: 0, w: 200, h: 100 };
    expect(rotatedAabb(b, -30).w).toBeCloseTo(rotatedAabb(b, 30).w, 6);
    expect(rotatedAabb(b, 330).h).toBeCloseTo(rotatedAabb(b, 30).h, 6);
  });
});
