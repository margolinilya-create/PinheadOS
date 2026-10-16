// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sourceFiles, SRC_DIR } from '../testutil/sourceFiles';
import { diffManifest, erpDdlViolations } from './erpFrozenCheck';
import manifest from './erpFrozen.json';

// Сторож «ERP заморожен»: боевой ERP при работе над Order не меняется.
// Манифест пишет `npm run erp:freeze` (scripts/erp-freeze.mjs).

const MIGRATIONS_DIR = join(process.cwd(), '..', 'supabase', 'migrations');

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function describeDiff(d: { changed: string[]; added: string[]; removed: string[] }): string {
  return [
    ...d.changed.map((f) => `изменён ${f}`),
    ...d.added.map((f) => `добавлен ${f}`),
    ...d.removed.map((f) => `удалён ${f}`),
  ].join(', ');
}

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

  it('файлы src/erp совпадают с манифестом', () => {
    const actual: Record<string, string> = {};
    for (const p of sourceFiles(join(SRC_DIR, 'erp'), { ext: /./, tests: true })) {
      actual[relative(SRC_DIR, p).split(sep).join('/')] = sha(p);
    }
    const diff = diffManifest(manifest.files, actual);
    const list = describeDiff(diff);
    if (list) {
      expect.fail(
        `ERP изменён: ${list}. ERP боевой и в работе над Order не меняется. ` +
          'Если правка ERP согласована владельцем — npm run erp:freeze и коммит манифеста вместе с правкой.',
      );
    }
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
    const list = describeDiff(diffManifest(frozen, actualFrozen));
    if (list) {
      expect.fail(
        `ERP изменён: миграции ${list}. ERP боевой и в работе над Order не меняется. ` +
          'Если правка ERP согласована владельцем — npm run erp:freeze и коммит манифеста вместе с правкой.',
      );
    }
    expect(violations, `Новая миграция правит объекты erp_*: ${violations.join('; ')}`).toEqual([]);
  });
});
