import { describe, it, expect } from 'vitest';
import {
  CANVAS_PAD, FLAT_MM_FALLBACK, MIN_AREA_MM, arrowDelta, distanceMm, fit, lockAxis, neighborId, nodeToRect, nudgeRect,
  rectToNode, toMm, toMmTenth, toPx,
} from './canvasMath';

describe('canvasMath — вписывание', () => {
  it('флэт вписан с полями и стоит по центру', () => {
    const f = fit({ width: 800, height: 640 }, { w: 600, h: 760 });
    // Узкое место — высота: (640 − 2·40) / 760
    expect(f.pxPerMm).toBeCloseTo((640 - 2 * CANVAS_PAD) / 760, 6);
    expect(f.oy).toBeCloseTo(CANVAS_PAD, 6);
    expect(f.ox).toBeCloseTo((800 - 600 * f.pxPerMm) / 2, 6);
  });

  it('битый габарит — габарит по умолчанию, а не деление на ноль', () => {
    const bad = fit({ width: 800, height: 640 }, { w: 0, h: Number.NaN });
    expect(bad).toEqual(fit({ width: 800, height: 640 }, FLAT_MM_FALLBACK));
    expect(Number.isFinite(bad.pxPerMm)).toBe(true);
  });

  it('мм → px → мм туда и обратно', () => {
    const f = fit({ width: 1024, height: 700 }, { w: 520, h: 610 });
    for (const p of [{ x: 0, y: 0 }, { x: 123.4, y: 456.7 }, { x: 520, y: 610 }]) {
      const back = toMm(f, toPx(f, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
    expect(toMmTenth(f, toPx(f, { x: 123.44, y: 9.96 }))).toEqual([123.4, 10]);
  });

  it('рамка зоны ↔ узел konva; масштаб трансформера входит в размер', () => {
    const f = fit({ width: 800, height: 640 }, { w: 600, h: 760 });
    const r = { x: 150, y: 140, w: 300, h: 400 };
    expect(nodeToRect(f, rectToNode(f, r))).toEqual(r);
    const n = rectToNode(f, r);
    expect(nodeToRect(f, { ...n, scaleX: 0.5, scaleY: 2 })).toEqual({ x: 150, y: 140, w: 150, h: 800 });
  });

  it('сторона зоны с холста не меньше 5 мм', () => {
    const f = fit({ width: 800, height: 640 }, { w: 600, h: 760 });
    const r = nodeToRect(f, { ...rectToNode(f, { x: 10, y: 10, w: 100, h: 100 }), scaleX: 0.01, scaleY: 0.01 });
    expect(r.w).toBe(MIN_AREA_MM);
    expect(r.h).toBe(MIN_AREA_MM);
  });
});

describe('canvasMath — клавиши и ручки', () => {
  it('стрелки: 1 мм, с Shift — 10 мм; не стрелка — null', () => {
    expect(arrowDelta('ArrowRight', false)).toEqual({ x: 1, y: 0 });
    expect(arrowDelta('ArrowUp', true)).toEqual({ x: 0, y: -10 });
    expect(arrowDelta('ArrowLeft', true)).toEqual({ x: -10, y: 0 });
    expect(arrowDelta('ArrowDown', false)).toEqual({ x: 0, y: 1 });
    expect(arrowDelta('Tab', false)).toBeNull();
  });

  it('сдвиг рамки — с шагом 0,1 мм, размер прежний', () => {
    expect(nudgeRect({ x: 0.15, y: 10, w: 30, h: 40 }, 0.1, -10)).toEqual({ x: 0.3, y: 0, w: 30, h: 40 });
  });

  it('ручка по X не уходит по Y, по Y — по X; горловина — свободно', () => {
    const fixed = { x: 100, y: 50 };
    expect(lockAxis('x', fixed, { x: 140, y: 999 })).toEqual({ x: 140, y: 50 });
    expect(lockAxis('y', fixed, { x: 999, y: 70 })).toEqual({ x: 100, y: 70 });
    expect(lockAxis('xy', fixed, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });

  it('отмер калибровки — длина отрезка в мм', () => {
    expect(distanceMm({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(500);
  });

  it('соседняя зона — по кругу; без выбора — первая или последняя', () => {
    const ids = ['a', 'b', 'c'];
    expect(neighborId(ids, 'a', 1)).toBe('b');
    expect(neighborId(ids, 'c', 1)).toBe('a');
    expect(neighborId(ids, 'a', -1)).toBe('c');
    expect(neighborId(ids, null, 1)).toBe('a');
    expect(neighborId(ids, null, -1)).toBe('c');
    expect(neighborId([], null, 1)).toBeNull();
  });
});
