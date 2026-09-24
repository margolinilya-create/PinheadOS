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
  /**
   * РАЗДЕЛИТЕЛЬ ТЕЛА БЕРЁТСЯ ИЗ САМОГО SQL, а не считается равным `$$`.
   *
   * Postgres разрешает любой тег: `$$`, `$fn$`, а `pg_get_functiondef`
   * печатает `$function$` — и тело, скопированное с прода подлинным (правило
   * проекта), приезжает именно с ним. Жёсткий `$$` в этом месте уже стоил
   * проекту семи пустых проверок приёмки материалов: `indexOf('$$')`
   * не находил ничего, тело выходило пустым, и сторож зеленел НА ЛЮБОМ коде.
   * Отсюда и правило: пустое тело — это ошибка, а не «нечего проверять».
   */
  const tag = /\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/.exec(sql.slice(start));
  if (!tag) throw new Error(`нет тела ${fn}(): не найден разделитель тела функции`);
  const open = start + tag.index;
  const close = sql.indexOf(tag[0], open + tag[0].length);
  if (close < 0) throw new Error(`нет тела ${fn}(): тело не закрыто ${tag[0]}`);
  const body = sql.slice(open + tag[0].length, close);
  if (body.trim() === '') throw new Error(`пустое тело ${fn}() — сторож проверял бы пустоту`);
  return body;
}

/**
 * Поля, ВЫЧТЕННЫЕ из сравнения снимков строки в страже (`to_jsonb(new) - …`).
 *
 * Стражи с 24.09 перечисляют не охраняемые колонки, а исключения: снимок
 * `to_jsonb(new)` минус разрешённые поля сравнивается с тем же снимком
 * `to_jsonb(old)` — тогда колонка, добавленная позже, защищена по умолчанию.
 * Сторож проверяет конструкцию, а не имена, поэтому ему нужен НАБОР исключений.
 *
 * Понимает три записи: цепочку `- 'a' - 'b'`, массив `- array['a', 'b']`
 * и константу `- v_x`, объявленную как `v_x constant text[] := array[…]`.
 * Возвращает `null`, если сравнения снимков в теле нет, и бросает, если
 * у `new` и `old` вычитаются РАЗНЫЕ наборы: такое сравнение ложно всегда
 * и выглядело бы как работающий страж.
 */
export function snapshotExclusions(body: string): Set<string> | null {
  const code = withoutComments(body);
  const side = (who: 'new' | 'old'): string[] | null => {
    const at = code.indexOf(`to_jsonb(${who})`);
    if (at < 0) return null;
    const rest = code.slice(at + `to_jsonb(${who})`.length);
    // Хвост вычитаний — до закрывающей скобки группы или до `is distinct from`
    const tail = /^([\s\S]*?)(\)|is distinct from)/.exec(rest)?.[1] ?? '';
    const names = [...tail.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const v of tail.matchAll(/-\s*(v_\w+)/g)) {
      const decl = new RegExp(`${v[1]}\\s+(?:constant\\s+)?text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`).exec(code);
      if (!decl) throw new Error(`не найдено объявление ${v[1]}`);
      names.push(...[...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    }
    return names;
  };
  const fromNew = side('new');
  const fromOld = side('old');
  if (fromNew === null && fromOld === null) return null;
  const a = new Set(fromNew ?? []);
  const b = new Set(fromOld ?? []);
  if (a.size !== b.size || [...a].some((x) => !b.has(x))) {
    throw new Error(`снимки new и old вычитают разные поля: [${[...a]}] против [${[...b]}]`);
  }
  return a;
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
