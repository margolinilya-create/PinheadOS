/**
 * Носители файлов заказа и флэтов — отчёт уборки `order-artworks` и `garment-flats`
 * (веха 8, задача 7, решение К8 плана 2026-10-18-order-flow-m8-polish-enable.md).
 *
 * ДВЕ КОПИИ, ОДИН ТЕКСТ. Модуль читают npm-скрипт `scripts/order-files-gc.mjs`
 * (еженедельный отчёт в Actions) и edge-функция `supabase/functions/order-files-gc/`
 * (ручной вызов администратором). Функция деплоится из своего каталога и импортировать
 * отсюда не может, поэтому рядом с ней лежит побайтная копия, а сторож
 * `src/orderstudio/orderFilesGc.test.ts` сверяет копии. Править — здесь, потом копировать.
 *
 * Модуль без импортов и без окружения: клиент Supabase приходит аргументом
 * (`service_role` — только в скрипте и функции), поэтому код одинаково живёт
 * в Node и в Deno.
 *
 * ПОЧЕМУ НЕ `storage-gc`. Состав её носителей сторожит замороженный ERP
 * (`src/erp/utils/storageGc.test.ts`), а её деплой заменил бы живую уборку
 * `erp-attachments`. Эта уборка — отдельная и по умолчанию только ОТЧЁТ.
 *
 * ЧТО ЗНАЧИТ «КАНДИДАТ». Файл бакета старше 7 суток, которого не держит:
 *  · ни одна колонка-носитель (`PATH_COLUMNS`) — включая производное
 *    `<путь>.preview.png` от любого занятого пути;
 *  · ни текст строк ЕГО заказа (`TEXT_HOLDER_TABLES`, как `to_jsonb(row)::text`):
 *    ссылки из `orders.data`, журнала, слоёв холста, истории ТЗ после возврата;
 *  · и заказ — черновик (не черновик — не кандидат никогда).
 * У флэтов кандидат — только версия выше текущей и всей `history[]` найденного
 * флэта, которую не называет ни одна раскладка нанесения: след сорвавшегося
 * `saveFlat` (файлы ушли, справочник — нет).
 *
 * ОШИБКА = НИЧЕГО. Любая ошибка выборки, расхождение страниц с `count: 'exact'`
 * или непонятный справочник флэтов — исключение; `runReport` отвечает пустым
 * списком кандидатов и `ok: false`.
 */

export const ORDER_BUCKET = 'order-artworks';
export const FLATS_BUCKET = 'garment-flats';
/** Строк на страницу выборки (потолок PostgREST по умолчанию) */
export const PAGE = 1000;
/** Объектов на страницу листинга Storage */
const LIST_PAGE = 100;
/** Моложе недели — не кандидат: файл мог уйти в бакет до сохранения строки */
export const MIN_AGE_MS = 7 * 24 * 3600_000;
/** Превью PDF/AI рядом с исходником (`api/artworks.ts`, `PREVIEW_SUFFIX`) */
export const PREVIEW_SUFFIX = '.preview.png';

/**
 * Колонки-носители: каждая колонка `*_path`/`*_paths` таблиц `orders` и `order_*`
 * из миграций (сторож выводит их из SQL и сверяет с этим списком).
 */
export const PATH_COLUMNS = [
  { table: 'orders', column: 'sticker_preview_path' },
  { table: 'order_items', column: 'tz_pdf_path' },
  { table: 'order_item_prints', column: 'artwork_path' },
  { table: 'order_item_labels', column: 'attach_image_path' },
  { table: 'order_item_labels', column: 'preview_paths', array: true },
  { table: 'order_notes_cards', column: 'image_path' },
];

/** Текстовый носитель: строки заказа целиком (ключ ищется в их JSON) */
export const TEXT_HOLDER_TABLES = [
  'orders', 'order_items', 'order_item_prints', 'order_item_labels', 'order_notes_cards', 'order_events',
];

/** Носители флэтов: справочник версий и раскладки нанесений заказов */
export const FLAT_HOLDERS = {
  catalogTable: 'app_config',
  catalogKey: 'garmentFlats',
  layoutTable: 'order_item_prints',
  layoutColumn: 'layout',
};

const ORDER_PATH_RE = /^orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//;
const FLAT_PATH_RE = /^flats\/([A-Za-z0-9_-]+)\/v([1-9][0-9]{0,3})\/[A-Za-z0-9._-]+$/;
/** id в `.in()` за запрос: держит длину адреса PostgREST */
const IN_CHUNK = 100;

/**
 * Удаление — только при ДВУХ условиях сразу: `apply: true` в теле ручного вызова
 * и секрет функции `ORDER_FILES_GC_DELETE` ровно `'1'` (решение владельца).
 * Любое другое значение — отчёт.
 */
export function deleteAllowed(body, secret) {
  return body != null && typeof body === 'object' && body.apply === true && secret === '1';
}

/** Все объекты бакета: рекурсивно и постранично (у «папки» `id === null`) */
export async function listBucket(db, bucket, prefix = '', acc = []) {
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await db.storage.from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`листинг ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const e of data) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) await listBucket(db, bucket, path, acc);
      else acc.push({ path, size: e.metadata?.size ?? 0, createdAt: e.created_at });
    }
    if (data.length < LIST_PAGE) break;
  }
  return acc;
}

/**
 * Все строки выборки постранично со сверкой с `count: 'exact'`: число строк
 * не меняется между страницами и равно собранному, иначе — ошибка
 * (строка, вставленная во время обхода, сдвинула бы хвост мимо проверки).
 */
export async function fetchAll(db, table, columns, filter = (q) => q, orderBy = 'id') {
  const rows = [];
  let expected = null;
  for (let from = 0; ; from += PAGE) {
    const query = filter(db.from(table).select(columns, { count: 'exact' }));
    const { data, error, count } = await query.order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (typeof count !== 'number') throw new Error(`${table}: сервер не вернул число строк`);
    if (expected === null) expected = count;
    else if (count !== expected) throw new Error(`${table}: число строк изменилось во время выборки`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (rows.length !== expected) {
    throw new Error(`${table}: прочитано ${rows.length} строк из ${expected}`);
  }
  return rows;
}

/** Занятые пути по колонкам + производные превью */
async function columnHolders(db) {
  const taken = new Set();
  for (const { table, column, array } of PATH_COLUMNS) {
    const rows = await fetchAll(db, table, `id, ${column}`);
    for (const row of rows) {
      const values = array ? (Array.isArray(row[column]) ? row[column] : []) : [row[column]];
      for (const v of values) {
        if (typeof v === 'string' && v) {
          taken.add(v);
          taken.add(v + PREVIEW_SUFFIX);
        }
      }
    }
  }
  return taken;
}

const isOld = (createdAt, now) => {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t <= now - MIN_AGE_MS;
};

const inChunks = (ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(ids.slice(i, i + IN_CHUNK));
  return out;
};

/** Строки заказа целиком: шапка, позиции, нанесения, бирки, карточки, журнал */
async function orderRows(db, orderId) {
  const byOrder = (q) => q.eq('order_id', orderId);
  const orders = await fetchAll(db, 'orders', '*', (q) => q.eq('id', orderId));
  const items = await fetchAll(db, 'order_items', '*', byOrder);
  const itemIds = items.map((i) => i.id);
  const prints = [];
  const labels = [];
  for (const chunk of inChunks(itemIds)) {
    prints.push(...await fetchAll(db, 'order_item_prints', '*', (q) => q.in('item_id', chunk)));
    labels.push(...await fetchAll(db, 'order_item_labels', '*', (q) => q.in('item_id', chunk)));
  }
  const notes = await fetchAll(db, 'order_notes_cards', '*', byOrder);
  const events = await fetchAll(db, 'order_events', '*', byOrder);
  return { order: orders[0] ?? null, rows: [...orders, ...items, ...prints, ...labels, ...notes, ...events] };
}

const emptyReport = (bucket, objects) => ({
  bucket,
  objects: objects.length,
  taken: 0,
  heldByAge: 0,
  heldNotDraft: 0,
  heldNoOrder: 0,
  heldByText: 0,
  heldUnknown: 0,
  candidates: [],
  bytes: 0,
});

const addCandidate = (r, o) => {
  r.candidates.push({ path: o.path, size: o.size });
  r.bytes += o.size;
};

/** Отчёт по `order-artworks`; бросает на любой ошибке */
export async function orderArtworksReport(db, now) {
  const objects = await listBucket(db, ORDER_BUCKET);
  const r = emptyReport(ORDER_BUCKET, objects);
  const taken = await columnHolders(db);
  const byOrder = new Map();
  for (const o of objects) {
    if (taken.has(o.path)) { r.taken += 1; continue; }
    if (!isOld(o.createdAt, now)) { r.heldByAge += 1; continue; }
    const m = ORDER_PATH_RE.exec(o.path);
    if (!m) { r.heldUnknown += 1; continue; }
    if (!byOrder.has(m[1])) byOrder.set(m[1], []);
    byOrder.get(m[1]).push(o);
  }
  for (const [orderId, files] of byOrder) {
    const { order, rows } = await orderRows(db, orderId);
    // Строки заказа нет — статус неизвестен (удалить можно и в обход стража:
    // service_role, SQL Editor). Непонятное = ничего: придержать
    if (!order) { r.heldNoOrder += files.length; continue; }
    if (order.status !== 'draft') { r.heldNotDraft += files.length; continue; }
    const text = rows.map((row) => JSON.stringify(row)).join('\n');
    for (const o of files) {
      const base = o.path.endsWith(PREVIEW_SUFFIX) ? o.path.slice(0, -PREVIEW_SUFFIX.length) : o.path;
      if (text.includes(o.path) || text.includes(base)) r.heldByText += 1;
      else addCandidate(r, o);
    }
  }
  return r;
}

/** Справочник флэтов: id → наибольшая известная версия; непонятное — ошибка */
async function flatVersions(db) {
  const { catalogTable, catalogKey } = FLAT_HOLDERS;
  const rows = await fetchAll(db, catalogTable, 'key, value', (q) => q.eq('key', catalogKey), 'key');
  if (rows.length !== 1) throw new Error(`${catalogKey}: справочник не найден`);
  const flats = rows[0]?.value?.flats;
  if (!Array.isArray(flats)) throw new Error(`${catalogKey}: нет списка флэтов`);
  const max = new Map();
  for (const f of flats) {
    const versions = [f?.version, ...(Array.isArray(f?.history) ? f.history.map((h) => h?.version) : [])];
    if (typeof f?.id !== 'string' || !versions.every((v) => Number.isInteger(v) && v > 0)) {
      throw new Error(`${catalogKey}: флэт без id или с версией не числом`);
    }
    max.set(f.id, Math.max(...versions));
  }
  return max;
}

/** Версии флэтов, которые называют раскладки нанесений (`flat_id@flat_version`) */
async function layoutVersions(db) {
  const { layoutTable, layoutColumn } = FLAT_HOLDERS;
  const rows = await fetchAll(db, layoutTable, `id, ${layoutColumn}`, (q) => q.not(layoutColumn, 'is', null));
  const held = new Set();
  for (const row of rows) {
    const l = row[layoutColumn];
    if (l && typeof l.flat_id === 'string') held.add(`${l.flat_id}@${Number(l.flat_version)}`);
  }
  return held;
}

/** Отчёт по `garment-flats`; бросает на любой ошибке */
export async function garmentFlatsReport(db, now) {
  const objects = await listBucket(db, FLATS_BUCKET);
  const r = emptyReport(FLATS_BUCKET, objects);
  const known = await flatVersions(db);
  const inLayouts = await layoutVersions(db);
  for (const o of objects) {
    const m = FLAT_PATH_RE.exec(o.path);
    if (!m || !known.has(m[1])) { r.heldUnknown += 1; continue; }
    const version = Number(m[2]);
    if (version <= known.get(m[1]) || inLayouts.has(`${m[1]}@${version}`)) { r.taken += 1; continue; }
    if (!isOld(o.createdAt, now)) { r.heldByAge += 1; continue; }
    addCandidate(r, o);
  }
  return r;
}

/** Оба бакета; ошибка любого — `ok: false` и ни одного кандидата */
export async function runReport(db, now = Date.now()) {
  try {
    const buckets = [await orderArtworksReport(db, now), await garmentFlatsReport(db, now)];
    return { ok: true, buckets };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), buckets: [] };
  }
}

/** Только числа — для логов и summary Actions: пути клиентов туда не попадают */
export function reportNumbers(report) {
  return report.buckets.map((b) => ({
    bucket: b.bucket,
    objects: b.objects,
    taken: b.taken,
    candidates: b.candidates.length,
    bytes: b.bytes,
    heldByAge: b.heldByAge,
    heldNotDraft: b.heldNotDraft,
    heldNoOrder: b.heldNoOrder,
    heldByText: b.heldByText,
    heldUnknown: b.heldUnknown,
  }));
}
