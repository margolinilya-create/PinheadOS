import { describe, it, expect } from 'vitest';
import { frontView } from '../../design/fixtures.testutil';
import { sleeveView } from '../../design/fixtures5b.testutil';
import { NECK_DROP_MM, alignToView, shiftPattern, unfold } from './patternAlign';

type Pt = [number, number];
const RECT = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const polyArea = (pts: Pt[]) => Math.abs(pts.reduce((s, [x1, y1], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return s + x1 * y2 - x2 * y1;
}, 0)) / 2;
const box = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

describe('alignToView — лекало в мм вида (веха 5в, Э2б)', () => {
  it('перед: середина детали — на ось, верх — выше горловины на глубину выреза', () => {
    const v = frontView();
    const p = alignToView(RECT(-1000, -2000, 560, 720), v);
    const b = box(p.contour_mm);
    expect(b.x + b.w / 2).toBeCloseTo(v.anchors.center_axis_x!);
    expect(b.y).toBeCloseTo(v.anchors.neckline_point!.y - NECK_DROP_MM.front);
    expect(p.count).toBe(1);
  });
  it('рукав: ось рукава и низ рукава', () => {
    const v = sleeveView('sleeve_left', 'flats/t/v1/sleeve_left.svg');
    const p = alignToView(RECT(0, 0, 400, 250), v, 2);
    const b = box(p.contour_mm);
    expect(b.x + b.w / 2).toBeCloseTo(v.anchors.sleeve_center_x!);
    expect(b.y + b.h).toBeCloseTo(v.anchors.sleeve_bottom_y!);
    expect(p.count).toBe(2);
  });
  it('ручной сдвиг', () => {
    const p = shiftPattern({ contour_mm: RECT(0, 0, 10, 10), count: 1 }, 5, -3);
    expect(box(p.contour_mm)).toMatchObject({ x: 5, y: -3 });
  });
});

describe('unfold — половина детали со сгибом', () => {
  it('сгиб справа: ширина удваивается, точки сгиба не дублируются', () => {
    const half: Pt[] = [[0, 0], [100, 0], [100, 200], [0, 200]];
    const full = unfold(half, 'right');
    expect(box(full)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(full).toHaveLength(6);
    expect(polyArea(full)).toBeCloseTo(2 * polyArea(half));
  });
  it('полочка с вырезом горловины у сгиба: площадь ровно вдвое, начало сгиба посреди массива', () => {
    const half: Pt[] = [[0, 30], [60, 0], [100, 80], [100, 700], [0, 700]];
    expect(polyArea(unfold(half, 'right'))).toBeCloseTo(2 * polyArea(half));
  });
  it('сгиб слева — зеркально влево', () => {
    expect(box(unfold([[0, 0], [100, 0], [100, 200], [0, 200]], 'left')).x).toBe(-100);
  });
});
