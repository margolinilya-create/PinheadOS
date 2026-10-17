/**
 * Картинки логотипов для холста (веха 5а, задача 5; проверка безопасности H2, M2, L8).
 *
 * Путь: `downloadArtwork` (только `download()` → Blob; подписанная ссылка на
 * холст не идёт) → тип по БАЙТАМ (`sniffArtwork`, ответу не доверяем) →
 * SVG через `sanitizeSvg` в новый Blob, растр — новый Blob с типом по
 * сигнатуре, превью PDF/AI — только при сигнатуре PNG → object URL →
 * `HTMLImageElement` (в `<img>` скрипты не исполняются; blob-URL никуда,
 * кроме картинки, не уходит). Растр больше 4096 px по стороне уменьшается
 * для показа (`createImageBitmap`); DPI считается по исходнику (`px_w`
 * раскладки), не по показу. Бомба по заголовку (сторона > 12 000 px или
 * > 80 Мп) отклоняется и при скачивании.
 *
 * Кэш — на заказ (ключ — путь в бакете, в нём id заказа): один запрос на
 * файл, и сбой — один тост на путь (неудача тоже кэшируется до сброса).
 * `releaseArtworkImages` (смена заказа, уход с вкладки, выход — стор
 * дизайна) освобождает все object URL; замена картинки по тому же пути
 * (`primeArtworkImage` после загрузки) освобождает прежний URL. Уменьшение
 * большого растра — на обоих путях: и при скачивании, и при `primeArtworkImage`.
 *
 * Модуль без React: хук — `useArtworkImage.ts`.
 */
import { artworkPreviewPath, downloadArtwork } from '../../api/artworks';
import { toast } from '../../../store/useToastStore';
import { sanitizeSvg } from './sanitizeSvg';
import { ARTWORK_MIME, sniffArtwork } from './sniff';

/** Сторона растра для показа на холсте, px */
export const MAX_DISPLAY_PX = 4096;

interface Entry {
  promise: Promise<HTMLImageElement | null>;
  url: string | null;
}

const cache = new Map<string, Entry>();

/** Объект в бакете, который рисует холст: исходник либо его превью (PDF/AI) */
export function displayPathOf(path: string, hasPreview: boolean): string {
  return hasPreview ? artworkPreviewPath(path) : path;
}

function fail(message: string): null {
  toast.error(`Логотип не показан: ${message}`);
  return null;
}

/** Уменьшить большой растр для показа; нечем или не вышло — исходный Blob */
async function downscale(blob: Blob, width: number, height: number): Promise<Blob> {
  const side = Math.max(width, height);
  if (side <= MAX_DISPLAY_PX || typeof createImageBitmap !== 'function') return blob;
  try {
    const k = MAX_DISPLAY_PX / side;
    const bmp = await createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(width * k)),
      resizeHeight: Math.max(1, Math.round(height * k)),
      resizeQuality: 'high',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return blob;
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return out ?? blob;
  } catch {
    return blob;
  }
}

/** Скачанные байты → чистый Blob для показа; что-то не так — тост и `null` */
async function cleanBlob(orderId: string, objectPath: string, isPreview: boolean): Promise<Blob | null> {
  const raw = await downloadArtwork(orderId, objectPath);
  if (!raw) return null;
  const bytes = new Uint8Array(await raw.arrayBuffer());
  const sniff = sniffArtwork(bytes, objectPath);
  if (!sniff.ok) return fail(sniff.error);
  if (isPreview && sniff.kind !== 'png') return fail('превью не PNG — загрузите файл заново');
  if (sniff.kind === 'pdf') return fail('у PDF нет превью — загрузите файл заново');
  if (sniff.kind === 'svg') {
    const clean = sanitizeSvg(new TextDecoder().decode(bytes));
    return clean.ok ? new Blob([clean.svg], { type: ARTWORK_MIME.svg }) : fail(clean.error);
  }
  const blob = new Blob([bytes as BlobPart], { type: ARTWORK_MIME[sniff.kind] });
  return downscale(blob, sniff.width ?? 0, sniff.height ?? 0);
}

function decodeImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Запись вытеснена (замена по пути, сброс): ждущему — картинка новой записи, если она есть */
function superseded(key: string): Promise<HTMLImageElement | null> {
  return cache.get(key)?.promise ?? Promise.resolve(null);
}

/** Blob → object URL → картинка; запись уже вытеснена — URL сразу освобождается */
async function decodeInto(key: string, entry: Entry, blob: Blob): Promise<HTMLImageElement | null> {
  if (cache.get(key) !== entry) return superseded(key);
  const url = URL.createObjectURL(blob);
  entry.url = url;
  const img = await decodeImage(url);
  if (cache.get(key) !== entry) {
    URL.revokeObjectURL(url);
    return superseded(key);
  }
  return img ?? fail('файл не читается как картинка');
}

function store(key: string, make: (entry: Entry) => Promise<HTMLImageElement | null>): Promise<HTMLImageElement | null> {
  const prev = cache.get(key);
  if (prev?.url) URL.revokeObjectURL(prev.url);
  const entry: Entry = { promise: Promise.resolve(null), url: null };
  cache.set(key, entry);
  entry.promise = make(entry);
  return entry.promise;
}

/** Картинка логотипа нанесения: исходник или превью PDF/AI. Один запрос на путь */
export function loadArtworkImage(orderId: string, path: string, hasPreview: boolean): Promise<HTMLImageElement | null> {
  const objectPath = displayPathOf(path, hasPreview);
  if (!orderId || !objectPath) return Promise.resolve(null);
  const hit = cache.get(objectPath);
  if (hit) return hit.promise;
  return store(objectPath, async (entry) => {
    const blob = await cleanBlob(orderId, objectPath, hasPreview);
    return blob ? decodeInto(objectPath, entry, blob) : null;
  });
}

/** Размер растра в пикселях (из заголовка: `px_w`/`px_h` раскладки) */
export interface RasterSize {
  width: number;
  height: number;
}

/**
 * Положить в кэш уже чистый Blob (только что загруженный логотип: SVG после
 * санитайзера, растр с типом по сигнатуре, PNG-превью PDF) — без скачивания.
 * Прежняя картинка по тому же пути освобождается (L8).
 *
 * `size` — пиксели растра из заголовка (`px_w`/`px_h`): растр больше 4096 px
 * уменьшается для показа так же, как при скачивании, иначе холст держал бы
 * исходник (PNG A3 300 dpi, до 80 Мп) до ухода с вкладки. SVG и превью PDF
 * (≤ 2048 px) — `null`. Параметр обязательный, чтобы новый вызов не забыл его.
 */
export function primeArtworkImage(
  path: string,
  hasPreview: boolean,
  blob: Blob,
  size: RasterSize | null,
): Promise<HTMLImageElement | null> {
  const objectPath = displayPathOf(path, hasPreview);
  if (!objectPath) return Promise.resolve(null);
  return store(objectPath, async (entry) => {
    const shown = size ? await downscale(blob, size.width, size.height) : blob;
    return decodeInto(objectPath, entry, shown);
  });
}

/** Освободить все object URL и забыть картинки (смена заказа, уход с вкладки, выход) */
export function releaseArtworkImages(): void {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
}
