/**
 * Логотип пользователя → метаданные для раскладки и чистый Blob для холста.
 * Перенос DM `lib/catalog/loadAsset.ts` без ветки PDF (её делает `loadPdf`,
 * задача 5) и без чтения в data URL:
 * - тип — по байтам (`sniffArtwork`), не по `File.type` и не по ответу (H2);
 * - SVG — через `sanitizeSvg`, Blob собирается из очищенного текста;
 * - растр — новый Blob с MIME по сигнатуре; размеры — из заголовка (M2),
 *   DPI — из `pHYs` PNG; нет метрики — ширина 120 мм «оценочно».
 */
import type { AssetMeta } from '../types';
import { MAX_COORD_MM, MAX_SOURCE_FILE_LEN } from '../limits';
import { parseViewBox } from '../catalog/svgMeta';
import { sanitizeSvg } from './sanitizeSvg';
import { ARTWORK_MIME, sniffArtwork, type ArtworkKind } from './sniff';

/** Ширина печати растра без метрики, мм */
export const DEFAULT_RASTER_WIDTH_MM = 120;

const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, px: 0.2645833, pt: 0.352778 };

/** «210mm», «595.3pt», «300» → мм; `physical` — единица физическая (mm/cm/pt) */
function lengthToMm(raw: string | null): { mm: number; physical: boolean } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([\d.]+)\s*(mm|cm|px|pt)?$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!(value > 0)) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  return { mm: value * UNIT_TO_MM[unit], physical: unit !== 'px' };
}

/**
 * Размер SVG в мм. Достоверно — width/height с физическими единицами;
 * px/без единиц (96 dpi) и viewBox-only (1 ед. = 1 мм) — оценка.
 */
export function parseSvgSizeMm(svgText: string): { w: number; h: number; estimated: boolean } | null {
  const wAttr = svgText.match(/<svg[^>]*\bwidth\s*=\s*["']([^"']+)["']/i);
  const hAttr = svgText.match(/<svg[^>]*\bheight\s*=\s*["']([^"']+)["']/i);
  const w = lengthToMm(wAttr?.[1] ?? null);
  const h = lengthToMm(hAttr?.[1] ?? null);
  if (w !== null && h !== null) return { w: w.mm, h: h.mm, estimated: !(w.physical && h.physical) };
  const vb = parseViewBox(svgText);
  if (vb && vb.w > 0 && vb.h > 0) return { w: vb.w, h: vb.h, estimated: true };
  return null;
}

/** DPI из чанка `pHYs` PNG (единица — метр); иначе `null` */
export function readPngDpi(b: Uint8Array): number | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 8;
  while (offset + 8 <= b.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(b[offset + 4], b[offset + 5], b[offset + 6], b[offset + 7]);
    const data = offset + 8;
    if (type === 'pHYs') {
      if (data + 9 > b.length) return null;
      const ppuX = view.getUint32(data);
      return b[data + 8] === 1 && ppuX > 0 ? ppuX * 0.0254 : null;
    }
    if (type === 'IEND') break;
    offset = data + length + 4;
  }
  return null;
}

export interface LoadedAsset {
  kind: ArtworkKind;
  meta: AssetMeta;
  /** Чистый Blob для холста (`<img>` из object URL) и для загрузки */
  blob: Blob;
  /** Что санитайзер вырезал из SVG (пусто — ничего) */
  removed: string[];
}

export type LoadAssetResult =
  | { status: 'ok'; asset: LoadedAsset }
  /** PDF/AI: дальше — `loadPdf` (pdfjs, задача 5) */
  | { status: 'pdf'; bytes: Uint8Array }
  | { status: 'error'; error: string };

async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Верх DPI, который принимает `parseLayout` (`asset.dpi`) */
const MAX_ASSET_DPI = 10000;

/** Размер в границах раскладки (`parseLayout`): конечный, > 0 и ≤ MAX_COORD_MM */
function sizeInBounds(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= MAX_COORD_MM && h <= MAX_COORD_MM;
}

/** Оценочный размер, ужатый в границы раскладки с сохранением пропорций */
function clampSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_COORD_MM / Math.max(w, h));
  return { w: w * k, h: h * k };
}

function sourceName(fileName: string): string {
  return fileName.slice(0, MAX_SOURCE_FILE_LEN);
}

function svgAsset(bytes: Uint8Array, fileName: string): LoadAssetResult {
  const clean = sanitizeSvg(new TextDecoder().decode(bytes));
  if (!clean.ok) return { status: 'error', error: clean.error };
  const parsed = parseSvgSizeMm(clean.svg);
  // Размер вне границ раскладки — как будто его нет (оценка), иначе нанесение пропало бы с холста
  const mm = parsed && sizeInBounds(parsed.w, parsed.h) ? parsed : null;
  const w = mm?.w ?? DEFAULT_RASTER_WIDTH_MM;
  const h = mm?.h ?? w;
  return {
    status: 'ok',
    asset: {
      kind: 'svg',
      blob: new Blob([clean.svg], { type: ARTWORK_MIME.svg }),
      removed: clean.removed,
      meta: {
        type: 'svg', source_file: sourceName(fileName), intrinsic_w_mm: w, intrinsic_h_mm: h,
        size_estimated: mm === null || mm.estimated, has_preview: false,
      },
    },
  };
}

function rasterAsset(bytes: Uint8Array, fileName: string, kind: ArtworkKind, pxW: number, pxH: number): LoadAssetResult {
  const read = kind === 'png' ? readPngDpi(bytes) : null;
  // Странный pHYs (ppu = 1 → 0,0254 DPI, сотни метров; или > 10000 DPI) — как будто его нет:
  // раскладка с таким макетом не прошла бы `parseLayout`, и нанесение пропало бы с холста
  const dpi = read && read <= MAX_ASSET_DPI && sizeInBounds((pxW / read) * 25.4, (pxH / read) * 25.4) ? read : null;
  const { w, h } = dpi
    ? { w: (pxW / dpi) * 25.4, h: (pxH / dpi) * 25.4 }
    : clampSize(DEFAULT_RASTER_WIDTH_MM, DEFAULT_RASTER_WIDTH_MM * (pxH / pxW));
  const meta: AssetMeta = {
    type: 'png', source_file: sourceName(fileName), intrinsic_w_mm: w, intrinsic_h_mm: h,
    px_w: pxW, px_h: pxH, size_estimated: !dpi, has_preview: false,
  };
  if (dpi) meta.dpi = dpi;
  return { status: 'ok', asset: { kind, blob: new Blob([bytes as BlobPart], { type: ARTWORK_MIME[kind] }), removed: [], meta } };
}

/** Прочитать файл логотипа. Ошибка — текстом для показа, без исключения */
export async function loadAsset(file: Blob, fileName: string): Promise<LoadAssetResult> {
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(file);
  } catch {
    return { status: 'error', error: 'Не удалось прочитать файл' };
  }
  const sniff = sniffArtwork(bytes, fileName);
  if (!sniff.ok) return { status: 'error', error: sniff.error };
  if (sniff.kind === 'pdf') return { status: 'pdf', bytes };
  if (sniff.kind === 'svg') return svgAsset(bytes, fileName);
  return rasterAsset(bytes, fileName, sniff.kind, sniff.width ?? 0, sniff.height ?? 0);
}
