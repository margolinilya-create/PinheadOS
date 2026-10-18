#!/usr/bin/env node
/**
 * Еженедельный ОТЧЁТ о ничьих файлах заказа и недописанных версиях флэтов
 * (`order-artworks`, `garment-flats`) — веха 8, задача 7, решение К8.
 *
 * ТОЛЬКО ОТЧЁТ: кода удаления здесь нет и не будет (сторож
 * `src/orderstudio/orderFilesGc.test.ts`). Удаляет лишь edge-функция
 * `order-files-gc` по ручному вызову администратора с `apply: true`
 * и при секрете `ORDER_FILES_GC_DELETE=1`, который ставит владелец.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<ключ> \
 *   npm run order-files:gc -- [--paths-out <файл.json>]
 *
 * В stdout и в `$GITHUB_STEP_SUMMARY` — ТОЛЬКО ЧИСЛА: пути `orders/<uuid>/<имя>` —
 * транслит клиентских файлов, часто бренд клиента; в логи Actions им нельзя.
 * Пути кандидатов — только в файл `--paths-out` (в Actions — артефакт на 7 дней).
 *
 * Ошибка любой выборки — кандидатов нет, код выхода 1.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { reportNumbers, runReport } from './lib/orderFileHolders.mjs';

const url = process.env.SUPABASE_URL;
// В секретах GitHub ключ лежит как SUPABASE_SERVICE_KEY (как у storage-backup.yml)
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const outIdx = process.argv.indexOf('--paths-out');
const pathsOut = outIdx > 0 ? process.argv[outIdx + 1] : null;

if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (или SUPABASE_SERVICE_KEY) в окружении.');
  console.error('Ключ обходит RLS целиком — не коммитьте его и не передавайте в чат.');
  process.exit(2);
}
if (outIdx > 0 && !pathsOut) {
  console.error('--paths-out ждёт имя файла.');
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const report = await runReport(db, Date.now());

if (!report.ok) {
  // Текст ошибки — имя таблицы или бакета и ответ сервера, путей в нём нет
  console.error(`Выборка не удалась — кандидатов нет: ${report.error}`);
  process.exit(1);
}

const kb = (bytes) => (bytes / 1024).toFixed(0);
const rows = reportNumbers(report);
const lines = [
  '### Уборка файлов заказа — отчёт (ничего не удалено)',
  '',
  '| Бакет | Объектов | Занятых | Кандидатов | кБ | Придержано по возрасту | Не черновик | По тексту заказа | Непонятный путь |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.bucket} | ${r.objects} | ${r.taken} | ${r.candidates} | ${kb(r.bytes)} | ${r.heldByAge} | ${r.heldNotDraft} | ${r.heldByText} | ${r.heldUnknown} |`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

if (pathsOut) {
  const paths = Object.fromEntries(report.buckets.map((b) => [b.bucket, b.candidates.map((c) => c.path)]));
  writeFileSync(pathsOut, `${JSON.stringify(paths, null, 2)}\n`);
}
