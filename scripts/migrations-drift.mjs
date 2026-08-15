#!/usr/bin/env node
/**
 * Сверка «что применено на базе» с «что лежит в репозитории».
 *
 * ЗАЧЕМ. 15.08.2026 обнаружилось, что на проде работают три миграции от 13.08,
 * файлов которых нет ни в одной ветке git (`erp_stage_guard_ready`,
 * `erp_catalog_edit_policies`, `erp_guards_and_grants`). Это тяжелее любой
 * отдельной дыры: весь слой сторожевых тестов проекта читает МИГРАЦИИ, то есть
 * сверял код с текстом, который база не исполняет, — а восстановление схемы
 * из репозитория вернуло бы старые политики.
 *
 * ПОЧЕМУ СНИМОК, А НЕ ПРОСТО DIFF. Имена в `supabase_migrations.schema_migrations`
 * задаются при применении и исторически расходятся с именами файлов: одна и та же
 * правка лежит как `…_erp_stage_guard_skip_order.sql`, а применена как
 * `erp_review_fix_stage_guard_skip_order`. Плюс часть применённого — разовые
 * операции с данными, которым файл не положен вовсе (копирование каталогов,
 * временные политики QA). Голый diff дал бы три десятка вечных расхождений,
 * то есть красный шаг, который все научатся игнорировать.
 *
 * Поэтому расхождения фиксируются снимком `supabase/migrations-applied.json`
 * с причиной у каждого. Скрипт падает, когда появляется расхождение, которого
 * в снимке нет, ИЛИ когда записанное в снимке расхождение исчезло (снимок
 * протух). И то и другое требует решения человека: закоммитить файл, применить
 * миграцию или обновить снимок.
 *
 * КАК ЗАПУСКАТЬ.
 *   npm run migrations:drift                 # список применённого — из stdin
 *   SUPABASE_DB_URL=… npm run migrations:drift   # сам сходит в базу через psql
 *
 * Список из базы берётся так:
 *   select name from supabase_migrations.schema_migrations order by version;
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const SNAPSHOT = join(root, 'supabase', 'migrations-applied.json');

/** Имена по обе стороны нормализуются одинаково: ведущая метка времени снимается. */
const normalize = (name) => name.replace(/^\d{6,}_?/, '');

function appliedFromPsql(url) {
  const sql = 'select name from supabase_migrations.schema_migrations order by version';
  return execFileSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8' });
}

function readApplied() {
  if (process.env.SUPABASE_DB_URL) return appliedFromPsql(process.env.SUPABASE_DB_URL);
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const rawApplied = readApplied()
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (rawApplied.length === 0) {
  console.error(
    'Список применённых миграций пуст.\n' +
      'Задайте SUPABASE_DB_URL (скрипт сходит сам) либо подайте имена на stdin:\n' +
      '  select name from supabase_migrations.schema_migrations order by version;',
  );
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const knownAppliedWithoutFile = snapshot.appliedWithoutFile ?? {};
const knownFileNotApplied = snapshot.fileNotApplied ?? {};

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
const fileByName = new Map(files.map((f) => [normalize(f.replace(/\.sql$/, '')), f]));
const appliedNames = new Set(rawApplied.map(normalize));

const appliedWithoutFile = rawApplied.filter((n) => !fileByName.has(normalize(n)));
const fileNotApplied = files.filter((f) => !appliedNames.has(normalize(f.replace(/\.sql$/, ''))));

const problems = [];

for (const name of appliedWithoutFile) {
  if (!(name in knownAppliedWithoutFile)) {
    problems.push(
      `НА БАЗЕ ЕСТЬ, В РЕПОЗИТОРИИ НЕТ: «${name}».\n` +
        '    Выгрузите её в файл миграции (текст лежит в supabase_migrations.schema_migrations.statements)\n' +
        '    и закоммитьте — иначе сторожевые тесты сверяют код с текстом, которого база не исполняет.\n' +
        '    Если файл не положен (разовая операция с данными) — впишите причину в supabase/migrations-applied.json.',
    );
  }
}

for (const file of fileNotApplied) {
  if (!(file in knownFileNotApplied)) {
    problems.push(
      `В РЕПОЗИТОРИИ ЕСТЬ, НА БАЗЕ НЕТ: «${file}».\n` +
        '    Либо миграция не применена, либо применена под другим именем — впишите какое\n' +
        '    в supabase/migrations-applied.json.',
    );
  }
}

const staleApplied = Object.keys(knownAppliedWithoutFile).filter((n) => !appliedWithoutFile.includes(n));
const staleFiles = Object.keys(knownFileNotApplied).filter((f) => !fileNotApplied.includes(f));

for (const name of staleApplied) {
  problems.push(`СНИМОК ПРОТУХ: «${name}» больше не расходится — уберите строку из appliedWithoutFile.`);
}
for (const file of staleFiles) {
  problems.push(`СНИМОК ПРОТУХ: «${file}» больше не расходится — уберите строку из fileNotApplied.`);
}

console.log(`Применено на базе: ${rawApplied.length}`);
console.log(`Файлов в репозитории: ${files.length}`);
console.log(`Известных расхождений в снимке: ${Object.keys(knownAppliedWithoutFile).length + Object.keys(knownFileNotApplied).length}`);

if (problems.length > 0) {
  console.error(`\n✗ Новых расхождений: ${problems.length}\n`);
  for (const p of problems) console.error(`  • ${p}\n`);
  process.exit(1);
}

console.log('\n✓ Расхождений сверх записанных в снимке нет.');
