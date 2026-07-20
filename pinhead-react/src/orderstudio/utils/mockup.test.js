import { describe, it, expect } from 'vitest';
import { getGarmentSVG } from './mockup';

// Mock findColorEntry
vi.mock('../../data', () => ({
  findColorEntry: vi.fn((code) => {
    if (code === 'WHT') return { code: 'WHT', name: 'White', hex: '#ffffff' };
    if (code === 'BLK') return { code: 'BLK', name: 'Black', hex: '#000000' };
    if (code === 'RED') return { code: 'RED', name: 'Red', hex: '#ff0000' };
    return null;
  }),
}));

describe('getGarmentSVG', () => {
  it('returns SVG string for tee type', () => {
    const svg = getGarmentSVG('tee', 'WHT');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('returns SVG for hoodie type', () => {
    const svg = getGarmentSVG('hoodie', 'RED');
    expect(svg).toContain('<svg');
  });

  it('returns SVG for longsleeve type', () => {
    const svg = getGarmentSVG('longsleeve', 'BLK');
    expect(svg).toContain('<svg');
  });

  it('returns SVG for polo type', () => {
    const svg = getGarmentSVG('polo', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns SVG for sweat type', () => {
    const svg = getGarmentSVG('sweat', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns SVG for shopper type', () => {
    const svg = getGarmentSVG('shopper', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns SVG for zip-hoodie using hoodie SVG', () => {
    const svg = getGarmentSVG('zip-hoodie', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns fallback SVG for half-zip', () => {
    const svg = getGarmentSVG('half-zip', 'RED');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });

  it('returns fallback SVG for tank', () => {
    const svg = getGarmentSVG('tank', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns fallback SVG for pants', () => {
    const svg = getGarmentSVG('pants', 'BLK');
    expect(svg).toContain('<svg');
  });

  it('returns fallback SVG for shorts', () => {
    const svg = getGarmentSVG('shorts', 'WHT');
    expect(svg).toContain('<svg');
  });

  it('returns empty string for unknown type', () => {
    const svg = getGarmentSVG('unknown', 'WHT');
    expect(svg).toBe('');
  });

  it('uses fallback color when colorCode not found', () => {
    const svg = getGarmentSVG('tee', 'NONEXISTENT');
    expect(svg).toContain('<svg');
    expect(svg).toContain('#ccc');
  });

  it('recolors designer SVG with correct fill', () => {
    const svg = getGarmentSVG('tee', 'RED');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).not.toContain('fill="#d9d9d9"');
  });
});
