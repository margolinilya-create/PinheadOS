import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pngBytes, textBytes } from './bytes.testutil';
import {
  MSG_PDF_BROKEN, MSG_PDF_PAGE, MSG_PDF_TIMEOUT, MSG_PDF_WORKER, PDF_DESTROY_WAIT_MS, PDF_MAX_IMAGE_PX, PDF_TIMEOUT_MS,
  PREVIEW_MAX_PX, __resetPdfWorkerForTests, loadPdf,
} from './loadPdf';
import { MSG_AI } from './sniff';

/** pdfjs в jsdom не работает (нет воркера и canvas) — подменяем API тем, что нужно модулю */
const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerPort: null as unknown },
  AnnotationMode: { DISABLE: 0 },
}));
vi.mock('pdfjs-dist/build/pdf.mjs', () => pdf);
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.min.mjs' }));

class FakeWorker {
  static created: { url: string; opts: unknown }[] = [];
  static instances: FakeWorker[] = [];
  terminated = false;
  constructor(url: string, opts: unknown) {
    FakeWorker.created.push({ url, opts });
    FakeWorker.instances.push(this);
  }
  terminate() { this.terminated = true; }
}

const destroy = vi.fn(() => Promise.resolve());
const render = vi.fn(() => ({ promise: Promise.resolve() }));

/** Документ с первой страницей w×h pt */
function doc(wPt: number, hPt: number) {
  const page = { getViewport: ({ scale }: { scale: number }) => ({ width: wPt * scale, height: hPt * scale }), render };
  return { promise: Promise.resolve({ getPage: vi.fn(async () => page) }), destroy };
}

const PDF = textBytes('%PDF-1.7\n%…');
let ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn> };

beforeEach(() => {
  __resetPdfWorkerForTests();
  FakeWorker.created = [];
  FakeWorker.instances = [];
  pdf.getDocument.mockReset();
  pdf.GlobalWorkerOptions.workerPort = null;
  destroy.mockClear();
  render.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  ctx = { fillStyle: '', fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob([pngBytes(2, 2) as BlobPart], { type: 'image/png' }));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('loadPdf', () => {
  it('A4: размер из MediaBox точно, превью PNG ≤ 2048 px, DPI не пишется', async () => {
    pdf.getDocument.mockReturnValue(doc(595.28, 841.89));
    const res = await loadPdf(PDF, 'Логотип.pdf');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.asset.meta).toMatchObject({ type: 'png', source_file: 'Логотип.pdf', size_estimated: false, has_preview: true });
    expect(res.asset.meta.intrinsic_w_mm).toBeCloseTo(210, 0);
    expect(res.asset.meta.intrinsic_h_mm).toBeCloseTo(297, 0);
    expect(res.asset.meta.px_w).toBeUndefined();
    expect(res.asset.meta.dpi).toBeUndefined();
    expect(res.asset.png.type).toBe('image/png');
    const vp = (render.mock.calls[0] as unknown as [{ viewport: { width: number; height: number }; annotationMode: number }])[0];
    expect(Math.round(Math.max(vp.viewport.width, vp.viewport.height))).toBe(PREVIEW_MAX_PX);
    expect(vp.annotationMode).toBe(0);
    expect(ctx.fillStyle).toBe('#ffffff');
    expect(destroy).toHaveBeenCalled();
  });

  it('маленький логотип — 300 dpi от размера, не растягивается до предела', async () => {
    pdf.getDocument.mockReturnValue(doc(72, 36)); // 25,4 × 12,7 мм
    await loadPdf(PDF, 'a.pdf');
    const vp = (render.mock.calls[0] as unknown as [{ viewport: { width: number } }])[0].viewport;
    expect(Math.round(vp.width)).toBe(300);
  });

  it('безопасные параметры pdfjs (M2, L7): без eval и XFA, предел картинки, копия буфера', async () => {
    pdf.getDocument.mockReturnValue(doc(100, 100));
    await loadPdf(PDF, 'a.pdf');
    const opts = pdf.getDocument.mock.calls[0][0];
    expect(opts).toMatchObject({ isEvalSupported: false, enableXfa: false, maxImageSize: PDF_MAX_IMAGE_PX });
    expect(opts).not.toHaveProperty('cMapUrl');
    expect(opts).not.toHaveProperty('standardFontDataUrl');
    expect(opts.data).not.toBe(PDF);
    expect(Array.from(opts.data as Uint8Array)).toEqual(Array.from(PDF));
  });

  it('воркер — module-воркер из ассета, один на вкладку, явным портом (L5)', async () => {
    pdf.getDocument.mockReturnValue(doc(100, 100));
    await loadPdf(PDF, 'a.pdf');
    await loadPdf(PDF, 'b.pdf');
    expect(FakeWorker.created).toEqual([{ url: '/assets/pdf.worker.min.mjs', opts: { type: 'module' } }]);
    expect(pdf.GlobalWorkerOptions.workerPort).toBeInstanceOf(FakeWorker);
  });

  it('воркер не запустился — ошибка, без «воркера в главном потоке»', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('CSP'); } });
    expect(await loadPdf(PDF, 'a.pdf')).toEqual({ ok: false, error: MSG_PDF_WORKER });
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });

  it('AI без PDF-совместимости — подсказка про флажок', async () => {
    expect(await loadPdf(textBytes('%!PS-Adobe-3.0'), 'logo.ai')).toEqual({ ok: false, error: MSG_AI });
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });

  it('битый PDF — текст ошибки, документ уничтожен', async () => {
    pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure')), destroy });
    expect(await loadPdf(PDF, 'a.pdf')).toEqual({ ok: false, error: MSG_PDF_BROKEN });
    expect(destroy).toHaveBeenCalled();
  });

  it('страница больше 5 м — отказ', async () => {
    pdf.getDocument.mockReturnValue(doc(15000, 100));
    expect(await loadPdf(PDF, 'a.pdf')).toEqual({ ok: false, error: MSG_PDF_PAGE });
  });

  it('PDF-бомба: 30 с — destroy, текст; занятый воркер гасится, следующий файл — на новом', async () => {
    vi.useFakeTimers();
    // Воркер занят бомбой: на destroy не отвечает никогда
    pdf.getDocument.mockReturnValueOnce({ promise: new Promise(() => {}), destroy: vi.fn(() => new Promise(() => {})) });
    const pending = loadPdf(PDF, 'a.pdf');
    await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: MSG_PDF_TIMEOUT });
    expect(pdf.GlobalWorkerOptions.workerPort).toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    pdf.getDocument.mockReturnValue(doc(100, 100));
    expect((await loadPdf(PDF, 'b.pdf')).ok).toBe(true);
    expect(FakeWorker.created).toHaveLength(2);
    expect(pdf.GlobalWorkerOptions.workerPort).toBeInstanceOf(FakeWorker);
  });

  it('getDocument бросает синхронно (порт ещё в destroy) — отказ текстом, не исключение', async () => {
    pdf.getDocument.mockImplementation(() => {
      throw new Error('PDFWorker.fromPort - the worker is being destroyed.');
    });
    await expect(loadPdf(PDF, 'a.pdf')).resolves.toEqual({ ok: false, error: MSG_PDF_BROKEN });
  });

  it('destroy дожидается: следующий PDF не открывается, пока прежний не уничтожен', async () => {
    let release!: () => void;
    const slow = vi.fn(() => new Promise<void>((r) => { release = r; }));
    pdf.getDocument.mockReturnValueOnce({ ...doc(100, 100), destroy: slow }).mockReturnValueOnce(doc(100, 100));
    const a = loadPdf(PDF, 'a.pdf');
    const b = loadPdf(PDF, 'b.pdf');
    let aDone = false;
    void a.then(() => { aDone = true; });
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(aDone).toBe(false);
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
    release();
    expect((await a).ok).toBe(true);
    expect((await b).ok).toBe(true);
    expect(pdf.getDocument).toHaveBeenCalledTimes(2);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it(`воркер не ответил на destroy за ${PDF_DESTROY_WAIT_MS} мс — гасится, следующий файл — на новом`, async () => {
    vi.useFakeTimers();
    pdf.getDocument.mockReturnValueOnce({ ...doc(100, 100), destroy: vi.fn(() => new Promise(() => {})) });
    const pending = loadPdf(PDF, 'a.pdf');
    await vi.advanceTimersByTimeAsync(PDF_DESTROY_WAIT_MS);
    expect((await pending).ok).toBe(true);
    expect(FakeWorker.instances.map((w) => w.terminated)).toEqual([true]);
    pdf.getDocument.mockReturnValue(doc(100, 100));
    await loadPdf(PDF, 'b.pdf');
    expect(FakeWorker.instances.map((w) => w.terminated)).toEqual([true, false]);
  });
});
