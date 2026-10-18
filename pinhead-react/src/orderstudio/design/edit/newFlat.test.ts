import { describe, it, expect } from 'vitest';
import { MSG_NO_GARMENT, MSG_NO_VIEWBOX, MSG_ONLY_SVG, MSG_TOO_BIG, MSG_UTF8, readFlatSvg, removedLabel, removedText, summarizeRemoved } from './newFlat';
import { FLAT_SVG_MAX_BYTES } from '../limits';
import { FLAT_MAX_BYTES } from '../../api/garmentFlats';
import EVIL from './fixtures/flat-evil.svg?raw';

const enc = (s: string) => new TextEncoder().encode(s);
const SVG = (attrs = 'viewBox="0 0 300 600"', body = '<g id="garment"><path d="M0 0 L300 0 L300 600 Z"/></g>') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0]);

describe('readFlatSvg (К9)', () => {
  it('корректный SVG: очищенный текст, viewBox, масштаб 1 без физической единицы', () => {
    const r = readFlatSvg(enc(SVG()), 'tee.svg');
    expect(r).toMatchObject({ ok: true, vb: { w: 300, h: 600 }, scale: 1, removed: [] });
  });

  it('width="600mm" → масштаб 600 / vb.w; см и pt тоже', () => {
    expect(readFlatSvg(enc(SVG('viewBox="0 0 300 600" width="600mm"')), 'a.svg')).toMatchObject({ ok: true, scale: 2 });
    expect(readFlatSvg(enc(SVG('viewBox="0 0 300 600" width="60cm"')), 'a.svg')).toMatchObject({ ok: true, scale: 2 });
    const pt = readFlatSvg(enc(SVG('viewBox="0 0 72 600" width="72pt"')), 'a.svg');
    expect(pt.ok && pt.scale).toBeCloseTo(25.4 / 72);
    expect(readFlatSvg(enc(SVG('viewBox="0 0 300 600" width="300px"')), 'a.svg')).toMatchObject({ ok: true, scale: 1 });
  });

  it('PNG-байты под .svg, PNG, PDF и AI — «только SVG»', () => {
    expect(readFlatSvg(PNG, 'tee.svg')).toEqual({ ok: false, error: MSG_ONLY_SVG });
    expect(readFlatSvg(PNG, 'tee.png')).toEqual({ ok: false, error: MSG_ONLY_SVG });
    expect(readFlatSvg(enc('%PDF-1.7 ...'), 'tee.pdf')).toEqual({ ok: false, error: MSG_ONLY_SVG });
    expect(readFlatSvg(enc('%PDF-1.7 ...'), 'tee.ai')).toEqual({ ok: false, error: MSG_ONLY_SVG });
  });

  it('нет garment, нет viewBox — отказ с текстом', () => {
    expect(readFlatSvg(enc(SVG(undefined, '<path d="M0 0 L1 1 Z"/>')), 'a.svg')).toEqual({ ok: false, error: MSG_NO_GARMENT });
    expect(readFlatSvg(enc(SVG('width="300mm"')), 'a.svg')).toEqual({ ok: false, error: MSG_NO_VIEWBOX });
    expect(readFlatSvg(enc(SVG('viewBox="0 0 0 600"')), 'a.svg')).toEqual({ ok: false, error: MSG_NO_VIEWBOX });
  });

  it('UTF-16 с BOM и encoding не UTF-8 — «Сохраните SVG в UTF-8»', () => {
    const text = SVG();
    const u16 = new Uint8Array(2 + text.length * 2);
    u16[0] = 0xff; u16[1] = 0xfe;
    for (let i = 0; i < text.length; i++) u16[2 + i * 2] = text.charCodeAt(i);
    expect(readFlatSvg(u16, 'a.svg')).toEqual({ ok: false, error: MSG_UTF8 });
    expect(readFlatSvg(enc(`<?xml version="1.0" encoding="windows-1251"?>${text}`), 'a.svg')).toEqual({ ok: false, error: MSG_UTF8 });
    expect(readFlatSvg(enc(`<?xml version="1.0" encoding="UTF-8"?>${text}`), 'a.svg').ok).toBe(true);
    const broken = new Uint8Array([...enc(SVG().slice(0, -6)), 0xc3, 0x28, ...enc('</svg>')]);
    expect(readFlatSvg(broken, 'a.svg')).toEqual({ ok: false, error: MSG_UTF8 });
  });

  it('больше 1 МБ — отказ; предел совпадает с бакетом флэтов', () => {
    expect(FLAT_SVG_MAX_BYTES).toBe(FLAT_MAX_BYTES);
    const big = SVG(undefined, `<g id="garment"><path d="M0 0 ${'L1 1 '.repeat(220000)}Z"/></g>`);
    expect(readFlatSvg(enc(big), 'a.svg')).toEqual({ ok: false, error: MSG_TOO_BIG });
  });

  it('<script> вырезан и назван в removed; злонамеренная фикстура — подписи по виду', () => {
    const r = readFlatSvg(enc(SVG(undefined, '<script>alert(1)</script><g id="garment"><path d="M0 0 L1 1 Z"/></g>')), 'a.svg');
    expect(r.ok && r.svg).not.toContain('script');
    expect(r.ok && r.removed).toEqual([{ label: 'скрипты', count: 1 }]);
    const evil = readFlatSvg(enc(EVIL), 'evil.svg');
    expect(evil.ok).toBe(true);
    if (!evil.ok) return;
    expect(evil.scale).toBe(1);
    const labels = evil.removed.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(['скрипты', 'обработчики событий', 'внешние ссылки', 'встроенные картинки', 'стили и шрифты', 'другое']));
    expect(evil.svg).not.toMatch(/script|onload|onclick|evil\.example|foreignObject/);
  });

  it('10 000 обработчиков on* — одна строка «обработчики событий ×10000»', () => {
    const attrs = Array.from({ length: 10000 }, (_, i) => `onclick${i}="x"`).join(' ');
    const r = readFlatSvg(enc(SVG(undefined, `<g id="garment" ${attrs}><path d="M0 0 L1 1 Z"/></g>`)), 'a.svg');
    expect(r.ok && r.removed).toEqual([{ label: 'обработчики событий', count: 10000 }]);
    expect(r.ok && removedText(r.removed[0])).toBe('обработчики событий ×10000');
  });

  it('summarizeRemoved: не больше 20 строк; имена из файла не попадают в подписи', () => {
    expect(removedLabel('<evil-name>')).toBe('другое');
    expect(removedLabel('g@onclick (event)')).toBe('обработчики событий');
    expect(removedLabel('<use https://x>')).toBe('внешние ссылки');
    expect(summarizeRemoved(Array.from({ length: 500 }, (_, i) => `<tag${i}>`))).toEqual([{ label: 'другое', count: 500 }]);
    expect(removedText({ label: 'скрипты', count: 1 })).toBe('скрипты');
  });
});
