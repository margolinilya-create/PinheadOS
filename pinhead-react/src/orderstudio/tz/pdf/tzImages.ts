/**
 * Картинки и мокапы ТЗ (веха 6+7, задача 3; К4, К6): прямоугольники
 * `image`/`scene` раскладки → `TzVisual` до рисования.
 *
 * - **Мокап нанесения** — флэт версии раскладки (`flatAtVersion`) в цвете
 *   позиции (`garmentHexOf`) со всеми нанесениями вида, текущее выделено,
 *   масштаб вывода — по ячейке (`buildSceneSvg`, `outputScale`); сцена уже
 *   очищена `sanitizeSvg(scene)`;
 * - **превью макета** — логотип (`logosForPdf`: SVG вектором после санитайзера,
 *   растр, PNG-превью PDF/AI) на прямоугольнике цвета ткани, SVG-обёрткой
 *   через санитайзер;
 * - **фото** (стикер, бирки, схема, заметки) — тип по сигнатуре байт
 *   (`sniffArtwork`); JPEG/PNG крупнее 200 dpi ячейки ужимаются на canvas
 *   (JPEG 0,85; PNG остаётся PNG), WEBP — в JPEG, SVG — только очищенный,
 *   PDF/AI — его PNG-превью. Один путь качается один раз; алиас jsPDF — путь.
 *
 * Не скачалось или не читается — `TzPdfError` с названием: ТЗ без картинки
 * в производство не уходит.
 */
import { artworkPreviewPath, downloadArtwork } from '../../api/artworks';
import { loadFlatMarkup } from '../../design/assets/flatImages';
import { garmentHexOf } from '../../design/assets/garmentHex';
import { sanitizeSvg } from '../../design/assets/sanitizeSvg';
import { ARTWORK_MIME, sniffArtwork } from '../../design/assets/sniff';
import { flatAtVersion } from '../../design/catalog/flatVersion';
import { buildSceneSvg, mockupSceneMm } from '../../design/export/buildSceneSvg';
import type { ResolvedFlat } from '../../design/export/resolveFlat';
import { svgToDataUrl } from '../../design/export/flatMarkup';
import { domRasterizer, logosForPdf, type PdfRasterizer } from '../../design/export/svgForPdf';
import { escAttr, num, safeImageHref } from '../../design/export/svgText';
import { parseLayout, placementOf } from '../../design/model/layout';
import type { FlatView, Placement } from '../../design/types';
import { printMethodProfile } from '../../model/printMethods';
import type { SalesItem, SalesPrint } from '../../model/types';
import type { TzBox, TzLayout } from '../model/layoutPager';
import type { TzCatalogs, TzMockupRef } from '../model/tzDocTypes';
import type { TzVisual } from './drawBoxes';
import { TzPdfError } from './tzPdfError';

/** Плотность фото в ТЗ, точек на дюйм ячейки */
export const TZ_PHOTO_DPI = 200;
const JPEG_QUALITY = 0.85;

export interface TzImageDeps {
  download: (orderId: string, path: string) => Promise<Blob | null>;
  flatMarkup: (view: FlatView) => Promise<ResolvedFlat | null>;
  /** Растр логотипов (`svgForPdf`) */
  rasterizer: PdfRasterizer;
  /** Растр → `w`×`h` px в `type`; не вышло — `null` */
  shrink: (blob: Blob, w: number, h: number, type: 'image/jpeg' | 'image/png') => Promise<Uint8Array | null>;
}

/** Ужать растр на canvas (память холста отдаётся сразу) */
async function canvasShrink(blob: Blob, w: number, h: number, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, JPEG_QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch (e) {
    console.error('tzImages: растр', e);
    return null;
  }
}

export const DEFAULT_IMAGE_DEPS: TzImageDeps = {
  download: downloadArtwork, flatMarkup: loadFlatMarkup, rasterizer: domRasterizer, shrink: canvasShrink,
};

export interface VisualCtx {
  orderId: string;
  /** Первая позиция группы — её нанесения и цвет на мокапах */
  item: SalesItem;
  catalogs: TzCatalogs;
}

const ROLE_LABEL: Record<NonNullable<TzBox['role']>, string> = {
  sticker: 'картинка стикера', label: 'превью бирки', scheme: 'схема притачивания', note: 'картинка заметки', artwork: 'превью макета',
};

const fileOf = (path: string) => path.split('/').pop() ?? path;

/** Обёртка картинки `data:` в лист `w`×`h` мм (фон — цвет ткани или нет), через санитайзер */
function wrapImage(href: string, w: number, h: number, bg: string | null): string {
  const safe = safeImageHref(href);
  if (!safe) throw new TzPdfError('картинка ТЗ не прошла проверку');
  const pad = bg ? Math.min(w, h) * 0.04 : 0;
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}mm" height="${num(h)}mm" viewBox="0 0 ${num(w)} ${num(h)}">`
    + (bg ? `<rect x="0" y="0" width="${num(w)}" height="${num(h)}" fill="${escAttr(bg)}"/>` : '')
    + `<image href="${safe}" x="${num(pad)}" y="${num(pad)}" width="${num(w - 2 * pad)}" height="${num(h - 2 * pad)}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new TzPdfError(`картинка ТЗ не прошла проверку: ${clean.error}`);
  return clean.svg;
}

/** Пиксели растра в ячейке при 200 dpi, с пропорциями источника; не больше источника */
export function photoPx(box: { w: number; h: number }, src: { w: number; h: number }): { w: number; h: number } {
  const tw = (box.w / 25.4) * TZ_PHOTO_DPI;
  const th = (box.h / 25.4) * TZ_PHOTO_DPI;
  const k = Math.min(1, tw / src.w, th / src.h);
  return { w: Math.max(1, Math.round(src.w * k)), h: Math.max(1, Math.round(src.h * k)) };
}

type Reader = (path: string) => Promise<Uint8Array | null>;

async function rasterPhoto(bytes: Uint8Array, path: string, box: TzBox, deps: TzImageDeps, fail: (why: string) => TzPdfError): Promise<TzVisual> {
  const s = sniffArtwork(bytes, path);
  if (!s.ok) throw fail(s.error);
  if (s.kind === 'svg' || s.kind === 'pdf') throw fail('не картинка');
  const src = { w: s.width ?? 1, h: s.height ?? 1 };
  const px = photoPx(box, src);
  const type = s.kind === 'png' ? 'png' : 'jpeg';
  if (s.kind !== 'webp' && px.w === src.w && px.h === src.h) return { kind: 'raster', bytes, type, alias: path, w: px.w, h: px.h };
  const out = await deps.shrink(new Blob([bytes as BlobPart], { type: ARTWORK_MIME[s.kind] }), px.w, px.h, type === 'png' ? 'image/png' : 'image/jpeg');
  const check = out ? sniffArtwork(out, type === 'png' ? 'x.png' : 'x.jpg') : null;
  if (!out || !check?.ok) throw fail('не открылась как картинка');
  return { kind: 'raster', bytes: out, type, alias: path, w: px.w, h: px.h };
}

async function photoVisual(path: string, box: TzBox, read: Reader, deps: TzImageDeps): Promise<TzVisual> {
  const what = `${ROLE_LABEL[box.role ?? 'note']} «${fileOf(path)}»`;
  const fail = (why: string) => new TzPdfError(why ? `${what}: ${why}` : `${what} — файл не загрузился`);
  const bytes = await read(path);
  if (!bytes) throw fail('');
  const s = sniffArtwork(bytes, path);
  if (!s.ok) throw fail(s.error);
  if (s.kind === 'pdf') {
    const preview = artworkPreviewPath(path);
    const png = await read(preview);
    if (!png) throw fail('у PDF нет превью — загрузите файл заново');
    return rasterPhoto(png, preview, box, deps, fail);
  }
  if (s.kind !== 'svg') return rasterPhoto(bytes, path, box, deps, fail);
  // Фото-SVG — только очищенным вектором (вырезанное санитайзером в ТЗ не попадает)
  const clean = sanitizeSvg(new TextDecoder().decode(bytes));
  if (!clean.ok) throw fail(clean.error);
  return { kind: 'svg', markup: wrapImage(svgToDataUrl(clean.svg), box.w, box.h, null) };
}

/** Нанесение без холста — размещение «как есть» для `logosForPdf` (размер, превью PDF/AI) */
function loosePlacement(p: SalesPrint): Placement {
  const w = p.width_mm && p.width_mm > 0 ? p.width_mm : 100;
  const h = p.height_mm && p.height_mm > 0 ? p.height_mm : 100;
  const path = p.artwork_path;
  return {
    print_key: p.key, view: 'front', area_id: '', x_mm: 0, y_mm: 0, width_mm: w, height_mm: h,
    rotation_deg: 0, flip_h: false, flip_v: false, method: p.method, artwork_path: path, stale: false,
    asset: { type: /\.svg$/i.test(path) ? 'svg' : 'png', source_file: fileOf(path), intrinsic_w_mm: w, intrinsic_h_mm: h, size_estimated: true, has_preview: /\.(pdf|ai)$/i.test(path) },
  };
}

function flatOf(ctx: VisualCtx, flatId: string) {
  return ctx.catalogs.garmentFlats?.flats.find((f) => f.id === flatId) ?? null;
}

/** Готовит картинки и мокапы всех прямоугольников раскладки (по номеру прямоугольника) */
export async function prepareVisuals(layout: TzLayout, ctx: VisualCtx, deps: TzImageDeps = DEFAULT_IMAGE_DEPS): Promise<Map<number, TzVisual>> {
  const files = new Map<string, Promise<Uint8Array | null>>();
  const read: Reader = (path) => {
    let hit = files.get(path);
    if (!hit) {
      hit = deps.download(ctx.orderId, path).then(async (b) => (b ? new Uint8Array(await b.arrayBuffer()) : null));
      files.set(path, hit);
    }
    return hit;
  };
  const logoDeps = { download: async (_id: string, path: string) => { const b = await read(path); return b ? new Blob([b as BlobPart]) : null; }, rasterizer: deps.rasterizer };
  const logos = new Map<string, Promise<string>>();
  const prints = ctx.item.prints;
  const nOf = (key: string) => prints.findIndex((p) => p.key === key) + 1;
  const logo = (p: SalesPrint): Promise<string> => {
    let hit = logos.get(p.key);
    if (!hit) {
      const flat = flatOf(ctx, parseLayout(p.layout)?.flat_id ?? '');
      const placement = (flat && placementOf(p, flat)) || loosePlacement(p);
      hit = logosForPdf(ctx.orderId, [{ n: nOf(p.key), placement }], logoDeps).then((r) => {
        if (!r.ok) throw new TzPdfError(`логотип нанесения ${nOf(p.key)} не загрузился (${r.error})`);
        return r.logos.images[p.key];
      });
      logos.set(p.key, hit);
    }
    return hit;
  };
  const hex = garmentHexOf(ctx.item, ctx.catalogs.suppliers);

  async function scene(ref: TzMockupRef, box: TzBox): Promise<TzVisual> {
    const n = nOf(ref.highlight);
    const flat = flatOf(ctx, ref.flatId);
    const geo = flat ? (flatAtVersion(flat, ref.flatVersion) ?? flat) : null;
    const view = geo?.views.find((v) => v.kind === ref.view);
    if (!flat || !view) throw new TzPdfError(`мокап нанесения ${n}: силуэта «${ref.flatId}» нет в справочнике флэтов`);
    const resolved = await deps.flatMarkup(view);
    if (!resolved) throw new TzPdfError(`силуэт изделия для мокапа нанесения ${n} не загрузился — повторите`);
    const own = ref.printKeys.map((k) => prints.find((p) => p.key === k)).filter((p): p is SalesPrint => Boolean(p));
    const placements = own.map((p) => placementOf(p, flat)).filter((p): p is Placement => Boolean(p));
    const images: Record<string, string> = {};
    for (const p of own) if (p.artwork_path) images[p.key] = await logo(p);
    const mm = mockupSceneMm(resolved.flatMm);
    const markup = buildSceneSvg({
      view, flatMarkup: resolved.markup, flatMm: resolved.flatMm, garmentColor: hex, placements, images,
      meta: { client: '', orderNumber: '', itemTitle: '', date: '', size: '' },
      profileOf: printMethodProfile, legend: [], outputScale: Math.min(box.w / mm.w, box.h / mm.h), highlight: ref.highlight,
    });
    return { kind: 'svg', markup };
  }

  const out = new Map<number, TzVisual>();
  for (const [i, b] of layout.boxes.entries()) {
    if (b.kind === 'scene' && b.scene) out.set(i, await scene(b.scene, b));
    if (b.kind !== 'image' || !b.image) continue;
    const print = b.role === 'artwork' ? prints.find((p) => p.artwork_path === b.image) : undefined;
    out.set(i, print ? { kind: 'svg', markup: wrapImage(await logo(print), b.w, b.h, hex) } : await photoVisual(b.image, b, read, deps));
  }
  return out;
}
