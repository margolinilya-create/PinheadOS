// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PAID_KINDS, PRINT_OFFSET_DIR, PRINT_OFFSET_FROM, SALES_PRINT_METHODS,
} from './types';

/**
 * СТОРОЖ ЗНАЧЕНИЙ: перечни клиента = CHECK базы.
 *
 * Union-тип TypeScript и CHECK миграции — две копии одного перечня. Разойдись
 * они — интерфейс предложит значение, которое база отвергнет (`23514` при
 * автосохранении), или база примет то, чего модель не знает (чтение молча
 * подменит его умолчанием). Перечни клиента — массивы (`as const`), из них
 * выведены типы; сторож читает ПОСЛЕДНЮЮ миграцию, задающую ограничение, и
 * сравнивает множества.
 */
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** Значения `check (<column> in (...))` ограничения из последней миграции, что его ставит */
function checkValues(constraint: string, column: string, sqlOf = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8')): string[] {
  const re = new RegExp(
    `add constraint ${constraint}\\s+check \\(([\\s\\S]*?)\\);`,
  );
  const hits = files.map((f) => sqlOf(f).match(re)).filter((m): m is RegExpMatchArray => m !== null);
  if (hits.length === 0) throw new Error(`нет миграции с ограничением ${constraint}`);
  const body = hits[hits.length - 1][1];
  const list = body.match(new RegExp(`${column} in \\(([^)]*)\\)`));
  if (!list) throw new Error(`в ${constraint} нет списка ${column} in (...)`);
  return [...list[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('перечни модели v4 совпадают с CHECK базы', () => {
  it('метод нанесения (с «прочее»)', () => {
    expect(checkValues('order_item_prints_method_check', 'method')).toEqual(sorted(SALES_PRINT_METHODS));
  });
  it('от чего смещение', () => {
    expect(checkValues('order_item_prints_offset_from_check', 'offset_from')).toEqual(sorted(PRINT_OFFSET_FROM));
  });
  it('куда смещение', () => {
    expect(checkValues('order_item_prints_offset_dir_check', 'offset_dir')).toEqual(sorted(PRINT_OFFSET_DIR));
  });
  it('вид оплаты', () => {
    expect(checkValues('orders_v4_paid_kind_check', 'paid_kind')).toEqual(sorted(PAID_KINDS));
  });
});

describe('сторож различает расхождение (самопроверка на подменённом тексте)', () => {
  const fake = (sql: string) => () => sql;
  it('лишнее значение в базе ловится', () => {
    const vals = checkValues('order_item_prints_offset_dir_check', 'offset_dir',
      fake("add constraint order_item_prints_offset_dir_check\n  check (offset_dir in ('', 'up', 'down', 'left', 'right', 'diag'));"));
    expect(vals).not.toEqual(sorted(PRINT_OFFSET_DIR));
  });
  it('нет ограничения — ошибка, а не пустой зелёный список', () => {
    expect(() => checkValues('no_such_check', 'x', fake('select 1;'))).toThrow(/нет миграции/);
  });
});
