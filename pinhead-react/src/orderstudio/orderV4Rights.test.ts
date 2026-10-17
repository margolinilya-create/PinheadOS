// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SALES_CLIENT_REV, saveFailureKind } from './api/salesOrders';

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

/** Список-константа `<name> constant text[] := array[...]` стража `order_v4_guard` */
function guardList(sql: string, name: string): string[] {
  const guard = functionsOf(sql).find((f) => f.name === 'order_v4_guard');
  if (!guard) throw new Error('нет order_v4_guard');
  const arr = guard.body.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([\\s\\S]*?)\\];`));
  if (!arr) throw new Error(`нет ${name} в order_v4_guard`);
  return [...arr[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

/** Белый список UPDATE стража */
const guardAllowed = (sql: string) => guardList(sql, 'c_allowed');

/** Колонки, добавленные в `public.orders` (`alter table public.orders … add column`) */
function addedOrderColumns(sqls: string[]): string[] {
  const cols = new Set<string>();
  for (const sql of sqls) {
    for (const stmt of noComments(sql).match(/alter table public\.orders\b[\s\S]*?;/gi) ?? []) {
      for (const m of stmt.matchAll(/add column (?:if not exists )?([a-z_]+)/gi)) cols.add(m[1]);
    }
  }
  return [...cols].sort();
}

/** Колонки `orders` до Order v4 (таблица визарда v3) */
const BASE_ORDER_COLUMNS = [
  'id', 'created_by', 'order_number', 'data', 'status', 'created_at', 'updated_at', 'bitrix_deal',
  'total_sum', 'total_qty', 'item_type', 'artwork_link', 'notes', 'erp_order_id',
];
const V4_SINCE = '20260928213529';

/** Нарушения парности метки режима RPC (`order_v4.rpc`, `sales.rpc`) в теле функции */
function rpcMarkProblems(body: string, key = 'order_v4.rpc'): string[] {
  const re = new RegExp(`set_config\\(\\s*'${key.replace('.', '\\.')}'\\s*,\\s*'(on|off)'`, 'g');
  const marks = [...body.matchAll(re)].map((x) => x[1]);
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
      'generate_order_number', 'order_number_format',
      'order_v4_child_guard', 'order_v4_delete_guard', 'order_v4_guard', 'order_v4_launch_check',
      'order_v4_set_payment', 'order_v4_transition', 'sales_is_lead', 'sales_is_ms', 'sales_is_seller',
    ]);
  });

  it('у каждой функции — revoke execute from public, anon', () => {
    expect(missingRevoke(RIGHTS)).toEqual([]);
  });

  it('функции-триггеры закрыты и от authenticated', () => {
    for (const n of ['order_v4_guard', 'order_v4_child_guard', 'order_v4_delete_guard']) {
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
    expect(RIGHTS).toMatch(/revoke all on public\.order_events from public, anon, authenticated;\s*grant select on public\.order_events to authenticated;/);
    expect(noComments(RIGHTS)).not.toMatch(/grant (insert|update|delete|all)[^;]*order_events/);
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
    expect(sql).toMatch(/create trigger orders_v4_guard\s+before insert or update on public\.orders\s+for each row execute function public\.order_v4_guard\(\);/);
    expect(sql).toMatch(/create trigger orders_v4_delete_guard\s+before delete on public\.orders\s+for each row execute function public\.order_v4_delete_guard\(\);/);
    // оракула «есть ли у uuid заказ ERP» нет: проверка удаления — внутри definer-триггера
    expect(sql).not.toMatch(/order_v4_has_erp/);
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

  it('каждая колонка orders v4 классифицирована стражем ровно один раз', () => {
    const allowed = guardAllowed(RIGHTS);
    const dbFilled = guardList(RIGHTS, 'c_db_filled');
    const insertEmpty = guardList(RIGHTS, 'c_insert_empty');
    const added = addedOrderColumns(files.filter((f) => f >= V4_SINCE).map(read));
    expect(added.length).toBeGreaterThan(30);
    const known = new Set([...BASE_ORDER_COLUMNS, ...added]);
    for (const col of [...known]) {
      const where = [allowed, dbFilled, insertEmpty].filter((l) => l.includes(col)).length;
      expect(where, `колонка ${col}`).toBe(1);
    }
    for (const col of [...allowed, ...dbFilled, ...insertEmpty]) {
      expect(known.has(col), `в списке стража лишняя колонка ${col}`).toBe(true);
    }
  });

  it('номер заказа: формат в одной функции, номер уникален, подделка заменяется', () => {
    const gen = fns.find((f) => f.name === 'generate_order_number');
    expect(gen?.body).toMatch(/public\.order_number_format\(nextval\('public\.order_number_seq'\)\)/);
    expect(RIGHTS).toMatch(/create unique index if not exists orders_order_number_uniq on public\.orders \(order_number\);/);
    const guard = fns.find((f) => f.name === 'order_v4_guard')?.body ?? '';
    expect(guard).toMatch(/order_number_format\(currval\('public\.order_number_seq'\)\)/);
    expect(guard).toMatch(/new\.order_number := public\.generate_order_number\(\)/);
  });

  it('DDL по erp_* нет — только чтение', () => {
    expect(noComments(RIGHTS)).not.toMatch(/\b(alter|create|drop)\s+(table|policy|trigger|index)[^;]*\berp_/i);
    expect(noComments(RIGHTS)).not.toMatch(/\b(insert into|update|delete from)\s+public\.erp_/i);
  });
});

/**
 * МИГРАЦИЯ E (веха 3, `…_sales_staff_flag.sql`): продавец — явный признак
 * `profiles.is_sales`. Держим то, что ломается молча:
 *   · последняя редакция `sales_is_seller()` смотрит на признак, а не на роль
 *     (иначе начальники цехов с профилем manager снова продавцы);
 *   · признак меняет только `sales_set_staff` (admin/director) — страж
 *     `profiles` верит метке `sales.rpc` только вне клиентских ролей (authenticated, anon), метка
 *     парная; исключение у стража ровно одно — `is_sales`;
 *   · revoke у каждой функции, триггер закрыт и от authenticated.
 */
const staffFile = files.filter((f) => f.endsWith('_sales_staff_flag.sql')).at(-1);
if (!staffFile) throw new Error('нет миграции *_sales_staff_flag.sql');
const STAFF = read(staffFile);

/** Колонки строки, которые читает тело стража (`new.x` / `old.x`) */
const rowColumnsOf = (body: string) =>
  [...new Set([...noComments(body).matchAll(/\b(?:new|old)\.([a-z_]+)/g)].map((m) => m[1]))].sort();

describe('миграция E: признак «Менеджер продаж»', () => {
  const fns = functionsOf(STAFF);
  const fn = (n: string) => fns.find((f) => f.name === n);

  it('функции на месте', () => {
    expect(fns.map((f) => f.name).sort()).toEqual(
      ['profiles_sales_guard', 'sales_is_seller', 'sales_set_staff', 'sales_staff_list']);
  });

  it('колонка is_sales — not null default false', () => {
    expect(noComments(STAFF)).toMatch(
      /alter table public\.profiles\s+add column if not exists is_sales boolean not null default false;/);
  });

  it('у каждой функции — revoke execute from public, anon; триггер закрыт и от authenticated', () => {
    expect(missingRevoke(STAFF)).toEqual([]);
    expect(STAFF).toMatch(/revoke execute on function public\.profiles_sales_guard\(\) from public, anon, authenticated;/);
    expect(STAFF).not.toMatch(/grant execute on function public\.profiles_sales_guard\(/);
    for (const n of ['sales_set_staff\\(uuid, boolean\\)', 'sales_staff_list\\(\\)', 'sales_is_seller\\(\\)']) {
      expect(STAFF).toMatch(new RegExp(`grant execute on function public\\.${n} to authenticated;`));
    }
  });

  it('у каждой security definer — set search_path = public; страж — invoker', () => {
    const bad = fns.filter((f) => /security definer/.test(f.head) && !/set search_path = public/.test(f.head));
    expect(bad.map((f) => f.name)).toEqual([]);
    expect(fn('profiles_sales_guard')?.head).toMatch(/security invoker/);
    for (const n of ['sales_is_seller', 'sales_set_staff', 'sales_staff_list']) {
      expect(fn(n)?.head, n).toMatch(/security definer/);
    }
  });

  it('последняя редакция sales_is_seller — по признаку, не по роли', () => {
    expect(latestDefining('sales_is_seller')).toBe(STAFF);
    const body = fn('sales_is_seller')?.body ?? '';
    expect(body).toMatch(/p\.is_sales is true/);
    expect(body).toMatch(/p\.active is true and p\.approved is true/);
    expect(body).not.toMatch(/p\.role\b/);
  });

  it('RPC — только admin/director активного одобренного профиля, иначе 42501', () => {
    for (const n of ['sales_set_staff', 'sales_staff_list']) {
      const body = fn(n)?.body ?? '';
      expect(body, n).toMatch(/p\.active is true and p\.approved is true\s+and p\.role in \('admin', 'director'\)\) then\s+raise exception using errcode = '42501'/);
    }
  });

  it('метка sales.rpc: только в sales_set_staff и закрыта off', () => {
    const withMarks = fns.filter((f) => /sales\.rpc'\s*,\s*'on'/.test(f.body));
    expect(withMarks.map((f) => f.name)).toEqual(['sales_set_staff']);
    for (const f of fns) expect(rpcMarkProblems(f.body, 'sales.rpc'), f.name).toEqual([]);
  });

  it('страж верит метке только вне клиентских ролей (authenticated, anon); исключение ровно одно — is_sales', () => {
    const guard = fn('profiles_sales_guard')?.body ?? '';
    expect(guard).toMatch(/current_setting\('sales\.rpc', true\)[\s\S]{0,80}current_user not in \('authenticated', 'anon'\)/);
    expect(rowColumnsOf(guard)).toEqual(['is_sales']);
    expect(guard).toMatch(/errcode = '42501'/);
  });

  it('страж висит на INSERT и UPDATE profiles', () => {
    expect(noComments(STAFF)).toMatch(
      /create trigger profiles_sales_guard\s+before insert or update on public\.profiles\s+for each row execute function public\.profiles_sales_guard\(\);/);
    expect(STAFF).toContain('drop trigger if exists profiles_sales_guard on public.profiles;');
  });

  it('политик не создаёт, DDL по erp_* нет', () => {
    expect(policiesOf(STAFF)).toEqual([]);
    expect(noComments(STAFF)).not.toMatch(/\berp_/);
  });
});

/**
 * Проверка ревизии первой строкой; порог — тот же `SALES_CLIENT_REV`, что
 * шлёт клиент (поднял ревизию в клиенте — подними и в SQL). Группа 1 — текст отказа
 */
const CLIENT_REV_CHECK = new RegExp(String.raw`^\s*if coalesce\(\(p_order->>'client_rev'\)::int, 0\) < ${SALES_CLIENT_REV} then\s+raise exception using errcode = 'P0001',\s+message = '([^']+)';`);
/** Сверка версии в обёртке; группа 1 — текст отказа */
const CONFLICT_CHECK = /if found and v_status = 'draft' and v_current is distinct from v_expected then\s+raise exception using errcode = 'P0001',\s+message = '([^']+)';/;

/** Тело функции с кодом от первого `begin` — без объявлений и комментариев */
const codeAfterBegin = (body: string) => noComments(body.slice(body.search(/\bbegin\b/) + 'begin'.length));

describe('миграция D: ревизия клиента и конкурентная правка', () => {
  const fnOf = (n: string) => functionsOf(latestDefining(n)).find((f) => f.name === n);

  it('обе функции сохранения ПЕРВЫМ делом отказывают клиенту без ревизии 3', () => {
    for (const n of ['order_v4_save', 'order_v4_save_full']) {
      const f = fnOf(n);
      expect(f, n).toBeTruthy();
      expect(codeAfterBegin(f?.body ?? ''), n).toMatch(CLIENT_REV_CHECK);
    }
  });

  it('обёртка сверяет expected_updated_at со строкой, взятой FOR UPDATE, до записи', () => {
    const body = noComments(fnOf('order_v4_save_full')?.body ?? '');
    expect(body).toMatch(/nullif\(p_order->>'expected_updated_at', ''\)::timestamptz/);
    expect(body).toMatch(/select updated_at, status into v_current, v_status\s+from public\.orders\s+where id = v_id and schema_version = 4\s+for update;/);
    // не черновик — сверки нет: причину отказа называет страж («правка закрыта»)
    expect(body).toMatch(CONFLICT_CHECK);
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('public.order_v4_save(p_order)'));
  });

  it('обе остаются invoker и закрыты от anon', () => {
    for (const n of ['order_v4_save', 'order_v4_save_full']) {
      const sql = latestDefining(n);
      expect(fnOf(n)?.head, n).toMatch(/security invoker/);
      expect(fnOf(n)?.head, n).not.toMatch(/security definer/);
      expect(missingRevoke(sql), n).toEqual([]);
      expect(sql, n).toMatch(new RegExp(`grant execute on function public\\.${n}\\(jsonb\\) to authenticated;`));
    }
  });

  it('тексты отказов сервера распознаёт клиент: outdated / conflict / locked', () => {
    for (const n of ['order_v4_save', 'order_v4_save_full']) {
      const outdated = codeAfterBegin(fnOf(n)?.body ?? '').match(CLIENT_REV_CHECK)?.[1];
      expect(outdated, n).toBeTruthy();
      expect(saveFailureKind({ code: 'P0001', message: outdated })).toBe('outdated');
    }
    const conflict = noComments(fnOf('order_v4_save_full')?.body ?? '').match(CONFLICT_CHECK)?.[1];
    expect(conflict).toBeTruthy();
    expect(saveFailureKind({ code: 'P0001', message: conflict })).toBe('conflict');
    // Страж B: отказ правки не-черновика — тот, что клиент зовёт locked
    const guard = functionsOf(RIGHTS).find((f) => f.name === 'order_v4_guard');
    const locked = noComments(guard?.body ?? '')
      .match(/if old\.status is distinct from 'draft' then\s+raise exception using errcode = '42501', message = '([^']+)';/)?.[1];
    expect(locked).toBeTruthy();
    expect(saveFailureKind({ code: '42501', message: locked })).toBe('locked');
  });

  it('самопроверка: проверка не первой строкой или с порогом 2 — красный', () => {
    const ok = `begin\n  if coalesce((p_order->>'client_rev')::int, 0) < ${SALES_CLIENT_REV} then`
      + "\n    raise exception using errcode = 'P0001',\n      message = 'Вышло обновление — обновите страницу, правка не сохранена';";
    expect(codeAfterBegin(ok)).toMatch(CLIENT_REV_CHECK);
    expect(codeAfterBegin(ok.replace(`< ${SALES_CLIENT_REV}`, `< ${SALES_CLIENT_REV - 1}`))).not.toMatch(CLIENT_REV_CHECK);
    expect(codeAfterBegin(ok.replace('begin\n', 'begin\n  perform 1;\n'))).not.toMatch(CLIENT_REV_CHECK);
  });
});

describe('самопроверка разборщиков', () => {
  it('rowColumnsOf видит вторую колонку стража', () => {
    expect(rowColumnsOf('if new.is_sales is distinct from old.is_sales or new.role <> old.role then')).toEqual(['is_sales', 'role']);
    expect(rowColumnsOf('-- new.role в комментарии\nif new.is_sales then')).toEqual(['is_sales']);
  });

  it('rpcMarkProblems ловит незакрытую метку sales.rpc', () => {
    expect(rpcMarkProblems(`perform set_config('sales.rpc', 'on', true); update x;`, 'sales.rpc')).toEqual(['on без off']);
    expect(rpcMarkProblems(`perform set_config('sales.rpc', 'on', true);`)).toEqual([]);
  });

  it('updatedColumns видит колонку с запятыми в выражении', () => {
    expect(updatedColumns(`update public.orders set a = coalesce(x, 'y'),\n b = 1 where id = 1`)).toEqual(['a', 'b']);
  });

  it('добавленная в сохранение колонка без строки в списке — расхождение', () => {
    const save = functionsOf(latestDefining('order_v4_save')).find((f) => f.name === 'order_v4_save');
    const mutated = (save?.body ?? '').replace('updated_at       = now()', 'updated_at       = now(),\n    status = \'done\'');
    expect(updatedColumns(mutated)).toContain('status');
    expect(guardAllowed(RIGHTS)).not.toContain('status');
  });

  it('новая колонка orders без классификации — красный', () => {
    const fake = 'alter table public.orders\n  add column if not exists fake_flag boolean;';
    const added = addedOrderColumns([...files.filter((f) => f >= V4_SINCE).map(read), fake]);
    const lists = [guardAllowed(RIGHTS), guardList(RIGHTS, 'c_db_filled'), guardList(RIGHTS, 'c_insert_empty')];
    expect(added).toContain('fake_flag');
    expect(lists.filter((l) => l.includes('fake_flag')).length).toBe(0);
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
