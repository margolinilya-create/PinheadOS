// @vitest-environment node
/**
 * Сторож набора знаков PDF (К10): `PDF_GLYPHS` = таблица `cmap` (формат 4,
 * платформа 3 / кодировка 1) ОБОИХ шрифтов `design/export/fonts/` — в обе
 * стороны. Шрифт сменили, а набор нет (или наоборот) — красный.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDF_GLYPHS, charName, unsupportedChars } from './pdfGlyphs';

const FONTS = join(process.cwd(), 'src/orderstudio/design/export/fonts');

/** Кодовые точки с ненулевым глифом из подтаблицы cmap формата 4 (3/1) */
function cmapCodePoints(file: string): Set<number> {
  const b = readFileSync(join(FONTS, file));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let cmap = -1;
  for (let i = 0; i < dv.getUint16(4); i += 1) {
    const rec = 12 + 16 * i;
    if (b.toString('latin1', rec, rec + 4) === 'cmap') cmap = dv.getUint32(rec + 8);
  }
  expect(cmap).toBeGreaterThan(0);
  const out = new Set<number>();
  for (let t = 0; t < dv.getUint16(cmap + 2); t += 1) {
    const rec = cmap + 4 + 8 * t;
    const st = cmap + dv.getUint32(rec + 4);
    if (dv.getUint16(rec) !== 3 || dv.getUint16(rec + 2) !== 1 || dv.getUint16(st) !== 4) continue;
    const segX2 = dv.getUint16(st + 6);
    const ends = st + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const offsets = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s += 1) {
      const end = dv.getUint16(ends + 2 * s);
      const start = dv.getUint16(starts + 2 * s);
      const delta = dv.getInt16(deltas + 2 * s);
      const ro = dv.getUint16(offsets + 2 * s);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let g = ro === 0 ? (c + delta) & 0xffff : dv.getUint16(offsets + 2 * s + ro + 2 * (c - start));
        if (ro !== 0 && g) g = (g + delta) & 0xffff;
        if (g) out.add(c);
      }
    }
  }
  return out;
}

const sorted = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);

describe('PDF_GLYPHS — сторож cmap', () => {
  it.each(['LiberationSans-Regular.subset.ttf', 'LiberationSans-Bold.subset.ttf'])('%s: набор равен cmap', (file) => {
    const cmap = cmapCodePoints(file);
    expect(cmap.size).toBe(321);
    expect(sorted(PDF_GLYPHS)).toEqual(sorted(cmap));
  });
});

describe('unsupportedChars', () => {
  it('казахские буквы, рубль и галочка — по одному, в порядке появления', () => {
    expect(unsupportedChars('Қазақ ₽ ✓')).toEqual(['Қ', 'қ', '₽', '✓']);
  });

  it('кириллица, латиница, №, кавычки-ёлочки, тире и перевод строки печатаются', () => {
    expect(unsupportedChars('Футболка «Old Money» № 5 — 10 мм\nвторая строка ё Ё ґ')).toEqual([]);
  });

  it('табуляция и невидимый пробел нулевой ширины — вне шрифта', () => {
    expect(unsupportedChars('а\tб\u200bв')).toEqual(['\t', '\u200b']);
  });
});

describe('charName — невидимые знаки словами', () => {
  it('называет табуляцию, неразрывный пробел и прочие невидимые кодом', () => {
    expect(charName('\t')).toBe('табуляция');
    expect(charName('\u00a0')).toBe('неразрывный пробел');
    expect(charName('\u200b')).toBe('невидимый знак U+200B');
    expect(charName('қ')).toBe('қ');
  });
});
