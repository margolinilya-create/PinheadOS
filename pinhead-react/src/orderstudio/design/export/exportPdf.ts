/**
 * PDF макета (веха 5а, задача 7) — jsPDF 4 + svg2pdf.js, масштаб 1:1 в мм.
 * Перенос DM `lib/export/exportPdf.ts`; сохранение файла — у кнопки
 * (`ui/panel/ExportPdfButton`), здесь только Blob.
 *
 * **Модуль грузится только динамически** (`import()` по клику «Скачать PDF
 * макета»): jsPDF и svg2pdf — ленивый чанк `vendor-pdf`, не в холсте и не
 * в оболочках (страж `bundle-budget`: «PDF макета» = граф этого модуля;
 * `pdfGuards.test.ts`: статического импорта нет).
 *
 * Лист — на каждый вид с размещениями (`maketPages`), сцена — `buildSceneSvg`:
 * шапка заказа (клиент, номер, позиция с цветом, «силуэт типовой», пометки
 * растра), рисунок 1:1, отступ от опоры, плашки Ш×В с номером, легенда, шкала.
 * Логотипы — `svgForPdf` (вектор или растр 300 dpi с пометкой).
 *
 * Безопасность (H1, L6):
 * - сцена уже очищена `sanitizeSvg(scene)`; DOM собирается `DOMParser` +
 *   `importNode` в документе `createHTMLDocument()` — вне страницы и без
 *   разбора HTML-строкой (DM вставлял сцену разметкой); скрипты в таком
 *   документе не исполняются;
 * - svg2pdf: внешние таблицы стилей не грузятся, картинки — только
 *   `data:image/(png|svg+xml);base64,`;
 * - jsPDF: только `output('blob')`.
 *
 * Кириллица — подмножество Liberation Sans (`fonts/`, OFL, ≈ 23 КБ на
 * начертание) через `?url`: хешированный ассет `/assets/`, кэш service worker,
 * качается один раз за жизнь вкладки. Шрифт не доехал — отказ: PDF без
 * кириллицы в производство не уходит.
 *
 * Тот же шрифт регистрируется и в браузере (`FontFace` из байтов, без URL):
 * svg2pdf меряет ширину текста шрифтом браузера (canvas или `getBBox` по имени
 * семейства), и без этого правый край шапки и центр плашек съезжали бы на
 * ширину запасного шрифта.
 */
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import regularFontUrl from './fonts/LiberationSans-Regular.subset.ttf?url';
import boldFontUrl from './fonts/LiberationSans-Bold.subset.ttf?url';
import type { SalesItem } from '../../model/types';
import { printMethodProfile } from '../../model/printMethods';
import type { FlatView, GarmentFlat } from '../types';
import { loadFlatMarkup } from '../assets/flatImages';
import type { ResolvedFlat } from './resolveFlat';
import { buildSceneSvg, PDF_FONT_FAMILY, type SceneMeta } from './buildSceneSvg';
import { MaketPdfError, maketCaption, maketPages, type MaketPage } from './maketPages';
import { bytesToBase64, logosForPdf, type LogoDeps, type PdfLogos } from './svgForPdf';

export const MSG_NO_PLACEMENTS = 'на изделии нет нанесений на холсте';
export const MSG_FLAT = 'силуэт изделия не загрузился — повторите';
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

export interface MaketPdfInput {
  orderId: string;
  item: Pick<SalesItem, 'prints'>;
  flat: GarmentFlat;
  /** Цвет ткани (`garmentHexOf`) — силуэт в цвете позиции */
  garmentHex: string;
  meta: Pick<SceneMeta, 'client' | 'orderNumber' | 'itemTitle' | 'date' | 'statusLabel'>;
}

/** Зависимости — для тестов; по умолчанию сеть, бакеты и браузерный растр */
export interface ExportDeps {
  fonts: () => Promise<PdfFonts>;
  flatMarkup: (view: FlatView) => Promise<ResolvedFlat | null>;
  logos: LogoDeps;
}

// ── Шрифты ───────────────────────────────────────────────────────────────

let fontsOnce: Promise<PdfFonts> | null = null;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Шрифты PDF — один раз за жизнь вкладки; сбой не кэшируется (повтор качает заново) */
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
function ensureMeasureFonts(fonts: PdfFonts): Promise<void> {
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

// ── Листы ────────────────────────────────────────────────────────────────

function sceneOf(page: MaketPage, flat: ResolvedFlat, logos: PdfLogos, input: MaketPdfInput): string {
  const notes = page.entries.flatMap((e) => logos.notes[e.print.key] ?? []);
  return buildSceneSvg({
    view: page.view,
    flatMarkup: flat.markup,
    flatMm: flat.flatMm,
    garmentColor: input.garmentHex,
    placements: page.entries.map((e) => e.placement),
    images: logos.images,
    meta: {
      ...input.meta,
      size: input.flat.base_size.trim() || 'ONE SIZE',
      typicalFlat: input.flat.typical,
      notes,
    },
    profileOf: printMethodProfile,
    legend: page.entries.map((e) => ({ printKey: e.print.key, n: e.n, text: maketCaption(e) })),
  });
}

/** Сторона листа из `width="628mm"`; иначе отказ (сцена битая) */
function pageMm(el: Element, attr: 'width' | 'height'): number {
  const m = /^(\d+(?:\.\d+)?)mm$/.exec(el.getAttribute(attr) ?? '');
  const v = m ? parseFloat(m[1]) : NaN;
  if (!(v > 0 && v <= MAX_PAGE_MM)) throw new MaketPdfError(MSG_SCENE);
  return v;
}

/** Сцена → узел в отдельном документе (`DOMParser` + `importNode`, не HTML-строкой) */
function sceneElement(doc: Document, markup: string): Element {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) throw new MaketPdfError(MSG_SCENE);
  return doc.importNode(parsed.documentElement, true);
}

/** Листы → один PDF: страница на лист, размер страницы = лист в мм */
async function renderPdf(scenes: string[], fonts: PdfFonts): Promise<Blob> {
  await ensureMeasureFonts(fonts);
  const doc = document.implementation.createHTMLDocument('maket');
  let pdf: jsPDF | null = null;
  for (const markup of scenes) {
    const el = sceneElement(doc, markup);
    const w = pageMm(el, 'width');
    const h = pageMm(el, 'height');
    const orientation = w > h ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'mm', format: [w, h], compress: true, putOnlyUsedFonts: true });
      registerFonts(pdf, fonts);
    } else {
      pdf.addPage([w, h], orientation);
    }
    doc.body.appendChild(el);
    try {
      await svg2pdf(el, pdf, { x: 0, y: 0, width: w, height: h, loadExternalStyleSheets: false, loadImages: SCENE_IMAGES });
    } finally {
      el.remove();
    }
  }
  if (!pdf) throw new MaketPdfError(MSG_NO_PLACEMENTS);
  pdf.setProperties({ creator: 'Pinhead' });
  return pdf.output('blob');
}

/**
 * Собрать PDF макета позиции. Отказ, понятный человеку, — `MaketPdfError`
 * (текст продолжает «PDF макета не собран: …»); прочее — сбой библиотеки.
 */
export async function exportMaketPdf(input: MaketPdfInput, deps: Partial<ExportDeps> = {}): Promise<Blob> {
  const pages = maketPages(input.item, input.flat);
  if (pages.length === 0) throw new MaketPdfError(MSG_NO_PLACEMENTS);
  const entries = pages.flatMap((p) => p.entries.map((e) => ({ n: e.n, placement: e.placement })));
  const flatMarkup = deps.flatMarkup ?? loadFlatMarkup;
  const [fonts, logos, flats] = await Promise.all([
    (deps.fonts ?? loadPdfFonts)(),
    logosForPdf(input.orderId, entries, deps.logos),
    Promise.all(pages.map((p) => flatMarkup(p.view))),
  ]);
  if (!logos.ok) throw new MaketPdfError(logos.error);
  const scenes = pages.map((page, i) => {
    const flat = flats[i];
    if (!flat) throw new MaketPdfError(MSG_FLAT);
    return sceneOf(page, flat, logos.logos, input);
  });
  return renderPdf(scenes, fonts);
}

/** Только для тестов: забыть шрифты */
export function __resetPdfFontsForTests(): void {
  fontsOnce = null;
  measureFonts = null;
}
