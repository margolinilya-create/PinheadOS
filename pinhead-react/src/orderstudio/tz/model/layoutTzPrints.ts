/**
 * Раскладка ТЗ: бирки, страницы нанесений и заметки (веха 6+7, задача 2).
 *
 * - Бирки — карточки по три в ряд: вид и вариант, превью, схема притачивания
 *   (название и картинка), комментарий; отметки «размерник / составник бланк».
 * - Нанесение № N — страница на каждое: параметры, мокап вида со всеми
 *   печатями (рисует движок), превью макета, сетка по 3 строки, «После проверки».
 * - Заметки — сетка 2 × 2 карточек на страницу, ссылка кликабельна только
 *   после `isSafeHttpUrl` (`linkSafe`).
 */
import {
  CONTENT_W, GAP, MARGIN, add, ensure, newPage, row, textIn, type Pager,
} from './layoutPager';
import { gridTable } from './layoutGrid';
import type { TzDoc, TzLabel, TzNoteCard, TzPrintPage } from './tzDocTypes';

const LABELS_TITLE = 'Параметры бирок';

function checkRow(p: Pager, x: number, label: string, checked: boolean): void {
  add(p, { x, y: p.y + 1, w: 4, h: 4, kind: 'check', checked });
  textIn(p, { x: x + 6, y: p.y, w: 60, h: 6 }, label, { max: 10, field: label });
}

function labelCard(p: Pager, l: TzLabel, x: number, w: number): void {
  let y = p.y;
  textIn(p, { x, y, w, h: 9 }, [l.kind, l.variant].filter(Boolean).join(' · ') + (l.blank ? ' (бланк)' : ''), { bold: true, max: 10, field: `Бирка «${l.kind}»` });
  y += 10;
  if (l.previews.length > 0) {
    const pw = (w - GAP * (l.previews.length - 1)) / l.previews.length;
    l.previews.forEach((img, i) => add(p, { x: x + i * (pw + GAP), y, w: pw, h: 40, kind: 'image', image: img, role: 'label' }));
    y += 42;
  }
  textIn(p, { x, y, w, h: 9 }, l.scheme ? `Притачивание: ${l.scheme}` : 'Притачивание: —', { kind: 'cell', max: 9, field: `Схема бирки «${l.kind}»` });
  y += 10;
  if (l.schemeImage) {
    add(p, { x, y, w, h: 30, kind: 'image', image: l.schemeImage, role: 'scheme' });
    y += 32;
  }
  textIn(p, { x, y, w, h: 14 }, l.comment || 'Комментарий: —', { kind: 'cell', max: 9, field: `Комментарий бирки «${l.kind}»` });
}

export function labelsPages(p: Pager, doc: TzDoc): void {
  newPage(p, LABELS_TITLE);
  checkRow(p, MARGIN, 'Размерник бланк', doc.labels.sizeBlank);
  checkRow(p, MARGIN + 80, 'Составник бланк', doc.labels.compositionBlank);
  p.y += 8;
  if (doc.labels.none) {
    textIn(p, { x: MARGIN, y: p.y, w: CONTENT_W, h: 7 }, 'Бирок в позиции нет', { max: 10, field: LABELS_TITLE });
    p.y += 8;
    return;
  }
  const w = (CONTENT_W - 2 * 5) / 3;
  const cardH = 9 + 1 + 42 + 10 + 32 + 14;
  for (let i = 0; i < doc.labels.items.length; i += 3) {
    ensure(p, cardH, `${LABELS_TITLE} — продолжение`);
    doc.labels.items.slice(i, i + 3).forEach((l, j) => labelCard(p, l, MARGIN + j * (w + 5), w));
    p.y += cardH + GAP;
  }
}

function printPage(p: Pager, doc: TzDoc, pr: TzPrintPage): void {
  const title = `Нанесение № ${pr.n}`;
  newPage(p, title);
  const r = (label: string, value: string, h?: number) => row(p, label, value, { title, h });
  r('Техника', [pr.methodLabel, pr.effects].filter(Boolean).join(', '));
  r('Ткань', pr.fabric);
  r('Размер макета', pr.sizeText || '—');
  r('Расположение', [pr.zone || '—', pr.rowLabel].join(' · '), 10);
  r('Отступ', [pr.offset, pr.on].filter(Boolean).join(', '), 10);
  r('Цвета Pantone', pr.pantone || '—', 10);
  r('Комментарий', pr.comment || '—', 14);
  if (pr.contractor) r('Подрядчик', pr.contractorDays ? `${pr.contractor}, срок ${pr.contractorDays} дн.` : pr.contractor);
  p.y += GAP;
  ensure(p, 110, `${title} — продолжение`);
  if (pr.mockup) add(p, { x: MARGIN, y: p.y, w: 112, h: 100, kind: 'scene', scene: pr.mockup });
  else textIn(p, { x: MARGIN, y: p.y, w: 112, h: 14 }, 'Мокап не построен: нанесение не размещено на изделии', { kind: 'cell', max: 9, field: title });
  textIn(p, { x: MARGIN + 116, y: p.y, w: CONTENT_W - 116, h: 6 }, 'Превью (макет)', { bold: true, max: 9, field: title });
  if (pr.artworkPath) add(p, { x: MARGIN + 116, y: p.y + 7, w: CONTENT_W - 116, h: 70, kind: 'image', image: pr.artworkPath, role: 'artwork' });
  if (pr.mockup && doc.typicalFlat) {
    textIn(p, { x: MARGIN, y: p.y + 101, w: 112, h: 6 }, 'Мокап по типовому флэту', { max: 8, field: title });
  }
  p.y += 108;
  gridTable(p, pr.grid, 3, title);
  p.y += GAP;
  ensure(p, 8, `${title} — продолжение`);
  textIn(p, { x: MARGIN, y: p.y, w: 40, h: 7 }, 'После проверки', { bold: true, max: 10, field: title });
  add(p, { x: MARGIN + 42, y: p.y + 6, w: CONTENT_W - 42, h: 0, kind: 'line' });
  p.y += 8;
}

export function printsPages(p: Pager, doc: TzDoc): void {
  doc.prints.forEach((pr) => printPage(p, doc, pr));
}

const NOTES_TITLE = 'Заметки к заказу';
const NOTE_W = (CONTENT_W - 6) / 2;
const NOTE_H = 125;

function noteCard(p: Pager, c: TzNoteCard, x: number, y: number): void {
  const field = c.group ? `Заметка «${c.group}»` : 'Заметка';
  let cy = y;
  if (c.group) {
    textIn(p, { x, y: cy, w: NOTE_W, h: 7 }, c.group, { bold: true, max: 10, field });
    cy += 8;
  }
  if (c.image) {
    add(p, { x, y: cy, w: NOTE_W, h: 80, kind: 'image', image: c.image, role: 'note' });
    cy += 82;
  }
  textIn(p, { x, y: cy, w: NOTE_W, h: 14 }, c.caption || '—', { max: 10, field });
  cy += 15;
  if (c.link) textIn(p, { x, y: cy, w: NOTE_W, h: 9 }, c.link, { max: 9, field, ...(c.linkSafe ? { link: c.link } : {}) });
}

export function notesPages(p: Pager, doc: TzDoc): void {
  for (let i = 0; i < doc.notes.length; i += 4) {
    newPage(p, i === 0 ? NOTES_TITLE : `${NOTES_TITLE} — продолжение`);
    doc.notes.slice(i, i + 4).forEach((c, j) => {
      noteCard(p, c, MARGIN + (j % 2) * (NOTE_W + 6), p.y + Math.floor(j / 2) * (NOTE_H + 4));
    });
    p.y += 2 * (NOTE_H + 4);
  }
}
