/**
 * КП в PDF (веха 5в, Э6): A4, позиция за позицией — мокап (если есть силуэт
 * и нанесения), строки нанесений с ценой, тираж и сумма позиции, затем итог
 * со ставками подготовки и скидкой, ориентировочный срок нанесения.
 *
 * Тексты — только текстовым API jsPDF (как ТЗ; не SVG-текстом); знак рубля
 * в шрифте PDF отсутствует — «руб.»; знаки вне набора шрифта (`unsupportedChars`)
 * — отказ с их перечнем, а не пустые квадраты. Мокап — очищенный SVG превью
 * через `svgInto`. Грузится только `import()` по кнопке «Скачать КП».
 */
import { loadPdfFonts, newPdf, pdfBlob, svgInto, type PdfDoc, type PdfFonts } from '../../design/export/pdfCore';
import { PDF_FONT_FAMILY } from '../../design/export/buildSceneSvg';
import { unsupportedChars } from '../model/pdfGlyphs';
import type { KpDoc, KpItem } from '../kp/kpDocument';

/** Отказ, понятный человеку: `kp` — признак для экрана (класс через границу чанка не сверяется) */
export class KpPdfError extends Error {
  readonly kp = true;
}

export interface KpPdfDeps {
  fonts: () => Promise<PdfFonts>;
  /** Мокап позиции — очищенный SVG и пропорция «В/Ш»; нет — `null` */
  mockup: (itemKey: string) => Promise<{ svg: string; aspect: number } | null>;
}

const PAGE_H = 297;
const M = 15;
const W = 210 - 2 * M;
const BOTTOM = PAGE_H - 22;
const MOCKUP_W = 58;

const rub = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('ru-RU')} руб.`);
const days = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'рабочего дня' : 'рабочих дней'}`;

function texts(doc: KpDoc): string[] {
  return [doc.client, doc.title, doc.number, ...doc.items.flatMap((it) => [it.title, ...it.lines.flatMap((l) => [l.zone, l.method, l.size])])];
}

class Writer {
  y = M;
  constructor(readonly pdf: PdfDoc) {}
  font(pt: number, bold = false) {
    this.pdf.setFont(PDF_FONT_FAMILY, bold ? 'bold' : 'normal');
    this.pdf.setFontSize(pt);
  }
  line(text: string, pt = 10, bold = false, x = M, width = W) {
    this.font(pt, bold);
    const lines = this.pdf.splitTextToSize(text, width) as string[];
    for (const l of lines) {
      this.pdf.text(l, x, this.y, { baseline: 'top' });
      this.y += pt * 0.42;
    }
    this.y += 1.2;
  }
  ensure(h: number) {
    if (this.y + h <= BOTTOM) return;
    this.pdf.addPage('a4', 'portrait');
    this.y = M;
  }
}

async function drawItem(w: Writer, it: KpItem, n: number, deps: KpPdfDeps): Promise<void> {
  const mock = await deps.mockup(it.key);
  const mockH = mock ? Math.min(78, MOCKUP_W * mock.aspect) : 0;
  const tableH = 8 + it.lines.length * 5.2;
  w.ensure(12 + Math.max(mockH, tableH) + 14);
  w.line(`${n}. ${it.title}`, 12, true);
  const top = w.y;
  const tx = mock ? M + MOCKUP_W + 6 : M;
  const tw = W - (tx - M);
  if (mock) await svgInto(w.pdf, document.implementation.createHTMLDocument('kp'), mock.svg, { x: M, y: top, w: MOCKUP_W, h: mockH });
  const cols = [0, 8, tw * 0.36, tw * 0.62, tw * 0.84];
  w.font(9, true);
  ['№', 'Зона', 'Техника', 'Размер', 'Цена/шт'].forEach((h, i) => w.pdf.text(h, tx + cols[i], top, { baseline: 'top' }));
  let y = top + 5.5;
  w.font(9);
  for (const l of it.lines) {
    const cells = [String(l.n), l.zone, l.method, l.size, rub(l.unit)];
    cells.forEach((c, i) => {
      const width = (cols[i + 1] ?? tw) - cols[i] - 1.5;
      const one = (w.pdf.splitTextToSize(c, width) as string[])[0] ?? '';
      w.pdf.text(one, tx + cols[i], y, { baseline: 'top' });
    });
    y += 5.2;
  }
  if (it.lines.length === 0) { w.pdf.text('Без нанесений', tx, y, { baseline: 'top' }); y += 5.2; }
  w.y = Math.max(top + mockH, y) + 3;
  const lead = it.leadDays === null ? '' : ` · нанесение: до ${days(it.leadDays)}`;
  w.line(`Тираж ${it.qty} шт · ${rub(it.unit)} за шт${it.manual ? ' (цена согласована)' : ''} · Сумма ${rub(it.total)}${lead}`, 10, true);
  w.y += 3;
}

export async function buildKpPdf(doc: KpDoc, deps: Partial<KpPdfDeps> = {}): Promise<Blob> {
  const bad = [...new Set(texts(doc).flatMap(unsupportedChars))];
  if (bad.length) throw new KpPdfError(`в тексте есть знаки, которых нет в шрифте PDF: ${bad.join(' ')} — замените их в заказе`);
  const fonts = await (deps.fonts ?? loadPdfFonts)();
  const pdf = await newPdf(fonts, 'a4', 'portrait');
  const w = new Writer(pdf);
  const full: KpPdfDeps = { fonts: deps.fonts ?? loadPdfFonts, mockup: deps.mockup ?? (async () => null) };
  w.line('Коммерческое предложение', 18, true);
  w.line(`№ ${doc.number} от ${doc.date}`, 11);
  if (doc.client) w.line(`Клиент: ${doc.client}`, 11);
  if (doc.title) w.line(doc.title, 11);
  w.y += 4;
  for (const [i, it] of doc.items.entries()) await drawItem(w, it, i + 1, full);
  w.ensure(40);
  w.line(`Сумма позиций: ${rub(doc.subtotal)}`, 11);
  if (doc.prep) w.line(`Подготовка (формы, программы): ${rub(doc.prep)}`, 11);
  if (doc.discount) w.line(`Скидка: −${rub(doc.discount)}`, 11);
  w.line(`Итого: ${rub(doc.total)}`, 14, true);
  if (doc.leadDays !== null) w.line(`Срок нанесения — ориентировочно до ${days(doc.leadDays)} с момента оплаты и согласования макета.`, 10);
  if (doc.incomplete) w.line('Часть позиций без расчёта — цена уточняется.', 10);
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont(PDF_FONT_FAMILY, 'normal');
    pdf.setFontSize(8);
    pdf.text(`КП ${doc.number} · стр. ${p} из ${pages}`, M, PAGE_H - 10, { baseline: 'top' });
  }
  pdf.setProperties({ creator: 'Pinhead', title: `КП ${doc.number}` });
  return pdfBlob(pdf);
}
