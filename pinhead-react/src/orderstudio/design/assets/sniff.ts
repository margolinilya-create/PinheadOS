/**
 * Тип файла макета — по содержимому, а не по расширению и не по `File.type`
 * (решение 10 плана; проверка безопасности H2, M2).
 *
 * - сигнатуры PNG, JPEG, WEBP (RIFF…WEBP), `%PDF` (PDF и AI, совместимый с PDF);
 * - SVG — текст, у которого после BOM, пробелов и пролога (`<?xml…?>`,
 *   комментарии, `<!DOCTYPE svg…>`) идёт корень `<svg`;
 * - расширение обязано совпасть с содержимым, иначе отказ;
 * - размеры растра — из заголовка (PNG IHDR, JPEG SOF, WEBP VP8/VP8L/VP8X):
 *   сторона больше 12 000 px или площадь больше 80 Мп — отказ (бомба);
 * - PSD, TIFF, EPS на холст не идут (в бакет их можно положить, как раньше).
 */
import { MAX_PX_AREA, MAX_PX_SIDE } from '../limits';

export type ArtworkKind = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf';

export type SniffResult =
  | { ok: true; kind: ArtworkKind; width?: number; height?: number }
  | { ok: false; error: string };

export const MSG_FORMAT = 'Этот формат нельзя поставить на изделие — сохраните в PNG, SVG или PDF. Приложить файл можно на вкладке «Изделие»';
export const MSG_AI = 'Пересохраните в Illustrator с флажком «Создать PDF-совместимый файл» или в PDF/PNG';
export const MSG_MISMATCH = 'Содержимое файла не совпадает с расширением — сохраните его заново в PNG, SVG или PDF';
export const MSG_TOO_BIG = 'Картинка слишком большая: не больше 12 000 px по стороне и 80 Мп — уменьшите её';
export const MSG_BROKEN = 'Файл повреждён: не удалось прочитать размер картинки';

const EXT_KIND: Record<string, ArtworkKind | 'ai'> = {
  png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', svg: 'svg', pdf: 'pdf', ai: 'ai',
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

/** Вид содержимого по сигнатуре байт (без сверки с расширением) — общий для холста и запуска (К12) */
export function contentKind(b: Uint8Array): ArtworkKind | null {
  if (startsWith(b, PNG_SIG)) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart();
  return stripProlog(head).startsWith('<svg') ? 'svg' : null;
}

/** Пролог XML перед корнем: `<?xml…?>`, комментарии (`<!-- Generator: … -->` из Illustrator), `<!DOCTYPE svg…>` */
const PROLOG_ITEM = /^(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b[^[>]*(?:\[[\s\S]*?\])?\s*>)\s*/i;

/** Снять пролог: SVG узнаётся и с комментарием, и с DOCTYPE (его потом отклонит санитайзер с подсказкой) */
function stripProlog(head: string): string {
  let rest = head;
  for (let i = 0; i < 32; i++) {
    const m = PROLOG_ITEM.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = u16be(b, i + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return null;
}

const SIZERS: Partial<Record<ArtworkKind, (b: Uint8Array) => { width: number; height: number } | null>> = {
  png: pngSize, jpeg: jpegSize, webp: webpSize,
};

/** Размеры растра из заголовка: проходит ли проверку на бомбу */
export function rasterSizeOk(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_PX_SIDE && height <= MAX_PX_SIDE && width * height <= MAX_PX_AREA;
}

/** Определить тип макета по байтам и сверить с расширением имени файла */
export function sniffArtwork(bytes: Uint8Array, fileName: string): SniffResult {
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
  const expected = EXT_KIND[ext];
  const kind = contentKind(bytes);
  if (!expected) return { ok: false, error: MSG_FORMAT };
  if (expected === 'ai') return kind === 'pdf' ? { ok: true, kind: 'pdf' } : { ok: false, error: MSG_AI };
  if (kind !== expected) return { ok: false, error: kind ? MSG_MISMATCH : MSG_FORMAT };
  const sizer = SIZERS[kind];
  if (!sizer) return { ok: true, kind };
  const size = sizer(bytes);
  if (!size) return { ok: false, error: MSG_BROKEN };
  if (!rasterSizeOk(size.width, size.height)) return { ok: false, error: MSG_TOO_BIG };
  return { ok: true, kind, ...size };
}

/** MIME по типу содержимого — для нового Blob (H2: тип не берётся из ответа) */
export const ARTWORK_MIME: Record<ArtworkKind, string> = {
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};
