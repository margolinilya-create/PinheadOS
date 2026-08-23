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
 * Исходник JS/TS без комментариев — тот же приём, что `withoutComments`,
 * но для клиентского кода: она снимает только строки `--` и на JavaScript
 * не действует.
 *
 * Нужен ровно там же — в проверках «этого здесь больше нет»: объяснение,
 * ПОЧЕМУ правила не стало, содержит те же слова, что и само правило. На этом
 * уже падал сторож приёмок (`materialReceipts.test.ts`), и оба падения были
 * ложными; когда приём понадобился второй раз (стартовый статус упаковки),
 * копия функции рядом означала бы две реализации одного правила.
 */
export function withoutJsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}
