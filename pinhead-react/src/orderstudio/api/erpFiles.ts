/**
 * Единственный писатель бакета `erp-attachments` из Order (веха 6+7, К12).
 *
 * При запуске МС копирует в производство PDF ТЗ групп и макеты нанесений и
 * бирок. Бакет ПУБЛИЧНЫЙ (`public = true`, К13): файл, положенный сюда,
 * видят по списку бакета все одобренные сотрудники и любой, у кого есть
 * ссылка. Поэтому здесь — всё, что делает копию безопасной:
 * - только `upload` с `upsert: false` (ни `update`, ни `remove`, ни `move`/`copy`);
 * - ключ только `tz/v4-<uuid попытки>/…` или `att/v4-<uuid попытки>/…`, ASCII,
 *   без `..` — без id заказа и номера, не угадывается заранее;
 * - `contentType` — только из белого списка `ERP_FILE_TYPES`, его назначает
 *   ВЫЗЫВАЮЩИЙ по сигнатуре байт (`sniffArtwork`), а тело перекладывается в
 *   `Blob` этого типа: тип исходного `Blob` (`blob.type`) сюда не доходит —
 *   иначе SVG со скриптом под именем `.png` исполнился бы на origin Storage;
 * - предел 20 МБ до запроса;
 * - 409 Duplicate — НЕ успех: файл по этому ключу положил кто-то другой
 *   (подложенный файл приняли бы за свой). Повтор запуска идёт с новыми
 *   ключами (новый uuid попытки).
 *
 * Сторож — `orderstudio/erpFilesWrites.test.ts`.
 */
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { networkFailureMessage, translateSupabaseError } from '../../utils/i18n';

export const ERP_ATTACHMENTS_BUCKET = 'erp-attachments';
/** Предел файла в производстве — до запроса */
export const ERP_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Типы, которые Order кладёт в публичный бакет; только по сигнатуре байт */
export const ERP_FILE_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml', 'application/postscript',
] as const;
export type ErpFileType = (typeof ERP_FILE_TYPES)[number];

export type ErpUploadResult = { ok: true; path: string; size: number } | { ok: false; reason: string };

export const ERP_DUPLICATE_REASON = 'Файл с таким именем уже есть в производстве — повторите запуск';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SEGMENT = '[A-Za-z0-9._-]+';
/** `tz/v4-<uuid>/…` или `att/v4-<uuid>/…`; дальше — ASCII-сегменты */
const KEY_RE = new RegExp(`^(tz|att)/v4-${UUID}(/${SEGMENT})+$`);

/** Ключ копии в `erp-attachments` допустим: префикс попытки, ASCII, без `..` */
export function isErpFileKey(path: string): boolean {
  return !!path && !path.includes('..') && !path.includes('//') && KEY_RE.test(path);
}

interface StorageError {
  message?: string;
  statusCode?: string | number;
  error?: string;
}

function isDuplicate(e: StorageError): boolean {
  return String(e.statusCode ?? '') === '409'
    || /duplicate|already exists/i.test(`${e.error ?? ''} ${e.message ?? ''}`);
}

/**
 * Загрузка копии файла в производство. Отказы проверок — без запроса и без
 * тоста (причину показывает шаг запуска); 409 — `ok: false` с текстом про
 * повтор; прочая ошибка Storage — тост и `ok: false`.
 */
export async function uploadErpFile(path: string, body: Blob, contentType: ErpFileType): Promise<ErpUploadResult> {
  if (!isErpFileKey(path)) return { ok: false, reason: 'Неверный путь файла в производстве' };
  if (!(ERP_FILE_TYPES as readonly string[]).includes(contentType)) {
    return { ok: false, reason: 'Этот тип файла в производство не копируется' };
  }
  if (body.size === 0) return { ok: false, reason: 'Файл пустой' };
  if (body.size > ERP_FILE_MAX_BYTES) return { ok: false, reason: 'Файл больше 20 МБ — производство его не примет' };
  // Тип — только назначенный вызывающим: тело перекладывается в Blob этого типа
  const typed = new Blob([body], { type: contentType });
  try {
    const { error } = await supabase.storage.from(ERP_ATTACHMENTS_BUCKET).upload(path, typed, { upsert: false, contentType });
    if (error) {
      const e = error as StorageError;
      if (isDuplicate(e)) return { ok: false, reason: ERP_DUPLICATE_REASON };
      console.error('uploadErpFile', error);
      const reason = `Файл не скопирован в производство: ${translateSupabaseError(e.message)}`;
      toast.error(reason);
      return { ok: false, reason };
    }
    return { ok: true, path, size: typed.size };
  } catch (e) {
    console.error('uploadErpFile', e);
    const reason = `Файл не скопирован в производство: ${networkFailureMessage(e)}`;
    toast.error(reason);
    return { ok: false, reason };
  }
}
