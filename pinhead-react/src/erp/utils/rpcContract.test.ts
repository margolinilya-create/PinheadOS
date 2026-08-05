import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Каждая функция, которую код зовёт через `supabase.rpc('erp_…')`, обязана
 * существовать в миграциях — и наоборот, аргументы вызова обязаны совпадать
 * с сигнатурой.
 *
 * Тот же жанр, что `upsertConflict.test.ts`, и по той же причине: юнит-тесты
 * слайсов ходят в мок стора, e2e поднимает фронт с мок-ключами, настоящего
 * PostgREST не видит никто. Опечатка в имени функции или в имени параметра
 * не ломает ни сборку, ни один тест — она отвечает 404/`PGRST202` в проде,
 * причём только на том действии, которое никто не прокликал.
 *
 * Операции этапов (частичная готовность, брак, приоритет, перенос) уехали
 * в RPC ради атомарности и приращения счётчиков — то есть цена такой опечатки
 * теперь «цех не может сдать работу».
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(p);
  }
  return out;
}

/** Вызовы `supabase.rpc('name', { args })` во всём исходнике */
export function rpcCallSites(files: string[]): { file: string; fn: string; args: string[] }[] {
  const out: { file: string; fn: string; args: string[] }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const re = /supabase\.rpc\(\s*'([a-z0-9_]+)'\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // Ключи объекта аргументов — и `name: value`, и сокращённая запись `{ payload }`.
      // Без второй формы вызов `rpc('erp_create_order', { payload })` выглядел бы
      // как «аргументов нет», и сторож молча пропускал бы самый старый RPC в разделе.
      const args = [...m[2].matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*(?::|,|$)/g)].map((a) => a[1]);
      out.push({ file, fn: m[1], args });
    }
  }
  return out;
}

/** Сигнатуры `create … function public.name(args)` из миграций */
export function functionSignatures(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /create (?:or replace )?function public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n?\s*returns/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const params = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(/\s+/)[0]);
    out.set(m[1], params);
  }
  return out;
}

const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

const SIGNATURES = functionSignatures(ALL_SQL);
const CALLS = rpcCallSites(walk(SRC));

describe('контракт RPC: клиент и миграции', () => {
  it('вызовы вообще есть — иначе тест сторожит пустоту', () => {
    expect(CALLS.length).toBeGreaterThan(0);
  });

  it('каждая вызываемая функция объявлена в миграциях', () => {
    const missing = CALLS
      .filter((c) => !SIGNATURES.has(c.fn))
      .map((c) => `${c.fn} (${c.file.replace(SRC, 'src')})`);
    expect(missing).toEqual([]);
  });

  it('каждый переданный аргумент есть в сигнатуре функции', () => {
    const wrong: string[] = [];
    for (const call of CALLS) {
      const params = SIGNATURES.get(call.fn);
      if (!params) continue;
      for (const arg of call.args) {
        // PostgREST сопоставляет аргументы ПО ИМЕНИ: лишний ключ — PGRST202,
        // а не молчаливое игнорирование
        if (!params.includes(arg)) wrong.push(`${call.fn}: нет параметра ${arg}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('операции этапов идут через RPC — атомарность и приращение счётчиков', () => {
    const names = new Set(CALLS.map((c) => c.fn));
    // Если кто-то вернёт их на прямой UPDATE «так проще», сломается здесь:
    // абсолютные счётчики теряют запись второго исполнителя цеха, а пачка
    // независимых запросов оставляет позицию в состоянии, которого никто не выбирал
    for (const fn of [
      'erp_stage_report_progress',
      'erp_stage_apply_defect',
      'erp_stage_reorder_queue',
      'erp_stage_move_department',
    ]) {
      expect(names).toContain(fn);
    }
  });
});
