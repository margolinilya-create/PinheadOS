/**
 * Мок Storage для e2e: объекты с телом (веха 5а), список «папок» (5б) и правила
 * бакета `erp-attachments` (веха 6+7, К12): повтор ключа — 409 Duplicate
 * (всегда, а не только с картой `storageObjects`), больше 30 МБ — 413, счётчик
 * загрузок по попытке запуска (`tz/v4-<uuid>/…`, `att/v4-<uuid>/…`).
 * `order-artworks` (PDF ТЗ и макеты) — общие правила: с картой тело хранится и
 * читается `download`.
 *
 * Регистрирует модуль `mockSupabase.ts` (маршрут `**\/storage/v1/**`).
 */

export type StorageReply = { status: number; type?: string; body?: unknown };

/** Что знает модуль о наборе `MockExtras` */
type StorageExtras = {
  storageObjects?: Record<string, { type: string; body: Buffer }>;
  storageListHidden?: string[];
};

export const ERP_BUCKET = 'erp-attachments';
/** Предел файла в производстве, как у писателя Order `api/erpFiles.ts` */
export const ERP_FILE_LIMIT = 30 * 1024 * 1024;

const DUPLICATE = { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' };
const TOO_LARGE = { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' };

/** Ключи `erp-attachments` и загрузки по попыткам — на каждый набор свои */
const erpState = new WeakMap<object, { keys: Set<string>; byAttempt: Map<string, number> }>();

function erpOf(extra: object) {
  let st = erpState.get(extra);
  if (!st) {
    st = { keys: new Set(), byAttempt: new Map() };
    erpState.set(extra, st);
  }
  return st;
}

/** Загрузки в `erp-attachments` по uuid попытки запуска — для проверок повтора (e2e T6, T7) */
export function erpUploadsByAttempt(extra: object): Map<string, number> {
  return erpOf(extra).byAttempt;
}

/** Файл из multipart/form-data supabase-js (часть с `Content-Type`); иначе тело как есть */
export function uploadedFile(contentType: string, buf: Buffer): { type: string; body: Buffer } {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!contentType.startsWith('multipart/form-data') || !boundary) return { type: contentType, body: buf };
  const sep = Buffer.from(`--${boundary}`);
  let from = buf.indexOf(sep);
  while (from >= 0) {
    const next = buf.indexOf(sep, from + sep.length);
    if (next < 0) break;
    const part = buf.subarray(from + sep.length, next);
    const headEnd = part.indexOf('\r\n\r\n');
    const head = headEnd >= 0 ? part.subarray(0, headEnd).toString() : '';
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (type) return { type: type.trim(), body: part.subarray(headEnd + 4, part.length - 2) };
    from = next;
  }
  return { type: contentType, body: buf };
}

/** Правила `erp-attachments`: 413 больше 30 МБ, 409 на повтор ключа; иначе ключ учтён */
function erpWrite(name: string, file: { body: Buffer }, upsert: string | undefined, extra: object): StorageReply | null {
  if (!name.startsWith(`${ERP_BUCKET}/`)) return null;
  if (file.body.length > ERP_FILE_LIMIT) return { status: 413, body: TOO_LARGE };
  const st = erpOf(extra);
  if (st.keys.has(name) && upsert !== 'true') return { status: 400, body: DUPLICATE };
  st.keys.add(name);
  const attempt = /^erp-attachments\/(?:tz|att)\/v4-([0-9a-f-]{36})\//.exec(name)?.[1];
  if (attempt) st.byAttempt.set(attempt, (st.byAttempt.get(attempt) ?? 0) + 1);
  return null;
}

/** Загрузка `<bucket>/<path>`: с картой — хранит тело, повтор без upsert — 409 Duplicate */
export function storageWrite(
  name: string, contentType: string, buf: Buffer, upsert: string | undefined, extra: StorageExtras,
): StorageReply {
  const file = uploadedFile(contentType, buf);
  const erp = erpWrite(name, file, upsert, extra);
  if (erp) return erp;
  const objects = extra.storageObjects;
  if (!objects) return { status: 200 };
  if (objects[name] && upsert !== 'true') return { status: 400, body: DUPLICATE };
  objects[name] = file;
  return { status: 200 };
}

/** Строка ответа `list` как у Storage: у «папки» `id: null` и нет метаданных */
type StorageListRow = { name: string; id: string | null; metadata: Record<string, unknown> | null };

/**
 * `POST object/list/<bucket>` (`{ prefix, limit, offset }`): имена непосредственно
 * под `prefix` из карты `storageObjects` — «папки» (`id: null`) и файлы, по
 * алфавиту, страницей `offset…offset+limit`. Ключи `storageListHidden` не
 * видны; папка, все объекты которой скрыты, не видна тоже. Без карты — `[]`
 * (прежнее поведение).
 */
export function storageList(bucket: string, body: Record<string, unknown>, extra: StorageExtras): StorageListRow[] {
  const objects = extra.storageObjects;
  if (!objects) return [];
  const prefix = String(body.prefix ?? '').replace(/\/+$/, '');
  const base = `${bucket}/${prefix ? `${prefix}/` : ''}`;
  const hidden = new Set(extra.storageListHidden ?? []);
  const found = new Map<string, boolean>();
  for (const key of Object.keys(objects)) {
    if (hidden.has(key) || !key.startsWith(base)) continue;
    const rest = key.slice(base.length);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    if (name) found.set(name, (found.get(name) ?? false) || slash >= 0);
  }
  const rows = [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, folder]): StorageListRow => (folder
      ? { name, id: null, metadata: null }
      : { name, id: `mock-${name}`, metadata: { size: objects[`${base}${name}`].body.length, mimetype: objects[`${base}${name}`].type } }));
  const offset = Number(body.offset ?? 0) || 0;
  const limit = Number(body.limit ?? 100) || 100;
  return rows.slice(offset, offset + limit);
}

/** Чтение `GET object/[authenticated/|sign/|public/]<bucket>/<path>`: тело из карты или 404 */
export function storageRead(method: string, key: string, extra: StorageExtras): StorageReply {
  if (method !== 'GET' || !extra.storageObjects) return { status: 404 };
  const segs = key.split('/').map(decodeURIComponent);
  const name = (['authenticated', 'sign', 'public'].includes(segs[0]) ? segs.slice(1) : segs).join('/');
  const hit = extra.storageObjects[name];
  return hit ? { status: 200, type: hit.type, body: hit.body } : { status: 404 };
}
