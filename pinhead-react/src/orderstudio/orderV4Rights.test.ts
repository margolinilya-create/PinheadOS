// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * СТОРОЖ ПРАВ ORDER V4 (веха 2, миграция B `…_order_v4_rights.sql`).
 *
 * Права заказа v4 живут в SQL: definer-RPC переходов/оплаты/запуска, страж
 * `orders` с белым списком колонок, стражи строк заказа, политики на команду.
 * Сторож держит то, что ломается молча:
 *   · у каждой функции файла — `revoke execute … from public, anon`
 *     (иначе Supabase по умолчанию открывает её анониму через REST);
 *   · у каждой `security definer` — `set search_path = public`;
 *   · в политиках `auth.uid()` только в `(select …)`, политики — на команду
 *     и пересоздаются явно (`drop policy if exists` + `create policy`);
 *   · метка режима RPC `order_v4.rpc`: каждое `'on'` закрыто своим `'off'`
 *     в той же функции — иначе вся оставшаяся транзакция идёт мимо стража;
 *   · белый список стража == колонки, которые пишут `order_v4_save`
 *     (последняя редакция) и `order_v4_set_urgent_days`, плюс `updated_at`.
 *     Новая колонка в сохранении без строки в списке — сохранение начнёт
 *     падать 42501; лишняя строка в списке — дыра в страже.
 */
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');

const rightsFile = files.filter((f) => f.endsWith('_order_v4_rights.sql')).at(-1);
if (!rightsFile) throw new Error('нет миграции *_order_v4_rights.sql');
const RIGHTS = read(rightsFile);

/** Последняя миграция, пересоздающая функцию `public.<fn>(` */
function latestDefining(fn: string): string {
  const re = new RegExp(`create or replace function public\\.${fn}\\(`);
  const hit = files.filter((f) => re.test(read(f))).at(-1);
  if (!hit) throw new Error(`нет миграции, определяющей ${fn}()`);
  return read(hit);
}

/** SQL без строк-комментариев */
const noComments = (sql: string) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

interface FnDef { name: string; head: string; body: string }

/** Функции файла: имя, заголовок до `as $tag$`, тело между тегами */
function functionsOf(sql: string): FnDef[] {
  const out: FnDef[] = [];
  const re = /create or replace function public\.([a-z0-9_]+)\(/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const rest = sql.slice(m.index);
    const as = rest.match(/\bas\s+(\$[a-z_]*\$)/i);
    if (!as || as.index === undefined) throw new Error(`нет тела ${m[1]}`);
    const tag = as[1];
    const bodyStart = as.index + as[0].length;
    const bodyEnd = rest.indexOf(tag, bodyStart);
    if (bodyEnd < 0) throw new Error(`тело ${m[1]} не закрыто`);
    out.push({ name: m[1], head: rest.slice(0, as.index), body: rest.slice(bodyStart, bodyEnd) });
  }
  return out;
}

/** Колонки `update public.orders set … where` — разбор по запятым верхнего уровня */
function updatedColumns(body: string): string[] {
  const cols = new Set<string>();
  const re = /update\s+public\.orders\s+set\s+([\s\S]*?)\s+where\b/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let depth = 0;
    let part = '';
    const parts: string[] = [];
    for (const ch of m[1]) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { parts.push(part); part = ''; } else part += ch;
    }
    parts.push(part);
    for (const p of parts) {
      const col = noComments(p).trim().match(/^([a-z_]+)\s*=/);
      if (!col) throw new Error(`не разобрано присваивание: ${p.trim()}`);
      cols.add(col[1]);
    }
  }
  return [...cols].sort();
}

/** Белый список стража `order_v4_guard` */
function guardAllowed(sql: string): string[] {
  const guard = functionsOf(sql).find((f) => f.name === 'order_v4_guard');
  if (!guard) throw new Error('нет order_v4_guard');
  const arr = guard.body.match(/c_allowed\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/);
  if (!arr) throw new Error('нет c_allowed в order_v4_guard');
  return [...arr[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

/** Нарушения парности метки режима RPC в теле функции */
function rpcMarkProblems(body: string): string[] {
  const marks = [...body.matchAll(/set_config\(\s*'order_v4\.rpc'\s*,\s*'(on|off)'/g)].map((x) => x[1]);
  const problems: string[] = [];
  let open = false;
  for (const mark of marks) {
    if (mark === 'on' && open) problems.push('два on подряд');
    if (mark === 'off' && !open) problems.push('off без on');
    open = mark === 'on';
  }
  if (open) problems.push('on без off');
  return problems;
}

/** Функции без `revoke execute … from public, anon` */
function missingRevoke(sql: string): string[] {
  return functionsOf(sql)
    .map((f) => f.name)
    .filter((n) => !new RegExp(
      `revoke execute on function public\\.${n}\\([^)]*\\)\\s+from\\s+public,\\s*anon\\b`,
    ).test(sql));
}

/** Тексты `create policy … ;` */
const policiesOf = (sql: string) => noComments(sql).match(/create policy[\s\S]*?;/g) ?? [];

describe('миграция B: права Order v4', () => {
  const fns = functionsOf(RIGHTS);

  it('функции на месте', () => {
    expect(fns.map((f) => f.name).sort()).toEqual([
      'order_v4_child_guard', 'order_v4_guard', 'order_v4_has_erp', 'order_v4_launch_check',
      'order_v4_set_payment', 'order_v4_transition', 'sales_is_lead', 'sales_is_ms', 'sales_is_seller',
    ]);
  });

  it('у каждой функции — revoke execute from public, anon', () => {
    expect(missingRevoke(RIGHTS)).toEqual([]);
  });

  it('функции-триггеры закрыты и от authenticated', () => {
    for (const n of ['order_v4_guard', 'order_v4_child_guard']) {
      expect(RIGHTS).toMatch(new RegExp(
        `revoke execute on function public\\.${n}\\(\\) from public, anon, authenticated;`));
      expect(RIGHTS).not.toMatch(new RegExp(`grant execute on function public\\.${n}\\(`));
    }
  });

  it('у каждой security definer — set search_path = public', () => {
    const bad = fns.filter((f) => /security definer/.test(f.head) && !/set search_path = public/.test(f.head));
    expect(bad.map((f) => f.name)).toEqual([]);
    // страж orders — invoker: родитель проверяется под RLS вызывающего
    expect(fns.find((f) => f.name === 'order_v4_guard')?.head).toMatch(/security invoker/);
  });

  it('в политиках нет голого auth.uid(), нет for all; каждая — на команду и пересоздаётся явно', () => {
    const policies = policiesOf(RIGHTS);
    expect(policies.length).toBeGreaterThanOrEqual(5);
    for (const p of policies) {
      const bare = p.replace(/\(select auth\.uid\(\)\)/g, '');
      expect(bare, p).not.toMatch(/auth\.uid\(\)/);
      expect(p, p).not.toMatch(/\bfor all\b/i);
      expect(p, p).toMatch(/\bfor (select|insert|update|delete) to authenticated\b/);
      const [, name, table] = p.match(/create policy (\w+) on (public\.\w+)/) ?? [];
      expect(RIGHTS, name).toContain(`drop policy if exists ${name} on ${table};`);
    }
    // хелперы в предикате — через (select …)
    for (const p of policies) {
      expect(p.replace(/\(select public\.sales_is_\w+\(\)\)/g, ''), p).not.toMatch(/sales_is_\w+\(\)/);
    }
  });

  it('журнал order_events: только политика select, запись отозвана', () => {
    const events = policiesOf(RIGHTS).filter((p) => /on public\.order_events/.test(p));
    expect(events.map((p) => p.match(/for (\w+)/)?.[1])).toEqual(['select']);
    expect(RIGHTS).toMatch(/revoke insert, update, delete, truncate on public\.order_events from public, anon, authenticated;/);
  });

  it('метка order_v4.rpc: каждое on закрыто off в той же функции', () => {
    const withMarks = fns.filter((f) => /order_v4\.rpc'\s*,\s*'on'/.test(f.body));
    expect(withMarks.map((f) => f.name).sort()).toEqual(
      ['order_v4_launch_check', 'order_v4_set_payment', 'order_v4_transition']);
    for (const f of fns) expect(rpcMarkProblems(f.body), f.name).toEqual([]);
  });

  it('страж верит метке только вне роли authenticated', () => {
    const guard = fns.find((f) => f.name === 'order_v4_guard');
    expect(guard?.body).toMatch(/current_setting\('order_v4\.rpc', true\)[\s\S]{0,80}current_user <> 'authenticated'/);
  });

  it('белый список стража = колонки order_v4_save + order_v4_set_urgent_days + updated_at', () => {
    const save = functionsOf(latestDefining('order_v4_save')).find((f) => f.name === 'order_v4_save');
    const urgent = functionsOf(latestDefining('order_v4_set_urgent_days'))
      .find((f) => f.name === 'order_v4_set_urgent_days');
    if (!save || !urgent) throw new Error('нет order_v4_save / order_v4_set_urgent_days');
    const written = [...new Set([...updatedColumns(save.body), ...updatedColumns(urgent.body), 'updated_at'])].sort();
    expect(guardAllowed(RIGHTS)).toEqual(written);
  });

  it('стражи висят на INSERT/UPDATE/DELETE всех таблиц заказа', () => {
    const sql = noComments(RIGHTS);
    expect(sql).toMatch(/create trigger orders_v4_guard\s+before insert or update or delete on public\.orders\s+for each row execute function public\.order_v4_guard\(\);/);
    for (const t of ['order_items', 'order_item_prints', 'order_item_labels', 'order_notes_cards']) {
      expect(sql).toMatch(new RegExp(
        `create trigger ${t}_v4_guard\\s+before insert or update or delete on public\\.${t}\\s+for each row execute function public\\.order_v4_child_guard\\(\\);`));
    }
  });

  it('стражи проверяют пути файлов и родителя', () => {
    const guard = fns.find((f) => f.name === 'order_v4_guard')?.body ?? '';
    expect(guard).toMatch(/order_artwork_path_ok\(new\.id, new\.sticker_preview_path\)/);
    expect(guard).toMatch(/new\.parent_id = new\.id/);
    const child = fns.find((f) => f.name === 'order_v4_child_guard')?.body ?? '';
    for (const snippet of [
      "v_new->>'tz_pdf_path'", "v_new->>'artwork_path'", "v_new->>'attach_image_path'",
      "v_new->>'image_path'", "v_new->'preview_paths'",
    ]) {
      expect(child, snippet).toContain(snippet);
    }
    expect(child).toMatch(/order_artwork_path_ok\(v_new_order, v_path\)/);
  });

  it('DDL по erp_* нет — только чтение', () => {
    expect(noComments(RIGHTS)).not.toMatch(/\b(alter|create|drop)\s+(table|policy|trigger|index)[^;]*\berp_/i);
    expect(noComments(RIGHTS)).not.toMatch(/\b(insert into|update|delete from)\s+public\.erp_/i);
  });
});

describe('самопроверка разборщиков', () => {
  it('updatedColumns видит колонку с запятыми в выражении', () => {
    expect(updatedColumns(`update public.orders set a = coalesce(x, 'y'),\n b = 1 where id = 1`)).toEqual(['a', 'b']);
  });

  it('добавленная в сохранение колонка без строки в списке — расхождение', () => {
    const save = functionsOf(latestDefining('order_v4_save')).find((f) => f.name === 'order_v4_save');
    const mutated = (save?.body ?? '').replace('updated_at       = now()', 'updated_at       = now(),\n    status = \'done\'');
    expect(updatedColumns(mutated)).toContain('status');
    expect(guardAllowed(RIGHTS)).not.toContain('status');
  });

  it('rpcMarkProblems ловит незакрытую метку', () => {
    expect(rpcMarkProblems(`perform set_config('order_v4.rpc', 'on', true); update x;`)).toEqual(['on без off']);
    expect(rpcMarkProblems(`perform set_config('order_v4.rpc', 'off', true);`)).toEqual(['off без on']);
  });

  it('missingRevoke ловит функцию без revoke', () => {
    const sql = `create or replace function public.f1() returns int language sql as $$ select 1 $$;\n`
      + `create or replace function public.f2() returns int language sql as $$ select 1 $$;\n`
      + `revoke execute on function public.f1() from public, anon;`;
    expect(missingRevoke(sql)).toEqual(['f2']);
  });
});
