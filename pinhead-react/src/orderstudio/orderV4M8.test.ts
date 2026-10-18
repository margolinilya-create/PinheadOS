// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { erpDdlViolations } from './erpFrozenCheck';
import { ZONE_ID_RE } from './catalog/tzRows';
import { SALES_CLIENT_REV } from './api/salesOrders';

/**
 * СТОРОЖ МИГРАЦИЙ ВЕХИ 8 (задача 2): L `…150000_order_v3_readonly_staff_audit`,
 * K `…160000_order_v4_zone_notes`, M `…170000_catalog_legacy_keys` и файлов
 * выкатки `supabase/rollout/m8/` (собирает `build.mjs`).
 *
 * Держит то, что ломается молча:
 *   · цепочка md5 J → L → K → откаты: тела B/D (литералы живой базы задачи 0) —
 *     обратная замена блоков `-- L:`/`-- K:`; предусловие K знает тело стража из L;
 *     откат L — тело B + классификация `notes` (годится и после K), откат K — тело D;
 *   · порядок файлов = порядок выкатки (L < K < M, все после J);
 *   · в файлах, которые применяет контроллер через MCP, нет `drop`/`delete`
 *     (комментарии и строки `'…'` не в счёт, тела `$…$` — в счёт);
 *   · папка выкатки = сборке (`build.mjs`): руками файлы не правятся;
 *   · CHECK и проверка кода зоны в K — ровно `ZONE_ID_RE.source`;
 *   · CHECK длины `notes` и классификация `notes` — в L, не в K; K не трогает стражей;
 *   · новые политики — на команду, с `(select …)`; ERP не трогается.
 */

const ROOT = join(process.cwd(), '..');
const MIG = join(ROOT, 'supabase/migrations');
const ROLLOUT = join(ROOT, 'supabase/rollout/m8');
const PROBES = join(ROOT, 'supabase/probes');
const read = (p: string) => readFileSync(p, 'utf8');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const FILES = {
  J: '20261018120000_order_v4_launch.sql',
  L: '20261018150000_order_v3_readonly_staff_audit.sql',
  K: '20261018160000_order_v4_zone_notes.sql',
  M: '20261018170000_catalog_legacy_keys.sql',
};
const L = read(join(MIG, FILES.L));
const K = read(join(MIG, FILES.K));
const M = read(join(MIG, FILES.M));
const B = read(join(MIG, '20261017062110_order_v4_rights.sql'));
const D = read(join(MIG, '20261017101513_order_v4_client_rev.sql'));

/** Литералы живой базы после J (задача 0; supabase/probes/README.md «Веха 8») */
const T0_MD5 = {
  order_v4_guard: '8dab43ebfb6d773f9c223844abb494fd',
  order_v4_delete_guard: '328e9df158071c55cbec4e655686d9b7',
  order_v4_child_guard: '75051f6f7d964b8be7b8888e0bb826ff',
  order_v4_save: '06a632efc09bf431c0c3c861960c22d9',
  order_v4_save_full: '6be40fb03b7eec70b76bf5de08b57c83',
};
/** md5 тел после L и K и тела отката L (B + notes) — литералы предусловий и сверок выкатки */
const L_MD5 = { order_v4_guard: '4fec238885f48f569a520c46f40bef72', order_v4_delete_guard: 'f2e4a081d688472c48cd9f3850a2ee45' };
const K_MD5 = { order_v4_save_full: 'c9eeabed217ddcefb685211b016b1116' };
const ROLLBACK_L_GUARD_MD5 = '95329c51fb463e39266d420ef7dda452';

interface Mutation { name: string; scope: 'L' | 'K'; fn?: string; find: string; replace: string; kills: string; probe?: string }
interface BuildModule {
  build: () => { files: Record<string, string>; MD5: Record<string, Record<string, string>>; rollbackGuardBody: string };
  revertBlocks: (text: string, prefix: string, keep?: (tag: string) => boolean) => string;
  fnStatement: (sql: string, fn: string) => { text: string; body: string };
  mutate: (sql: string, mu: Mutation) => string;
  MUTATIONS: Mutation[];
  CONTROLLER_FILES: string[];
  T0_MD5: Record<string, string>;
}
const gen = (await import(/* @vite-ignore */ pathToFileURL(join(ROLLOUT, 'build.mjs')).href)) as BuildModule;
const built = gen.build();
const body = (sql: string, fn: string) => gen.fnStatement(sql, fn).body;

/** Исполняемый текст для сторожа лексики: без `--`/`/* *\/` комментариев и строк `'…'` */
function lexicalCode(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
}
const FORBIDDEN_WORD = /\b(drop|delete)\b/i;

describe('веха 8: порядок и состав миграций', () => {
  it('L < K < M, все после J и последние в папке', () => {
    const all = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
    expect(all.slice(-4)).toEqual([FILES.J, FILES.L, FILES.K, FILES.M]);
  });

  it('K не трогает стражей заказа, order_v4_save и CHECK длины notes (это L)', () => {
    const fns = [...K.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]);
    expect(fns).toEqual(['order_v4_save_full']);
    expect(lexicalCode(K)).not.toMatch(/orders_notes_len/);
    expect(L).toMatch(/add constraint orders_notes_len check \(notes is null or char_length\(notes\) <= 2000\) not valid;/);
    expect(L).toMatch(/alter table public\.orders validate constraint orders_notes_len;/);
  });

  it('ERP не трогается; конец L и K — перечитать схему', () => {
    for (const sql of [L, K, M]) expect(erpDdlViolations(sql)).toEqual([]);
    // ERP только читается (стражи L смотрят erp_orders): ни DDL, ни записи
    for (const sql of [L, K, M]) expect(lexicalCode(sql)).not.toMatch(/\b(insert into|update|alter table|create \w+)\s+public\.erp_/i);
    for (const sql of [L, K, M]) expect(sql.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});

describe('веха 8: цепочка md5 J → L → K → откаты', () => {
  it('тела B и D (последние до вехи 8) — литералы живой базы задачи 0', () => {
    expect(md5(body(B, 'order_v4_guard'))).toBe(T0_MD5.order_v4_guard);
    expect(md5(body(B, 'order_v4_delete_guard'))).toBe(T0_MD5.order_v4_delete_guard);
    expect(md5(body(B, 'order_v4_child_guard'))).toBe(T0_MD5.order_v4_child_guard);
    expect(md5(body(D, 'order_v4_save'))).toBe(T0_MD5.order_v4_save);
    expect(md5(body(D, 'order_v4_save_full'))).toBe(T0_MD5.order_v4_save_full);
    expect(gen.T0_MD5).toEqual({
      'order_v4_guard()': T0_MD5.order_v4_guard,
      'order_v4_delete_guard()': T0_MD5.order_v4_delete_guard,
      'order_v4_child_guard()': T0_MD5.order_v4_child_guard,
      'order_v4_save(jsonb)': T0_MD5.order_v4_save,
      'order_v4_save_full(jsonb)': T0_MD5.order_v4_save_full,
    });
  });

  it('обратная замена блоков L и K даёт тела B и D побайтно', () => {
    for (const fn of ['order_v4_guard', 'order_v4_delete_guard']) {
      expect(gen.revertBlocks(body(L, fn), 'L'), fn).toBe(body(B, fn));
    }
    expect(gen.revertBlocks(body(K, 'order_v4_save_full'), 'K')).toBe(body(D, 'order_v4_save_full'));
  });

  it('md5 тел L и K — литералы сторожа и сборки', () => {
    expect(md5(body(L, 'order_v4_guard'))).toBe(L_MD5.order_v4_guard);
    expect(md5(body(L, 'order_v4_delete_guard'))).toBe(L_MD5.order_v4_delete_guard);
    expect(md5(body(K, 'order_v4_save_full'))).toBe(K_MD5.order_v4_save_full);
    expect(built.MD5.L).toEqual({ 'order_v4_guard()': L_MD5.order_v4_guard, 'order_v4_delete_guard()': L_MD5.order_v4_delete_guard });
    expect(built.MD5.K).toEqual({ 'order_v4_save_full(jsonb)': K_MD5.order_v4_save_full });
  });

  it('предусловия: L ждёт тела B, K — тела D/B и стражей из 2-apply-L', () => {
    const f = built.files;
    for (const h of [T0_MD5.order_v4_guard, T0_MD5.order_v4_delete_guard]) {
      expect(f['1-dryrun-L.sql']).toContain(`'${h}'`);
      expect(f['2-apply-L.sql']).toContain(`'${h}'`);
    }
    const lGuardFromApply = md5(body(f['2-apply-L.sql'], 'order_v4_guard'));
    expect(lGuardFromApply).toBe(L_MD5.order_v4_guard);
    for (const name of ['1-dryrun-K.sql', '2-apply-K.sql', '4-dryrun-rollback-K.sql']) {
      for (const h of [lGuardFromApply, L_MD5.order_v4_delete_guard, T0_MD5.order_v4_save,
        T0_MD5.order_v4_save_full, T0_MD5.order_v4_child_guard]) {
        expect(f[name], `${name} ${h}`).toContain(`'${h}'`);
      }
    }
  });

  it('откат L: тело B + notes (без веток v3), литерал сторожа; delete-страж — тело B', () => {
    const rb = built.rollbackGuardBody;
    expect(md5(rb)).toBe(ROLLBACK_L_GUARD_MD5);
    expect(built.MD5.rollbackL).toEqual({ 'order_v4_guard()': ROLLBACK_L_GUARD_MD5, 'order_v4_delete_guard()': T0_MD5.order_v4_delete_guard });
    const code = rb.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    const allowed = code.match(/c_allowed constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
    const insertEmpty = code.match(/c_insert_empty constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '';
    expect(allowed).toMatch(/'notes'/);
    expect(insertEmpty).not.toMatch(/'notes'/);
    expect(rb).not.toMatch(/Старые заказы/);
    expect(code).toMatch(/if new\.schema_version is distinct from 4 then return new; end if;/);
    // без notes откат — ровно тело B
    expect(gen.revertBlocks(rb, 'L')).toBe(body(B, 'order_v4_guard'));
    const rbFile = built.files['3-rollback-L.sql'];
    expect(md5(body(rbFile, 'order_v4_delete_guard'))).toBe(T0_MD5.order_v4_delete_guard);
    expect(rbFile).toContain(`'${ROLLBACK_L_GUARD_MD5}'`);
    expect(rbFile).toMatch(/alter table public\.profiles disable trigger profiles_sales_staff_audit;/);
  });

  it('откат функций K: только обёртка, тело D (порог 3), стражей L не трогает', () => {
    const f = built.files['3-rollback-K-functions.sql'];
    expect(f).not.toMatch(/order_v4_guard/);
    expect(md5(body(f, 'order_v4_save_full'))).toBe(T0_MD5.order_v4_save_full);
    expect(body(f, 'order_v4_save_full')).toMatch(/< 3 then/);
    expect(f).not.toMatch(/orders_notes_len/);
  });
});

describe('веха 8: лексика файлов контроллера и сборка папки', () => {
  it('папка выкатки = сборке build.mjs (файлы не правятся руками)', () => {
    const onDisk = readdirSync(ROLLOUT).filter((f) => f.endsWith('.sql') && !f.startsWith('probes-')).sort();
    expect(onDisk).toEqual(Object.keys(built.files).sort());
    for (const [name, text] of Object.entries(built.files)) expect(read(join(ROLLOUT, name)), name).toBe(text);
  });

  it('в файлах контроллера (L, K) нет drop/delete вне комментариев и строк', () => {
    expect(gen.CONTROLLER_FILES.length).toBe(9);
    for (const name of gen.CONTROLLER_FILES) {
      expect(lexicalCode(built.files[name]), name).not.toMatch(FORBIDDEN_WORD);
    }
    // миграции L и K сами — тоже (их текст входит в файлы контроллера)
    expect(lexicalCode(L)).not.toMatch(FORBIDDEN_WORD);
    expect(lexicalCode(K)).not.toMatch(FORBIDDEN_WORD);
  });

  it('файлы владельца несут то, что MCP не применит: M, 3b, регресс прав', () => {
    for (const name of ['2-apply-M.sql', '3b-drop-zone-id.sql', '1b-dryrun-L-regress.sql']) {
      expect(lexicalCode(built.files[name]), name).toMatch(FORBIDDEN_WORD);
      expect(gen.CONTROLLER_FILES).not.toContain(name);
    }
  });

  it('самопроверка лексики: перечень с delete в revoke и drop в теле $$ — красный; комментарий и строка — нет', () => {
    expect(lexicalCode('revoke select, insert, update, delete on public.x from anon;')).toMatch(FORBIDDEN_WORD);
    expect(lexicalCode('create function f() as $$ begin drop table x; end $$;')).toMatch(FORBIDDEN_WORD);
    expect(lexicalCode("-- on delete set null\nselect 'DELETE';")).not.toMatch(FORBIDDEN_WORD);
    expect(lexicalCode('select 1 from order_v4_delete_guard;')).not.toMatch(FORBIDDEN_WORD);
    const mutated = built.files['2-apply-L.sql'].replace(
      'revoke all on public.order_comments from public, anon, authenticated;',
      'revoke select, insert, update, delete on public.order_comments from public, anon, authenticated;');
    expect(lexicalCode(mutated)).toMatch(FORBIDDEN_WORD);
  });
});

describe('веха 8: K — код зоны и комментарий', () => {
  const full = body(K, 'order_v4_save_full');
  const code = full.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('CHECK колонки и проверка в обёртке — ровно ZONE_ID_RE.source', () => {
    const src = ZONE_ID_RE.source;
    expect(K).toContain(`check (zone_id is null or zone_id ~ '${src}')`);
    expect(code).toContain(`(pr.v->>'zone_id') !~ '${src}'`);
    expect(code).toMatch(/message = 'Неверный код зоны нанесения'/);
  });

  it('notes: 22023 до записи, запись только при ключе, ответ несёт notes и updated_at', () => {
    expect(code).toMatch(/char_length\(coalesce\(p_order->>'notes', ''\)\) > 2000/);
    expect(code).toMatch(/if p_order \? 'notes' then\s+update public\.orders set notes = /);
    expect(code).toMatch(/jsonb_build_object\('updated_at', v_updated, 'notes', coalesce\(v_notes, ''\)\)/);
    expect(code.indexOf("errcode = '22023'")).toBeLessThan(code.indexOf('public.order_v4_save(p_order)'));
  });

  it('порог ревизии K — 4, первой строкой; не ниже клиента', () => {
    const first = code.slice(code.search(/\bbegin\b/) + 5).trimStart();
    expect(first.startsWith("if coalesce((p_order->>'client_rev')::int, 0) < 4 then")).toBe(true);
    expect(4).toBeGreaterThanOrEqual(SALES_CLIENT_REV);
  });

  // Пара «клиент + миграция» (задача 8): клиент ревизии 4 и порог K — одно число
  it('порог ревизии K равен SALES_CLIENT_REV (клиент ревизии 4 — задача 8)', () => {
    const rev = Number(code.match(/if coalesce\(\(p_order->>'client_rev'\)::int, 0\) < (\d+) then/)?.[1]);
    expect(rev).toBe(SALES_CLIENT_REV);
    expect(SALES_CLIENT_REV).toBe(4);
  });

  it('invoker, revoke public/anon, grant authenticated', () => {
    expect(gen.fnStatement(K, 'order_v4_save_full').text).toMatch(/security invoker/);
    expect(K).toMatch(/revoke execute on function public\.order_v4_save_full\(jsonb\) from public, anon;/);
    expect(K).toMatch(/grant execute on function public\.order_v4_save_full\(jsonb\) to authenticated;/);
  });
});

describe('веха 8: L — права и журнал', () => {
  const code = lexicalCode(L);

  it('новая политика — одна, на команду select, хелпер в (select …); политики order_comments выключены', () => {
    const created = L.match(/create policy[\s\S]*?;/g) ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/for select to authenticated\s+using \(\(select public\.sales_is_lead\(\)\)\);/);
    expect(L).toMatch(/alter policy order_comments_select on public\.order_comments using \(false\);/);
    expect(L).toMatch(/alter policy order_comments_insert on public\.order_comments with check \(false\);/);
    expect(L).toMatch(/revoke all on public\.order_comments from public, anon, authenticated;/);
  });

  it('журнал: запись клиенту закрыта, триггер definer с search_path и закрыт от клиентов', () => {
    expect(L).toMatch(/revoke all on public\.sales_staff_events from public, anon, authenticated;\s*grant select on public\.sales_staff_events to authenticated;/);
    expect(L).toMatch(/revoke all on sequence public\.sales_staff_events_id_seq from public, anon, authenticated;/);
    expect(code).not.toMatch(/grant (insert|update|all)[^;]*sales_staff_events/);
    const trg = gen.fnStatement(L, 'profiles_sales_staff_audit').text;
    expect(trg).toMatch(/security definer\s+set search_path = public/);
    expect(L).toMatch(/revoke execute on function public\.profiles_sales_staff_audit\(\) from public, anon, authenticated;/);
    expect(L).toMatch(/create trigger profiles_sales_staff_audit\s+after update of is_sales, is_ms on public\.profiles/);
    expect(L).not.toMatch(/function public\.sales_set_staff/);
  });

  it('страж: ветка v3 после служебного доступа и веток FK, отказ 42501', () => {
    const g = body(L, 'order_v4_guard').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    const service = g.indexOf("not in ('authenticated', 'anon')");
    const fkErp = g.indexOf('old.erp_order_id is not null and new.erp_order_id is null');
    const v3Update = g.indexOf("if old.schema_version is distinct from 4 then\n    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';");
    const v3Insert = g.indexOf('Старые заказы (v3) только для чтения: новый заказ — укажите schema_version = 4');
    expect(service).toBeGreaterThan(0);
    expect(v3Insert).toBeGreaterThan(service);
    expect(v3Update).toBeGreaterThan(fkErp);
    expect(g).not.toMatch(/return new; end if;\n\s+elsif old\.schema_version is distinct from 4/);
    const dg = body(L, 'order_v4_delete_guard').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(dg.indexOf('Старые заказы (v3) только для чтения')).toBeGreaterThan(dg.indexOf("not in ('authenticated', 'anon')"));
    expect(dg).not.toMatch(/if old\.schema_version is distinct from 4 then\s+return old;/);
  });
});

describe('веха 8: M и мутации', () => {
  it('M: предусловие по md5 снимка, политика — alter policy с (select …)', () => {
    const snap = JSON.parse(read(join(ROOT, 'supabase/snapshots/catalog_config_legacy_2026-10-18.json'))) as {
      rows: { key: string; md5: string }[];
    };
    for (const r of snap.rows) expect(M, r.key).toMatch(new RegExp(`"${r.key}":\\s+"${r.md5}"`));
    expect(M.indexOf('$pre$')).toBeLessThan(M.search(/\bdelete from public\.catalog_config\b/));
    expect(M).toMatch(/alter policy catalog_config_select on public\.catalog_config\s+using \(\(select public\.catalog_reader\(\)\)\);/);
    expect(lexicalCode(M)).not.toMatch(/\b(create|drop) policy\b/);
  });

  it('каждая мутация находит свою правку ровно один раз, проба-убийца есть в файле проб', () => {
    const probe = (f: string) => read(join(PROBES, f));
    for (const mu of gen.MUTATIONS) {
      const src = mu.scope === 'L' ? L : K;
      expect(gen.mutate(src, mu), mu.name).not.toBe(src);
      const file = mu.probe ?? (mu.scope === 'L' ? 'order_v3_readonly.sql' : 'order_v4_zone_notes.sql');
      const names = new Set([...probe(file).matchAll(/pg_temp\.p\('([a-z0-9_]+)'/g)].map((m) => m[1]));
      const killed = [...mu.kills.matchAll(/[a-z0-9_]{4,}/g)].map((m) => m[0]).filter((n) => names.has(n));
      expect(killed.length, `${mu.name}: ${mu.kills}`).toBeGreaterThan(0);
    }
  });

  it('самопроверка: мутация с правкой, которой нет, — ошибка', () => {
    expect(() => gen.mutate(L, { name: 'x', scope: 'L', find: 'нет такой строки', replace: '', kills: '' })).toThrow(/0 раз/);
  });
});
