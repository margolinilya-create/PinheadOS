import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, withoutComments } from './migrations.testutil';

/**
 * Каждое имя, которое клиент передаёт в `supabase.rpc('…')` и
 * `supabase.from('…')`, обязано быть объявлено в миграциях.
 *
 * ЗАЧЕМ (обзор 24.09, сессия 67). Клиент Supabase в проекте не типизирован,
 * и опечатка или исчезнувшая функция видны только в рантайме — а если вызов
 * обёрнут запасным путём, то не видны вовсе. Так `useOrdersStore` зовёт
 * `generate_order_number`, которой нет ни в миграциях, ни на бою: номер
 * заказа Order Studio всегда уходит в запасной `PH-<время>-xxxx`, и об этом
 * никто не знал. Нашлось пробным включением `createClient<Database>` —
 * оно дало 93 ошибки, из которых настоящих две, а этот сторож ловит ровно
 * класс настоящих, без шума про `null` против необязательного аргумента.
 *
 * Сверка по МИГРАЦИЯМ, а не по `database.generated.ts`: файл типов
 * генерируется руками и отстаёт (на 24.09 в нём ещё `released`,
 * переименованный в `done_qty`), а миграции — источник схемы, который
 * сторожит `migrationJournal.test.ts`.
 */

/** Известные расхождения: имя → почему оно здесь. Список только сокращается */
const KNOWN_MISSING: Record<string, string> = {
  generate_order_number:
    'Order Studio: функции нет на бою, работает запасной номер. Решение за владельцем (обзор 24.09)',
};

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.|\.testutil\./.test(name)) acc.push(p);
  }
  return acc;
}

const code = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => withoutComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
  .join('\n')
  .toLowerCase();

const used = (re: RegExp) => [...new Set([...code.matchAll(re)].map((m) => m[1]))].sort();

describe('имена схемы, которые зовёт клиент, существуют', () => {
  it('каждая функция из supabase.rpc(…) объявлена в миграциях', () => {
    const rpcs = used(/\.rpc\(\s*'([a-z_0-9]+)'/g);
    expect(rpcs.length).toBeGreaterThan(20);
    const missing = rpcs.filter((fn) => !KNOWN_MISSING[fn]
      && !new RegExp(`function\\s+(public\\.)?${fn}\\s*\\(`).test(sql));
    expect(missing, 'клиент зовёт функцию, которой нет в миграциях').toEqual([]);
  });

  it('каждая таблица из supabase.from(…) объявлена в миграциях', () => {
    const tables = used(/\.from\(\s*'([a-z_0-9]+)'/g);
    expect(tables.length).toBeGreaterThan(20);
    const missing = tables.filter((t) => !KNOWN_MISSING[t]
      && !new RegExp(`(table|view)\\s+(if not exists\\s+)?(public\\.)?${t}\\b`).test(sql));
    expect(missing, 'клиент читает таблицу, которой нет в миграциях').toEqual([]);
  });

  it('известные расхождения ещё действительно расходятся', () => {
    // Иначе список исключений переживёт починку и начнёт прикрывать новое
    for (const name of Object.keys(KNOWN_MISSING)) {
      expect(code.includes(`'${name}'`), `${name} больше не вызывается — уберите из KNOWN_MISSING`).toBe(true);
      expect(new RegExp(`function\\s+(public\\.)?${name}\\s*\\(`).test(sql),
        `${name} появилась в миграциях — уберите из KNOWN_MISSING`).toBe(false);
    }
  });
});
