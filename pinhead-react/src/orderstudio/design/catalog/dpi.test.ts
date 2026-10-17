import { describe, it, expect } from 'vitest';
import { effectiveDpi, printQuality } from './dpi';
import type { AssetMeta } from '../types';

const png = (px: number): AssetMeta => ({
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 100,
  px_w: px, px_h: px, size_estimated: false, has_preview: false,
});
const svg: AssetMeta = { ...png(0), type: 'svg', px_w: undefined, px_h: undefined };
const RASTER = { dpi: { good: 300, min: 150 } };
const EMB = { detail: { minLineMm: 1, minTextMm: 4 } };

describe('effectiveDpi', () => {
  it('пиксели на ширину печати в дюймах', () => {
    expect(effectiveDpi(1181, 100)).toBeCloseTo(300, 0);
  });
  it('нулевые входы → 0', () => {
    expect(effectiveDpi(0, 100)).toBe(0);
    expect(effectiveDpi(1000, 0)).toBe(0);
  });
});

describe('printQuality', () => {
  it('SVG — всегда вектор', () => expect(printQuality(svg, 500, RASTER).quality).toBe('vector'));
  it('good при ≥300 DPI', () => expect(printQuality(png(1200), 100, RASTER).quality).toBe('good'));
  it('mid при 150–299 DPI', () => expect(printQuality(png(800), 100, RASTER).quality).toBe('mid'));
  it('low при <150 DPI', () => expect(printQuality(png(400), 100, RASTER).quality).toBe('low'));
  it('без пикселей — unknown', () => expect(printQuality({ ...png(0), px_w: undefined }, 100).quality).toBe('unknown'));
  it('без макета — unknown', () => expect(printQuality(undefined, 100).quality).toBe('unknown'));
  it('без профиля — пороги 300/150', () => expect(printQuality(png(500), 100).quality).toBe('low'));
  it('пороги — из профиля техники', () => {
    expect(printQuality(png(500), 100, { dpi: { good: 200, min: 120 } }).quality).toBe('mid');
  });
  it('техника без DPI-контроля в профиле — пороги по умолчанию', () => {
    expect(printQuality(png(1200), 100, {}).quality).toBe('good');
  });
  it('вышивка — контроль детали, а не DPI, и у вектора тоже', () => {
    expect(printQuality(png(1200), 100, EMB).quality).toBe('embroidery');
    expect(printQuality(svg, 200, EMB).quality).toBe('embroidery');
  });
});
