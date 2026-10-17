import { describe, it, expect } from 'vitest';
import { parseViewBox } from './svgMeta';

describe('parseViewBox', () => {
  it('третья и четвёртая компоненты — ширина и высота', () => {
    expect(parseViewBox('<svg viewBox="0 0 600 760">')).toEqual({ w: 600, h: 760 });
  });
  it('запятые и одинарные кавычки', () => {
    expect(parseViewBox("<svg viewBox='-10,-5,120.5,80'>")).toEqual({ w: 120.5, h: 80 });
  });
  it('нет атрибута → null', () => expect(parseViewBox('<svg width="10">')).toBeNull());
});
