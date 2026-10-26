import { describe, it, expect } from 'vitest';
import { DEFAULT_RASTER_WIDTH_MM, loadAsset, parseSvgSizeMm, readJpegDpi, readPngDpi } from './loadAsset';
import { MSG_MISMATCH } from './sniff';
import { jpegBytes, pngBytes, textBytes } from './bytes.testutil';
import { MSG_DOCTYPE } from './sanitizeSvg';

const blob = (b: Uint8Array, type = '') => new Blob([b as BlobPart], { type });

async function blobText(b: Blob): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()));
}

describe('parseSvgSizeMm (тесты DM)', () => {
  it('width/height в мм — достоверный размер', () => {
    expect(parseSvgSizeMm('<svg width="210mm" height="297mm"></svg>')).toEqual({ w: 210, h: 297, estimated: false });
  });

  it('width/height в cm/pt — достоверный размер с пересчётом', () => {
    const r = parseSvgSizeMm('<svg width="21cm" height="720pt"></svg>');
    expect(r?.w).toBeCloseTo(210, 3);
    expect(r?.h).toBeCloseTo(254.0, 1);
    expect(r?.estimated).toBe(false);
  });

  it('width/height с единицами важнее viewBox', () => {
    expect(parseSvgSizeMm('<svg width="100mm" height="50mm" viewBox="0 0 600 300"></svg>')).toEqual({ w: 100, h: 50, estimated: false });
  });

  it('без единиц = px → 96 dpi, но оценка', () => {
    const r = parseSvgSizeMm('<svg width="600" height="300"></svg>');
    expect(r?.w).toBeCloseTo(600 * 0.2645833, 3);
    expect(r?.estimated).toBe(true);
  });

  it('viewBox-only → 1 ед. = 1 мм, оценка', () => {
    expect(parseSvgSizeMm('<svg viewBox="0 0 600 760"></svg>')).toEqual({ w: 600, h: 760, estimated: true });
  });

  it('width/height в дюймах — достоверный размер', () => {
    expect(parseSvgSizeMm('<svg width="2in" height="1in"></svg>')).toEqual({ w: 50.8, h: 25.4, estimated: false });
  });

  it('нет метрик → null', () => {
    expect(parseSvgSizeMm('<svg><rect/></svg>')).toBeNull();
    expect(parseSvgSizeMm('<svg width="100%" height="100%"></svg>')).toBeNull();
  });
});

describe('readPngDpi', () => {
  it('pHYs в пикселях на метр → dpi', () => {
    expect(readPngDpi(pngBytes(10, 10, 300))).toBeCloseTo(300, 0);
  });
  it('нет pHYs или не PNG → null', () => {
    expect(readPngDpi(pngBytes(10, 10))).toBeNull();
    expect(readPngDpi(jpegBytes(10, 10))).toBeNull();
  });
});

describe('readJpegDpi', () => {
  it('JFIF в точках на дюйм', () => {
    expect(readJpegDpi(jpegBytes(10, 10, { jfif: { units: 1, x: 300 } }))).toBe(300);
  });
  it('JFIF в точках на сантиметр — пересчёт в дюймы', () => {
    expect(readJpegDpi(jpegBytes(10, 10, { jfif: { units: 2, x: 118 } }))).toBeCloseTo(299.72, 1);
  });
  it('JFIF только с пропорцией (единица 0) — метрики нет', () => {
    expect(readJpegDpi(jpegBytes(10, 10, { jfif: { units: 0, x: 72 } }))).toBeNull();
  });
  it('EXIF важнее JFIF, оба порядка байт', () => {
    expect(readJpegDpi(jpegBytes(10, 10, { jfif: { units: 1, x: 72 }, exif: { x: 300, unit: 2, littleEndian: true } }))).toBe(300);
    expect(readJpegDpi(jpegBytes(10, 10, { exif: { x: 300, unit: 2, littleEndian: false } }))).toBe(300);
    expect(readJpegDpi(jpegBytes(10, 10, { exif: { x: 118, unit: 3, littleEndian: true } }))).toBeCloseTo(299.72, 1);
  });
  it('не JPEG, обрезанный и мусорный файл — null без исключения', () => {
    expect(readJpegDpi(pngBytes(10, 10, 300))).toBeNull();
    const cut = jpegBytes(10, 10, { exif: { x: 300, unit: 2, littleEndian: true } }).slice(0, 40);
    expect(readJpegDpi(cut)).toBeNull();
    expect(readJpegDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]))).toBeNull();
  });
});

describe('loadAsset', () => {
  it('PNG с pHYs: размер из DPI, достоверно; Blob — image/png по сигнатуре, а не по File.type', async () => {
    const r = await loadAsset(blob(pngBytes(1181, 591, 300), 'text/html'), 'logo.png');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.asset.meta).toMatchObject({ type: 'png', px_w: 1181, px_h: 591, size_estimated: false, has_preview: false });
    expect(r.asset.meta.intrinsic_w_mm).toBeCloseTo(100, 0);
    expect(r.asset.meta.dpi).toBeCloseTo(300, 0);
    expect(r.asset.blob.type).toBe('image/png');
  });

  it('JPEG без метрики: ширина 120 мм по пропорции, оценка; тип растра — png', async () => {
    const r = await loadAsset(blob(jpegBytes(800, 400)), 'photo.jpg');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.kind).toBe('jpeg');
    expect(r.asset.meta).toMatchObject({ type: 'png', intrinsic_w_mm: DEFAULT_RASTER_WIDTH_MM, intrinsic_h_mm: 60, size_estimated: true });
    expect(r.asset.meta.dpi).toBeUndefined();
    expect(r.asset.blob.type).toBe('image/jpeg');
  });

  it('JPEG с DPI в JFIF: размер из DPI, достоверно', async () => {
    const r = await loadAsset(blob(jpegBytes(1200, 600, { jfif: { units: 1, x: 300 } })), 'photo.jpg');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta).toMatchObject({ px_w: 1200, px_h: 600, size_estimated: false, dpi: 300 });
    expect(r.asset.meta.intrinsic_w_mm).toBeCloseTo(101.6, 1);
  });

  it('SVG: Blob из очищенного текста, вредное вырезано и названо', async () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>';
    const r = await loadAsset(blob(textBytes(evil)), 'logo.svg');
    if (r.status !== 'ok') throw new Error(r.status);
    const text = await blobText(r.asset.blob);
    expect(text).not.toMatch(/script|onload|alert/);
    expect(r.asset.blob.type).toBe('image/svg+xml');
    expect(r.asset.removed.length).toBe(2);
    expect(r.asset.meta).toMatchObject({ type: 'svg', intrinsic_w_mm: 50, intrinsic_h_mm: 20, size_estimated: false });
  });

  it('странный pHYs (ppu = 1 → 0,0254 DPI) — как без метрики: оценка 120 мм, без dpi, раскладка проходит разбор', async () => {
    const r = await loadAsset(blob(pngBytes(1000, 500, 0.0254)), 'odd.png');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta).toMatchObject({ intrinsic_w_mm: DEFAULT_RASTER_WIDTH_MM, intrinsic_h_mm: 60, size_estimated: true });
    expect(r.asset.meta.dpi).toBeUndefined();
  });

  it('pHYs > 10000 DPI — как без метрики', async () => {
    const r = await loadAsset(blob(pngBytes(1000, 500, 20000)), 'odd.png');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta.size_estimated).toBe(true);
    expect(r.asset.meta.dpi).toBeUndefined();
  });

  it('очень вытянутый растр без метрики — размер ужат в 5000 мм с пропорцией', async () => {
    const r = await loadAsset(blob(jpegBytes(10, 1000)), 'strip.jpg');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta.intrinsic_h_mm).toBe(5000);
    expect(r.asset.meta.intrinsic_w_mm).toBeCloseTo(50, 5);
  });

  it('SVG с размером больше 5 м — оценка 120 мм', async () => {
    const r = await loadAsset(blob(textBytes('<svg xmlns="http://www.w3.org/2000/svg" width="9000mm" height="10mm"/>')), 'a.svg');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta).toMatchObject({ intrinsic_w_mm: 120, size_estimated: true });
  });

  it('SVG без метрик — 120×120 оценочно', async () => {
    const r = await loadAsset(blob(textBytes('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')), 'a.svg');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta).toMatchObject({ intrinsic_w_mm: 120, intrinsic_h_mm: 120, size_estimated: true });
  });

  it('SVG с DOCTYPE — отказ с текстом', async () => {
    const r = await loadAsset(blob(textBytes('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>')), 'a.svg');
    expect(r).toEqual({ status: 'error', error: MSG_DOCTYPE });
  });

  it('PDF и AI — дальше в loadPdf', async () => {
    expect((await loadAsset(blob(textBytes('%PDF-1.4\n')), 'a.pdf')).status).toBe('pdf');
    expect((await loadAsset(blob(textBytes('%PDF-1.4\n')), 'a.ai')).status).toBe('pdf');
  });

  it('PNG под .svg — отказ, а не холст', async () => {
    expect(await loadAsset(blob(pngBytes(10, 10)), 'a.svg')).toEqual({ status: 'error', error: MSG_MISMATCH });
  });

  it('длинное имя файла обрезано до 255', async () => {
    const r = await loadAsset(blob(pngBytes(10, 10)), `${'я'.repeat(300)}.png`);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.asset.meta.source_file.length).toBe(255);
  });
});
