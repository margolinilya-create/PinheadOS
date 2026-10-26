/**
 * «Файлы печати» позиции (веха 5в, Э4а, без базы): на каждое нанесение с
 * макетом и мм — PNG в натуральную величину 300 dpi (pHYs записан), у вектора
 * (SVG — очищенный) и PDF/AI — ещё исходник; всё — ZIP без сжатия
 * (`zipStore`) со списком `читать.txt`. Грузится только `import()` по кнопке.
 *
 * Рисунок — без поворота и отражения раскладки (это положение на изделии, а
 * не файл плёнки); размер — Ш×В нанесения. DPI — сначала 300; не вышло (холст
 * браузера не держит: мобильный Safari ≈ 16,7 Мп, настольные — 16 384 px по стороне
 * и ≈ 268 Мп) — 150, затем по площади, с пометкой в имени и в списке.
 * PDF/AI в PNG не растеризуются: печать — по исходнику (пометка в списке).
 */
import type { SalesItem, SalesOrder, SalesPrint } from '../../model/types';
import { parseLayout } from '../model/layoutMark';
import { contentKind, type ArtworkKind } from '../assets/sniff';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { makeZip, withPngDpi, type ZipEntry } from './zipStore';

export const PRINT_DPI = 300;
export const REDUCED_DPI = 150;
/** Предел холста настольного браузера: сторона и площадь, пикселей */
export const MAX_CANVAS_SIDE = 16_384;
export const MAX_CANVAS_PX = 268_000_000;

export interface PrintFileDeps {
  download: (orderId: string, path: string) => Promise<Blob | null>;
  /** PNG-байты картинки, растянутой в w×h px; не вышло — `null` */
  rasterize: (src: Blob | string, kind: ArtworkKind, w: number, h: number) => Promise<Uint8Array | null>;
}

const ascii = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** Где нанесение: вид раскладки, иначе код зоны, иначе «zone» */
function whereOf(p: SalesPrint): string {
  return ascii(parseLayout(p.layout)?.view ?? p.zone_id ?? 'zone');
}

/** `PH-1234_p2_front_dtf_280x350mm.png` (+ `_150dpi` при снижении) */
export function printFileName(number: string, index: number, p: SalesPrint, ext: string, dpi = PRINT_DPI): string {
  const n = ascii(number).toUpperCase() || 'PH';
  const dpiTag = dpi === PRINT_DPI ? '' : `_${dpi}dpi`;
  return `${n}_p${index + 1}_${whereOf(p)}_${ascii(p.method)}_${Math.round(p.width_mm ?? 0)}x${Math.round(p.height_mm ?? 0)}mm${dpiTag}.${ext}`;
}

/**
 * DPI по порядку попыток: 300 → 150 → по пределу холста (не ниже 72); попытка
 * за пределом настольного холста отбрасывается сразу, остальные пробует
 * растеризация (мобильный холст меньше — откажет, будет следующая)
 */
export function dpiCandidates(wMm: number, hMm: number): number[] {
  const fits = (dpi: number) => {
    const w = wMm / 25.4 * dpi;
    const h = hMm / 25.4 * dpi;
    return Math.max(w, h) <= MAX_CANVAS_SIDE && w * h <= MAX_CANVAS_PX;
  };
  const side = Math.floor(MAX_CANVAS_SIDE / (Math.max(wMm, hMm) / 25.4));
  const area = Math.floor(Math.sqrt(MAX_CANVAS_PX / ((wMm / 25.4) * (hMm / 25.4))));
  const last = Math.max(72, Math.min(side, area, REDUCED_DPI - 1));
  return [...new Set([PRINT_DPI, REDUCED_DPI, last])].filter((d) => fits(d) || d === last);
}

/** Нанесения, у которых есть что печатать: макет и оба мм */
export function printablePrints(item: Pick<SalesItem, 'prints'>): { print: SalesPrint; index: number }[] {
  return item.prints.map((print, index) => ({ print, index }))
    .filter(({ print }) => !!print.artwork_path && (print.width_mm ?? 0) > 0 && (print.height_mm ?? 0) > 0);
}

const EXT: Record<ArtworkKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', svg: 'svg', pdf: 'pdf' };

export interface PrintFilesResult {
  zip: Uint8Array;
  fileName: string;
  /** Сколько нанесений вошло */
  count: number;
  notes: string[];
}

export async function buildPrintFiles(order: Pick<SalesOrder, 'id' | 'number'>, item: SalesItem, deps: PrintFileDeps): Promise<PrintFilesResult> {
  const entries: ZipEntry[] = [];
  const lines: string[] = [];
  const notes: string[] = [];
  const enc = new TextEncoder();
  let count = 0;
  for (const { print, index } of printablePrints(item)) {
    const n = index + 1;
    const blob = await deps.download(order.id, print.artwork_path);
    if (!blob) { notes.push(`Нанесение ${n}: макет не скачался — повторите позже`); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const kind = contentKind(bytes);
    if (!kind) { notes.push(`Нанесение ${n}: формат макета не распознан — файл не добавлен`); continue; }
    const w = print.width_mm as number;
    const h = print.height_mm as number;
    let src: Blob | string = blob;
    if (kind === 'svg') {
      const clean = sanitizeSvg(new TextDecoder().decode(bytes), 'asset');
      if (!clean.ok) { notes.push(`Нанесение ${n}: SVG не прошёл очистку — файл не добавлен`); continue; }
      src = clean.svg;
      entries.push({ name: printFileName(order.number, index, print, 'svg'), data: enc.encode(clean.svg) });
    } else if (kind === 'pdf') {
      const ext = /\.ai$/i.test(print.artwork_path) ? 'ai' : 'pdf';
      entries.push({ name: printFileName(order.number, index, print, ext), data: bytes });
      lines.push(`${printFileName(order.number, index, print, ext)} — исходник (вектор): печатать по нему`);
      count++;
      continue;
    }
    let dpi = PRINT_DPI;
    let png: Uint8Array | null = null;
    for (const d of dpiCandidates(w, h)) {
      const px = (mm: number) => Math.max(1, Math.round(mm / 25.4 * d));
      png = await deps.rasterize(src, kind, px(w), px(h));
      dpi = d;
      if (png) break;
    }
    if (!png) { notes.push(`Нанесение ${n}: не удалось подготовить PNG — приложен исходник`); entries.push({ name: printFileName(order.number, index, print, EXT[kind]), data: bytes }); continue; }
    const name = printFileName(order.number, index, print, 'png', dpi);
    entries.push({ name, data: withPngDpi(png, dpi) });
    lines.push(`${name} — ${Math.round(w)} × ${Math.round(h)} мм, ${dpi} dpi${dpi < PRINT_DPI ? ' (снижено: браузер не удержал холст этого размера при 300 dpi)' : ''}`);
    count++;
  }
  const readme = [`Файлы печати ${order.number}`, '', ...lines, ...(notes.length ? ['', 'Замечания:', ...notes] : []),
    '', 'Рисунок — без поворота и отражения раскладки; размер — Ш×В нанесения.'].join('\n');
  entries.push({ name: 'читать.txt', data: enc.encode(readme) });
  return { zip: makeZip(entries), fileName: `${ascii(order.number).toUpperCase() || 'PH'}-print-files.zip`, count, notes };
}

/** Браузерная растеризация: растр — `createImageBitmap`, SVG — `data:`-ссылка в `Image` (без object URL) */
export async function rasterizeInBrowser(src: Blob | string, kind: ArtworkKind, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    if (kind === 'svg' && typeof src === 'string') {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(src)))}`;
      await img.decode();
      g.drawImage(img, 0, 0, w, h);
    } else if (src instanceof Blob) {
      const bmp = await createImageBitmap(src);
      g.drawImage(bmp, 0, 0, w, h);
      bmp.close();
    } else {
      return null;
    }
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch (e) {
    console.error('printFiles: растеризация', e);
    return null;
  }
}
