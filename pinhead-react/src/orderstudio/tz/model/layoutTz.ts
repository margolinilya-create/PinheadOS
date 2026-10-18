/**
 * Раскладка ТЗ (К4, К11): документ → страницы A4 с прямоугольниками полей.
 * Чистая геометрия без PDF-движка; страницы как в образцах:
 *
 *  1. Шапка — номер и название, менеджер, даты, вид изделия, количество,
 *     упаковка, стикеры (+ картинка), «без ЧЗ», комментарии ТЗ.
 *  2. Полотно — ткани, цвета (у колорблока — по деталям), поставщик, матрица
 *     «зона × техника», сетка ЦВ/РАЗМ (по 4 строки), «Сборка/швея» для ручки,
 *     описание модели, доп. обработки.
 *  3. Параметры бирок; 4. Нанесение № N (каждое); 5. Заметки (2 × 2).
 *  6. «Продолжение: <поле>» — то, что не влезло в поле и при 8 pt.
 *  Подвал на каждой странице: текст справочника, «PH-… · ТЗ k из m · стр. i/n»,
 *  ссылка на заказ (кликабельна только `http(s)`).
 */
import type { Measure } from './fitText';
import {
  CONTENT_W, GAP, MARGIN, PAGE_H, add, layoutContinuations, newPage, newPager, row, textIn,
  type Pager, type TzBox, type TzLayout,
} from './layoutPager';
import { gridTable, matrixTable } from './layoutGrid';
import { labelsPages, notesPages, printsPages } from './layoutTzPrints';
import { isSafeHttpUrl } from './safeUrl';
import type { TzDoc } from './tzDocTypes';

export type { TzBox, TzLayout } from './layoutPager';

const HEADER_TITLE = 'Шапка ТЗ';
const FABRIC_TITLE = 'Полотно и размерная сетка';

export function tzTitle(doc: TzDoc): string {
  const deal = doc.header.bitrixId ? `[${doc.header.bitrixId}] ` : '';
  return `ТЕХНИЧЕСКОЕ ЗАДАНИЕ К ЗАКАЗУ № ${deal}${doc.header.title}`.trim();
}

function headerPage(p: Pager, doc: TzDoc): void {
  const h = doc.header;
  newPage(p, tzTitle(doc));
  const r = (label: string, value: string, height?: number) => row(p, label, value, { title: HEADER_TITLE, h: height });
  r('Номер заказа', h.orderNumber || '—');
  r('Менеджер проекта', h.manager || '—');
  r('Дата оформления', h.issuedOn || '—');
  r('Дата сдачи', h.dueDate || '—');
  r('Вид изделия', h.productTitle || '—', 12);
  r('Количество', `${h.qty} шт.`);
  r('Упаковка', [h.packaging, h.packagingSize, h.packagingNote].filter(Boolean).join('; ') || '—', 12);
  r('Стикеры', [h.stickers, h.stickersNote].filter(Boolean).join('; ') || '—', 12);
  add(p, { x: MARGIN, y: p.y + 1.5, w: 4, h: 4, kind: 'check', checked: h.noChestnyZnak });
  textIn(p, { x: MARGIN + 6, y: p.y, w: 80, h: 7 }, 'Без Честного знака', { max: 10, field: 'Без Честного знака' });
  p.y += 8;
  const comment = h.comments.map((c) => (c.label ? `${c.label}: ${c.text}` : c.text)).join('\n');
  r('Комментарий', comment || '—', 40);
  if (h.stickerImage) {
    p.y += GAP;
    textIn(p, { x: MARGIN, y: p.y, w: 60, h: 6 }, 'Стикер', { bold: true, max: 9, field: 'Стикер' });
    add(p, { x: MARGIN, y: p.y + 7, w: 80, h: 50, kind: 'image', image: h.stickerImage, role: 'sticker' });
    p.y += 58;
  }
}

function colorsText(doc: TzDoc): string {
  return doc.fabric.colors.map((c) => (c.parts.length
    ? `${c.color} (${c.parts.map((x) => `${x.part} — ${x.color}`).join(', ')})`
    : c.color)).join('; ');
}

function fabricPage(p: Pager, doc: TzDoc): void {
  const f = doc.fabric;
  newPage(p, FABRIC_TITLE);
  const r = (label: string, value: string, height?: number) => row(p, label, value, { title: FABRIC_TITLE, h: height });
  r('Полотно основное', f.main || '—');
  r('Полотно отделочное', f.trim || '—');
  r('Цвет', colorsText(doc) || '—', 10);
  r('Поставщик', f.supplier || '—');
  p.y += GAP;
  matrixTable(p, f.matrix, FABRIC_TITLE);
  p.y += GAP;
  gridTable(p, f.grid, 4, FABRIC_TITLE);
  p.y += GAP;
  r('Сборка/швея', '', 8);
  r('Описание модели', f.modelDescription || '—', 20);
  r('Доп. обработки', f.extraProcessing.join('; ') || '—', 14);
}

const FOOTER_Y = PAGE_H - MARGIN - 12;
const FOOTER_TEXT = { x: MARGIN, y: FOOTER_Y, w: CONTENT_W, h: 6 };
const FOOTER_LINK = { x: MARGIN + 82, y: FOOTER_Y + 6, w: CONTENT_W - 82, h: 6 };

/**
 * Поля подвала одинаковы на всех страницах: их текст подбирается один раз
 * (на черновой раскладке), и не влезшее уходит на страницу продолжения
 * ОДИН раз, а не с каждой страницы
 */
function footerTemplates(p: Pager, doc: TzDoc): { text: TzBox; link: TzBox } {
  const draft = newPager(p.measure);
  const text = textIn(draft, FOOTER_TEXT, doc.footer.text, { max: 8, field: 'Подвал ТЗ' });
  const safe = isSafeHttpUrl(doc.footer.link);
  const link = textIn(draft, FOOTER_LINK, doc.footer.link, { max: 8, field: 'Ссылка на заказ', ...(safe ? { link: doc.footer.link } : {}) });
  p.conts.push(...draft.conts);
  return { text, link };
}

/** Поле шаблона подвала без номера страницы (его ставит `add`) */
function copyBox({ page: _page, ...b }: TzBox): Omit<TzBox, 'page'> {
  return { ...b, lines: [...(b.lines ?? [])] };
}

function footers(p: Pager, doc: TzDoc, tpl: { text: TzBox; link: TzBox }): void {
  const pages = p.page;
  for (let page = 1; page <= pages; page += 1) {
    p.page = page;
    add(p, { x: MARGIN, y: FOOTER_Y - 1, w: CONTENT_W, h: 0, kind: 'line' });
    add(p, copyBox(tpl.text));
    textIn(p, { x: MARGIN, y: FOOTER_Y + 6, w: 80, h: 6 }, `${doc.footer.group} · стр. ${page}/${pages}`, { max: 8, field: 'Подвал ТЗ' });
    add(p, copyBox(tpl.link));
  }
  p.page = pages;
}

export function layoutTz(doc: TzDoc, measure: Measure): TzLayout {
  const p = newPager(measure);
  headerPage(p, doc);
  fabricPage(p, doc);
  labelsPages(p, doc);
  printsPages(p, doc);
  notesPages(p, doc);
  const tpl = footerTemplates(p, doc);
  layoutContinuations(p);
  footers(p, doc, tpl);
  return { pages: p.page, boxes: p.boxes.map(({ ...b }) => b) };
}
