import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDF_FONT_FAMILY } from './buildSceneSvg';
import { MaketPdfError } from './maketPages';
import { addRaster, newPdf, pageMm, pdfBlob, sceneElement, svgInto, MSG_SCENE } from './pdfCore';

vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));

const FONTS_DIR = join(process.cwd(), 'src/orderstudio/design/export/fonts');
const fontBytes = (name: string) => new Uint8Array(readFileSync(join(FONTS_DIR, name)));
const FONTS = { regular: fontBytes('LiberationSans-Regular.subset.ttf'), bold: fontBytes('LiberationSans-Bold.subset.ttf') };
const JPEG_1PX = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), (c) => c.charCodeAt(0));

const raw = async (blob: Blob) => new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));

describe('pdfCore — общее ядро PDF макета и ТЗ (К5)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('newPdf: A4 в мм, шрифт PDF зарегистрирован в двух начертаниях и выбран', async () => {
    const pdf = await newPdf(FONTS, 'a4');
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210, 2);
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(297, 2);
    expect(pdf.getFontList()[PDF_FONT_FAMILY]).toEqual(expect.arrayContaining(['normal', 'bold']));
    expect(pdf.getFont().fontName).toBe(PDF_FONT_FAMILY);
  });

  it('addRaster: один алиас — картинка встроена один раз', async () => {
    const pdf = await newPdf(FONTS, 'a4');
    addRaster(pdf, { bytes: JPEG_1PX, kind: 'jpeg', alias: 'orders/x/label/a.jpg' }, { x: 10, y: 10, w: 20, h: 20 });
    addRaster(pdf, { bytes: JPEG_1PX, kind: 'jpeg', alias: 'orders/x/label/a.jpg' }, { x: 40, y: 10, w: 20, h: 20 });
    const text = await raw(pdfBlob(pdf));
    expect((text.match(/\/DCTDecode/g) ?? []).length).toBe(1);
  });

  it('pdfBlob — application/pdf с %PDF-', async () => {
    const blob = pdfBlob(await newPdf(FONTS, [100, 50], 'landscape'));
    expect(blob.type).toBe('application/pdf');
    expect((await raw(blob)).startsWith('%PDF-')).toBe(true);
  });

  it('сцена: битый SVG и сторона вне 0…5080 мм — отказ словами', () => {
    const doc = document.implementation.createHTMLDocument('t');
    expect(() => sceneElement(doc, '<svg><g></svg>')).toThrow(MaketPdfError);
    const el = sceneElement(doc, '<svg xmlns="http://www.w3.org/2000/svg" width="6000mm" height="10mm"/>');
    expect(() => pageMm(el, 'width')).toThrow(MSG_SCENE);
    expect(pageMm(el, 'height')).toBe(10);
  });

  it('svgInto: узел рисуется в отдельном документе и убирается после', async () => {
    const pdf = await newPdf(FONTS, 'a4');
    const doc = document.implementation.createHTMLDocument('t');
    await svgInto(pdf, doc, '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10" fill="#e11d48"/></svg>', { x: 0, y: 0, w: 10, h: 10 });
    expect(doc.body.children).toHaveLength(0);
    expect(document.body.querySelector('svg')).toBeNull();
  });
});
