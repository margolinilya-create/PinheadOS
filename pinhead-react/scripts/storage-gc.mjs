#!/usr/bin/env node
/**
 * Уборка ничьих файлов в бакете `erp-attachments`.
 *
 * ЗАЧЕМ. Правило проекта требует, чтобы файл уходил вместе со строкой,
 * которая на него ссылается: «без этого бакет копит платные файлы, которые
 * никому не принадлежат и, пока он публичный, доступны по ссылке». Правило
 * соблюдалось не всегда — разбор 13.09 нашёл 208 объектов (402 МБ из 457),
 * не принадлежащих ни одной строке, причём 168 из них осиротели ЗАДОЛГО
 * до той уборки. Сам по себе такой файл не виден ни на одном экране, то есть
 * не найдётся, пока его не пойти искать.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ SQL. Supabase запрещает удаление из
 * `storage.objects` напрямую — триггер `protect_objects_delete`:
 *
 *   Direct deletion from storage tables is not allowed. Use the Storage API
 *   instead. HINT: This prevents accidental data loss from orphaned objects.
 *
 * Запрет верный: строка в `storage.objects` это МЕТАДАННЫЕ, а сам объект
 * лежит в S3. Снеси метаданные — файл пропадёт с раздачи, но останется
 * в хранилище и продолжит тарифицироваться, уже без всякого следа о том,
 * что чистить. Поэтому единственная правильная дорога — Storage API,
 * а он требует ключ `service_role`.
 *
 * ПОЧЕМУ КЛЮЧ НЕ В РЕПОЗИТОРИИ. `service_role` обходит RLS ЦЕЛИКОМ. Он
 * читается из окружения и никуда не пишется:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<ключ> \
 *   node scripts/storage-gc.mjs            # только показать, НИЧЕГО не трогая
 *   node scripts/storage-gc.mjs --apply    # удалить
 *
 * ЧТО СЧИТАЕТСЯ НИЧЬИМ. Объект бакета, чей ключ не встречается ни в
 * `erp_order_attachments.file_path`, ни в `erp_tz_documents.file_path`.
 * Проверено 13.09, что других носителей пути нет: колонок, чьё имя содержит
 * `file`, `path` или `url`, в схеме больше нет, и ни одна JSONB-колонка
 * (`erp_order_drafts.payload`, `erp_experimental.final_package`,
 * `orders.data`, `erp_stage_reports.extra`, `order_templates.data`)
 * подстрок `att/` и `tz/` не содержит. Появится третий носитель — впишите
 * его в REFERENCES, иначе скрипт сотрёт живой файл.
 *
 * БЕЗ `--apply` НИЧЕГО НЕ УДАЛЯЕТСЯ. Умолчание — показать список и объём:
 * у необратимого действия умолчанием не бывает «сделать».
 */

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'erp-attachments';

/** Таблицы и колонки, которые ДЕРЖАТ ключ объекта в этом бакете */
const REFERENCES = [
  { table: 'erp_order_attachments', column: 'file_path' },
  { table: 'erp_tz_documents', column: 'file_path' },
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes('--apply');

if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в окружении.');
  console.error('Ключ `service_role` лежит в Supabase → Settings → API.');
  console.error('Он обходит RLS целиком — не коммитьте его и не передавайте в чат.');
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** Постранично: `list` отдаёт максимум 100 за раз, а в бакете их сотни */
async function listAll(prefix = '', acc = []) {
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // У папки нет `id` — это единственный признак, по которому её видно
      if (entry.id === null) await listAll(path, acc);
      else acc.push({ path, size: entry.metadata?.size ?? 0 });
    }
    if (data.length < PAGE) break;
  }
  return acc;
}

/** Все занятые ключи — постранично: строк больше, чем отдаёт один запрос */
async function referencedPaths() {
  const taken = new Set();
  for (const { table, column } of REFERENCES) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from(table).select(column).not(column, 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}.${column}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) taken.add(row[column]);
      if (data.length < PAGE) break;
    }
  }
  return taken;
}

const human = (bytes) => {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} МБ` : `${(bytes / 1024).toFixed(0)} кБ`;
};

const objects = await listAll();
const taken = await referencedPaths();
const orphans = objects.filter((o) => !taken.has(o.path));
const bytes = orphans.reduce((sum, o) => sum + o.size, 0);

console.log(`бакет:     ${BUCKET}`);
console.log(`объектов:  ${objects.length}`);
console.log(`занятых:   ${taken.size} (по ${REFERENCES.map((r) => r.table).join(' и ')})`);
console.log(`ничьих:    ${orphans.length}, ${human(bytes)}\n`);

if (orphans.length === 0) {
  console.log('Убирать нечего.');
  process.exit(0);
}

for (const o of orphans) console.log(`  ${o.path}  (${human(o.size)})`);

if (!apply) {
  console.log(`\nНичего не удалено. Чтобы удалить: node ${process.argv[1].split('/').pop()} --apply`);
  process.exit(0);
}

/**
 * `remove` принимает до 1000 ключей за раз, но отвечает СПИСКОМ УДАЛЁННОГО,
 * а не ошибкой на каждый промах: короткий ответ означает, что часть ключей
 * не убралась, и это надо назвать, а не посчитать успехом.
 */
let removed = 0;
for (let i = 0; i < orphans.length; i += 100) {
  const batch = orphans.slice(i, i + 100).map((o) => o.path);
  const { data, error } = await db.storage.from(BUCKET).remove(batch);
  if (error) {
    console.error(`\nПартия ${i / 100 + 1}: ${error.message}`);
    process.exit(1);
  }
  removed += data?.length ?? 0;
}

console.log(`\nУдалено: ${removed} из ${orphans.length}.`);
if (removed !== orphans.length) {
  console.error('Убралось не всё — перезапустите и посмотрите, что осталось.');
  process.exit(1);
}
