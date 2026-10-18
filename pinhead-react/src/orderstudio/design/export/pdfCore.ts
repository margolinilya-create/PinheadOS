/**
 * Общее ядро PDF (веха 6+7, задача 3; К5): шрифты, регистрация, svg2pdf
 * в прямоугольник, растр, вывод. **Единственный файл с импортами `jspdf`
 * и `svg2pdf.js`** (сторож `pdfGuards.test.ts`).
 *
 * Статически ядро импортируют ровно два движка — PDF макета
 * (`design/export/exportPdf.ts`) и PDF ТЗ (`tz/pdf/*`); сами движки грузятся
 * только `import()` из своих загрузчиков, поэтому jsPDF и svg2pdf живут
 * в ленивом чанке `vendor-pdf`.
 *
 * Безопасность (H1, L6 вехи 5а; К4):
 * - SVG собирается `DOMParser` + `importNode` в отдельном документе
 *   (`createHTMLDocument()`), не HTML-строкой; скрипты там не исполняются;
 * - svg2pdf: внешние таблицы стилей не грузятся, картинки — только
 *   `data:image/(png|svg+xml);base64,`;
 * - jsPDF: вывод — только `output('blob')` (`pdfBlob`).
 *
 * Кириллица — подмножество Liberation Sans (`fonts/`, OFL) через `?url`.
 * Шрифт не доехал — отказ (`MSG_FONT`): PDF без кириллицы в производство
 * не уходит. Тот же шрифт регистрируется и в браузере (`FontFace` из байтов):
 * svg2pdf меряет ширину текста шрифтом браузера.
 */
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import regularFontUrl from './fonts/LiberationSans-Regular.subset.ttf?url';
import boldFontUrl from './fonts/LiberationSans-Bold.subset.ttf?url';
import { PDF_FONT_FAMILY } from './buildSceneSvg';
import { MaketPdfError } from './maketPages';
import { bytesToBase64 } from './svgForPdf';

export type { jsPDF as PdfDoc } from 'jspdf';

export const MSG_FONT = 'шрифт для PDF не загрузился — проверьте связь и повторите';
export const MSG_SCENE = 'лист макета не собрался — сообщите администратору';

/** Предел стороны страницы PDF (200 дюймов — предел просмотрщиков), мм */
const MAX_PAGE_MM = 5080;
/** Картинки сцены — только встроенные PNG и SVG (как `safeImageHref` сцены) */
const SCENE_IMAGES = /^data:image\/(png|svg\+xml);base64,/;
const REGULAR_FILE = 'PHMaketSans-Regular.ttf';
const BOLD_FILE = 'PHMaketSans-Bold.ttf';

export interface PdfFonts {
  /** TTF байтами: jsPDF берёт их base64, браузер — `FontFace` */
  regular: Uint8Array;
  bold: Uint8Array;
}

export interface Box { x: number; y: number; w: number; h: number }

// ── Шрифты ───────────────────────────────────────────────────────────────

let fontsOnce: Promise<PdfFonts> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Шрифты PDF — один раз за жизнь вкладки; сбой не кэшируется (повтор качает
 * заново). Отказ — `MaketPdfError(MSG_FONT)`; движок ТЗ переводит его в свой
 */
export function loadPdfFonts(): Promise<PdfFonts> {
  if (!fontsOnce) {
    fontsOnce = Promise.all([fetchBytes(regularFontUrl), fetchBytes(boldFontUrl)])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((e: unknown) => {
        fontsOnce = null;
        console.error('exportPdf: шрифт', e);
        throw new MaketPdfError(MSG_FONT);
      });
  }
  return fontsOnce;
}

function registerFonts(pdf: jsPDF, fonts: PdfFonts): void {
  pdf.addFileToVFS(REGULAR_FILE, bytesToBase64(fonts.regular));
  pdf.addFont(REGULAR_FILE, PDF_FONT_FAMILY, 'normal');
  pdf.addFileToVFS(BOLD_FILE, bytesToBase64(fonts.bold));
  pdf.addFont(BOLD_FILE, PDF_FONT_FAMILY, 'bold');
  pdf.setFont(PDF_FONT_FAMILY, 'normal');
}

let measureFonts: Promise<void> | null = null;

/**
 * Шрифт PDF — и браузеру, для замера ширины текста svg2pdf (выравнивание по
 * правому краю и центру). Из байтов, без сети; нет `FontFace` — без замера
 * своим шрифтом (выравнивание приблизительное), PDF всё равно собирается
 */
export function ensureMeasureFonts(fonts: PdfFonts): Promise<void> {
  if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve();
  if (!measureFonts) {
    const faces = [
      new FontFace(PDF_FONT_FAMILY, fonts.regular.slice().buffer, { weight: '400' }),
      new FontFace(PDF_FONT_FAMILY, fonts.bold.slice().buffer, { weight: '700' }),
    ];
    measureFonts = Promise.all(faces.map((f) => f.load()))
      .then((loaded) => { loaded.forEach((f) => document.fonts.add(f)); })
      .catch((e: unknown) => { console.error('exportPdf: замер шрифта', e); });
  }
  return measureFonts;
}

// ── Документ ─────────────────────────────────────────────────────────────

/** Новый PDF в мм со шрифтами PDF (кириллица); шрифт браузера для замера — тоже */
export async function newPdf(
  fonts: PdfFonts,
  format: 'a4' | [number, number],
  orientation: 'portrait' | 'landscape' = 'portrait',
): Promise<jsPDF> {
  await ensureMeasureFonts(fonts);
  const pdf = new jsPDF({ orientation, unit: 'mm', format, compress: true, putOnlyUsedFonts: true });
  registerFonts(pdf, fonts);
  return pdf;
}

/** Сторона листа из `width="628mm"`; иначе отказ (сцена битая) */
export function pageMm(el: Element, attr: 'width' | 'height'): number {
  const m = /^(\d+(?:\.\d+)?)mm$/.exec(el.getAttribute(attr) ?? '');
  const v = m ? parseFloat(m[1]) : NaN;
  if (!(v > 0 && v <= MAX_PAGE_MM)) throw new MaketPdfError(MSG_SCENE);
  return v;
}

/** Сцена → узел в отдельном документе (`DOMParser` + `importNode`, не HTML-строкой) */
export function sceneElement(doc: Document, markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) throw new MaketPdfError(MSG_SCENE);
  return doc.importNode(parsed.documentElement, true);
}

/** Узел SVG (из `sceneElement`) → svg2pdf в прямоугольник листа, мм */
export async function svgElementInto(pdf: jsPDF, doc: Document, el: Element, box: Box): Promise<void> {
  doc.body.appendChild(el);
  try {
    await svg2pdf(el, pdf, { x: box.x, y: box.y, width: box.w, height: box.h, loadExternalStyleSheets: false, loadImages: SCENE_IMAGES });
  } finally {
    el.remove();
  }
}

/** Очищенная разметка SVG → в прямоугольник листа (svg2pdf), мм */
export async function svgInto(pdf: jsPDF, doc: Document, markup: string, box: Box): Promise<void> {
  await svgElementInto(pdf, doc, sceneElement(doc, markup), box);
}

export interface RasterImage {
  bytes: Uint8Array;
  kind: 'jpeg' | 'png';
  /** Ключ кэша jsPDF: повтор того же алиаса не встраивает картинку второй раз */
  alias: string;
}

/** Растр JPEG/PNG (тип уже проверен по сигнатуре) → в прямоугольник листа, мм */
export function addRaster(pdf: jsPDF, img: RasterImage, box: Box): void {
  pdf.addImage(img.bytes, img.kind === 'jpeg' ? 'JPEG' : 'PNG', box.x, box.y, box.w, box.h, img.alias, 'NONE');
}

/** Единственный вывод PDF — Blob (никаких окон, blob-URL и data-URL) */
export function pdfBlob(pdf: jsPDF): Blob {
  return pdf.output('blob');
}

/** Только для тестов: забыть шрифты */
export function __resetPdfFontsForTests(): void {
  fontsOnce = null;
  measureFonts = null;
}
