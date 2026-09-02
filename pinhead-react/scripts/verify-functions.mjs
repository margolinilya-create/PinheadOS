#!/usr/bin/env node
/**
 * Сверка снимка edge-функций с боевым проектом — за одну команду.
 *
 * ЗАЧЕМ. Ровно то же, зачем `verify-migrations.mjs`, и по той же причине:
 * `functionsParity.test.ts` проверяет снимок с ФАЙЛАМИ репозитория, а живой
 * список функций из CI не прочитать — он за Management API, а не за PostgREST.
 * Без этой команды сверка не делается, и дрейф копится: аудит 02.09.2026
 * нашёл его в трёх функциях из четырёх, причём одна была выкачена и работала,
 * не имея исходника нигде.
 *
 * ОТПЕЧАТОК — md5 упорядоченного списка «слаг@версия», а не списка слагов.
 * Второй случай дрейфа (`purchase-list-pdf` v1 в репозитории против v2 в проде)
 * состав функций не меняет вовсе: отпечаток по слагам сошёлся бы и объявил
 * репозиторий описывающим прод. Версия — единственное, что отличает
 * переисправленную функцию от прежней.
 *
 *   node scripts/verify-functions.mjs
 *   node scripts/verify-functions.mjs --expect <md5>
 *
 * Величины для сравнения даёт MCP `list_edge_functions` (или
 * `supabase functions list`): возьмите slug и version каждой ACTIVE-функции.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, '../../supabase/functions/DEPLOYED.json');

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const pairs = snapshot.functions.map((f) => `${f.slug}@${f.version}`).sort();
const md5 = createHash('md5').update(pairs.join(',')).digest('hex');

const expected = process.argv.includes('--expect')
  ? process.argv[process.argv.indexOf('--expect') + 1]
  : null;

console.log(`снимок:  supabase/functions/DEPLOYED.json`);
console.log(`функций: ${pairs.length}`);
console.log(`md5:     ${md5}`);

const orphans = snapshot.functions.filter((f) => f.orphan);
if (orphans.length > 0) {
  console.log(`\nВ проде есть, в репозитории нет (${orphans.length}):`);
  for (const f of orphans) console.log(`  ${f.slug}@${f.version} — ${f.note.split('.')[0]}.`);
}

if (!expected) {
  console.log('\nВозьмите у прода список ACTIVE-функций (MCP list_edge_functions');
  console.log('или `supabase functions list`) и соберите те же пары:\n');
  console.log(`  ${pairs.join(', ')}\n`);
  console.log('Разошлось — снимок отстал (или обогнал) прод. Порядок починки:');
  console.log('supabase/functions/DEPLOYED.json, блок «_» вверху файла.');
  process.exit(0);
}

if (expected === md5) {
  console.log('\n✓ совпало с продом');
  process.exit(0);
}

console.error(`\n✗ РАСХОЖДЕНИЕ: у прода ${expected}, у снимка ${md5}`);
console.error('Репозиторий не описывает выкаченные функции. Выкаченная функция');
console.error('без исходника — код, который работает и которого нигде нет.');
process.exit(1);
