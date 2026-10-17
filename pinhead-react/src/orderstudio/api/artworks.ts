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
] as const;
export type ArtworkMimeType = (typeof ARTWORK_MIME_TYPES)[number];

export type ArtworkKind = 'logo' | 'flat' | 'tz' | 'label' | 'sticker' | 'note';

/**
 * Тип по расширению — раньше, чем тип браузера. supabase-js грузит File через
 * FormData, и Storage берёт тип из `File.type`, а опцию `contentType` для File
 * не смотрит. У .ai/.eps этот тип зависит от ОС (пусто, `application/postscript`,
 * `application/illustrator`), а пустой уходит как `application/octet-stream`,
 * которого бакет не принимает — и не должен.
 */
const TYPE_BY_EXT: Record<string, ArtworkMimeType> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', pdf: 'application/pdf',
  ai: 'application/postscript', eps: 'application/postscript', ps: 'application/postscript',
};

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
  if (!type) return fail('Файл не загружен', 'формат не поддерживается (PNG, JPG, WEBP, SVG, PDF, AI, EPS)');
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

/** Подписанная ссылка на 10 минут либо `null` */
export async function artworkSignedUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC);
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

/**
 * Удаление: ждём ответ. Storage на объект, который RLS не дал удалить
 * (заказ уже отправлен, чужой заказ), отвечает БЕЗ ошибки пустым списком —
 * это тоже отказ, а не «удалено».
 */
export async function removeArtwork(path: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).remove([path]);
    if (error) {
      console.error('removeArtwork', error);
      fail('Файл не удалён', translateSupabaseError(error.message));
      return false;
    }
    if (!data || data.length === 0) {
      fail('Файл не удалён', 'нет прав или файла уже нет');
      return false;
    }
    return true;
  } catch (e) {
    console.error('removeArtwork', e);
    fail('Файл не удалён', networkFailureMessage(e));
    return false;
  }
}
