/**
 * Файлы заказа v4 — закрытый бакет `order-artworks` (веха 2, миграция C
 * `20261017070826_order_artworks_bucket`).
 *
 * Ключ — строго ASCII: `orders/<id заказа>/<вид>/<uuid>-<ascii-имя>`. Ту же
 * форму проверяют база (`order_artwork_path_ok` — в политиках Storage,
 * в `order_v4_save` и в стражах строк заказа) и `isArtworkPath` здесь.
 * Писать и удалять может автор или руководство, пока заказ — черновик;
 * читать — всякий, кому виден заказ, и только подписанной ссылкой на 10 минут,
 * выданной по требованию (ссылки не хранятся).
 *
 * SVG может нести скрипт. Открытый по подписанной ссылке НАПРЯМУЮ (новая
 * вкладка), он выполнится в origin Storage. Поэтому (правило вехи 3,
 * `docs/rules/pravila-hranilishcha-faylov-zakaza-veha-2-17-10.md`):
 * превью — только `<img src={artworkSignedUrl}>` (скрипты в `<img>` не
 * исполняются), а «открыть в новой вкладке» — только `artworkDownloadUrl`
 * (ответ с `Content-Disposition: attachment`, браузер файл не рисует).
 *
 * Ошибка → `toast.error` и `null`/`false` (правило проекта). Удаление не
 * оптимистичное: ответ Storage ждём и проверяем, что объект и правда удалён.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { asciiFileName } from '../../utils/asciiFileName';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';

export const ARTWORK_BUCKET = 'order-artworks';
/** = `file_size_limit` бакета (26214400) */
export const ARTWORK_MAX_BYTES = 25 * 1024 * 1024;
/** Подписанная ссылка живёт 10 минут: выдаётся по требованию, не хранится */
export const SIGNED_URL_TTL_SEC = 600;

/** = `allowed_mime_types` бакета (сторож `orderArtworksBucket.test.ts` сверяет списки) */
export const ARTWORK_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
  'application/pdf', 'application/postscript', 'application/illustrator',
  'image/vnd.adobe.photoshop', 'image/tiff',
] as const;
export type ArtworkMimeType = (typeof ARTWORK_MIME_TYPES)[number];

export type ArtworkKind = 'logo' | 'flat' | 'tz' | 'label' | 'sticker' | 'note';

/**
 * Тип по расширению — раньше, чем тип браузера. supabase-js грузит File через
 * FormData, и Storage берёт тип из `File.type`, а опцию `contentType` для File
 * не смотрит. У .ai/.eps этот тип зависит от ОС (пусто, `application/postscript`,
 * `application/illustrator`), у .psd/.tif — тоже (у .psd часто пусто), а пустой уходит как `application/octet-stream`,
 * которого бакет не принимает — и не должен.
 */
const TYPE_BY_EXT: Record<string, ArtworkMimeType> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', pdf: 'application/pdf',
  ai: 'application/postscript', eps: 'application/postscript', ps: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop', tif: 'image/tiff', tiff: 'image/tiff',
};

/** Что назвать человеку, когда формат не принят (= ключи TYPE_BY_EXT, без дублей jpeg/tif) */
export const ARTWORK_FORMATS_HINT = 'PNG, JPG, WEBP, SVG, PDF, AI, EPS, PS, PSD, TIFF';

/** Тип, с которым файл уйдёт в бакет, либо `null` — формат бакетом не принимается */
export function artworkContentType(file: Pick<File, 'name' | 'type'>): ArtworkMimeType | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (TYPE_BY_EXT[ext]) return TYPE_BY_EXT[ext];
  return (ARTWORK_MIME_TYPES as readonly string[]).includes(file.type) ? (file.type as ArtworkMimeType) : null;
}

const SEGMENT = '[A-Za-z0-9._-]+';

/** Та же проверка, что `order_artwork_path_ok(order, path)` в базе */
export function isArtworkPath(orderId: string, path: string): boolean {
  const id = orderId.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return false;
  if (!path || path.includes('..')) return false;
  return new RegExp(`^orders/${id}/${SEGMENT}(/${SEGMENT})*$`).test(path);
}

/** Ключ нового файла: `orders/<id>/<вид>/<uuid>-<ascii-имя>`; uuid — чтобы два одинаковых имени не затёрли друг друга */
export function artworkPath(orderId: string, kind: ArtworkKind, fileName: string): string {
  return `orders/${orderId.toLowerCase()}/${kind}/${crypto.randomUUID()}-${asciiFileName(fileName, 'file', 'bin')}`;
}

function fail(context: string, message: string): null {
  toast.error(`${context}: ${message}`);
  return null;
}

/** Загрузка при выборе файла. Возвращает ключ объекта либо `null` */
export async function uploadArtwork(orderId: string, kind: ArtworkKind, file: File): Promise<string | null> {
  if (file.size > ARTWORK_MAX_BYTES) {
    toast.error('Файл больше 25 МБ');
    return null;
  }
  if (file.size === 0) return fail('Файл не загружен', 'файл пустой');
  const type = artworkContentType(file);
  if (!type) return fail('Файл не загружен', `формат не поддерживается (${ARTWORK_FORMATS_HINT})`);
  const path = artworkPath(orderId, kind, file.name);
  if (!isArtworkPath(orderId, path)) return fail('Файл не загружен', 'неверный заказ');
  const body = file.type === type ? file : new File([file], file.name, { type });
  try {
    const { error } = await supabase.storage.from(ARTWORK_BUCKET).upload(path, body, { upsert: false, contentType: type });
    if (error) {
      console.error('uploadArtwork', error);
      return fail('Файл не загружен', translateSupabaseError(error.message));
    }
    return path;
  } catch (e) {
    console.error('uploadArtwork', e);
    return fail('Файл не загружен', networkFailureMessage(e));
  }
}

async function signOne(path: string, download: boolean): Promise<string | null> {
  try {
    const bucket = supabase.storage.from(ARTWORK_BUCKET);
    const { data, error } = download
      ? await bucket.createSignedUrl(path, SIGNED_URL_TTL_SEC, { download: true })
      : await bucket.createSignedUrl(path, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) {
      console.error('artworkSignedUrl', error);
      return fail('Файл не открыт', translateSupabaseError(error?.message));
    }
    return data.signedUrl;
  } catch (e) {
    console.error('artworkSignedUrl', e);
    return fail('Файл не открыт', networkFailureMessage(e));
  }
}

/** Подписанная ссылка на 10 минут для ПОКАЗА (`<img src>`) либо `null`. В новую вкладку её не открывать — см. `artworkDownloadUrl` */
export function artworkSignedUrl(path: string): Promise<string | null> {
  return signOne(path, false);
}

/**
 * Подписанная ссылка на 10 минут для «открыть в новой вкладке» / «скачать»
 * либо `null`. supabase-js дописывает к ней `&download=`, и Storage отдаёт
 * файл с `Content-Disposition: attachment`: браузер его сохраняет, а не
 * рисует, — скрипт в SVG не исполняется в origin Storage.
 */
export function artworkDownloadUrl(path: string): Promise<string | null> {
  return signOne(path, true);
}

/** Пакетно: карта «ключ → ссылка». Файлы без ссылки пропущены (и названы тостом); ошибка запроса — `null` */
export async function artworkSignedUrls(paths: string[]): Promise<Record<string, string> | null> {
  if (paths.length === 0) return {};
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC);
    if (error || !data) {
      console.error('artworkSignedUrls', error);
      return fail('Файлы не открыты', translateSupabaseError(error?.message));
    }
    const out: Record<string, string> = {};
    let missing = 0;
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
      else missing += 1;
    }
    if (missing > 0) toast.error(`Не открыто файлов: ${missing} — их нет или нет доступа`);
    return out;
  } catch (e) {
    console.error('artworkSignedUrls', e);
    return fail('Файлы не открыты', networkFailureMessage(e));
  }
}

/** `removed` — объект удалён; `missing` — Storage ничего не удалил, а вызывающий согласен на «уже нет» */
export type RemoveArtworkResult = 'removed' | 'missing';

/**
 * Удаление: ждём ответ (не оптимистично). Ошибка → тост и `null`.
 *
 * Пустой список без ошибки Storage отдаёт в двух случаях, и различить их
 * по ответу нельзя: файла уже нет ИЛИ RLS не дал удалить (заказ отправлен,
 * чужой заказ). Поэтому решает вызывающий:
 *   · по умолчанию пустой ответ — отказ: тост «нет прав или файла уже нет»
 *     и `null`;
 *   · `{ missingOk: true }` — вызывающий всё равно убирает путь из заказа
 *     (позицию удалили, файл заменили): пустой ответ — `'missing'` без тоста.
 *     Если на деле это был отказ RLS, отказ получит и сохранение заказа —
 *     у них одно условие (черновик, автор или руководство), — так что файл
 *     не «пропадёт» из видимого заказа молча.
 */
export async function removeArtwork(
  path: string,
  opts: { missingOk?: boolean } = {},
): Promise<RemoveArtworkResult | null> {
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).remove([path]);
    if (error) {
      console.error('removeArtwork', error);
      return fail('Файл не удалён', translateSupabaseError(error.message));
    }
    if (!data || data.length === 0) {
      if (opts.missingOk) return 'missing';
      return fail('Файл не удалён', 'нет прав или файла уже нет');
    }
    return 'removed';
  } catch (e) {
    console.error('removeArtwork', e);
    return fail('Файл не удалён', networkFailureMessage(e));
  }
}
