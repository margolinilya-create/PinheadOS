// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож выкатки P (веха 5в, Э8): файл сухого прогона `rollout/m5c/1-dryrun-P.sql`
 * собран из миграции и пробы — текст обоих в нём дословно, ожидание `total` в шапках
 * совпадает с числом проб. Иначе сухой прогон проверял бы не ту миграцию.
 */
const SUPA = join(process.cwd(), '..', 'supabase');
const read = (p: string) => readFileSync(join(SUPA, p), 'utf8');
const MIGRATION = read('migrations/20261026090000_order_templates_layouts.sql');
const PROBE = read('probes/order_templates.sql');
const DRY = read('rollout/m5c/1-dryrun-P.sql');

const probeCount = (sql: string) => (sql.match(/select pg_temp\.p\('/g) ?? []).length;
const expectedTotal = (sql: string) => Number(/PROBE_RESULT fails=0 total=(\d+)/.exec(sql)?.[1]);

describe('выкатка P — order_templates', () => {
  it('сухой прогон содержит миграцию дословно и тело пробы', () => {
    expect(DRY).toContain(MIGRATION);
    const body = PROBE.slice(PROBE.indexOf("set local statement_timeout = '30s';\n") + 37);
    expect(DRY).toContain(body.trim());
  });

  it('ожидание total = числу проб (проба и сухой прогон)', () => {
    expect(probeCount(PROBE)).toBe(23);
    expect(expectedTotal(PROBE)).toBe(probeCount(PROBE));
    expect(expectedTotal(DRY)).toBe(probeCount(DRY));
  });

  it('миграция не трогает ERP и не удаляет ничего; CHECK данных — null-безопасный', () => {
    const code = MIGRATION.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/erp_/);
    expect(code).not.toMatch(/\bdrop\s+(table|policy|constraint|column|function)\b|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\b/i);
    expect(code).toMatch(/check \(coalesce\(/);
    expect(code).toMatch(/revoke all on table public\.order_templates from public, anon, authenticated/);
  });
});

/**
 * Выкатка O (веха 5в, Э9): сухой прогон `2-dryrun-O.sql` = миграция + проба дословно.
 * Функции пробы вызываются в выражении ответа: в `select 'ok' from (select f(…)) x`
 * планировщик функцию не вызывает — первая редакция пробы так «проходила» отказы.
 */
describe('выкатка O — виды капюшон и карман', () => {
  const MIG_O = read('migrations/20261026100000_garment_flats_hood_pocket.sql');
  const PROBE_O = read('probes/flats_views_o.sql');
  const DRY_O = read('rollout/m5c/2-dryrun-O.sql');

  it('сухой прогон содержит миграцию дословно и тело пробы; total = числу проб', () => {
    expect(DRY_O).toContain(MIG_O);
    const body = PROBE_O.slice(PROBE_O.indexOf("set local statement_timeout = '30s';\n") + 37);
    expect(DRY_O).toContain(body.trim());
    expect(probeCount(PROBE_O)).toBe(10);
    expect(expectedTotal(PROBE_O)).toBe(probeCount(PROBE_O));
    expect(expectedTotal(DRY_O)).toBe(probeCount(DRY_O));
  });

  it('вызов функции проверки — не в подзапросе, который планировщик выбросит', () => {
    const code = PROBE_O.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/select 'ok' from \(select public\./);
    expect((code.match(/catalog_value_check\(/g) ?? []).length).toBe(5);
    expect((code.match(/::text \|\| 'ok'/g) ?? []).length).toBe(5);
  });
});

