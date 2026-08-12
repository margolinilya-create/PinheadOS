/**
 * Чтение SQL-миграций для сторожевых тестов.
 *
 * Только для тестов: приложение этот модуль не импортирует, в бандл он не
 * попадает. Отдельный файл, а не копия в каждом тесте, — потому что копия уже
 * один раз разошлась и молча сторожила не то.
 *
 * Правило одно: функция или страж читается из ПОСЛЕДНЕЙ миграции, которая его
 * определяет. Функции пересоздаются целиком, и прежняя миграция остаётся
 * в репозитории со старыми правилами — тест, читающий её по имени, сторожит
 * файл, а не базу. Так `serverPermissions` утверждал «плановые даты стражем
 * не охраняются» (верно для 20260803180000, неверно для функции — 20260803230000
 * уже поставила их под `order.manage`), а `permissionsCoverage` читал
 * 20260803230000, когда действующий страж пересоздан в 20260805120000
 * и дополнен в 20260810150000.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(process.cwd(), '../supabase/migrations');

/** Текст миграции по имени файла */
export function migration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

/** Последняя миграция, подходящая под шаблон, — та, что реально работает в базе */
export function latestMatching(pattern: RegExp, what: string): string {
  const hit = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => pattern.test(migration(f)));
  if (hit.length === 0) throw new Error(`нет миграции, определяющей ${what}`);
  return migration(hit[hit.length - 1]);
}

/** Последняя миграция, пересоздающая функцию `public.<fn>(…)` */
export function latestDefining(fn: string): string {
  return latestMatching(
    new RegExp(`create or replace function public\\.${fn}\\(`),
    `${fn}()`,
  );
}

/**
 * SQL без строк-комментариев. Нужен там, где проверяется ОТСУТСТВИЕ правила:
 * комментарий, объясняющий, почему правила нет, содержит те же слова, что и
 * правило, и утверждение «этого здесь нет» ловило бы его.
 */
export function withoutComments(sql: string): string {
  return sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
}

/** Тело функции между `$$ … $$` — без окружающих комментариев миграции */
export function functionBody(sql: string, fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  if (start < 0) throw new Error(`нет тела ${fn}()`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open, close);
}

/**
 * Колонки таблицы, собранные ПО ВСЕМ миграциям: `create table` плюс каждый
 * `alter table … add column`.
 *
 * Нужно потому, что сторожа перечисляли колонки РУКАМИ, и список отставал
 * от схемы молча. `permissionsCoverage` держал 13 имён при 22 колонках
 * `erp_item_stages` — в списке не было ни `cycle`, ни `origin`, то есть тест
 * по построению не мог поймать дефект, который эти две колонки и породили
 * (UPDATE, трогающий только их, не проверялся вообще ничем). Такой сторож
 * зелен независимо от того, что он охраняет.
 *
 * Читаем схему из миграций, а не из живой базы: тесты идут в CI без доступа
 * к БД, и сверяться надо с тем же источником, из которого база и собрана.
 */
export function tableColumns(table: string): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
  const cols = new Set<string>();
  for (const name of files) {
    const sql = withoutComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

    // create table [if not exists] public.<table> ( … );
    const created = sql.match(
      new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\)`, 'i'),
    );
    if (created) {
      for (const line of created[1].split('\n')) {
        // Колонка — первое слово строки; ограничения и ключи пропускаем
        const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i);
        if (m && !/^(primary|foreign|unique|check|constraint|references|exclude)$/i.test(m[1])) {
          cols.add(m[1]);
        }
      }
    }

    /*
     * ALTER разбирается ОПЕРАТОРОМ ЦЕЛИКОМ, а не «add column сразу после имени
     * таблицы»: один `alter table` часто несёт несколько `add column` через
     * запятую и с переносами строк —
     *
     *   alter table public.erp_item_stages
     *     add column overdue_comment text,
     *     add column overdue_ack_at timestamptz;
     *
     * Регулярка «имя таблицы + add column» подхватывала из такого оператора
     * ТОЛЬКО ПЕРВУЮ колонку, и `overdue_ack_at` терялась молча. Ровно тот класс
     * дефекта, ради которого эта функция и написана: читатель схемы, тихо
     * теряющий колонку, не лучше захардкоженного списка.
     */
    const stmtRe = new RegExp(
      `alter table (?:only )?public\\.${table}\\b([\\s\\S]*?);`,
      'gi',
    );
    for (const stmt of sql.matchAll(stmtRe)) {
      const body = stmt[1];
      for (const m of body.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi)) {
        cols.add(m[1]);
      }
      for (const m of body.matchAll(/drop column (?:if exists )?([a-z_][a-z0-9_]*)/gi)) {
        cols.delete(m[1]);
      }
    }
  }
  return cols;
}
