/**
 * Мокапы позиции (веха 5в, Э5): PNG «вид × цвет ткани» — превью вида
 * (`buildPreviewSvg`, флэт в цвете ткани и макеты по зонам) в фирменной сцене
 * с подписью; архив ZIP (`zipStore`). Новая сцена — своей функцией: эталонный
 * лист PDF макета (`buildSceneSvg`, сторож `sceneGolden`) не трогается.
 * Грузится только `import()` по кнопке «Мокапы»; ничего не пишет.
 */
import type { SalesItem, SalesOrder } from '../../model/types';
import type { FlatView, GarmentFlat, Placement } from '../types';
import type { Supplier } from '../../catalog/types';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { garmentHexOf } from '../assets/garmentHex';
import { placementOf } from '../model/layout';
import { buildPreviewSvg } from './buildPreviewSvg';
import { svgToDataUrl } from './flatMarkup';
import { esc, num } from './svgText';
import { makeZip, type ZipEntry } from './zipStore';

/** Ширина PNG мокапа, px */
export const MOCKUP_PX = 1600;
const FOOTER_PX = 120;
const BG = '#F4F1EA';
const INK = '#1A1A1A';

export interface MockupDeps {
  flatMarkup: (view: FlatView) => Promise<{ markup: string; flatMm: { w: number; h: number } } | null>;
  /** Картинка нанесения `data:image/png;base64,…`; нет — `undefined` */
  artwork: (pl: Placement) => Promise<string | undefined>;
  /** PNG из SVG `w×h` px; не вышло — `null` */
  toPng: (svg: string, w: number, h: number) => Promise<Uint8Array | null>;
}

const VIEW_TAG: Record<string, string> = { front: 'front', back: 'back', sleeve_left: 'sleeve-l', sleeve_right: 'sleeve-r' };

/** Цвета позиции без дублей и пустых — порядок сетки */
export function itemColors(item: Pick<SalesItem, 'size_grid'>): string[] {
  return [...new Set(item.size_grid.rows.map((r) => r.color.trim()).filter(Boolean))];
}

/** `PH-1234_mockup_front_15-01.png`: код цвета из подписи «Чёрный (15-01)», иначе номер цвета */
export function mockupFileName(number: string, view: string, color: string, colorIndex: number): string {
  const code = /\(([0-9A-Za-z.-]+)\)\s*$/.exec(color)?.[1] ?? `c${colorIndex + 1}`;
  const n = number.replace(/[^A-Za-z0-9-]+/g, '') || 'PH';
  return `${n}_mockup_${VIEW_TAG[view] ?? 'view'}_${code}.png`;
}

/** Фирменная сцена: подложка, превью по центру, подпись внизу (очищенный SVG) */
export function mockupSceneSvg(previewSvg: string, flatMm: { w: number; h: number }, caption: string): { svg: string; w: number; h: number } {
  const w = MOCKUP_PX;
  const imgH = Math.round(w * (flatMm.h / flatMm.w) * 0.9);
  const h = imgH + FOOTER_PX + 60;
  const imgW = Math.round(w * 0.9);
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="${BG}"/>`
    + `<image href="${svgToDataUrl(previewSvg)}" x="${num((w - imgW) / 2)}" y="30" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid meet"/>`
    + `<text x="${w / 2}" y="${h - FOOTER_PX / 2}" font-size="34" font-family="sans-serif" fill="${INK}" text-anchor="middle">${esc(caption)}</text>`
    + '</svg>';
  const clean = sanitizeSvg(raw, 'scene');
  if (!clean.ok) throw new Error(`Мокап не собран: ${clean.error}`);
  return { svg: clean.svg, w, h };
}

const VIEW_NAMES: Record<string, string> = { front: 'перед', back: 'спина', sleeve_left: 'левый рукав', sleeve_right: 'правый рукав' };

export interface MockupsResult { zip: Uint8Array; fileName: string; count: number; notes: string[] }

export async function buildMockups(
  order: Pick<SalesOrder, 'number'>, item: SalesItem, flat: GarmentFlat, suppliers: readonly Supplier[], deps: MockupDeps,
): Promise<MockupsResult> {
  const placed = item.prints.map((p) => placementOf(p, flat)).filter((p): p is Placement => !!p);
  const views = flat.views.filter((v) => placed.some((p) => p.view === v.kind));
  const list = views.length ? views : flat.views.slice(0, 1);
  const colors = itemColors(item);
  const palette = colors.length ? colors : [''];
  const images: Record<string, string | undefined> = {};
  for (const pl of placed) images[pl.print_key] = await deps.artwork(pl);
  const entries: ZipEntry[] = [];
  const notes: string[] = [];
  const model = item.product_type || 'Изделие';
  for (const view of list) {
    const markup = await deps.flatMarkup(view);
    if (!markup) { notes.push(`Вид «${VIEW_NAMES[view.kind]}»: силуэт не загрузился`); continue; }
    const pls = placed.filter((p) => p.view === view.kind);
    for (const [ci, color] of palette.entries()) {
      const preview = buildPreviewSvg({
        view, flatMarkup: markup.markup, flatMm: markup.flatMm, garmentColor: garmentHexOf(item, suppliers, null, color || null),
        placements: pls, images: Object.fromEntries(pls.map((p) => [p.print_key, images[p.print_key] ?? ''])),
      });
      const caption = [order.number, model, color, VIEW_NAMES[view.kind]].filter(Boolean).join(' · ');
      const scene = mockupSceneSvg(preview, markup.flatMm, caption);
      const png = await deps.toPng(scene.svg, scene.w, scene.h);
      if (!png) { notes.push(`Мокап «${VIEW_NAMES[view.kind]}, ${color || 'цвет'}» не собрался`); continue; }
      entries.push({ name: mockupFileName(order.number, view.kind, color, ci), data: png });
    }
  }
  const n = order.number.replace(/[^A-Za-z0-9-]+/g, '') || 'PH';
  return { zip: makeZip(entries), fileName: `${n}-mockups.zip`, count: entries.length, notes };
}

/** Браузерная растеризация сцены: `data:`-ссылка в `Image` → холст → PNG (без object URL) */
export async function svgToPngInBrowser(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    img.src = svgToDataUrl(svg);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch (e) {
    console.error('mockups: растеризация', e);
    return null;
  }
}
