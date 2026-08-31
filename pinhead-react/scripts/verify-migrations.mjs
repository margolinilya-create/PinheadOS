#!/usr/bin/env node
/**
 * Сверка снимка журнала миграций с боевой базой — за одну команду.
 *
 * ЗАЧЕМ. `migrationJournal.test.ts` проверяет снимок САМ С СОБОЙ и с файлами
 * репозитория: живую базу из CI не прочитать, а `supabase_migrations`
 * не выставлена наружу PostgREST, так что supabase-js её тоже не видит.
 * Собственный комментарий сторожа говорил: «применили и не обновили снимок»
 * будет видно в диффе выкладки. Сверка 31.08 показала, что не видно:
 * снимок отстал на ПЯТЬ записей, две из них пересоздавали функции — и все
 * сторожа прав шесть дней сверялись с текстом, которого в базе нет.
 *
 * ЧТО ДЕЛАЕТ. Считает отпечаток снимка (число записей + md5 упорядоченного
 * списка версий) и печатает ОДИН запрос, который даёт те же две величины
 * из прода. Сравнить — глазами или флагом `--expect`.
 *
 * Почему отпечаток, а не список: сверка «192 строки против 192» глазами
 * не делается, поэтому её и не делали. Два числа сравниваются за секунду,
 * а расходятся ровно тогда, когда расходится хоть одна версия.
 *
 *   node scripts/verify-migrations.mjs
 *   node scripts/verify-migrations.mjs --expect 3265a706cf45b4914b65dcf09a576009
 *
 * Второй вид — для того, кто уже выполнил запрос: код возврата 1 при
 * расхождении, то есть годится в цепочку выкладки.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, '../../supabase/migrations/APPLIED.json');

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const versions = snapshot.migrations.map((m) => m.version).sort();
const md5 = createHash('md5').update(versions.join(',')).digest('hex');

const SQL = "select count(*) as записей, "
  + "md5(string_agg(version, ',' order by version)) as md5 "
  + 'from supabase_migrations.schema_migrations;';

const expected = process.argv.includes('--expect')
  ? process.argv[process.argv.indexOf('--expect') + 1]
  : null;

console.log(`снимок:  ${SNAPSHOT.replace(/.*\/supabase/, 'supabase')}`);
console.log(`записей: ${versions.length}`);
console.log(`md5:     ${md5}`);

if (!expected) {
  console.log('\nВыполните на боевой базе и сравните две величины:\n');
  console.log(`  ${SQL}\n`);
  console.log('Разошлось — снимок отстал (или обогнал) прод. Порядок починки:');
  console.log('supabase/migrations/README.md, раздел «Порядок после каждой выкладки».');
  process.exit(0);
}

if (expected === md5) {
  console.log('\n✓ совпало с продом');
  process.exit(0);
}

console.error(`\n✗ РАСХОЖДЕНИЕ: у прода ${expected}, у снимка ${md5}`);
console.error('Снимок не описывает боевую базу. Сторожа, читающие последнюю');
console.error('репозиторную миграцию (latestDefining), сверяются не с тем текстом.');
process.exit(1);
