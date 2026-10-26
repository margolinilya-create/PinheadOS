import { describe, it, expect } from 'vitest';
import { parseSvgContours, pathSubpaths, parseTransform } from './svgContours';
import { bbox } from './geom';
import { pieceSizeText, toPatternPieces, UNIT_TO_MM } from './importPattern';

const svg = (attrs: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe('parseSvgContours — лекала SVG (веха 5в, Э2б)', () => {
  it('единицы из width и viewBox: мм, см, дюймы; без единиц — null', () => {
    expect(parseSvgContours(svg('width="600mm" height="800mm" viewBox="0 0 600 800"', '<rect width="10" height="10"/>')).unitMm).toBeCloseTo(1);
    expect(parseSvgContours(svg('width="60cm" viewBox="0 0 600 800"', '<rect width="10" height="10"/>')).unitMm).toBeCloseTo(1);
    expect(parseSvgContours(svg('width="10in" viewBox="0 0 1000 1000"', '<rect width="10" height="10"/>')).unitMm).toBeCloseTo(0.254);
    expect(parseSvgContours(svg('viewBox="0 0 600 800"', '<rect width="10" height="10"/>')).unitMm).toBeNull();
  });

  it('path с относительными командами; внутренний контур и defs — не детали', () => {
    const r = parseSvgContours(svg('width="600mm" viewBox="0 0 600 800"',
      '<defs><rect width="900" height="900"/></defs>'
      + '<path id="front" d="M10 10 h500 v700 h-500 z"/>'
      + '<rect x="100" y="100" width="20" height="20"/>'));
    expect(r.pieces.map((p) => p.name)).toEqual(['front']);
    expect(bbox(r.pieces[0].contour)).toEqual({ x: 10, y: 10, w: 500, h: 700 });
  });

  it('transform группы и элемента складываются', () => {
    const r = parseSvgContours(svg('width="100mm" viewBox="0 0 100 100"',
      '<g transform="translate(100 50)"><rect transform="scale(2)" width="10" height="20"/></g>'));
    expect(bbox(r.pieces[0].contour)).toEqual({ x: 100, y: 50, w: 20, h: 40 });
  });

  it('кривые и дуги — отрезками; полукруг дугой A', () => {
    const subs = pathSubpaths('M0 0 A 50 50 0 0 1 100 0 Z');
    expect(subs[0].closed).toBe(true);
    const b = bbox(subs[0].pts);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(50, 0);
    const c = pathSubpaths('M0 0 C 0 100 100 100 100 0 Q 50 -50 0 0 Z');
    expect(c[0].pts.length).toBeGreaterThan(20);
  });

  it('незамкнутое — заметка; не SVG — понятный отказ', () => {
    expect(parseSvgContours(svg('viewBox="0 0 10 10"', '<path d="M0 0 L10 10"/>')).notes.join(' ')).toMatch(/Незамкнутых контуров: 1/);
    expect(parseSvgContours('это не svg').notes).toEqual(['Файл не читается как SVG']);
  });

  it('parseTransform: rotate вокруг точки', () => {
    const m = parseTransform('rotate(90 10 10)');
    expect(m[4]).toBeCloseTo(20);
    expect(m[5]).toBeCloseTo(0);
  });
});

describe('toPatternPieces — мм, упрощение, подпись', () => {
  it('дюймы → мм, округление до 0,1; размер «56 × 72 см»', () => {
    const [p] = toPatternPieces([{ name: 'Перед', contour: [[0, 0], [22.047, 0], [22.047, 28.346], [0, 28.346]] }], UNIT_TO_MM.in);
    expect([p.width_mm, p.height_mm]).toEqual([560, 720]);
    expect(pieceSizeText(p)).toBe('56 × 72 см');
  });
});
