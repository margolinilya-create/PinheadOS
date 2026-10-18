import { describe, it, expect } from 'vitest';
import { MIN_PT, fitText, lineHeightMm, wrapText, type FitOpts } from './fitText';
import { mono } from './measure.testutil';
const opts: FitOpts = { max: 12, min: MIN_PT, lineGap: 1.2, measure: mono };

describe('fitText — кегль и переполнение', () => {
  it('влезает при max — кегль max, одна строка, остатка нет', () => {
    expect(fitText({ w: 100, h: 10 }, 'Короткий текст', opts)).toEqual({ pt: 12, lines: ['Короткий текст'], rest: '' });
  });

  it('не влезает при max — кегль уменьшается, но не ниже 8', () => {
    const text = 'слово '.repeat(30).trim();
    const fit = fitText({ w: 60, h: 25 }, text, opts);
    expect(fit.pt).toBeLessThan(12);
    expect(fit.pt).toBeGreaterThanOrEqual(8);
    expect(fit.rest).toBe('');
    expect(fit.lines.join(' ')).toBe(text);
  });

  it('при 8 не влезает — начало в поле, остаток в rest, кегль ровно 8, ничего не потеряно', () => {
    const text = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
    const fit = fitText({ w: 40, h: 8 }, text, opts);
    expect(fit.pt).toBe(8);
    expect(fit.rest).not.toBe('');
    expect(`${fit.lines.join(' ')} ${fit.rest}`).toBe(text);
    expect(fit.lines.length).toBe(Math.floor(8 / lineHeightMm(8, 1.2)));
  });

  it('абзацы сохраняются в остатке', () => {
    const fit = fitText({ w: 40, h: 4 }, 'первая строка\nвторая строка\nтретья', opts);
    expect(fit.pt).toBe(8);
    expect(fit.lines).toEqual(['первая строка']);
    expect(fit.rest).toBe('вторая строка\nтретья');
  });

  it('пусто — без строк', () => {
    expect(fitText({ w: 40, h: 10 }, '   ', opts)).toEqual({ pt: 12, lines: [], rest: '' });
  });
});

describe('wrapText — перенос', () => {
  it('длинное слово (имя файла лекал) рвётся по знакам, без потерь', () => {
    const name = 'Fertoing_T-shirt_Regular_01.10.2025';
    const lines = wrapText(name, 20, 10, mono);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(name);
    for (const l of lines) expect(mono(l, 10)).toBeLessThanOrEqual(20);
  });
});
