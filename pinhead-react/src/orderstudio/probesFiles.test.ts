// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Сторож SQL-проб `supabase/probes/*.sql` (веха 2, 17.10). Пробы запускаются
// на БОЮ целиком через SQL Editor, поэтому каждый файл обязан:
// - открывать транзакцию сам и ставить короткие lock/statement timeout;
// - не тратить order_number_seq: заказ вставляется только с явным order_number;
// - заканчиваться исключением 'PROBE_RESULT …' (откат всего прогона);
// - не содержать commit;
// - держать в шапке ожидание `fails=0 total=N`, где N — число проб.
// Как запускать — supabase/probes/README.md.

const PROBES_DIR = join(process.cwd(), '..', 'supabase', 'probes');

/** Комментарии `-- …` и `/* … *\/` убраны: правило касается исполняемого текста. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

/** Вставки в orders без явного order_number (каждая расходует order_number_seq). */
function insertsWithoutNumber(sql: string): string[] {
  const code = stripSqlComments(sql);
  const bad: string[] = [];
  const re = /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?orders"?(?![\w"])\s*(\([^)]*\))?/gi;
  for (const m of code.matchAll(re)) {
    const cols = m[1];
    if (!cols || !/\border_number\b/i.test(cols)) bad.push(m[0].replace(/\s+/g, ' '));
  }
  return bad;
}

/** После последнего raise 'PROBE_RESULT' — только конец DO-блока и, по желанию, rollback. */
function endsWithProbeResult(sql: string): boolean {
  const code = stripSqlComments(sql);
  const marker = /raise\s+exception\s+'PROBE_RESULT/gi;
  let last = -1;
  for (const m of code.matchAll(marker)) last = m.index ?? -1;
  if (last < 0) return false;
  const tail = code.slice(last).replace(/^raise\s+exception\s+'[^']*'[^;]*;/i, '');
  return /^\s*end\s*;\s*\$\$\s*;\s*(rollback\s*;\s*)?$/i.test(tail);
}

function hasCommit(sql: string): boolean {
  return /\bcommit\b/i.test(stripSqlComments(sql));
}

/** Первый оператор — begin, затем set local lock_timeout и statement_timeout. */
function opensOwnTransaction(sql: string): boolean {
  const code = stripSqlComments(sql);
  return /^\s*begin\s*;\s*set\s+local\s+lock_timeout\s*=\s*'\d+s'\s*;\s*set\s+local\s+statement_timeout\s*=\s*'\d+s'\s*;/i.test(
    code,
  );
}

/** Ожидание из шапки (`fails=0 total=N`) и фактическое число проб `pg_temp.p(…)`. */
function expectedAndActualTotal(sql: string): { expected: number | null; actual: number } {
  const header = sql.split('\n').filter((l) => l.startsWith('--')).join('\n');
  const m = /fails=0 total=(\d+)/.exec(header);
  const code = stripSqlComments(sql);
  const calls = code.match(/pg_temp\.p\s*\(/g)?.length ?? 0;
  const defs = code.match(/function\s+pg_temp\.p\s*\(/g)?.length ?? 0;
  return { expected: m ? Number(m[1]) : null, actual: calls - defs };
}

const GOOD = `-- Ожидание: PROBE_RESULT fails=0 total=1
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create function pg_temp.p(a text) returns void language sql as $f$ select 1 $f$;
insert into public.orders (id, order_number, data) values (gen_random_uuid(), 'PROBE-1', '{}');
select pg_temp.p($q$insert into public.orders (order_number, data) values ('PROBE-2', '{}')$q$);
insert into public.order_items (order_id) values (gen_random_uuid());
do $$
begin
  raise exception 'PROBE_RESULT fails=% total=%', 0, 1;
end;
$$;
rollback;
`;

describe('сторож SQL-проб: правила на синтетике (мутации)', () => {
  it('эталонный файл проходит все правила', () => {
    expect(insertsWithoutNumber(GOOD)).toEqual([]);
    expect(endsWithProbeResult(GOOD)).toBe(true);
    expect(hasCommit(GOOD)).toBe(false);
    expect(opensOwnTransaction(GOOD)).toBe(true);
    expect(expectedAndActualTotal(GOOD)).toEqual({ expected: 1, actual: 1 });
  });

  it('вставка в orders без order_number ловится (с public., без, в кавычках, без списка колонок)', () => {
    const forms = [
      `insert into public.orders (id, data) values (gen_random_uuid(), '{}');`,
      `INSERT INTO orders(data) values ('{}');`,
      `insert into "public"."orders" (data) values ('{}');`,
      `insert into public.orders values (default);`,
      `insert into public.orders select * from x;`,
      `select pg_temp.p($q$insert into public.orders (schema_version) values (4)$q$);`,
    ];
    for (const f of forms) expect(insertsWithoutNumber(GOOD + f), f).toHaveLength(1);
    // соседние таблицы и комментарии не считаются
    expect(insertsWithoutNumber('insert into public.order_items (order_id) values (null);')).toEqual([]);
    expect(insertsWithoutNumber('insert into public.orders_archive (x) values (1);')).toEqual([]);
    expect(insertsWithoutNumber('-- insert into public.orders (data) values (1)\n')).toEqual([]);
  });

  it('нет raise PROBE_RESULT или после него ещё операторы — ловится', () => {
    expect(endsWithProbeResult(GOOD.replace("'PROBE_RESULT", "'RESULT"))).toBe(false);
    expect(endsWithProbeResult(GOOD + "select pg_temp.p('x');\n")).toBe(false);
    expect(endsWithProbeResult(GOOD.replace('rollback;', 'commit;'))).toBe(false);
    expect(endsWithProbeResult(GOOD.replace('rollback;\n', ''))).toBe(true);
    expect(endsWithProbeResult(GOOD + '-- хвостовой комментарий\n')).toBe(true);
  });

  it('commit ловится в любом регистре, но не в комментарии', () => {
    expect(hasCommit(GOOD.replace('begin;', 'begin;\nCOMMIT;'))).toBe(true);
    expect(hasCommit(GOOD + 'commit;\n')).toBe(true);
    expect(hasCommit(GOOD + '-- commit не делаем\n')).toBe(false);
  });

  it('без begin или без таймаутов — ловится', () => {
    expect(opensOwnTransaction(GOOD.replace('begin;\n', ''))).toBe(false);
    expect(opensOwnTransaction(GOOD.replace("set local lock_timeout = '3s';\n", ''))).toBe(false);
    expect(opensOwnTransaction(GOOD.replace("set local statement_timeout = '30s';\n", ''))).toBe(false);
  });

  it('ожидание в шапке расходится с числом проб — видно', () => {
    expect(expectedAndActualTotal(GOOD.replace('total=1\n', 'total=2\n'))).toEqual({ expected: 2, actual: 1 });
    expect(expectedAndActualTotal(GOOD.replace('-- Ожидание: PROBE_RESULT fails=0 total=1', '-- без ожидания')).expected).toBe(
      null,
    );
  });
});

const files = existsSync(PROBES_DIR)
  ? readdirSync(PROBES_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];

describe('сторож SQL-проб: файлы supabase/probes', () => {
  it('папка проб есть и в ней есть пробы прав Order v4', () => {
    expect(files).toContain('order_v4_rights.sql');
  });

  it('README упоминает каждый файл проб', () => {
    const readme = readFileSync(join(PROBES_DIR, 'README.md'), 'utf8');
    for (const f of files) expect(readme, f).toContain(f);
  });

  describe.each(files)('%s', (file) => {
    const sql = readFileSync(join(PROBES_DIR, file), 'utf8');

    it('не вставляет заказ без явного order_number (последовательность не тратится)', () => {
      expect(insertsWithoutNumber(sql)).toEqual([]);
    });

    it('открывает транзакцию с короткими lock_timeout и statement_timeout', () => {
      expect(opensOwnTransaction(sql)).toBe(true);
    });

    it("заканчивается raise exception 'PROBE_RESULT …' (откат)", () => {
      expect(endsWithProbeResult(sql)).toBe(true);
    });

    it('не содержит commit', () => {
      expect(hasCommit(sql)).toBe(false);
    });

    it('ожидание fails=0 total=N в шапке совпадает с числом проб', () => {
      const { expected, actual } = expectedAndActualTotal(sql);
      expect(expected).not.toBeNull();
      expect(actual).toBe(expected);
    });
  });
});
