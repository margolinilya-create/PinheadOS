/**
 * Текст в поле фиксированного размера (К11, спека «Переполнение полей»).
 *
 * Кегль подбирается от `max` вниз до 8 pt с шагом 0,5 pt по ширинам глифов.
 * Не влезает и при 8 pt — в поле идёт начало, остаток (`rest`) уходит
 * на страницу «Продолжение: <поле>». Ничего не обрезается молча.
 *
 * Ширина — функция `measure(строка, кегль) → мм`: в движке — `getStringUnitWidth`
 * jsPDF, в тестах — заглушка моноширинного шрифта. Модуль без зависимостей.
 */

/** Миллиметров в пункте */
export const PT_MM = 25.4 / 72;
/** Наименьший кегль ТЗ — мельче цех не читает (спека) */
export const MIN_PT = 8;
const STEP = 0.5;

export type Measure = (s: string, pt: number) => number;

export interface FitOpts {
  max: number;
  min: typeof MIN_PT;
  lineGap: number;
  measure: Measure;
}

export interface Fit {
  pt: number;
  lines: string[];
  /** Не вместилось и при 8 pt; пусто — всё в поле */
  rest: string;
}

/** Строка переноса и то, чем она соединяется со следующей при сборке остатка */
interface Seg { text: string; join: '' | ' ' | '\n' }

export function lineHeightMm(pt: number, lineGap: number): number {
  return pt * PT_MM * lineGap;
}

/** Слово шире строки — по знакам */
function breakWord(word: string, w: number, pt: number, measure: Measure): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && measure(cur + ch, pt) > w) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function wrapParagraph(par: string, w: number, pt: number, measure: Measure): Seg[] {
  const out: Seg[] = [];
  let cur = '';
  for (const word of par.split(/ +/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, pt) <= w) {
      cur = next;
      continue;
    }
    if (cur) out.push({ text: cur, join: ' ' });
    const pieces = measure(word, pt) > w ? breakWord(word, w, pt, measure) : [word];
    pieces.slice(0, -1).forEach((p) => out.push({ text: p, join: '' }));
    cur = pieces[pieces.length - 1];
  }
  out.push({ text: cur, join: '\n' });
  return out;
}

/** Перенос по словам и абзацам (`\n`) на ширину `w` мм при кегле `pt` */
export function wrapText(text: string, w: number, pt: number, measure: Measure): string[] {
  return wrapSegs(text, w, pt, measure).map((s) => s.text);
}

function wrapSegs(text: string, w: number, pt: number, measure: Measure): Seg[] {
  return text.replace(/\r\n?/g, '\n').split('\n').flatMap((par) => wrapParagraph(par, w, pt, measure));
}

function joinRest(segs: Seg[]): string {
  return segs.map((s, i) => s.text + (i < segs.length - 1 ? s.join : '')).join('');
}

export function fitText(box: { w: number; h: number }, text: string, o: FitOpts): Fit {
  const clean = (text ?? '').trim();
  if (!clean) return { pt: o.max, lines: [], rest: '' };
  for (let pt = o.max; pt >= o.min; pt -= STEP) {
    const segs = wrapSegs(clean, box.w, pt, o.measure);
    const fits = Math.floor(box.h / lineHeightMm(pt, o.lineGap) + 1e-9);
    const last = pt - STEP < o.min;
    if (segs.length <= fits) return { pt, lines: segs.map((s) => s.text), rest: '' };
    if (last) {
      return { pt, lines: segs.slice(0, fits).map((s) => s.text), rest: joinRest(segs.slice(fits)).trim() };
    }
  }
  return { pt: o.min, lines: [], rest: clean };
}
