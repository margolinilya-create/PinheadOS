/**
 * Рисование раскладки ТЗ (веха 6+7, задача 3; К4): прямоугольники `layoutTz`
 * → страницы A4 jsPDF.
 *
 * - **Тексты — только текстовым API jsPDF** (`text`, `textWithLink`): тексты
 *   справочников и заказа не попадают в SVG-строку (правило вехи 4, К4);
 * - ячейки, линии, галочки — `rect` и `line`; галочка рисуется линиями —
 *   глифа ✓ в шрифте нет (К10);
 * - ссылка кликабельна только после `isSafeHttpUrl` (сторож `pdfGuards`),
 *   прочее печатается текстом;
 * - картинки и мокапы рисует `tzImages` (`TzVisual` по номеру прямоугольника):
 *   растр — `addRaster`, SVG — `svgInto` (только очищенный).
 *
 * Ширина текста для раскладки — `fontMeasure`: метрики жирного начертания
 * шрифта PDF (оно шире обычного — обычный текст в поле влезет тем более).
 */
import type { Box, PdfDoc } from '../../design/export/pdfCore';
import { PDF_FONT_FAMILY } from '../../design/export/buildSceneSvg';
import { LINE_GAP, type TzBox, type TzLayout } from '../model/layoutPager';
import { PT_MM, lineHeightMm, type Measure } from '../model/fitText';
import { charName, unsupportedChars } from '../model/pdfGlyphs';
import { isSafeHttpUrl } from '../model/safeUrl';
import { TzPdfError } from './tzPdfError';

/** Отступ текста от рамки ячейки, мм */
const CELL_PAD = 0.6;
const INK = 20;
const RULE = 160;
const LINE_W = 0.25;

/** Картинка или мокап прямоугольника: растр JPEG/PNG или очищенный SVG */
export type TzVisual =
  | { kind: 'raster'; bytes: Uint8Array; type: 'jpeg' | 'png'; alias: string; w: number; h: number }
  | { kind: 'svg'; markup: string };

export interface DrawOps {
  /** Растр в прямоугольник (`pdfCore.addRaster`) */
  raster: (v: Extract<TzVisual, { kind: 'raster' }>, box: Box) => void;
  /** Очищенный SVG в прямоугольник (`pdfCore.svgInto`) */
  svg: (markup: string, box: Box) => Promise<void>;
}

/** Ширина строки шрифтом PDF (жирным), мм */
export function fontMeasure(pdf: PdfDoc): Measure {
  return (s, pt) => pdf.getStringUnitWidth(s, { fontName: PDF_FONT_FAMILY, fontStyle: 'bold' }) * pt * PT_MM;
}

/** Защита, если чек-лист обошли: знак вне шрифта — отказ с названием знака (К10) */
export function assertGlyphs(layout: TzLayout): void {
  for (const b of layout.boxes) {
    const text = (b.lines ?? []).join('\n');
    const bad = unsupportedChars(text);
    if (bad.length > 0) {
      const sample = text.replace(/\s+/g, ' ').trim().slice(0, 40);
      throw new TzPdfError(`знаки ${bad.map(charName).join(', ')} в тексте «${sample}» не печатаются шрифтом ТЗ — замените их`);
    }
  }
}

function drawText(pdf: PdfDoc, b: TzBox): void {
  const lines = b.lines ?? [];
  if (lines.length === 0 || !b.pt) return;
  const pad = b.kind === 'cell' ? CELL_PAD : 0;
  const lh = lineHeightMm(b.pt, LINE_GAP);
  pdf.setFont(PDF_FONT_FAMILY, b.bold ? 'bold' : 'normal');
  pdf.setFontSize(b.pt);
  pdf.setTextColor(INK);
  lines.forEach((line, i) => {
    const y = b.y + (b.kind === 'cell' ? CELL_PAD / 2 : 0) + i * lh;
    const url = b.link && isSafeHttpUrl(b.link) ? b.link : null;
    if (url) pdf.textWithLink(line, b.x + pad, y, { url, baseline: 'top' });
    else pdf.text(line, b.x + pad, y, { baseline: 'top' });
  });
}

function drawCheck(pdf: PdfDoc, b: TzBox): void {
  const s = Math.min(b.w, b.h, 4);
  const x = b.x + (b.w - s) / 2;
  const y = b.y + (b.h - s) / 2;
  pdf.rect(x, y, s, s);
  if (!b.checked) return;
  pdf.setLineWidth(LINE_W * 2);
  pdf.line(x + s * 0.2, y + s * 0.55, x + s * 0.42, y + s * 0.8);
  pdf.line(x + s * 0.42, y + s * 0.8, x + s * 0.82, y + s * 0.2);
  pdf.setLineWidth(LINE_W);
}

/** Прямоугольник с пропорциями картинки внутри ячейки, по центру */
export function containBox(box: Box, aspect: number): Box {
  const w = Math.min(box.w, box.h * aspect);
  const h = w / aspect;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

async function drawBox(pdf: PdfDoc, b: TzBox, visual: TzVisual | undefined, ops: DrawOps): Promise<void> {
  const box: Box = { x: b.x, y: b.y, w: b.w, h: b.h };
  switch (b.kind) {
    case 'cell':
      pdf.rect(b.x, b.y, b.w, b.h);
      drawText(pdf, b);
      return;
    case 'text':
      drawText(pdf, b);
      return;
    case 'line':
      pdf.line(b.x, b.y, b.x + b.w, b.y + b.h);
      return;
    case 'check':
      drawCheck(pdf, b);
      return;
    case 'image':
    case 'scene':
      if (!visual) throw new TzPdfError('картинка ТЗ не подготовлена — сообщите администратору');
      if (visual.kind === 'raster') ops.raster(visual, containBox(box, visual.w / visual.h));
      else await ops.svg(visual.markup, box);
      return;
  }
}

/**
 * Страницы раскладки — в PDF: `firstPage` — номер страницы PDF, на которую
 * ляжет страница 1 раскладки (у склейки всех ТЗ — после прошлых групп);
 * страницы дальше добавляются A4. `visuals` — по номеру прямоугольника
 */
export async function drawLayout(
  pdf: PdfDoc,
  layout: TzLayout,
  visuals: ReadonlyMap<number, TzVisual>,
  ops: DrawOps,
  firstPage = 1,
): Promise<void> {
  for (let page = 1; page <= layout.pages; page += 1) {
    const target = firstPage + page - 1;
    while (pdf.getNumberOfPages() < target) pdf.addPage('a4', 'portrait');
    pdf.setPage(target);
    pdf.setDrawColor(RULE);
    pdf.setLineWidth(LINE_W);
    for (const [i, b] of layout.boxes.entries()) {
      if (b.page === page) await drawBox(pdf, b, visuals.get(i), ops);
    }
  }
}
