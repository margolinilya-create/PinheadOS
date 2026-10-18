/**
 * Знаки, которые печатает шрифт PDF (К10): подмножество LiberationSans
 * `design/export/fonts/*.subset.ttf` — 321 кодовая точка, одинаковая у обоих
 * начертаний. Нет ₽, ✓, ☐, казахских и узбекских букв, CJK, эмодзи, табуляции.
 *
 * Знак вне набора jsPDF напечатает пустым прямоугольником или пропустит —
 * поэтому чек-лист отправки называет поле и знаки ДО сборки, а движок
 * отказывает, если чек-лист обошли. Молча заменять на «?» нельзя: цех
 * получил бы искажённый текст.
 *
 * Набор сверяет с таблицей `cmap` (формат 4) обоих TTF сторож
 * `pdfGlyphs.test.ts` в обе стороны: новый шрифт — новый набор, одним коммитом.
 */

/** Диапазоны кодовых точек `cmap` (включительно) */
const RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x400, 0x45f], [0x490, 0x491],
  [0x2010, 0x2010], [0x2012, 0x2022], [0x2026, 0x2026], [0x2030, 0x2030],
  [0x2032, 0x2033], [0x2039, 0x203a], [0x20ac, 0x20ac], [0x2116, 0x2116],
  [0x2122, 0x2122], [0x2212, 0x2212], [0x2248, 0x2248], [0x2260, 0x2260],
  [0x2264, 0x2265],
];

function expand(ranges: readonly (readonly [number, number])[]): Set<number> {
  const out = new Set<number>();
  for (const [from, to] of ranges) for (let c = from; c <= to; c += 1) out.add(c);
  return out;
}

export const PDF_GLYPHS: ReadonlySet<number> = expand(RANGES);

/** Перевод строки — не глиф: его разбирает перенос текста */
const LINE_BREAK = 0x0a;

/** Знаки текста вне шрифта — по одному, в порядке первого появления */
export function unsupportedChars(text: string): string[] {
  const out: string[] = [];
  for (const ch of text ?? '') {
    const cp = ch.codePointAt(0) as number;
    if (cp !== LINE_BREAK && !PDF_GLYPHS.has(cp) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

const NAMED: Record<string, string> = {
  '\u00a0': 'неразрывный пробел',
  '\t': 'табуляция',
  '\r': 'возврат каретки',
};

/** Невидимый или управляющий знак (его нельзя показать в тексте отказа как есть) */
function isInvisible(ch: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Z}]/u.test(ch) && ch !== ' ';
}

/** Знак для человека: видимый — сам знак, невидимый — словами («невидимый знак U+200B») */
export function charName(ch: string): string {
  if (NAMED[ch]) return NAMED[ch];
  if (!isInvisible(ch)) return ch;
  const hex = (ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0');
  return `невидимый знак U+${hex}`;
}
