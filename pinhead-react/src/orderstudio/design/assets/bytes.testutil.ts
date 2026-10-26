/** Заголовки картинок для тестов `sniff` и `loadAsset` — минимальные, но честные */

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** PNG: сигнатура + IHDR (+ pHYs, если задан dpi) + IEND */
export function pngBytes(width: number, height: number, dpi?: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const ihdr = chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
  const phys = dpi ? chunk('pHYs', [...be32(Math.round(dpi / 0.0254)), ...be32(Math.round(dpi / 0.0254)), 1]) : [];
  return new Uint8Array([...sig, ...ihdr, ...phys, ...chunk('IEND', [])]);
}

export interface JpegMetric {
  /** Плотность JFIF APP0: единица 0 — только пропорция, 1 — точек на дюйм, 2 — на сантиметр */
  jfif?: { units: 0 | 1 | 2; x: number };
  /** EXIF APP1 (IFD0): XResolution и ResolutionUnit (2 — дюйм, 3 — сантиметр) */
  exif?: { x: number; unit: 2 | 3; littleEndian: boolean };
}

const be16 = (n: number) => [(n >> 8) & 255, n & 255];

function exifApp1(e: NonNullable<JpegMetric['exif']>): number[] {
  const u16 = (n: number) => (e.littleEndian ? [n & 255, (n >> 8) & 255] : be16(n));
  const u32 = (n: number) => (e.littleEndian ? [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255] : be32(n));
  // TIFF: заголовок 8 байт, IFD0 с 8: 2 записи + ссылка на следующий IFD = 30 байт, рациональное число с 38
  const tiff = [
    ...(e.littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...u16(2),
    ...u16(0x011a), ...u16(5), ...u32(1), ...u32(38),
    ...u16(0x0128), ...u16(3), ...u32(1), ...u16(e.unit), 0, 0,
    ...u32(0),
    ...u32(e.x), ...u32(1),
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return [0xff, 0xe1, ...be16(body.length + 2), ...body];
}

/** JPEG: SOI + APP0 (+ APP1 EXIF) + SOF0 с размерами */
export function jpegBytes(width: number, height: number, metric: JpegMetric = {}): Uint8Array {
  const d = metric.jfif ?? { units: 0, x: 1 };
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, d.units, ...be16(d.x), ...be16(d.x), 0x00, 0x00];
  const app1 = metric.exif ? exifApp1(metric.exif) : [];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...sof, 0xff, 0xd9]);
}

/** WEBP VP8X: холст ширина-1 / высота-1, 24 бита little-endian */
export function webpBytes(width: number, height: number): Uint8Array {
  const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  const head = [...'RIFF'].map((c) => c.charCodeAt(0));
  const body = [...'WEBPVP8X'].map((c) => c.charCodeAt(0));
  return new Uint8Array([...head, 30, 0, 0, 0, ...body, 10, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
}

export function textBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
