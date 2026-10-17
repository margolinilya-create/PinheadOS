/**
 * Логотипы для PDF макета (веха 5а, задача 7; план, решение 10 п. 3;
 * проверка безопасности H1, H2, M2; проверка скиллами — «растр в PDF ≤ 300 dpi
 * от размера печати»).
 *
 * Сцена листа (`buildSceneSvg`) принимает картинки только как
 * `data:image/(png|svg+xml);base64,` — сюда приходят байты из бакета заказа
 * (`downloadArtwork`: `download()` → Blob, тип по БАЙТАМ, а не по ответу):
 * - **SVG** — `sanitizeSvg`. Ничего не вырезано — логотип идёт в PDF
 *   **вектором** (svg2pdf разбирает вложенный SVG сам). Что-то вырезано —
 *   **растр** 300 dpi от размера печати и пометка в шапке «логотип N — растр»:
 *   разметку, которую санитайзер не пропустил, svg2pdf не получает никогда;
 * - растр рисует браузер в `<img>` из `data:`-URL (не `blob:` — его можно было
 *   бы открыть как документ нашего источника, H2): в картинке скрипты не
 *   исполняются и сеть не трогается. Рисуется ИСХОДНИК — так сохраняются цвета
 *   из `style` (Inkscape, Illustrator), которые санитайзер режет. Исходник
 *   с усилителями — `<use>`, вложенные `<image>`/`<feImage>`, `<foreignObject>`
 *   (цепочки и бомбы, «грязный» холст) — рисуется очищенным;
 * - **PNG** — как есть, крупнее 300 dpi — уменьшается; **JPEG/WEBP** —
 *   перекодируются в PNG (сцена берёт только PNG и SVG);
 * - **PDF/AI** — PNG-превью рядом с исходником (`<путь>.preview.png`,
 *   задача 5) и пометка «логотип N — растр из PDF».
 *
 * Логотип не скачался или не читается — отказ с номером: PDF без логотипа
 * в производство уйти не должен. Растр — не больше 5000 px по стороне и 25 Мп.
 */
import { artworkPreviewPath, downloadArtwork } from '../../api/artworks';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { ARTWORK_MIME, sniffArtwork } from '../assets/sniff';
import type { Placement } from '../types';
import { svgToDataUrl } from './flatMarkup';

export const PDF_RASTER_DPI = 300;
export const PDF_RASTER_MAX_SIDE = 5000;
export const PDF_RASTER_MAX_PX = 25_000_000;
/** Сколько ждать, пока браузер откроет SVG как картинку */
export const SVG_DECODE_TIMEOUT_MS = 15_000;

const MM_PER_INCH = 25.4;
/** Усилители: цепочки `<use>`, вложенные картинки, HTML — исходник с ними не рисуется */
const AMPLIFIERS = new Set(['use', 'image', 'feimage', 'foreignobject']);

// ── SVG: вектор или растр ────────────────────────────────────────────────

export type SvgLogoPlan =
  | { kind: 'vector'; href: string }
  | { kind: 'raster'; source: string; removed: string[] }
  | { kind: 'error'; error: string };

/** Можно ли рисовать исходник в `<img>`: читается и без усилителей */
function originalRasterSafe(text: string): boolean {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return false;
  return !Array.from(doc.getElementsByTagName('*')).some((el) => AMPLIFIERS.has(el.localName.toLowerCase()));
}

/** Как поставить SVG-логотип в PDF: чистый — вектором; что-то вырезано — растр; отказ санитайзера — ошибка */
export function planSvgLogo(text: string): SvgLogoPlan {
  const clean = sanitizeSvg(text);
  if (!clean.ok) return { kind: 'error', error: clean.error };
  if (clean.removed.length === 0) return { kind: 'vector', href: svgToDataUrl(clean.svg) };
  const source = originalRasterSafe(text) ? text : clean.svg;
  return { kind: 'raster', source, removed: clean.removed };
}

// ── Размер растра ────────────────────────────────────────────────────────

export interface RasterSize {
  w: number;
  h: number;
  /** Растр надо перерисовать (SVG — всегда; растр — если уменьшен) */
  resized: boolean;
}

/**
 * Пиксели растра для печати `widthMm`×`heightMm`: не плотнее 300 dpi, не больше
 * 5000 px по стороне и 25 Мп. Исходный растр (`src`) не увеличивается.
 */
export function rasterPx(widthMm: number, heightMm: number, src: { w: number; h: number } | null): RasterSize {
  const tw = (widthMm / MM_PER_INCH) * PDF_RASTER_DPI;
  const th = (heightMm / MM_PER_INCH) * PDF_RASTER_DPI;
  let k = 1;
  let w = tw;
  let h = th;
  if (src) {
    k = Math.min(1, Math.max(tw / src.w, th / src.h));
    w = src.w * k;
    h = src.h * k;
  }
  const side = PDF_RASTER_MAX_SIDE / Math.max(w, h);
  if (side < 1) { w *= side; h *= side; }
  const area = Math.sqrt(PDF_RASTER_MAX_PX / (w * h));
  if (area < 1) { w *= area; h *= area; }
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  return { w: W, h: H, resized: !src || W !== src.w || H !== src.h };
}

const PX_PER_UNIT: Record<string, number> = { '': 1, px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, pc: 16 };

function lengthPx(raw: string | null): number | null {
  const m = raw?.trim().match(/^([\d.]+)\s*(px|mm|cm|in|pt|pc)?$/i);
  const v = m ? parseFloat(m[1]) * PX_PER_UNIT[(m[2] ?? '').toLowerCase()] : NaN;
  return v > 0 && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

/**
 * Корень SVG под растр `w`×`h`: размер в px и растяжение, как у `<image
 * preserveAspectRatio="none">` сцены. Без `viewBox` он выводится из
 * width/height — иначе новый размер обрезал бы рисунок, а не масштабировал.
 */
export function sizedSvg(text: string, w: number, h: number): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root.hasAttribute('viewBox')) {
    const vw = lengthPx(root.getAttribute('width'));
    const vh = lengthPx(root.getAttribute('height'));
    if (vw && vh) root.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  }
  root.setAttribute('width', String(w));
  root.setAttribute('height', String(h));
  root.setAttribute('preserveAspectRatio', 'none');
  return new XMLSerializer().serializeToString(root);
}

// ── Растр в браузере ─────────────────────────────────────────────────────

export interface PdfRasterizer {
  /** Растр (Blob с типом по сигнатуре) → PNG `w`×`h`; не вышло — `null` */
  bitmap(blob: Blob, w: number, h: number): Promise<Blob | null>;
  /** SVG-текст → PNG `w`×`h` через `<img>` из `data:`-URL; не вышло — `null` */
  svg(text: string, w: number, h: number): Promise<Blob | null>;
}

/** Холст → PNG; память холста отдаётся сразу после кодирования */
function canvasPng(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  draw(ctx);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      resolve(blob);
    }, 'image/png');
  });
}

function decodeImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => done(null), SVG_DECODE_TIMEOUT_MS);
    function done(v: HTMLImageElement | null) {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(v);
    }
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });
}

export const domRasterizer: PdfRasterizer = {
  async bitmap(blob, w, h) {
    if (typeof createImageBitmap !== 'function') return null;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    } catch (e) {
      console.error('svgForPdf: bitmap', e);
      return null;
    }
    try {
      return await canvasPng(w, h, (ctx) => ctx.drawImage(bmp, 0, 0, w, h));
    } catch (e) {
      console.error('svgForPdf: bitmap draw', e);
      return null;
    } finally {
      bmp.close();
    }
  },
  async svg(text, w, h) {
    const img = await decodeImage(svgToDataUrl(text));
    if (!img) return null;
    try {
      return await canvasPng(w, h, (ctx) => ctx.drawImage(img, 0, 0, w, h));
    } catch (e) {
      // «Грязный» холст (SecurityError у toBlob) и прочее — растра нет
      console.error('svgForPdf: svg draw', e);
      return null;
    }
  },
};

// ── Логотипы нанесений ───────────────────────────────────────────────────

export interface LogoEntry {
  /** Номер нанесения в позиции — его называют пометка и отказ */
  n: number;
  placement: Placement;
}

export interface PdfLogos {
  /** Картинка сцены по `print_key` */
  images: Record<string, string>;
  /** Пометка шапки листа по `print_key`: «логотип N — растр» (на листе своего вида) */
  notes: Record<string, string>;
}

export type PdfLogosResult = { ok: true; logos: PdfLogos } | { ok: false; error: string };

export interface LogoDeps {
  download: (orderId: string, path: string) => Promise<Blob | null>;
  rasterizer: PdfRasterizer;
}

const DEFAULT_DEPS: LogoDeps = { download: downloadArtwork, rasterizer: domRasterizer };

export function rasterNote(n: number, fromPdf: boolean): string {
  return fromPdf ? `логотип ${n} — растр из PDF` : `логотип ${n} — растр`;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Байты → base64 кусками (`fromCharCode(...)` целиком переполнил бы стек аргументов) */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** PNG-байты → data URL сцены; не PNG — `null` */
function pngHref(bytes: Uint8Array): string | null {
  return PNG_SIG.every((v, i) => bytes[i] === v) ? `data:image/png;base64,${bytesToBase64(bytes)}` : null;
}

async function blobHref(blob: Blob | null): Promise<string | null> {
  return blob ? pngHref(new Uint8Array(await blob.arrayBuffer())) : null;
}

type LogoResult = { ok: true; href: string; note: string | null } | { ok: false; error: string };

async function svgLogo(bytes: Uint8Array, e: LogoEntry, deps: LogoDeps): Promise<LogoResult> {
  const plan = planSvgLogo(new TextDecoder().decode(bytes));
  if (plan.kind === 'error') return { ok: false, error: `логотип ${e.n}: ${plan.error}` };
  if (plan.kind === 'vector') return { ok: true, href: plan.href, note: null };
  const size = rasterPx(e.placement.width_mm, e.placement.height_mm, null);
  const href = await blobHref(await deps.rasterizer.svg(sizedSvg(plan.source, size.w, size.h), size.w, size.h));
  return href ? { ok: true, href, note: rasterNote(e.n, false) } : { ok: false, error: `логотип ${e.n} не открылся как картинка` };
}

async function logoFor(e: LogoEntry, read: (path: string) => Promise<Uint8Array | null>, deps: LogoDeps): Promise<LogoResult> {
  const { placement: p, n } = e;
  const fromPdf = p.asset.has_preview;
  const path = fromPdf ? artworkPreviewPath(p.artwork_path) : p.artwork_path;
  if (!path) return { ok: false, error: `логотип ${n}: нет файла макета` };
  const bytes = await read(path);
  if (!bytes) return { ok: false, error: `логотип ${n} не скачался` };
  const sniff = sniffArtwork(bytes, path);
  if (!sniff.ok) return { ok: false, error: `логотип ${n}: ${sniff.error}` };
  if (fromPdf && sniff.kind !== 'png') return { ok: false, error: `логотип ${n}: превью не PNG — загрузите файл заново` };
  if (sniff.kind === 'pdf') return { ok: false, error: `логотип ${n}: у PDF нет превью — загрузите файл заново` };
  if (sniff.kind === 'svg') return svgLogo(bytes, e, deps);
  const note = fromPdf ? rasterNote(n, true) : null;
  const size = rasterPx(p.width_mm, p.height_mm, { w: sniff.width ?? 0, h: sniff.height ?? 0 });
  const same = sniff.kind === 'png' && !size.resized ? pngHref(bytes) : null;
  const href = same ?? await blobHref(await deps.rasterizer.bitmap(new Blob([bytes as BlobPart], { type: ARTWORK_MIME[sniff.kind] }), size.w, size.h));
  return href ? { ok: true, href, note } : { ok: false, error: `логотип ${n} не открылся как картинка` };
}

/** Картинки и пометки для сцен PDF; первый отказ останавливает сборку */
export async function logosForPdf(orderId: string, entries: LogoEntry[], deps: LogoDeps = DEFAULT_DEPS): Promise<PdfLogosResult> {
  const files = new Map<string, Promise<Uint8Array | null>>();
  const read = (path: string) => {
    let hit = files.get(path);
    if (!hit) {
      hit = deps.download(orderId, path).then(async (blob) => (blob ? new Uint8Array(await blob.arrayBuffer()) : null));
      files.set(path, hit);
    }
    return hit;
  };
  const images: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const e of entries) {
    const r = await logoFor(e, read, deps);
    if (!r.ok) return r;
    images[e.placement.print_key] = r.href;
    if (r.note) notes[e.placement.print_key] = r.note;
  }
  return { ok: true, logos: { images, notes } };
}
