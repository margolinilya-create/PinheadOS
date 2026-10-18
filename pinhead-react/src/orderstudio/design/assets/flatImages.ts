/**
 * Флэт для холста (веха 5а, задача 5; решения 2 и 10 плана).
 *
 * `downloadFlatSvg` (приватный бакет флэтов `FLATS_BUCKET`, путь — только
 * прошедший `isFlatPath`) → `resolveFlat` (повторный `sanitizeSvg` перед
 * показом — защита в глубину, габарит в мм) → `recolorGarment` (силуэт в цвет
 * ткани, только проверенный hex) → Blob `image/svg+xml` → object URL →
 * `HTMLImageElement`.
 *
 * Цвет ткани — `garmentHex.ts` (лёгкий, синхронный). Сам модуль холст грузит
 * по требованию через `imageLayer` (потолок чанка холста 100 кБ gzip).
 *
 * Объекты флэтов неизменяемы по версии (путь версионный), поэтому разметка
 * кэшируется по пути на всю сессию вкладки, картинка — по пути и цвету.
 * Сбой — один тост на путь (неудача кэшируется до сброса). `releaseFlatImages`
 * (уход с вкладки, выход — стор дизайна) освобождает object URL.
 *
 * Модуль без React: хук — `useFlatImage.ts`.
 */
import { downloadFlatSvg } from '../../api/garmentFlats';
import { toast } from '../../../store/useToastStore';
import type { FlatView } from '../types';
import { recolorGarment } from '../export/flatMarkup';
import { resolveFlat, type ResolvedFlat } from '../export/resolveFlat';
import { NEUTRAL_GARMENT_HEX, validHex } from './garmentHex';

/* Цвет ткани — лёгкий модуль `garmentHex` (его читают синхронно); здесь — для прежних импортов */
export { NEUTRAL_GARMENT_HEX, garmentHexOf } from './garmentHex';

export interface FlatImage {
  image: HTMLImageElement;
  /** Габарит флэта, мм */
  flatMm: { w: number; h: number };
}

type ViewRef = Pick<FlatView, 'svg_path' | 'scale_mm_per_unit'>;

const markups = new Map<string, Promise<ResolvedFlat | null>>();
const images = new Map<string, { promise: Promise<FlatImage | null>; url: string | null }>();

const markupKey = (view: ViewRef) => `${view.svg_path}|${view.scale_mm_per_unit}`;

/** Очищенная разметка флэта и габарит (её же читают превью и PDF макета) */
export function loadFlatMarkup(view: ViewRef): Promise<ResolvedFlat | null> {
  const key = markupKey(view);
  let hit = markups.get(key);
  if (!hit) {
    hit = (async () => {
      const text = await downloadFlatSvg(view.svg_path);
      if (text === null) return null;
      const resolved = resolveFlat(text, view);
      if (!resolved) toast.error('Силуэт не показан: файл флэта повреждён — сообщите администратору');
      return resolved;
    })();
    markups.set(key, hit);
  }
  return hit;
}

function decodeImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Картинка флэта в цвете ткани (hex не по форме — нейтральный) */
export function loadFlatImage(view: ViewRef, colorHex: string): Promise<FlatImage | null> {
  const hex = validHex(colorHex) ? colorHex : NEUTRAL_GARMENT_HEX;
  const key = `${markupKey(view)}|${hex}`;
  const hit = images.get(key);
  if (hit) return hit.promise;
  const entry: { promise: Promise<FlatImage | null>; url: string | null } = { promise: Promise.resolve(null), url: null };
  images.set(key, entry);
  entry.promise = (async () => {
    const flat = await loadFlatMarkup(view);
    if (!flat || images.get(key) !== entry) return null;
    const url = URL.createObjectURL(new Blob([recolorGarment(flat.markup, hex)], { type: 'image/svg+xml' }));
    entry.url = url;
    const image = await decodeImage(url);
    if (images.get(key) !== entry) {
      URL.revokeObjectURL(url);
      return null;
    }
    if (!image) toast.error('Силуэт не показан: картинка не открылась');
    return image ? { image, flatMm: flat.flatMm } : null;
  })();
  return entry.promise;
}

/** Освободить object URL и забыть флэты (уход с вкладки, выход) */
export function releaseFlatImages(): void {
  for (const entry of images.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  images.clear();
  markups.clear();
}
