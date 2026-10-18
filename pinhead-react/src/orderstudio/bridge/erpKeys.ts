/**
 * Ключи копий в `erp-attachments` при запуске (веха 6+7, К12) — формат ERP
 * (`tz/…`, `att/…`) без импорта ERP: мост пускает к ERP ровно три модуля и
 * только динамически. Паритет префикса и ASCII с `tzFilePath` /
 * `attachmentFilePath` держит `erpKeys.test.ts`.
 *
 * - Область ключа — `v4-<uuid попытки>`, а не id заказа: бакет публичный и
 *   его список видят все одобренные (К13). Ключ не раскрывает uuid заказа v4
 *   и номер и не угадывается заранее (подложенный файл — 409, отказ).
 * - У вложения в ключе нет человеческого имени: оно только в `file_name`
 *   строки (`erpFileName` на общем `asciiFileName`).
 * - Расширение — по сигнатуре байт (его назначает `launchFiles`).
 */
import { asciiFileName } from '../../utils/asciiFileName';

export type ErpAttachmentKind = 'print' | 'label';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT_RE = /^[a-z0-9]{1,5}$/;

function uuid(v: string, what: string): string {
  if (!UUID_RE.test(v)) throw new Error(`${what}: ожидается uuid`);
  return v;
}

/** Область ключей попытки запуска: `v4-<uuid попытки>` */
export function erpScope(attemptId: string): string {
  return `v4-${uuid(attemptId, 'Попытка запуска')}`;
}

/** Копия PDF ТЗ позиции: `tz/v4-<попытка>/<группа>/v1-tz.pdf` */
export function erpTzKey(attemptId: string, groupId: string): string {
  return `tz/${erpScope(attemptId)}/${uuid(groupId, 'Группа ТЗ')}/v1-tz.pdf`;
}

/** Копия макета или превью бирки: `att/v4-<попытка>/<вид>/<uid>.<ext>` */
export function erpAttachmentKey(attemptId: string, kind: ErpAttachmentKind, uid: string, ext: string): string {
  if (kind !== 'print' && kind !== 'label') throw new Error('Вид вложения: print или label');
  if (!EXT_RE.test(ext)) throw new Error('Расширение файла: латиница и цифры');
  return `att/${erpScope(attemptId)}/${kind}/${uuid(uid, 'Файл')}.${ext}`;
}

/** Имя файла для человека (`file_name` строки ERP): части через «-», ASCII */
export function erpFileName(parts: readonly string[], ext: string): string {
  // Пустая основа — «file»: у «.png» `asciiFileName` счёл бы основой расширение
  const base = parts.map((p) => p.trim()).filter(Boolean).join('-') || 'file';
  return asciiFileName(`${base}.${ext}`, 'file', ext);
}
