import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Placement } from '../types';
import { decodeDataUrlText } from './flatMarkup';
import { jpegBytes, pngBytes, textBytes } from '../assets/bytes.testutil';
import {
  domRasterizer, logosForPdf, planSvgLogo, rasterNote, rasterPx, sizedSvg,
  PDF_RASTER_MAX_PX, PDF_RASTER_MAX_SIDE, type LogoDeps, type PdfRasterizer,
} from './svgForPdf';

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const CLEAN = `<svg ${SVG_NS} viewBox="0 0 100 50" width="100mm" height="50mm"><path d="M0 0h10v10z" fill="#e11d48"/></svg>`;
const EVIL = `<svg ${SVG_NS} viewBox="0 0 100 50" onload="alert(1)"><script>alert(2)</script><path d="M0 0h10v10z"/></svg>`;
/** Inkscape пишет цвет в `style` — санитайзер его режет, вектор вышел бы чёрным */
const STYLED = `<svg ${SVG_NS} viewBox="0 0 100 50"><path style="fill:#e11d48" d="M0 0h10v10z"/></svg>`;

const placement = (patch: Partial<Placement> = {}): Placement => ({
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 0, y_mm: 0, width_mm: 100, height_mm: 50,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf', artwork_path: 'orders/ab/logo/1-logo.svg', stale: false,
  asset: { type: 'svg', source_file: 'logo.svg', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false },
  ...patch,
});

const blobOf = (bytes: Uint8Array, type = 'application/octet-stream') => new Blob([bytes as BlobPart], { type });
const OUT_PNG = pngBytes(4, 2);

function deps(files: Record<string, Uint8Array | null>): LogoDeps & { rasterizer: PdfRasterizer & { bitmap: ReturnType<typeof vi.fn>; svg: ReturnType<typeof vi.fn> } } {
  return {
    download: vi.fn(async (_orderId: string, path: string) => {
      const bytes = files[path];
      return bytes ? blobOf(bytes) : null;
    }),
    rasterizer: {
      bitmap: vi.fn(async () => blobOf(OUT_PNG, 'image/png')),
      svg: vi.fn(async () => blobOf(OUT_PNG, 'image/png')),
    },
  };
}

const pngHref = (bytes: Uint8Array) => `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;

describe('planSvgLogo — вектор или растр', () => {
  it('чистый SVG — вектором (data:image/svg+xml base64 очищенного текста)', () => {
    const plan = planSvgLogo(CLEAN);
    expect(plan.kind).toBe('vector');
    if (plan.kind !== 'vector') return;
    expect(plan.href.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(decodeDataUrlText(plan.href)).toContain('fill="#e11d48"');
  });

  it('вредный SVG — растр; скрипт и onload в вектор не попадают', () => {
    const plan = planSvgLogo(EVIL);
    expect(plan.kind).toBe('raster');
    if (plan.kind !== 'raster') return;
    expect(plan.removed.join(' ')).toMatch(/script/);
    expect(plan.removed.join(' ')).toMatch(/onload/);
  });

  it('растр без вложенных ресурсов рисуется с исходника — цвет из style сохраняется', () => {
    const plan = planSvgLogo(STYLED);
    expect(plan.kind === 'raster' && plan.source).toContain('style="fill:#e11d48"');
  });

  it('цепочка <use>, вложенная картинка, foreignObject — растр с очищенного текста', () => {
    const chain = `<svg ${SVG_NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" style="x:y">`
      + '<g id="a"><path d="M0 0h1v1z"/></g><g id="b"><use href="#a"/><use href="#a"/></g><use href="#b"/></svg>';
    const nested = `<svg ${SVG_NS} viewBox="0 0 10 10"><a><image href="data:image/svg+xml;base64,AAAA" width="1" height="1"/></a></svg>`;
    const html = `<svg ${SVG_NS} viewBox="0 0 10 10"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`;
    for (const text of [chain, nested, html]) {
      const plan = planSvgLogo(text);
      expect(plan.kind).toBe('raster');
      if (plan.kind !== 'raster') continue;
      expect(plan.source).not.toMatch(/<use href="#b"|<image|foreignObject|style=/);
    }
  });

  it('DOCTYPE, битый XML — отказ с текстом', () => {
    expect(planSvgLogo('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>').kind).toBe('error');
    expect(planSvgLogo('<svg').kind).toBe('error');
  });
});

describe('rasterPx — растр в PDF не плотнее 300 dpi от размера печати', () => {
  it('SVG: 100×50 мм → 1181×591 px', () => {
    expect(rasterPx(100, 50, null)).toEqual({ w: 1181, h: 591, resized: true });
  });

  it('крупный растр уменьшается до 300 dpi, мелкий не трогается', () => {
    expect(rasterPx(100, 50, { w: 6000, h: 3000 })).toEqual({ w: 1181, h: 591, resized: true });
    expect(rasterPx(100, 50, { w: 800, h: 400 })).toEqual({ w: 800, h: 400, resized: false });
  });

  it('предел стороны и площади холста', () => {
    const wide = rasterPx(2000, 100, null);
    expect(Math.max(wide.w, wide.h)).toBeLessThanOrEqual(PDF_RASTER_MAX_SIDE);
    const big = rasterPx(420, 420, null);
    expect(big.w * big.h).toBeLessThanOrEqual(PDF_RASTER_MAX_PX);
    expect(big.w).toBeGreaterThan(1);
  });
});

describe('sizedSvg — корень под размер растра', () => {
  it('ширина, высота и растяжение как у <image> сцены; viewBox сохраняется', () => {
    const out = sizedSvg(CLEAN, 1181, 591);
    expect(out).toMatch(/width="1181"/);
    expect(out).toMatch(/height="591"/);
    expect(out).toMatch(/preserveAspectRatio="none"/);
    expect(out).toContain('viewBox="0 0 100 50"');
  });

  it('без viewBox — он выводится из width/height (мм → px), иначе рисунок обрезался бы', () => {
    const out = sizedSvg(`<svg ${SVG_NS} width="100mm" height="50mm"><path d="M0 0h1"/></svg>`, 10, 5);
    expect(out).toMatch(/viewBox="0 0 377\.95\d* 188\.97\d*"/);
  });
});

describe('logosForPdf — картинки нанесений для сцены', () => {
  afterEach(() => vi.restoreAllMocks());

  it('чистый SVG — вектором, растр не строится, пометки нет', async () => {
    const d = deps({ 'orders/ab/logo/1-logo.svg': textBytes(CLEAN) });
    const r = await logosForPdf('ab', [{ n: 1, placement: placement() }], d);
    expect(r.ok && r.logos.images.p1.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(r.ok && r.logos.notes).toEqual({});
    expect(d.rasterizer.svg).not.toHaveBeenCalled();
  });

  it('вредный SVG — растр 300 dpi и пометка «логотип N — растр»', async () => {
    const d = deps({ 'orders/ab/logo/1-logo.svg': textBytes(EVIL) });
    const r = await logosForPdf('ab', [{ n: 2, placement: placement() }], d);
    expect(r.ok && r.logos.images.p1).toBe(pngHref(OUT_PNG));
    expect(r.ok && r.logos.notes).toEqual({ p1: rasterNote(2, false) });
    expect(rasterNote(2, false)).toBe('логотип 2 — растр');
    const [text, w, h] = d.rasterizer.svg.mock.calls[0];
    expect([w, h]).toEqual([1181, 591]);
    expect(text).toMatch(/width="1181"/);
  });

  it('мелкий PNG — как есть, без перекодирования', async () => {
    const png = pngBytes(800, 400);
    const d = deps({ 'orders/ab/logo/1-logo.png': png });
    const p = placement({ artwork_path: 'orders/ab/logo/1-logo.png' });
    const r = await logosForPdf('ab', [{ n: 1, placement: p }], d);
    expect(r.ok && r.logos.images.p1).toBe(pngHref(png));
    expect(d.rasterizer.bitmap).not.toHaveBeenCalled();
  });

  it('крупный PNG уменьшается, JPEG перекодируется в PNG (сцена берёт только PNG и SVG)', async () => {
    const d = deps({ 'orders/ab/logo/big.png': pngBytes(6000, 3000), 'orders/ab/logo/photo.jpg': jpegBytes(400, 200) });
    const r = await logosForPdf('ab', [
      { n: 1, placement: placement({ print_key: 'a', artwork_path: 'orders/ab/logo/big.png' }) },
      { n: 2, placement: placement({ print_key: 'b', artwork_path: 'orders/ab/logo/photo.jpg' }) },
    ], d);
    expect(r.ok && Object.keys(r.logos.images)).toEqual(['a', 'b']);
    const calls = d.rasterizer.bitmap.mock.calls.map(([blob, w, h]) => [(blob as Blob).type, w, h]);
    expect(calls).toEqual([['image/png', 1181, 591], ['image/jpeg', 400, 200]]);
  });

  it('PDF/AI — превью рядом с исходником и пометка «растр из PDF»', async () => {
    const preview = pngBytes(1000, 500);
    const d = deps({ 'orders/ab/logo/1-logo.pdf.preview.png': preview });
    const p = placement({ artwork_path: 'orders/ab/logo/1-logo.pdf', asset: { ...placement().asset, type: 'png', has_preview: true } });
    const r = await logosForPdf('ab', [{ n: 3, placement: p }], d);
    expect(d.download).toHaveBeenCalledWith('ab', 'orders/ab/logo/1-logo.pdf.preview.png');
    expect(r.ok && r.logos.notes).toEqual({ p1: 'логотип 3 — растр из PDF' });
  });

  it('один файл на двух нанесениях скачивается один раз', async () => {
    const d = deps({ 'orders/ab/logo/1-logo.svg': textBytes(CLEAN) });
    await logosForPdf('ab', [
      { n: 1, placement: placement({ print_key: 'a' }) },
      { n: 2, placement: placement({ print_key: 'b', view: 'back' }) },
    ], d);
    expect(d.download).toHaveBeenCalledTimes(1);
  });

  it('отказы называют логотип: не скачался, подмена типа, превью не PNG, PDF без превью, растр не вышел', async () => {
    const svgPath = 'orders/ab/logo/1-logo.svg';
    const fail = async (files: Record<string, Uint8Array | null>, p: Placement, broken = false) => {
      const d = deps(files);
      if (broken) d.rasterizer.svg.mockResolvedValue(null);
      const r = await logosForPdf('ab', [{ n: 4, placement: p }], d);
      return r.ok ? '' : r.error;
    };
    expect(await fail({}, placement())).toBe('логотип 4 не скачался');
    expect(await fail({ [svgPath]: pngBytes(10, 10) }, placement())).toMatch(/^логотип 4: Содержимое файла не совпадает/);
    const pdfAsset = { ...placement().asset, has_preview: true };
    expect(await fail({ 'orders/ab/logo/x.pdf.preview.png': textBytes(CLEAN) }, placement({ artwork_path: 'orders/ab/logo/x.pdf', asset: pdfAsset })))
      .toMatch(/^логотип 4: /);
    expect(await fail({ 'orders/ab/logo/x.pdf': textBytes('%PDF-1.7') }, placement({ artwork_path: 'orders/ab/logo/x.pdf' })))
      .toBe('логотип 4: у PDF нет превью — загрузите файл заново');
    expect(await fail({ [svgPath]: textBytes(EVIL) }, placement(), true)).toBe('логотип 4 не открылся как картинка');
  });

  it('нанесение без файла — отказ, а не пустая картинка', async () => {
    const r = await logosForPdf('ab', [{ n: 1, placement: placement({ artwork_path: '' }) }], deps({}));
    expect(r.ok ? '' : r.error).toBe('логотип 1: нет файла макета');
  });
});

describe('domRasterizer — растр в браузере', () => {
  afterEach(() => vi.restoreAllMocks());

  function stubCanvas() {
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (cb: (b: Blob) => void) => cb(blobOf(OUT_PNG, 'image/png')) };
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => (tag === 'canvas' ? canvas : real(tag))) as typeof document.createElement);
    return { canvas, drawImage };
  }

  it('SVG — через <img> с data:-URL (не blob:), рисуется в заданный размер', async () => {
    const { canvas, drawImage } = stubCanvas();
    const created = vi.spyOn(URL, 'createObjectURL');
    let src = '';
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) { src = v; setTimeout(() => this.onload?.(), 0); }
    });
    const out = await domRasterizer.svg(CLEAN, 30, 20);
    expect(out?.type).toBe('image/png');
    expect(src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(created).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 30, 20);
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    vi.unstubAllGlobals();
  });

  it('SVG не открылся — null', async () => {
    stubCanvas();
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { setTimeout(() => this.onerror?.(), 0); }
    });
    expect(await domRasterizer.svg(CLEAN, 30, 20)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('растр — через createImageBitmap, картинка закрывается', async () => {
    const { drawImage } = stubCanvas();
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 6000, height: 3000, close })));
    const out = await domRasterizer.bitmap(blobOf(pngBytes(6000, 3000), 'image/png'), 1181, 591);
    expect(out?.type).toBe('image/png');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1181, 591);
    expect(close).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
