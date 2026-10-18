import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newSalesPrint } from '../../model/factory';
import type { SalesPrint } from '../../model/types';
import { flat as flatFixture } from '../fixtures.testutil';
import type { PrintLayoutV1 } from '../types';
import { textBytes } from '../assets/bytes.testutil';
import { PDF_FONT_FAMILY } from './buildSceneSvg';
import { MaketPdfError } from './maketPages';
import { __resetPdfFontsForTests, exportMaketPdf, loadPdfFonts, MSG_FLAT, MSG_FONT, MSG_NO_PLACEMENTS, type ExportDeps, type MaketPdfInput } from './exportPdf';

/*
 * svg2pdf в Vitest: поле `main` пакета — UMD, а он в jsdom видит `window`
 * и ищет глобальный `jspdf`. Сборка Vite берёт ES-модуль (`module`/`browser`) —
 * его же и здесь: тест проверяет тот код, что уедет в браузер
 */
vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));

const FONTS_DIR = join(process.cwd(), 'src/orderstudio/design/export/fonts');
const fontBytes = (name: string) => new Uint8Array(readFileSync(join(FONTS_DIR, name)));
const FONTS = { regular: fontBytes('LiberationSans-Regular.subset.ttf'), bold: fontBytes('LiberationSans-Bold.subset.ttf') };

const FLAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><path id="garment" fill="#ffffff" stroke="#111" d="M10 10H590V750H10Z"/></svg>';
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0h100v50H0z" fill="#e11d48"/></svg>';
/** Настоящий PNG 1×1 (jsPDF его разбирает) */
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const layout = (patch: Partial<PrintLayoutV1> = {}): Record<string, unknown> => ({
  v: 1, flat_id: 'tshirt-test', flat_version: 1, view: 'front', area_id: 'chest',
  x_mm: 250, y_mm: 167, rotation_deg: 0, flip_h: false, flip_v: false,
  asset: { type: 'svg', source_file: 'logo.svg', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false },
  ...patch,
} as unknown as Record<string, unknown>);

const front = (): SalesPrint => newSalesPrint({
  key: 'f', method: 'dtf', zone: 'Грудь (перед)', width_mm: 100, height_mm: 50,
  artwork_path: 'orders/ab/logo/1-logo.svg', layout: layout(), offset_mm: 75, offset_from: 'neck_seam', offset_dir: 'down',
});
const back = (): SalesPrint => newSalesPrint({
  key: 'b', method: 'silkscreen', zone: 'Спина', width_mm: 100, height_mm: 100, artwork_path: 'orders/ab/logo/2-logo.png',
  layout: layout({ view: 'back', area_id: 'back', y_mm: 150, asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 100, size_estimated: false, has_preview: false } }),
});

function input(prints: SalesPrint[], patch: Partial<MaketPdfInput> = {}): MaketPdfInput {
  return {
    orderId: 'ab',
    item: { prints },
    flat: flatFixture(),
    garmentHex: '#1f2937',
    meta: { client: 'ООО «Ромашка»', orderNumber: 'PH-1234', itemTitle: 'Футболка Regular · Чёрный · 10 шт', date: '17.10.2026', statusLabel: 'Расчёт' },
    ...patch,
  };
}

function deps(files: Record<string, Uint8Array> = {}): Partial<ExportDeps> {
  return {
    fonts: async () => FONTS,
    flatMarkup: async () => ({ markup: FLAT_SVG, flatMm: { w: 600, h: 760 }, removed: [] }),
    logos: {
      download: vi.fn(async (_id: string, path: string) => (files[path] ? new Blob([files[path] as BlobPart]) : null)),
      rasterizer: { bitmap: vi.fn(async () => null), svg: vi.fn(async () => null) },
    },
  };
}

const FILES = { 'orders/ab/logo/1-logo.svg': textBytes(LOGO_SVG), 'orders/ab/logo/2-logo.png': PNG_1PX };

/**
 * jsdom не рисует: svg2pdf меряет растр через `new Image()`, а ширину текста —
 * canvas или `getBBox` (в браузере — шрифтом, который `exportPdf` регистрирует
 * через `FontFace`). Здесь — заглушки: замер приблизительный, текст тот же
 */
function stubLayout() {
  vi.stubGlobal('Image', class {
    width = 1;
    height = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const proto = SVGElement.prototype as unknown as { getBBox?: () => DOMRect };
  const had = 'getBBox' in proto;
  proto.getBBox = function getBBox(this: Element) { return { width: (this.textContent ?? '').length * 8 } as DOMRect; };
  return () => { if (!had) delete proto.getBBox; };
}

async function pdfText(blob: Blob): Promise<{ pages: number; text: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.destroy();
  return { pages: doc.numPages, text: parts.join('\n') };
}

describe('exportMaketPdf — настоящий PDF (jsPDF + svg2pdf, шрифты с диска)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('страница на вид, %PDF, кириллица извлекается текстом, шрифт встроен под своим именем', async () => {
    const unstub = stubLayout();
    const appended = vi.spyOn(document.body, 'appendChild');
    const blob = await exportMaketPdf(input([front(), back()]), deps(FILES)).finally(unstub);
    expect(blob.type).toBe('application/pdf');
    const raw = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain(`/BaseFont /${PDF_FONT_FAMILY}`);
    expect(raw).toContain('/FontFile2');
    expect(raw).not.toMatch(/Liberation/);
    // Сцена рисуется в отдельном документе: в страницу попадает только скрытый
    // замер ширины текста svg2pdf (`textContent`), но не лист с данными заказа
    const sceneInPage = appended.mock.calls.some(([node]) => (node as Element).querySelector?.('[data-order-header]'));
    expect(sceneInPage).toBe(false);
    const { pages, text } = await pdfText(blob);
    expect(pages).toBe(2);
    for (const s of ['PH-1234', 'ООО «Ромашка»', 'Футболка Regular', 'Грудь (перед)', '75 мм от шва горловины', 'Спина', 'Силуэт типовой', 'масштаб 1:1']) {
      expect(text).toContain(s);
    }
  }, 30_000);

  it('нет размещений — отказ словами, сеть не трогается', async () => {
    const d = deps(FILES);
    const run = exportMaketPdf(input([newSalesPrint({ zone: 'Грудь' })]), d);
    await expect(run).rejects.toThrow(MaketPdfError);
    await expect(run).rejects.toThrow(MSG_NO_PLACEMENTS);
    expect(d.logos!.download).not.toHaveBeenCalled();
  });

  it('логотип не скачался или силуэт не загрузился — отказ с причиной', async () => {
    await expect(exportMaketPdf(input([front()]), deps({}))).rejects.toThrow('логотип 1 не скачался');
    const noFlat = { ...deps(FILES), flatMarkup: async () => null };
    await expect(exportMaketPdf(input([front()]), noFlat)).rejects.toThrow(MSG_FLAT);
  });
});

describe('loadPdfFonts — шрифты PDF', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetPdfFontsForTests();
  });

  it('один раз за вкладку; сбой — отказ словами, повтор качает заново', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadPdfFonts()).rejects.toThrow(MSG_FONT);
    const fonts = await loadPdfFonts();
    expect(Array.from(fonts.regular)).toEqual([1, 2, 3]);
    expect(Array.from(fonts.bold)).toEqual([1, 2, 3]);
    await loadPdfFonts();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
