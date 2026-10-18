/**
 * Заготовки тестов движка PDF ТЗ (веха 6+7, задача 3): шрифты с диска,
 * байты картинок, заглушки сети и разметки, разбор PDF pdfjs.
 *
 * jsdom не рисует: svg2pdf меряет растр через `new Image()`, а ширину текста —
 * canvas или `getBBox`; здесь — заглушки (как в `exportPdf.test.ts`).
 */
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TzPdfDeps } from './tzPdf';

const FONTS_DIR = join(process.cwd(), 'src/orderstudio/design/export/fonts');
const fontBytes = (name: string) => new Uint8Array(readFileSync(join(FONTS_DIR, name)));
export const FONTS = { regular: fontBytes('LiberationSans-Regular.subset.ttf'), bold: fontBytes('LiberationSans-Bold.subset.ttf') };

export const FLAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><path id="garment" fill="#ffffff" stroke="#111" d="M10 10H590V750H10Z"/></svg>';
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0h100v50H0z" fill="#e11d48"/></svg>';
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Настоящий PNG 1×1 */
export const PNG_1PX = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
/** Настоящий JPEG 1×1 */
export const JPEG_1PX = b64('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');

/** Байты по расширению пути; `missing` — не скачиваются */
export function filesByExt(missing: string[] = []): (orderId: string, path: string) => Promise<Blob | null> {
  return vi.fn(async (_id: string, path: string) => {
    if (missing.includes(path)) return null;
    if (path.endsWith('.png')) return new Blob([PNG_1PX as BlobPart]);
    if (/\.jpe?g$/.test(path)) return new Blob([JPEG_1PX as BlobPart]);
    if (path.endsWith('.svg')) return new Blob([LOGO_SVG]);
    return null;
  });
}

/** Детерминированный «sha-256» для jsdom (в нём `crypto.subtle` нет): FNV по байтам, 32 байта */
export async function fakeDigest(bytes: Uint8Array): Promise<ArrayBuffer> {
  const out = new Uint8Array(32);
  let h = 0x811c9dc5;
  bytes.forEach((b, i) => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
    out[i % 32] ^= h & 0xff;
  });
  return out.buffer;
}

export function deps(patch: Partial<TzPdfDeps> = {}): Partial<TzPdfDeps> {
  return {
    fonts: async () => FONTS,
    digest: fakeDigest,
    download: filesByExt(),
    flatMarkup: vi.fn(async () => ({ markup: FLAT_SVG, flatMm: { w: 600, h: 760 }, removed: [] })),
    rasterizer: { bitmap: vi.fn(async () => null), svg: vi.fn(async () => null) },
    shrink: vi.fn(async () => null),
    ...patch,
  };
}

export function stubLayout(): () => void {
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

export async function pdfPages(blob: Blob): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.destroy();
  return pages;
}

export async function rawPdf(blob: Blob): Promise<string> {
  return new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
}
