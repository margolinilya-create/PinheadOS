import { describe, it, expect } from 'vitest';
import { parseDxf } from './dxf';
import { area, bbox, bulgeArc, chainSegments, simplifyClosed, type Pt } from './geom';

/** DXF из пар «код, значение» */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join('\n');
const header = (units: number | null) => (units === null ? [] : ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', units, '0', 'ENDSEC']);
const lw = (pts: Pt[], closed = true, layer = '0', bulges: number[] = []) => [
  '0', 'LWPOLYLINE', '8', layer, '90', pts.length, '70', closed ? 1 : 0,
  ...pts.flatMap(([x, y], i) => ['10', x, '20', y, ...(bulges[i] ? ['42', bulges[i]] : [])]),
];
const entities = (...ents: (string | number)[][]) => ['0', 'SECTION', '2', 'ENTITIES', ...ents.flat(), '0', 'ENDSEC'];
const RECT = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

describe('parseDxf — единицы и контуры (веха 5в, Э2б)', () => {
  it('$INSUNITS: мм, дюймы, см; нет — null', () => {
    expect(parseDxf(dxf(...header(4), ...entities(lw(RECT(0, 0, 10, 10))), '0', 'EOF')).units).toBe('mm');
    expect(parseDxf(dxf(...header(1), ...entities(lw(RECT(0, 0, 10, 10))))).units).toBe('in');
    expect(parseDxf(dxf(...header(5), ...entities(lw(RECT(0, 0, 10, 10))))).units).toBe('cm');
    expect(parseDxf(dxf(...entities(lw(RECT(0, 0, 10, 10))))).units).toBeNull();
  });

  it('замкнутая полилиния — деталь, Y перевёрнут; внутренняя (насечка внутри) — не деталь', () => {
    const r = parseDxf(dxf(...entities(lw(RECT(0, 0, 500, 700)), lw(RECT(100, 100, 20, 20)))));
    expect(r.pieces).toHaveLength(1);
    const b = bbox(r.pieces[0].contour);
    expect([b.w, b.h, b.y]).toEqual([500, 700, -700]);
  });

  it('цепочка LINE собирается в контур; незамкнутая — заметка', () => {
    const line = (a: Pt, b: Pt) => ['0', 'LINE', '8', '0', '10', a[0], '20', a[1], '11', b[0], '21', b[1]];
    const closed = parseDxf(dxf(...entities(line([0, 0], [100, 0]), line([100, 50], [0, 50]), line([100, 0], [100, 50]), line([0, 50], [0, 0]))));
    expect(closed.pieces).toHaveLength(1);
    expect(area(closed.pieces[0].contour)).toBeCloseTo(5000);
    const open = parseDxf(dxf(...entities(line([0, 0], [100, 0]), line([100, 0], [100, 50]), line([100, 50], [0, 60]))));
    expect(open.pieces).toHaveLength(0);
    expect(open.notes.join(' ')).toMatch(/Незамкнутых контуров: 1/);
  });

  it('AAMA: деталь — блок с контуром слоя «1», вставка INSERT со смещением и масштабом; внутренние слои — не детали', () => {
    const r = parseDxf(dxf(
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'FRONT', '10', 0, '20', 0,
      ...lw(RECT(0, 0, 50, 70), true, '1'),
      ...lw(RECT(-10, -10, 200, 200), true, '8'),
      '0', 'ENDBLK',
      '0', 'ENDSEC',
      ...entities(['0', 'INSERT', '8', '0', '2', 'FRONT', '10', 100, '20', 0, '41', 2, '42', 2]),
    ));
    expect(r.pieces.map((p) => p.name)).toEqual(['FRONT']);
    const b = bbox(r.pieces[0].contour);
    expect([b.x, b.w, b.h]).toEqual([100, 100, 140]);
  });

  it('POLYLINE + VERTEX … SEQEND и выпуклость (bulge) — дуга отрезками', () => {
    const r = parseDxf(dxf(...entities([
      '0', 'POLYLINE', '8', '0', '70', 1,
      '0', 'VERTEX', '8', '0', '10', 0, '20', 0, '42', 1,
      '0', 'VERTEX', '8', '0', '10', 100, '20', 0,
      '0', 'VERTEX', '8', '0', '10', 100, '20', 100,
      '0', 'VERTEX', '8', '0', '10', 0, '20', 100,
      '0', 'SEQEND',
    ])));
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].contour.length).toBeGreaterThan(10);
    // полукруг под нижней стороной (Y файла вверх → здесь вниз): рамка выше на 50
    expect(bbox(r.pieces[0].contour).h).toBeCloseTo(150, 0);
  });
});

describe('geom', () => {
  it('bulgeArc: полуокружность через (1, −1)', () => {
    const mid = bulgeArc([0, 0], [2, 0], 1, 90);
    expect(mid).toHaveLength(1);
    expect(mid[0][0]).toBeCloseTo(1);
    expect(mid[0][1]).toBeCloseTo(-1);
  });
  it('simplifyClosed: лишние точки на прямых уходят; не больше предела', () => {
    const dense: Pt[] = [];
    for (let i = 0; i < 100; i++) dense.push([i, 0]);
    for (let i = 0; i < 100; i++) dense.push([100, i]);
    for (let i = 100; i > 0; i--) dense.push([i, 100]);
    for (let i = 100; i > 0; i--) dense.push([0, i]);
    const s = simplifyClosed(dense, 0.3, 400);
    expect(s.length).toBe(4);
    const circle: Pt[] = Array.from({ length: 2000 }, (_, i) => [Math.cos(i / 318.3) * 300, Math.sin(i / 318.3) * 300]);
    expect(simplifyClosed(circle, 0.01, 50).length).toBeLessThanOrEqual(50);
  });
  it('chainSegments: отрезки в любом порядке и направлении', () => {
    const { closed } = chainSegments([[[0, 0], [1, 0]], [[0, 1], [0, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 1]]]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toHaveLength(4);
  });
});
