import { describe, it, expect } from 'vitest';
import { mockupSrc } from './garmentMockup';

const decode = (src: string) => decodeURIComponent(src.replace('data:image/svg+xml;charset=utf-8,', ''));

describe('mockupSrc — силуэт модели картинкой, а не разметкой', () => {
  it('нет силуэта — пусто', () => {
    expect(mockupSrc(null, '#d9d9d9')).toBe('');
    expect(mockupSrc('нет-такого', '#d9d9d9')).toBe('');
  });

  it('SVG — data URL с пространством имён (без него <img> не рисует)', () => {
    const src = mockupSrc('pants', '#d9d9d9');
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decode(src);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg.match(/xmlns="/g)).toHaveLength(1);
  });

  it('пространство имён не дублируется, если оно уже есть', () => {
    const src = mockupSrc('tee', '#d9d9d9');
    expect(src).not.toBe('');
    expect(decode(src).match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
  });
});
