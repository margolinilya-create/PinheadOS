/**
 * Файлы заказа v4 — закрытый бакет `order-artworks` (веха 2, миграция C
 * `20261017070826_order_artworks_bucket`).
 *
 * Ключ — строго ASCII: `orders/<id заказа>/<вид>/<uuid>-<ascii-имя>`. Ту же
 * форму проверяют база (`order_artwork_path_ok` — в политиках Storage,
 * в `order_v4_save` и в стражах строк заказа) и `isArtworkPath` здесь.
 * Писать (новый ключ) и удалять может автор или руководство, пока заказ — черновик;
 * UPDATE (upsert, move) бакет запрещает всем (restrictive `order_artworks_no_update`),
 * поэтому загрузка — только `upsert: false`, а `move`/`copy` клиент не зовёт;
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
 * Ошибка → `toast.error` и `null` (правило проекта). Удаление не
 * оптимистичное: ответ Storage ждём; `removeArtwork` возвращает `'removed'`,
 * `'missing'` (пустой ответ при `{ missingOk: true }` — без тоста) или `null`.
 *
 * Превью PDF/AI для холста (веха 5а, решение 3; проверка безопасности M3)
 * лежит по ВЫВОДИМОМУ пути `<исходник>.preview.png`: путей в `layout` нет,
 * сервер их не проверяет. Пишет его только `uploadArtworkPreview` (путь
 * вычисляется, а не приходит; только PNG по сигнатуре; `upsert: false`),
 * удаляется оно вместе с исходником (`removeArtwork`). Холст читает файлы
 * только `downloadArtwork` → Blob (подписанная ссылка на холст не идёт).
 * Уборка «ничьих» файлов и копирование в ERP (вехи 6–7) обязаны знать
 * `.preview.png` (правило вехи 5а). Сторож `artworkWrites.test.ts`: запись
 * в бакет — только из этого модуля.
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

/** Расширения, которые принимает клиент (ключи TYPE_BY_EXT) */
export const ARTWORK_EXTENSIONS: readonly string[] = Object.keys(TYPE_BY_EXT);

/** Что назвать человеку, когда формат не принят: каждое принимаемое расширение */
export const ARTWORK_FORMATS_HINT = 'PNG, JPG, JPEG, WEBP, SVG, PDF, AI, EPS, PS, PSD, TIF, TIFF';

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

/** Первые байты файла совпадают с сигнатурой */
async function hasSig(blob: Blob, sig: readonly number[]): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, sig.length).arrayBuffer());
  return sig.every((v, i) => head[i] === v);
}

/**
 * Загрузка проверенного по сигнатуре файла с явным типом, `upsert: false`
 * (превью макета, PDF ТЗ): не та сигнатура — отказ `notSig`, иначе путь
 * либо `null` с тостом.
 */
async function putChecked(
  path: string, blob: Blob, sig: readonly number[], type: string, context: string, notSig: string,
): Promise<string | null> {
  try {
    if (!(await hasSig(blob, sig))) return fail(context, notSig);
    const body = new Blob([blob], { type });
    const { error } = await supabase.storage.from(ARTWORK_BUCKET).upload(path, body, { upsert: false, contentType: type });
    if (error) {
      console.error(context, error);
      return fail(context, translateSupabaseError(error.message));
    }
    return path;
  } catch (e) {
    console.error(context, e);
    return fail(context, networkFailureMessage(e));
  }
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

// ── PDF ТЗ группы (веха 6+7, К1) ────────────────────────────────────────

/** Порог сервера при отправке (миграция J: `size <= 8388608`) — больше не уйдёт в работу */
export const TZ_PDF_MAX_BYTES = 8 * 1024 * 1024;

const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/**
 * PDF ТЗ группы → `orders/<id>/tz/<uuid>-<имя>`. Имя (`tzFileName`) несёт хэши
 * группы и содержимого в начале — `asciiFileName` режет только хвост. Тип —
 * только `application/pdf` и только по сигнатуре `%PDF-`; `upsert: false`:
 * новая версия получает новый ключ (снимок не меняется задним числом).
 */
export async function uploadTzPdf(orderId: string, blob: Blob, fileName: string): Promise<string | null> {
  const context = 'ТЗ не загружено';
  const path = artworkPath(orderId, 'tz', fileName);
  if (!isArtworkPath(orderId, path)) return fail(context, 'неверный заказ');
  // Пустой файл отсекает проверка сигнатуры
  if (blob.size > TZ_PDF_MAX_BYTES) return fail(context, 'PDF больше 8 МБ');
  return putChecked(path, blob, PDF_SIG, 'application/pdf', context, 'файл не PDF');
}

// ── Превью PDF/AI и чтение для холста (веха 5а) ─────────────────────────

/** Суффикс превью: `<исходник>.preview.png` (решение 3 плана вехи 5а) */
export const PREVIEW_SUFFIX = '.preview.png';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPreviewPath(path: string): boolean {
  return path.endsWith(PREVIEW_SUFFIX);
}

/** Путь превью исходника; у самого превью превью нет — пустая строка */
export function artworkPreviewPath(sourcePath: string): string {
  return !sourcePath || isPreviewPath(sourcePath) ? '' : `${sourcePath}${PREVIEW_SUFFIX}`;
}

/**
 * Превью PDF/AI рядом с исходником. Путь выводится из исходника (M3): клиент не
 * может положить «превью» по произвольному ключу; только PNG по сигнатуре,
 * тип `image/png`, `upsert: false`. Возвращает путь превью либо `null`.
 */
export async function uploadArtworkPreview(orderId: string, sourcePath: string, png: Blob): Promise<string | null> {
  const context = 'Превью макета не загружено';
  const path = artworkPreviewPath(sourcePath);
  if (!path || !isArtworkPath(orderId, sourcePath) || !isArtworkPath(orderId, path)) return fail(context, 'неверный путь');
  if (png.size === 0) return fail(context, 'файл пустой');
  if (png.size > ARTWORK_MAX_BYTES) return fail(context, 'файл больше 25 МБ');
  return putChecked(path, png, PNG_SIG, 'image/png', context, 'превью не PNG');
}

/**
 * Файл заказа байтами — для холста (веха 5а): подписанная ссылка на холст
 * не идёт, только `download()` → Blob. Путь обязан принадлежать заказу.
 * Тип файла ответу не доверяется — его определяет вызывающий по байтам (H2).
 */
export async function downloadArtwork(orderId: string, path: string): Promise<Blob | null> {
  const context = 'Макет не загружен с сервера';
  if (!isArtworkPath(orderId, path)) return fail(context, 'неверный путь');
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).download(path);
    if (error || !data) {
      console.error('downloadArtwork', error);
      return fail(context, error ? translateSupabaseError(error.message) : 'пустой ответ');
    }
    if (data.size > ARTWORK_MAX_BYTES) return fail(context, 'файл больше 25 МБ');
    return data;
  } catch (e) {
    console.error('downloadArtwork', e);
    return fail(context, networkFailureMessage(e));
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
  // Превью PDF/AI уходит вместе с исходником одним запросом; его может и не быть —
  // тогда Storage просто не назовёт его в ответе
  const preview = artworkPreviewPath(path);
  try {
    const { data, error } = await supabase.storage.from(ARTWORK_BUCKET).remove(preview ? [path, preview] : [path]);
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
