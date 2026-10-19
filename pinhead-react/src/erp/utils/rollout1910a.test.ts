// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { functionBody, migration, migrationFiles, withoutComments } from './migrations.testutil';

/**
 * ОТКАТЫ ПРАВОК 19.10, ПЛАН A (`supabase/rollout/r1910a/`, Task 9).
 *
 * Файл отката лежит ВНЕ `supabase/migrations` (его не считают сторож журнала
 * и DDL-проверка `erpFrozen`), поэтому «последняя редакция» к нему не
 * применяется: тело каждой функции в `<версия>_<слаг>_rollback.sql` обязано
 * совпасть с телом той же функции в ПОСЛЕДНЕЙ миграции ДО `<версия>` — то
 * есть с тем, что стояло на бою до отката. Откат, восстановивший «почти
 * прежнее» тело, хуже отсутствующего: проверки прошлых правок молча пропадут.
 */

const ROLLOUT = join(process.cwd(), '../supabase/rollout/r1910a');
const SUFFIX = '_rollback.sql';
const DEFINES = /create or replace function public\.([a-z_0-9]+)\(/g;

const rollbacks = readdirSync(ROLLOUT).filter((f) => f.endsWith(SUFFIX)).sort();

function definedIn(sql: string): string[] {
  return [...new Set([...withoutComments(sql).matchAll(DEFINES)].map((m) => m[1]))];
}

/** Миграция, которую откатывает файл: то же имя без `_rollback` */
function targetOf(rollback: string): string {
  return rollback.slice(0, -SUFFIX.length) + '.sql';
}

/** Последняя миграция до `target`, определяющая функцию, или null */
function previousDefining(fn: string, target: string): string | null {
  const re = new RegExp(`create or replace function public\\.${fn}\\(`);
  const before = migrationFiles().filter((f) => f < target && re.test(migration(f)));
  return before.length ? before[before.length - 1] : null;
}

describe('откаты правок 19.10 (план A)', () => {
  it('три отката — S1, E1, C1 — и у каждого есть своя миграция', () => {
    expect(rollbacks).toEqual([
      '20261019090000_erp_attach_30mb_passport_optional_rollback.sql',
      '20261019100000_erp_embroidery_one_stage_rollback.sql',
      '20261019110000_erp_cut_result_once_rollback.sql',
    ]);
    for (const rb of rollbacks) expect(migrationFiles()).toContain(targetOf(rb));
    // В папке миграций откатов нет: их считал бы сторож журнала
    expect(migrationFiles().filter((f) => f.includes('rollback'))).toEqual([]);
  });

  it.each(rollbacks)('%s: тело каждой функции = прежняя редакция', (rb) => {
    const sql = readFileSync(join(ROLLOUT, rb), 'utf8');
    const target = targetOf(rb);
    const fns = definedIn(sql);
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) {
      const prev = previousDefining(fn, target);
      expect(prev, `${fn}: прежней редакции до ${target} нет — откат не должен её создавать`).not.toBeNull();
      expect(functionBody(sql, fn), `${fn} в ${rb} ≠ ${prev}`).toBe(functionBody(migration(prev as string), fn));
    }
  });

  it('E1: прежние функции восстановлены, новые сняты вместе с триггером', () => {
    const rb = '20261019100000_erp_embroidery_one_stage_rollback.sql';
    const sql = withoutComments(readFileSync(join(ROLLOUT, rb), 'utf8'));
    const target = targetOf(rb);
    const created = definedIn(migration(target));
    const restored = created.filter((fn) => previousDefining(fn, target) !== null).sort();
    const fresh = created.filter((fn) => previousDefining(fn, target) === null).sort();
    expect(definedIn(sql).sort()).toEqual(restored);
    expect(restored).toEqual([
      'erp_item_produced_qty', 'erp_stage_completion_block', 'erp_stage_guard', 'erp_stage_passthrough',
    ]);
    expect(fresh).toEqual([
      'erp_embroidery_is_phased', 'erp_embroidery_program_finish', 'erp_embroidery_program_skip',
      'erp_item_stages_embroidery_route_gate',
    ]);
    for (const fn of fresh) expect(sql).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`));
    expect(sql).toMatch(/drop trigger if exists erp_item_stages_dep_gate on public\.erp_item_stages;/);
    // Триггер снимается до своей функции
    expect(sql.indexOf('drop trigger if exists erp_item_stages_dep_gate'))
      .toBeLessThan(sql.indexOf('drop function if exists public.erp_item_stages_embroidery_route_gate('));
    // Гейт закрытия — одна перегрузка, права как в прежней редакции
    expect(sql).not.toMatch(/erp_stage_completion_block\(uuid, int\)/);
    expect(sql).toMatch(/grant execute on function public\.erp_stage_completion_block\(uuid, int, boolean\) to authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.erp_stage_guard\(\) from anon, authenticated, public;/);
    expect(sql).toMatch(/grant execute on function public\.erp_item_produced_qty\(uuid\) to authenticated;/);
    expect(sql).toMatch(/notify pgrst, 'reload schema';/);
  });

  it('README выкатки: порядок S1 → E1 → C1, предусловия, триггеры отката, запрос наследия', () => {
    const readme = readFileSync(join(ROLLOUT, 'README.md'), 'utf8');
    const s1 = readme.indexOf('20261019090000');
    const e1 = readme.indexOf('20261019100000');
    const c1 = readme.indexOf('20261019110000');
    expect(s1).toBeGreaterThan(-1);
    expect(s1).toBeLessThan(e1);
    expect(e1).toBeLessThan(c1);
    expect(readme).toMatch(/PROBE_RESULT/);
    expect(readme).toMatch(/APPLIED\.json/);
    expect(readme).toMatch(/npm run migrations:verify/);
    expect(readme).toMatch(/notify pgrst, 'reload schema'/);
    expect(readme).toMatch(/31457280|30 МБ/);
    for (const trigger of ['fails>0', 'check_violation', 'erp_item_economics', 'Ошибки интерфейса', '413']) {
      expect(readme).toContain(trigger);
    }
    expect(readme).toMatch(/erp_stage_program_block/);
    expect(readme).toMatch(/embroideryProgramBlock/);
    for (const rb of rollbacks) expect(readme).toContain(rb);
  });
});
