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
 * Ядро — `pdfCore.ts` (вынос вехи 6+7, задача 3, без изменения поведения):
 * шрифты, регистрация, svg2pdf в прямоугольник, вывод Blob. Кириллица —
 * подмножество Liberation Sans; шрифт не доехал — отказ `MSG_FONT`.
 */
import type { SalesItem } from '../../model/types';
import { printMethodProfile } from '../../model/printMethods';
import type { FlatView, GarmentFlat } from '../types';
import { loadFlatMarkup } from '../assets/flatImages';
import type { ResolvedFlat } from './resolveFlat';
import { buildSceneSvg, type SceneMeta } from './buildSceneSvg';
import { MaketPdfError, maketCaption, maketPages, type MaketPage } from './maketPages';
import { logosForPdf, type LogoDeps, type PdfLogos } from './svgForPdf';
import {
  loadPdfFonts, newPdf, pageMm, pdfBlob, sceneElement, svgElementInto, type PdfDoc, type PdfFonts,
} from './pdfCore';

export { MSG_FONT, MSG_SCENE, loadPdfFonts, __resetPdfFontsForTests, type PdfFonts } from './pdfCore';

export const MSG_NO_PLACEMENTS = 'на изделии нет нанесений на холсте';
export const MSG_FLAT = 'силуэт изделия не загрузился — повторите';

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

/** Листы → один PDF: страница на лист, размер страницы = лист в мм */
async function renderPdf(scenes: string[], fonts: PdfFonts): Promise<Blob> {
  const doc = document.implementation.createHTMLDocument('maket');
  let pdf: PdfDoc | null = null;
  for (const markup of scenes) {
    const el = sceneElement(doc, markup);
    const w = pageMm(el, 'width');
    const h = pageMm(el, 'height');
    const orientation = w > h ? 'landscape' : 'portrait';
    if (!pdf) pdf = await newPdf(fonts, [w, h], orientation);
    else pdf.addPage([w, h], orientation);
    await svgElementInto(pdf, doc, el, { x: 0, y: 0, w, h });
  }
  if (!pdf) throw new MaketPdfError(MSG_NO_PLACEMENTS);
  pdf.setProperties({ creator: 'Pinhead' });
  return pdfBlob(pdf);
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
