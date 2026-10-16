// Заморозка ERP: пишет src/orderstudio/erpFrozen.json — хэши sha256 файлов
// src/erp/** и ERP-миграций (supabase/migrations/*.sql, где встречается `erp_`).
// Сторож — src/orderstudio/erpFrozen.test.ts. Запускать ТОЛЬКО когда правку ERP
// согласовал владелец; манифест коммитится вместе с правкой.
// Обход дублирует тест намеренно: скрипт — чистый Node ESM и TS не импортирует.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const migrationsDir = join(root, '..', 'supabase', 'migrations');
const out = join(srcDir, 'orderstudio', 'erpFrozen.json');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

// Ключи по алфавиту — диф манифеста в PR читается
const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const files = {};
for (const p of walk(join(srcDir, 'erp'))) {
  files[relative(srcDir, p).split(sep).join('/')] = sha(readFileSync(p));
}

const migrations = {};
for (const name of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql'))) {
  const buf = readFileSync(join(migrationsDir, name));
  if (buf.toString('utf8').includes('erp_')) migrations[name] = sha(buf);
}

writeFileSync(out, JSON.stringify({ files: sorted(files), migrations: sorted(migrations) }, null, 2) + '\n');
console.log(`erp:freeze — файлов ERP: ${Object.keys(files).length}, ERP-миграций: ${Object.keys(migrations).length}`);
