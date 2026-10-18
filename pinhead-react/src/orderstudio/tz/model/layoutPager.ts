/**
 * Раскладка ТЗ по страницам A4 — общие кирпичи (веха 6+7, задача 2).
 *
 * Чистая геометрия в мм: прямоугольники с текстом, клетками, галочками,
 * картинками и мокапами. Рисует их движок PDF (задача 3) текстовым API jsPDF,
 * SVG — только мокап сцены (К4). Текст в поле — через `fitText` (≥ 8 pt);
 * не влезло — в поле начало и «(продолжение на стр. N)», остаток — на странице
 * «Продолжение: <поле>» в конце документа (К11). Стрелки «→» в шрифте нет (К10).
 *
 * `Pager` изменяемый только внутри одной сборки `layoutTz`; наружу уходят
 * готовые прямоугольники.
 */
import { MIN_PT, fitText, lineHeightMm, type FitOpts, type Measure } from './fitText';
import type { TzMockupRef } from './tzDocTypes';

export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN = 10;
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const FOOTER_H = 14;
/** Низ области содержимого — над подвалом */
export const BOTTOM = PAGE_H - MARGIN - FOOTER_H;
export const TITLE_H = 10;
export const LINE_GAP = 1.2;
export const GAP = 2;

export type TzBoxKind = 'text' | 'cell' | 'image' | 'scene' | 'line' | 'check';

export interface TzBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: TzBoxKind;
  /** Строки текста (уже перенесённые) и кегль */
  lines?: string[];
  pt?: number;
  bold?: boolean;
  /** Галочка: отмечена */
  checked?: boolean;
  /** Картинка: путь в бакете и её роль */
  image?: string;
  role?: 'sticker' | 'label' | 'scheme' | 'artwork' | 'note';
  /** Мокап сцены */
  scene?: TzMockupRef;
  /** Кликабельная ссылка — только прошедшая `isSafeHttpUrl` */
  link?: string;
}

export interface TzLayout {
  pages: number;
  boxes: TzBox[];
}

export interface Pager {
  boxes: TzBox[];
  page: number;
  y: number;
  measure: Measure;
  conts: { field: string; text: string; marker: TzBox }[];
}

export function newPager(measure: Measure): Pager {
  return { boxes: [], page: 0, y: MARGIN, measure, conts: [] };
}

export function add(p: Pager, box: Omit<TzBox, 'page'>): TzBox {
  const b: TzBox = { page: p.page, ...box };
  p.boxes.push(b);
  return b;
}

/** Новая страница с заголовком */
export function newPage(p: Pager, title: string): void {
  p.page += 1;
  p.y = MARGIN;
  const fit = fitText({ w: CONTENT_W, h: TITLE_H }, title, { max: 13, min: MIN_PT, lineGap: 1.1, measure: p.measure });
  add(p, { x: MARGIN, y: p.y, w: CONTENT_W, h: TITLE_H, kind: 'text', lines: [...fit.lines, ...(fit.rest ? [fit.rest] : [])].slice(0, 2), pt: fit.pt, bold: true });
  p.y += TITLE_H + GAP;
}

/** Места до низа не хватает — новая страница «<заголовок>» */
export function ensure(p: Pager, h: number, title: string): void {
  if (p.y + h > BOTTOM) newPage(p, title);
}

export interface TextOpts { max?: number; bold?: boolean; kind?: 'text' | 'cell'; field: string; link?: string }

/**
 * Текст в прямоугольнике. Не влез и при 8 pt — в поле начало и пометка
 * продолжения, остаток — в очередь страниц «Продолжение: <поле>»
 */
export function textIn(p: Pager, r: { x: number; y: number; w: number; h: number }, text: string, o: TextOpts): TzBox {
  const opts: FitOpts = { max: o.max ?? 10, min: MIN_PT, lineGap: LINE_GAP, measure: p.measure };
  const fit = fitText(r, text, opts);
  const base = { ...r, kind: o.kind ?? 'text', bold: o.bold, ...(o.link ? { link: o.link } : {}) } as const;
  if (!fit.rest) return add(p, { ...base, lines: fit.lines, pt: fit.pt });
  const room = Math.max(0, r.h - lineHeightMm(MIN_PT, LINE_GAP));
  const head = room > 0 ? fitText({ w: r.w, h: room }, text, opts) : { pt: MIN_PT, lines: [], rest: text.trim() };
  const box = add(p, { ...base, lines: [...head.lines, '(продолжение на стр. ?)'], pt: head.pt });
  p.conts.push({ field: o.field, text: head.rest, marker: box });
  return box;
}

/** Строка «подпись — значение» во всю ширину */
export function row(p: Pager, label: string, value: string, o: { h?: number; labelW?: number; max?: number; title: string }): void {
  const h = o.h ?? 7;
  const lw = o.labelW ?? 48;
  ensure(p, h, o.title);
  textIn(p, { x: MARGIN, y: p.y, w: lw, h }, label, { kind: 'cell', bold: true, max: 9, field: label });
  textIn(p, { x: MARGIN + lw, y: p.y, w: CONTENT_W - lw, h }, value, { kind: 'cell', max: o.max ?? 10, field: label });
  p.y += h;
}

/** Строки продолжений: каждое поле с новой страницы, текст течёт по страницам; пометки получают номер */
export function layoutContinuations(p: Pager): void {
  const queue = [...p.conts];
  p.conts = [];
  for (const c of queue) {
    newPage(p, `Продолжение: ${c.field}`);
    c.marker.lines = [...(c.marker.lines ?? []).slice(0, -1), `(продолжение на стр. ${p.page})`];
    let rest = c.text;
    for (;;) {
      const h = BOTTOM - p.y;
      const fit = fitText({ w: CONTENT_W, h }, rest, { max: 10, min: MIN_PT, lineGap: LINE_GAP, measure: p.measure });
      add(p, { x: MARGIN, y: p.y, w: CONTENT_W, h, kind: 'text', lines: fit.lines, pt: fit.pt });
      if (!fit.rest || fit.rest === rest) break;
      rest = fit.rest;
      newPage(p, `Продолжение: ${c.field}`);
    }
  }
}
