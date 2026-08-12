import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrations.testutil';

/**
 * Новая триггерная функция обязана закрываться для REST.
 *
 * ЧТО СЛУЧИЛОСЬ 12.08. Миграция `20260803250000` закрыла двенадцать триггерных
 * функций, перечислив их ПОИМЁННО. Тринадцатая — `erp_experimental_task_sync()`
 * этой сессии — в список, разумеется, не попала и осталась единственной
 * триггерной функцией схемы, вызываемой ролью `authenticated` через
 * `/rest/v1/rpc/…`.
 *
 * ПОЧЕМУ ЭТО НЕ ДЫРА И ВСЁ РАВНО ДЕФЕКТ. Прямой вызов триггерной функции
 * Postgres отклоняет сам («trigger functions can only be called as triggers»),
 * так что эксплуатировать нечего. Дефект в способе: перечисление по именам
 * не переживает добавления следующей функции, а предупреждение адвизора,
 * которое висит постоянно, — это шум, за которым теряется настоящее.
 * `20260812160000` заменила перечисление ОБХОДОМ по `prorettype`.
 *
 * ЧТО СТОРОЖИТ ЭТОТ ТЕСТ. Обход закрыл то, что было НА МОМЕНТ миграции.
 * Функцию, созданную позже, он не увидит: `create function` даёт EXECUTE
 * роли PUBLIC по умолчанию. Поэтому здесь проверяется ровно одно — у каждой
 * триггерной функции, ВПЕРВЫЕ появившейся после обхода, есть свой явный
 * `revoke` (или свой обход).
 *
 * ГРАНИЦА ЧЕСТНОСТИ. Тест читает репозиторий, а не базу, и знает только то,
 * что описано миграциями. Но правило проекта — все изменения схемы идут
 * миграциями, и именно их набор описывает прод.
 *
 * `create or replace` существующей функции privileges НЕ сбрасывает, поэтому
 * пересоздание уже закрытой функции второго `revoke` не требует — тест
 * смотрит на ПЕРВОЕ появление имени.
 */

const FILES = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
const sql = (name: string) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

/** Миграция, закрывающая триггерные функции обходом по типу возврата */
function sweepMigration(): string {
  const hit = FILES.filter((f) => {
    const text = sql(f);
    return /prorettype\s*=\s*'pg_catalog\.trigger'::regtype/i.test(text)
      && /revoke execute on function/i.test(text);
  });
  if (hit.length === 0) throw new Error('нет миграции-обхода по триггерным функциям');
  return hit[hit.length - 1];
}

/** Имя → файл первой миграции, где функция объявлена как `returns trigger` */
function firstTriggerFunctionDefs(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of FILES) {
    const text = sql(name);
    const re = /create (?:or replace )?function public\.(\w+)\s*\([^)]*\)\s*returns trigger/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!out.has(m[1])) out.set(m[1], name);
    }
  }
  return out;
}

/** Имя → файл миграции, где у функции явно отозван EXECUTE */
function explicitRevokes(): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of FILES) {
    const re = /revoke execute on function public\.(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    const text = sql(name);
    while ((m = re.exec(text)) !== null) {
      if (!out.has(m[1])) out.set(m[1], name);
    }
  }
  return out;
}

describe('триггерные функции недоступны через REST', () => {
  const SWEEP = sweepMigration();
  const DEFS = firstTriggerFunctionDefs();
  const REVOKES = explicitRevokes();

  it('обе стороны найдены — сторож не сторожит пустоту', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(DEFS.size).toBeGreaterThanOrEqual(10);
    expect(SWEEP).toMatch(/^20260812160000/);
  });

  it('обход отзывает право у public и anon, а не только у authenticated', () => {
    // Правило проекта: `from anon` в одиночку не работает — право приходит
    // от PUBLIC (`=X/postgres` в ACL), и `anon` его наследует.
    const text = sql(SWEEP);
    expect(text).toMatch(/from public, anon, authenticated/i);
  });

  it('обход проверяет себя на месте — иначе он молча ничего не отзовёт', () => {
    // Миграция без самопроверки выглядит выполненной при нуле отозванных функций.
    expect(sql(SWEEP)).toMatch(/raise exception/i);
  });

  it('триггерная функция, заведённая после обхода, закрыта своей миграцией', () => {
    const problems: string[] = [];
    for (const [fn, file] of DEFS) {
      if (file <= SWEEP) continue; // закрыта обходом
      const revoked = REVOKES.get(fn);
      if (!revoked || revoked < file) {
        problems.push(
          `${fn}() заведена в ${file} — после обхода ${SWEEP} — и не имеет своего revoke`,
        );
      }
    }
    expect(problems, problems.join('; ')).toEqual([]);
  });

  it('предикаты RLS обходом НЕ закрываются — это записано как «не чинить»', () => {
    // `is_admin`, `erp_is_manager`, `erp_has_permission` и прочие возвращают
    // boolean, стоят в предикатах политик и исполняются от лица вызывающего:
    // отзыв EXECUTE сломал бы сами политики. Обход отбирает по `returns trigger`
    // именно поэтому — проверяем, что критерий не подменили на список имён.
    const text = sql(SWEEP);
    expect(text).toMatch(/prorettype\s*=\s*'pg_catalog\.trigger'::regtype/i);
    for (const predicate of ['is_admin', 'erp_is_manager', 'erp_has_permission']) {
      expect(
        new RegExp(`revoke execute on function public\\.${predicate}\\s*\\(`, 'i').test(text),
        `${predicate}() не должна отзываться этой миграцией`,
      ).toBe(false);
    }
  });
});
