import { describe, it, expect } from 'vitest';
import { resolveFlat } from './resolveFlat';

const FLAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><g id="garment" fill="#fff"><path d="M0 0h600v760z"/></g></svg>';

describe('resolveFlat', () => {
  it('габарит — viewBox × масштаб; разметка очищена', () => {
    const r = resolveFlat(FLAT, { scale_mm_per_unit: 0.5 });
    expect(r?.flatMm).toEqual({ w: 300, h: 380 });
    expect(r?.removed).toEqual([]);
    expect(r?.markup).toContain('id="garment"');
  });

  it('скрипт во флэте вырезан перед показом (защита в глубину)', () => {
    const evil = FLAT.replace('<g ', '<script>alert(1)</script><g onload="alert(2)" ');
    const r = resolveFlat(evil, { scale_mm_per_unit: 1 });
    expect(r?.markup).not.toMatch(/script|onload|alert/);
    expect(r?.removed.length).toBe(2);
  });

  it('без viewBox или битый — null', () => {
    expect(resolveFlat('<svg xmlns="http://www.w3.org/2000/svg"/>', { scale_mm_per_unit: 1 })).toBeNull();
    expect(resolveFlat('<svg', { scale_mm_per_unit: 1 })).toBeNull();
  });
});
