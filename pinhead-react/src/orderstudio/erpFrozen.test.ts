// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sourceFiles, SRC_DIR } from '../testutil/sourceFiles';
import { diffManifest, erpDdlViolations, frozenMessage } from './erpFrozenCheck';
import manifest from './erpFrozen.json';

// Сторож «ERP заморожен»: боевой ERP при работе над Order не меняется.
// Манифест пишет `npm run erp:freeze` (scripts/erp-freeze.mjs).

const MIGRATIONS_DIR = join(process.cwd(), '..', 'supabase', 'migrations');

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('сторож «ERP заморожен»', () => {
  it('diffManifest видит изменённый, новый и удалённый файл', () => {
    expect(diffManifest({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({
      changed: ['b'],
      added: ['c'],
      removed: [],
    });
    expect(diffManifest({ a: '1', b: '2' }, { a: '1' })).toEqual({ changed: [], added: [], removed: ['b'] });
  });

  it('erpDdlViolations ловит правку таблицы ERP', () => {
    expect(erpDdlViolations('alter table public.erp_orders add column x int;')).toHaveLength(1);
    expect(erpDdlViolations('create policy p on erp_orders for select using (true);')).toHaveLength(1);
    expect(erpDdlViolations('update erp_orders set x=1;')).toHaveLength(1);
    expect(erpDdlViolations('DROP TABLE IF EXISTS public.erp_items;')).toHaveLength(1);
    expect(erpDdlViolations('create or replace function public.erp_x() returns int as $$ select 1 $$;')).toHaveLength(1);
    expect(erpDdlViolations('delete from erp_orders;')).toHaveLength(1);
    expect(erpDdlViolations('insert into public.erp_orders(id) values (1);')).toHaveLength(1);
    expect(erpDdlViolations('create trigger t before update on public.erp_orders for each row execute function f();')).toHaveLength(1);
  });

  it('erpDdlViolations пропускает чтение ERP в функции Order', () => {
    expect(
      erpDdlViolations(
        'create function public.sales_is_ms() returns boolean as $$ select exists(select 1 from erp_employees) $$;',
      ),
    ).toEqual([]);
  });

  it('erpDdlViolations ловит расширенные формы правки схемы ERP', () => {
    const bad = [
      'drop policy if exists p on public.erp_orders;',
      'drop trigger t on erp_orders;',
      'create unique index concurrently if not exists i on only public.erp_orders (id);',
      'create index on erp_orders (id);',
      'create table if not exists public.erp_new (id int);',
      'truncate table public.erp_orders;',
      'alter policy p on erp_orders using (true);',
      'alter function public.erp_f() owner to postgres;',
      'alter view erp_v rename to w;',
      'alter publication supabase_realtime add table public.erp_orders;',
      'alter trigger t on erp_orders rename to u;',
      'grant select on table public.erp_orders to authenticated;',
      'revoke all on function erp_f() from public;',
      'comment on table public.erp_orders is \'x\';',
      'comment on column erp_orders.id is \'x\';',
      'create trigger t\n after update\n on public.erp_orders\n for each row execute function f();',
    ];
    for (const sql of bad) expect(erpDdlViolations(sql), sql).not.toEqual([]);
  });

  it('erpDdlViolations пропускает чтение ERP в предикате RLS и комментарии', () => {
    expect(
      erpDdlViolations(
        'create policy p on public.sales_orders for select using (exists (select 1 from erp_employees e join erp_roles r on r.id = e.role_id));',
      ),
    ).toEqual([]);
    expect(erpDdlViolations('-- update erp_orders вручную\n/* alter table erp_orders */ select 1;')).toEqual([]);
  });

  it('frozenMessage называет файл и команду заморозки', () => {
    const msg = frozenMessage('files', { changed: ['erp/utils/time.ts'], added: [], removed: [] });
    expect(msg).toContain('erp/utils/time.ts');
    expect(msg).toContain('npm run erp:freeze');
    expect(frozenMessage('files', { changed: [], added: [], removed: [] })).toBe('');
    expect(frozenMessage('migrations', { changed: [], added: [], removed: [] }, ['alter table erp_x'])).toContain('alter table erp_x');
  });

  it('файлы src/erp совпадают с манифестом', () => {
    const actual: Record<string, string> = {};
    for (const p of sourceFiles(join(SRC_DIR, 'erp'), { ext: /./, tests: true })) {
      actual[relative(SRC_DIR, p).split(sep).join('/')] = sha(p);
    }
    const message = frozenMessage('files', diffManifest(manifest.files, actual));
    if (message) expect.fail(message);
  });

  it('ERP-миграции не изменены, новые не трогают erp_*', () => {
    const frozen = manifest.migrations as Record<string, string>;
    const actualFrozen: Record<string, string> = {};
    const violations: string[] = [];
    for (const name of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
      const path = join(MIGRATIONS_DIR, name);
      if (name in frozen) {
        actualFrozen[name] = sha(path);
      } else {
        for (const v of erpDdlViolations(readFileSync(path, 'utf8'))) violations.push(`${name}: ${v}`);
      }
    }
    // Манифестные миграции только сверяются по хэшу; DDL-проверка — для остальных
    const message = frozenMessage('migrations', diffManifest(frozen, actualFrozen), violations);
    if (message) expect.fail(message);
  });
});
