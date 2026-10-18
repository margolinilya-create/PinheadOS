import { describe, it, expect } from 'vitest';
import { flat, CENTER_X, NECKLINE_Y } from '../../fixtures.testutil';
import type { Placement } from '../../types';
import {
  FLAT_MM_FALLBACK, areaAt, arrowHead, clampZoom, clientToMm, fromNode, isDarkHex, isOutOfZone, makeTransform,
  nudged, snapCenter, snapTargets, toNode, zoomAround,
} from './canvasMath';

const FRONT = flat().views[0];
const BACK = flat().views[1];

const placement = (patch: Partial<Placement> = {}): Placement => ({
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 240, y_mm: 167, width_mm: 120, height_mm: 80,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf',
  asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false },
  artwork_path: 'orders/x/logo/a.png', stale: false,
  ...patch,
});

describe('makeTransform', () => {
  it('флэт вписан в стейдж с полями и по центру', () => {
    const t = makeTransform({ width: 800, height: 640 }, { w: 600, h: 760 });
    // по высоте: (640 − 96) / 760
    expect(t.pxPerMM).toBeCloseTo(544 / 760, 6);
    expect(t.py(0)).toBeCloseTo(48, 6);
    expect(t.px(300)).toBeCloseTo(400, 6);
    expect(t.s(100)).toBeCloseTo(100 * t.pxPerMM, 6);
  });

  it('нулевой или битый размер флэта — запасной габарит, без деления на ноль', () => {
    const t = makeTransform({ width: 800, height: 640 }, { w: 0, h: Number.NaN });
    const ref = makeTransform({ width: 800, height: 640 }, FLAT_MM_FALLBACK);
    expect(t.pxPerMM).toBe(ref.pxPerMM);
    expect(Number.isFinite(t.px(10))).toBe(true);
  });
});

describe('мм → узел → мм (поворот, отражение)', () => {
  const t = makeTransform({ width: 900, height: 700 }, { w: 600, h: 760 });

  it.each([
    ['без поворота', placement()],
    ['поворот 30°', placement({ rotation_deg: 30 })],
    ['отражение по горизонтали', placement({ flip_h: true })],
    ['отражение по вертикали и поворот 275°', placement({ flip_v: true, rotation_deg: 275 })],
  ])('%s — возвращается то же размещение', (_name, pl) => {
    const back = fromNode(toNode(pl, t), t);
    expect(back.x_mm).toBeCloseTo(pl.x_mm, 6);
    expect(back.y_mm).toBeCloseTo(pl.y_mm, 6);
    expect(back.width_mm).toBeCloseTo(pl.width_mm, 6);
    expect(back.height_mm).toBeCloseTo(pl.height_mm, 6);
    expect(back.rotation_deg).toBeCloseTo(pl.rotation_deg, 6);
    expect(back.flip_h).toBe(pl.flip_h);
    expect(back.flip_v).toBe(pl.flip_v);
  });

  it('узел — центр-ориджин: x/y узла — центр рамки', () => {
    const n = toNode(placement(), t);
    expect(n.x).toBeCloseTo(t.px(300), 6);
    expect(n.y).toBeCloseTo(t.py(207), 6);
    expect(n.offsetX).toBeCloseTo(n.width / 2, 6);
  });

  it('растяжение трансформером: мм из ширины × масштаба, знак масштаба — отражение', () => {
    const n = toNode(placement(), t);
    const out = fromNode({ ...n, scaleX: -2, scaleY: 1.5 }, t);
    expect(out.width_mm).toBeCloseTo(240, 6);
    expect(out.height_mm).toBeCloseTo(120, 6);
    expect(out.flip_h).toBe(true);
    expect(out.flip_v).toBe(false);
    // центр на месте
    expect(out.x_mm + out.width_mm / 2).toBeCloseTo(300, 6);
  });
});

describe('привязка при перетаскивании', () => {
  const targets = snapTargets(FRONT, 'chest');

  it('цели: ось изделия и центр зоны', () => {
    expect(targets.axisX).toBe(CENTER_X);
    expect(targets.zoneCx).toBe(300);
    expect(targets.zoneCy).toBe(340);
  });

  it('рядом с осью (< 5 мм) — магнит и гайд; дальше — без привязки', () => {
    expect(snapCenter(303, 200, targets)).toEqual({ cx: 300, cy: 200, guideX: 300, guideY: undefined });
    expect(snapCenter(310, 200, targets)).toEqual({ cx: 310, cy: 200, guideX: undefined, guideY: undefined });
    expect(snapCenter(310, 337, targets)).toEqual({ cx: 310, cy: 340, guideX: undefined, guideY: 340 });
  });

  it('именованные оси тоже притягивают', () => {
    const view = { ...FRONT, anchors: { ...FRONT.anchors, axes: [{ id: 'dart', name: 'Выточка', x: 200 }] } };
    expect(snapCenter(198, 100, snapTargets(view, 'chest')).cx).toBe(200);
  });
});

describe('isOutOfZone', () => {
  it('внутри зоны — нет; край за зоной — да; поворот учитывается', () => {
    expect(isOutOfZone(FRONT, placement())).toBe(false);
    expect(isOutOfZone(FRONT, placement({ x_mm: 140 }))).toBe(true);
    // 300×60 у верха зоны: без поворота влезает, на 90° рамка уходит выше зоны
    expect(isOutOfZone(FRONT, placement({ x_mm: 150, y_mm: 160, width_mm: 300, height_mm: 60 }))).toBe(false);
    expect(isOutOfZone(FRONT, placement({ x_mm: 150, y_mm: 160, width_mm: 300, height_mm: 60, rotation_deg: 90 }))).toBe(true);
  });
});

describe('nudged — стрелки', () => {
  it('сдвиг на dx/dy мм, остальное как было', () => {
    const pl = placement();
    expect(nudged(pl, 1, 0)).toEqual({ ...pl, x_mm: 241 });
    expect(nudged(pl, 0, -10)).toEqual({ ...pl, y_mm: 157 });
  });
});

describe('зум и экранные координаты', () => {
  it('clampZoom держит пределы стора', () => {
    expect(clampZoom(100)).toBe(8);
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('zoomAround: точка под курсором остаётся на месте', () => {
    const pan = { x: 10, y: -20 };
    const next = zoomAround({ x: 300, y: 200 }, 1, 2, pan);
    const before = { x: (300 - pan.x) / 1, y: (200 - pan.y) / 1 };
    expect((300 - next.x) / 2).toBeCloseTo(before.x, 6);
    expect((200 - next.y) / 2).toBeCloseTo(before.y, 6);
  });

  it('clientToMm учитывает рамку контейнера, панораму и зум', () => {
    const t = makeTransform({ width: 800, height: 640 }, { w: 600, h: 760 });
    const zoom = 2;
    const pan = { x: -100, y: -50 };
    // точка флэта (300, 340) мм на экране:
    const sx = t.px(300) * zoom + pan.x + 20;
    const sy = t.py(340) * zoom + pan.y + 30;
    const mm = clientToMm({ x: sx, y: sy }, { left: 20, top: 30 }, pan, zoom, t);
    expect(mm.x_mm).toBeCloseTo(300, 6);
    expect(mm.y_mm).toBeCloseTo(340, 6);
  });
});

describe('areaAt — зона под точкой сброса', () => {
  it('внутри многоугольника зоны — её id; мимо — undefined', () => {
    expect(areaAt(FRONT, 300, 300)).toBe('chest');
    expect(areaAt(FRONT, 100, 100)).toBeUndefined();
    expect(areaAt(BACK, 300, 60)).toBe('label');
    expect(areaAt(BACK, 300, NECKLINE_Y + 200)).toBe('back');
  });

  it('невыпуклая зона: выемка не считается попаданием', () => {
    const view = {
      ...FRONT,
      print_areas: [{ ...FRONT.print_areas[0], polygon_mm: [[0, 0], [100, 0], [100, 100], [50, 50], [0, 100]] as [number, number][] }],
    };
    expect(areaAt(view, 50, 20)).toBe('chest');
    expect(areaAt(view, 50, 90)).toBeUndefined();
  });
});

describe('arrowHead — наконечник линии без фигуры Arrow', () => {
  it('треугольник с вершиной в конце линии', () => {
    const pts = arrowHead(0, 0, 100, 0, 6, 6);
    expect(pts).toHaveLength(6);
    expect(pts.slice(0, 2)).toEqual([100, 0]);
    expect(pts[2]).toBeCloseTo(94, 6);
    expect(Math.abs(pts[3])).toBeCloseTo(3, 6);
  });

  it('нулевая длина — пусто (не рисуется)', () => {
    expect(arrowHead(5, 5, 5, 5, 6, 6)).toEqual([]);
  });
});

describe('isDarkHex — обводка зоны по яркости ткани', () => {
  it('тёмная ткань — да, светлая — нет, мусор — нет', () => {
    expect(isDarkHex('#111111')).toBe(true);
    expect(isDarkHex('#1f2a5c')).toBe(true);
    expect(isDarkHex('#d9d9d9')).toBe(false);
    expect(isDarkHex('#ffffff')).toBe(false);
    expect(isDarkHex('red')).toBe(false);
  });
});
