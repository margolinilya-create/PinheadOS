/* ── Валидация загружаемых изображений (security ME-1) ──
 *
 * Проблема: uploadOrderAttachment/Preview/uploadSkuPhoto клали файл в ПУБЛИЧНЫЙ
 * бакет, беря content-type из клиентского file.type без allowlist. Загрузив
 * .svg/.html как image/svg+xml / text/html, пользователь добивался исполнения
 * своего JS на storage-origin (*.supabase.co).
 *
 * Фикс: пускать только растровые картинки (jpg/png/webp), content-type брать из
 * этого allowlist (никогда svg/html), расширение — каноническое по MIME (не из
 * имени файла → нет инъекции пути), плюс лимит размера. Даже если содержимое
 * файла — HTML, сохранённый content-type будет image/*, и браузер не исполнит
 * его как скрипт.
 */

/** MIME → каноническое расширение. Только безопасные растровые форматы. */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Дефолтный лимит размера загрузки. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 МБ

export interface UploadCheckOk {
  ok: true;
  /** Каноническое расширение по MIME (jpg/png/webp) — использовать для пути. */
  ext: string;
  /** Проверенный content-type — передавать в storage.upload. */
  contentType: string;
}
export interface UploadCheckErr {
  ok: false;
  error: string;
}
export type UploadCheck = UploadCheckOk | UploadCheckErr;

/**
 * Проверяет файл перед загрузкой в Storage.
 * Возвращает безопасные ext/contentType или ошибку для toast.
 */
export function validateImageUpload(
  file: File,
  opts: { maxBytes?: number } = {}
): UploadCheck {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!file) return { ok: false, error: 'Файл не выбран' };

  const type = (file.type || '').toLowerCase();
  const ext = ALLOWED_IMAGE_TYPES[type];
  if (!ext) {
    return { ok: false, error: 'Только изображения: JPG, PNG или WEBP' };
  }
  if (typeof file.size === 'number') {
    if (file.size === 0) return { ok: false, error: 'Пустой файл' };
    if (file.size > maxBytes) {
      return { ok: false, error: `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ` };
    }
  }
  return { ok: true, ext, contentType: type };
}

/** Санитайзинг сегмента пути в Storage (для предсказуемых имён без traversal). */
export function safePathSegment(raw: string): string {
  return String(raw).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'file';
}
