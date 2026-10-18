import { describe, it, expect } from 'vitest';
import { calibrateView, scaleFromKnownLength } from './calibrate';
import { area, frontView } from '../fixtures.testutil';

describe('калибровка вида (К11)', () => {
  const view = frontView({
    scale_mm_per_unit: 1,
    anchors: { neckline_point: { x: 300, y: 92 }, center_axis_x: 300, axes: [{ id: 'dart', name: 'Вытачка', x: 200 }] },
    size_anchors: { L: { neckline_point: { x: 310, y: 95 }, center_axis_x: 310 } },
    grade_rule: { center_axis_dx: 2 },
    print_areas: [area({ safe_inset_mm: 15, max_print_mm: { width: 280, height: 380 } })],
  });

  it('позиции × k: якоря, оси, якоря размеров, точки зон; масштаб × k', () => {
    const v = calibrateView(view, 2);
    expect(v.scale_mm_per_unit).toBe(2);
    expect(v.anchors).toEqual({ neckline_point: { x: 600, y: 184 }, center_axis_x: 600, axes: [{ id: 'dart', name: 'Вытачка', x: 400 }] });
    expect(v.size_anchors?.L).toEqual({ neckline_point: { x: 620, y: 190 }, center_axis_x: 620 });
    expect(v.print_areas[0].polygon_mm[0]).toEqual([300, 280]);
  });

  it('физические величины не меняются: отступ, лимиты печати, дельты ростовки', () => {
    const v = calibrateView(view, 2);
    expect(v.print_areas[0].safe_inset_mm).toBe(15);
    expect(v.print_areas[0].max_print_mm).toEqual({ width: 280, height: 380 });
    expect(v.grade_rule).toEqual({ center_axis_dx: 2 });
  });

  it('k не конечное, ≤ 0 или 1 — вид как есть', () => {
    for (const k of [0, -1, NaN, Infinity, 1]) expect(calibrateView(view, k)).toBe(view);
  });

  it('scaleFromKnownLength: масштаб × реальная / отмеренная; неверный ввод — null', () => {
    expect(scaleFromKnownLength(1, 500, 550)).toBeCloseTo(1.1);
    expect(scaleFromKnownLength(0.5, 100, 50)).toBe(0.25);
    expect(scaleFromKnownLength(1, 0, 50)).toBeNull();
    expect(scaleFromKnownLength(1, 100, NaN)).toBeNull();
  });
});
