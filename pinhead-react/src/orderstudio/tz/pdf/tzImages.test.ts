import { describe, it, expect, vi } from 'vitest';
import { fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import type { TzBox, TzLayout } from '../model/layoutPager';
import { photoPx, prepareVisuals, type TzImageDeps } from './tzImages';
import { TzPdfError } from './tzPdfError';
import { JPEG_1PX, LOGO_SVG, PNG_1PX } from './tzPdf.testutil';

/** PNG-заголовок с размером из IHDR (тело не нужно: тип и размер — по сигнатуре) */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const WEBP = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8X'].map((c) => c.charCodeAt(0)), Array(18).fill(0)));

function deps(files: Record<string, Uint8Array | string>, patch: Partial<TzImageDeps> = {}): TzImageDeps {
  return {
    download: vi.fn(async (_id: string, path: string) => (path in files ? new Blob([files[path] as BlobPart]) : null)),
    flatMarkup: vi.fn(async () => null),
    rasterizer: { bitmap: vi.fn(async () => null), svg: vi.fn(async () => null) },
    shrink: vi.fn(async (_b: Blob, _w: number, _h: number, type: string) => (type === 'image/png' ? PNG_1PX : JPEG_1PX)),
    ...patch,
  };
}

const img = (image: string, role: TzBox['role'], w = 40, h = 20): TzBox => ({ page: 1, x: 10, y: 10, w, h, kind: 'image', image, role });
const layoutOf = (...boxes: TzBox[]): TzLayout => ({ pages: 1, boxes });

function ctx() {
  const { order } = loadFixture('63886');
  return { orderId: order.id, item: order.items[0], catalogs: fixtureCatalogs() };
}

describe('tzImages — фото, превью макета, мокапы', () => {
  it('photoPx: 200 dpi ячейки в пропорциях источника, не больше источника', () => {
    expect(photoPx({ w: 40, h: 20 }, { w: 4000, h: 2000 })).toEqual({ w: 315, h: 157 });
    expect(photoPx({ w: 40, h: 20 }, { w: 10, h: 10 })).toEqual({ w: 10, h: 10 });
  });

  it('растр в пределах 200 dpi — байты как есть, алиас — путь; крупный PNG — ужимается PNG, WEBP — в JPEG', async () => {
    const d = deps({ 'a/small.jpg': JPEG_1PX, 'a/big.png': pngHeader(4000, 2000), 'a/w.webp': WEBP });
    const v = await prepareVisuals(layoutOf(img('a/small.jpg', 'label'), img('a/big.png', 'note'), img('a/w.webp', 'sticker')), ctx(), d);
    expect(v.get(0)).toMatchObject({ kind: 'raster', type: 'jpeg', alias: 'a/small.jpg', bytes: JPEG_1PX });
    expect(v.get(1)).toMatchObject({ kind: 'raster', type: 'png', alias: 'a/big.png', w: 315, h: 157 });
    expect(d.shrink).toHaveBeenCalledWith(expect.any(Blob), 315, 157, 'image/png');
    expect(v.get(2)).toMatchObject({ kind: 'raster', type: 'jpeg', alias: 'a/w.webp' });
  });

  it('один путь — одна загрузка', async () => {
    const d = deps({ 'a/s.jpg': JPEG_1PX });
    await prepareVisuals(layoutOf(img('a/s.jpg', 'label'), img('a/s.jpg', 'scheme')), ctx(), d);
    expect(d.download).toHaveBeenCalledTimes(1);
  });

  it('SVG-фото — только очищенным вектором', async () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" onclick="x()"/></svg>';
    const v = await prepareVisuals(layoutOf(img('a/n.svg', 'note')), ctx(), deps({ 'a/n.svg': evil }));
    const markup = (v.get(0) as { markup: string }).markup;
    expect(markup).toMatch(/^<svg/);
    expect(atob(markup.match(/base64,([^"]+)"/)![1])).not.toMatch(/script|onclick/);
  });

  it('PDF-картинка — PNG-превью рядом; превью нет — отказ словами', async () => {
    const v = await prepareVisuals(layoutOf(img('a/s.pdf', 'sticker')), ctx(), deps({ 'a/s.pdf': '%PDF-1.4', 'a/s.pdf.preview.png': PNG_1PX }));
    expect(v.get(0)).toMatchObject({ kind: 'raster', type: 'png', alias: 'a/s.pdf.preview.png' });
    await expect(prepareVisuals(layoutOf(img('a/s.pdf', 'sticker')), ctx(), deps({ 'a/s.pdf': '%PDF-1.4' }))).rejects.toThrow('у PDF нет превью');
  });

  it('не скачалось, подмена типа или растр не вышел — TzPdfError с названием', async () => {
    await expect(prepareVisuals(layoutOf(img('a/x.jpg', 'label')), ctx(), deps({}))).rejects.toThrow('превью бирки «x.jpg» — файл не загрузился');
    await expect(prepareVisuals(layoutOf(img('a/x.png', 'label')), ctx(), deps({ 'a/x.png': '<html><script/></html>' }))).rejects.toThrow(TzPdfError);
    const failShrink = deps({ 'a/big.png': pngHeader(4000, 2000) }, { shrink: vi.fn(async () => null) });
    await expect(prepareVisuals(layoutOf(img('a/big.png', 'note')), ctx(), failShrink)).rejects.toThrow('не открылась как картинка');
  });

  it('превью макета — логотип на прямоугольнике цвета ткани, SVG через санитайзер', async () => {
    const c = ctx();
    const path = c.item.prints[0].artwork_path;
    const v = await prepareVisuals(layoutOf(img(path, 'artwork', 74, 70)), c, deps({ [path]: PNG_1PX }));
    const markup = (v.get(0) as { markup: string }).markup;
    expect(markup).toMatch(/<rect [^>]*fill="#[0-9a-f]{6}"/i);
    expect(markup).toContain('href="data:image/png;base64,');
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('макет SVG — вектором после санитайзера', async () => {
    const c = ctx();
    const p = { ...c.item.prints[0], artwork_path: 'orders/x/logo/l.svg' };
    const item = { ...c.item, prints: [p] };
    const v = await prepareVisuals(layoutOf(img(p.artwork_path, 'artwork', 74, 70)), { ...c, item }, deps({ [p.artwork_path]: LOGO_SVG }));
    expect((v.get(0) as { markup: string }).markup).toContain('href="data:image/svg+xml;base64,');
  });
});
