// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { erpDdlViolations } from './erpFrozenCheck';
import { expectedGates, gateParityViolations, GATE_NAMES, type GateModule } from './orderV4LaunchGates.testutil';

/**
 * СТОРОЖ МИГРАЦИИ J (веха 6+7, задача 1: `…_order_v4_launch.sql`).
 *
 * J пересоздаёт четыре функции прав Order v4 поверх подлинного текста B/F.
 * Каждая правка — блок `-- J:begin <метка>` … `-- J:was|<строка B/F>` … `-- J:end`.
 * Сторож держит то, что ломается молча:
 *   · J — последняя редакция функций; обратная замена блоков даёт тело B/F
 *     побайтно, а md5 тел B/F — литералы живой базы (предусловие выкатки);
 *   · в J нет DDL таблиц и политик, нет DDL по `erp_*`, нет `v_role = 'manager'`;
 *   · гранты: revoke у public/anon, хелпер подлинности закрыт и от authenticated;
 *   · генератор мутаций находит каждую правку ровно один раз, и проба, которую
 *     мутация должна покраснить, есть в файле проб;
 *   · каждый текст отказа J, который видит человек, есть в пробах;
 *   · паритет гейтов экрана (`layout/orderNav.ts`, задача 4) и серверных условий
 *     отправки (`tz/model/sendChecklist.ts`, задача 2) с J.
 */

const ROOT = join(process.cwd(), '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const PROBES = join(ROOT, 'supabase/probes');
const J_NAME = '20261018120000_order_v4_launch.sql';
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
const J = read(J_NAME);

/** Литералы живой базы (SELECT 17–18.10): md5 `prosrc` тел до J — предусловие выкатки */
const PRE_J_MD5: Record<string, string> = {
  order_v4_transition: '7b4bc1a8f82abb838c08b7161a727074',
  order_v4_launch_check: 'b070898856f442412c65fa543aab0edc',
  order_v4_set_payment: '3e8b3d32bd3a8f8e2be4f44b1bb32c7d',
  sales_set_staff: 'e63f055a14f0118e17643d570a5a1a5f',
};
const J_FUNCTIONS = Object.keys(PRE_J_MD5);
/** Сигнатура, которую пересоздаёт J (у `sales_set_staff` их было две) */
const SIGNATURE: Record<string, RegExp> = {
  order_v4_transition: /^p_id uuid, p_to text, p_reason text default null/,
  order_v4_launch_check: /^p_id uuid$/,
  order_v4_set_payment: /^\s*p_id uuid, p_kind text, p_override_reason text default null$/,
  sales_set_staff: /^p_profile uuid, p_kind text, p_on boolean$/,
};

interface FnDef { name: string; args: string; head: string; body: string }

/** Функции файла: имя, аргументы, заголовок до `as $tag$`, тело между тегами */
function functionsOf(sql: string): FnDef[] {
  const out: FnDef[] = [];
  const re = /create (?:or replace )?function public\.([a-z0-9_]+)\(([^)]*)\)/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const rest = sql.slice(m.index);
    // тег тела у старых миграций бывает свой ($fn$, $body$) — берём его
    const as = rest.match(/\bas\s+(\$[a-z_]*\$)/i);
    if (!as || as.index === undefined) continue;
    const start = as.index + as[0].length;
    const end = rest.indexOf(as[1], start);
    out.push({ name: m[1], args: m[2].trim(), head: rest.slice(0, as.index), body: rest.slice(start, end) });
  }
  return out;
}

/** Определение функции с нужной сигнатурой в файле (или undefined) */
const defIn = (sql: string, fn: string) =>
  functionsOf(sql).find((f) => f.name === fn && SIGNATURE[fn].test(f.args));

/** Строки-комментарии убраны: правила — про исполняемый текст */
const noComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** Обратная замена блоков `-- J:` → строки `-- J:was|` (тело B/F) */
function revertJ(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let tag: string | null = null;
  let was: string[] = [];
  for (const line of lines) {
    const begin = line.match(/^\s*-- J:begin (\S+)$/);
    const end = line.match(/^\s*-- J:end (\S+)$/);
    const prev = line.match(/^\s*-- J:was\|(.*)$/);
    if (begin) {
      if (tag) throw new Error(`блок ${begin[1]} внутри ${tag}`);
      tag = begin[1];
      was = [];
    } else if (end) {
      if (end[1] !== tag) throw new Error(`конец ${end[1]} без начала`);
      out.push(...was);
      tag = null;
    } else if (prev) {
      if (!tag) throw new Error('строка was вне блока');
      was.push(prev[1]);
    } else if (!tag) {
      out.push(line);
    } else if (/-- J:/.test(line)) {
      throw new Error(`неизвестная метка: ${line}`);
    }
  }
  if (tag) throw new Error(`блок ${tag} не закрыт`);
  return out.join('\n');
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Последний файл до J, определяющий функцию с сигнатурой B/F */
function preJDefinition(fn: string): FnDef {
  const hit = files.filter((f) => f < J_NAME && defIn(read(f), fn)).at(-1);
  if (!hit) throw new Error(`нет определения ${fn} до J`);
  return defIn(read(hit), fn) as FnDef;
}

describe('миграция J: тела — B/F плюс помеченные правки', () => {
  it('J — последняя миграция, определяющая все четыре функции и хелпер', () => {
    for (const fn of [...J_FUNCTIONS, 'order_v4_erp_authentic']) {
      const last = files.filter((f) => functionsOf(read(f)).some((d) => d.name === fn)).at(-1);
      expect(last, fn).toBe(J_NAME);
    }
  });

  it('md5 тел B/F (текст между $$) — литералы живой базы', () => {
    for (const fn of J_FUNCTIONS) expect(md5(preJDefinition(fn).body), fn).toBe(PRE_J_MD5[fn]);
  });

  it('обратная замена блоков J даёт тело B/F побайтно', () => {
    for (const fn of J_FUNCTIONS) {
      const j = defIn(J, fn);
      expect(j, fn).toBeTruthy();
      expect(revertJ(j?.body ?? ''), fn).toBe(preJDefinition(fn).body);
    }
  });

  it('каждая функция J несёт хотя бы одну правку, метки внутри функции не повторяются', () => {
    for (const fn of J_FUNCTIONS) {
      const tags = [...(defIn(J, fn)?.body ?? '').matchAll(/-- J:begin (\S+)/g)].map((m) => m[1]);
      expect(tags.length, fn).toBeGreaterThan(0);
      expect(new Set(tags).size, fn).toBe(tags.length);
    }
  });

  it('revertJ ловит сломанный блок (мутации сторожа)', () => {
    expect(() => revertJ('  -- J:begin a\n x\n')).toThrow(/не закрыт/);
    expect(() => revertJ('  -- J:was|x\n')).toThrow(/вне блока/);
    expect(revertJ('a\n  -- J:begin t\nnew\n  -- J:was|old\n  -- J:end t\nb')).toBe('a\nold\nb');
    // правка без блока — тело расходится с B
    const body = defIn(J, 'order_v4_set_payment')?.body ?? '';
    expect(revertJ(body.replace("'Оплату отмечают до запуска'", "'Оплату отмечают'"))).not.toBe(
      preJDefinition('order_v4_set_payment').body);
  });
});

describe('миграция J: что в ней нет и как закрыто', () => {
  const code = noComments(J);

  it('нет DDL таблиц, политик и ERP; конец — notify pgrst', () => {
    expect(code).not.toMatch(/\bcreate\s+(policy|table)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(erpDdlViolations(J)).toEqual([]);
    expect(J.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('роль manager больше не делает автором (К20)', () => {
    for (const fn of J_FUNCTIONS) expect(noComments(defIn(J, fn)?.body ?? ''), fn).not.toMatch(/v_role = 'manager'/);
    expect(noComments(defIn(J, 'order_v4_launch_check')?.body ?? '')).toMatch(
      /public\.sales_is_seller\(\) and v_row\.created_by = v_uid/);
  });

  it('прежняя сигнатура перехода снята, новая и остальные — revoke public, anon + grant authenticated', () => {
    expect(code).toMatch(/drop function public\.order_v4_transition\(uuid, text, text\);/);
    for (const sig of [
      'order_v4_transition\\(uuid, text, text, timestamptz, uuid\\)',
      'order_v4_launch_check\\(uuid\\)',
      'order_v4_set_payment\\(uuid, text, text\\)',
      'sales_set_staff\\(uuid, text, boolean\\)',
    ]) {
      expect(code, sig).toMatch(new RegExp(`revoke execute on function public\\.${sig} from public, anon;`));
      expect(code, sig).toMatch(new RegExp(`grant execute on function public\\.${sig} to authenticated;`));
    }
    expect(code).toMatch(/revoke execute on function public\.order_v4_erp_authentic\(uuid, uuid\) from public, anon, authenticated;/);
    expect(code).not.toMatch(/grant execute on function public\.order_v4_erp_authentic/);
  });

  it('все функции J — security definer с set search_path = public', () => {
    for (const f of functionsOf(J)) {
      expect(f.head, f.name).toMatch(/security definer/);
      expect(f.head, f.name).toMatch(/set search_path = public/);
    }
  });

  it('подлинность ERP: владелец объекта и непустой заказ', () => {
    const helper = noComments(functionsOf(J).find((f) => f.name === 'order_v4_erp_authentic')?.body ?? '');
    expect(helper).toMatch(/coalesce\(o\.owner_id, o\.owner::text\) = p_launch_by::text/);
    expect(helper).toMatch(/exists \(select 1 from public\.erp_order_items i where i\.order_id = p_erp\)/);
    expect(helper).toMatch(/d\.file_path like 'tz\/v4-%'/);
    // путь документа ТЗ не привязан к другому заказу ERP (старая копия того же МС — не подлинная)
    expect(helper).toMatch(/not exists \(\s*select 1 from public\.erp_tz_documents d2\s+where d2\.file_path = d\.file_path and d2\.order_id <> p_erp\)/);
  });

  it('разделение обязанностей: переход в production повторяет проверки launch_check (находка 2)', () => {
    const tr = noComments(defIn(J, 'order_v4_transition')?.body ?? '');
    const start = tr.indexOf("v_row.status = 'ready_to_launch' and p_to = 'production' then");
    const branch = tr.slice(start, tr.indexOf('elsif', start + 1));
    expect(branch).toMatch(/if v_row\.created_by = v_uid and not coalesce\(v_boss, false\) then/);
    expect(branch).toMatch(/e\.kind = 'payment' and e\.reason is not null[\s\S]*if v_override_by = v_uid then/);
    // проверки — до поиска заказа ERP и записи
    expect(branch.indexOf('v_override_by = v_uid')).toBeLessThan(branch.indexOf('from public.erp_orders e'));
  });

  it('оплата: свежая метка и созданный заказ ERP запрещают смену, смена снимает метку (находка 2)', () => {
    const sp = noComments(defIn(J, 'order_v4_set_payment')?.body ?? '');
    expect(sp).toMatch(/if v_row\.launch_started_at > now\(\) - interval '10 minutes' then/);
    expect(sp).toMatch(/where e\.tz_order_id = p_id and e\.status <> 'cancelled'/);
    expect(sp).toMatch(/launch_started_at = null, launch_by = null,\s*updated_at = now\(\)/);
    expect(sp.indexOf("interval '10 minutes'")).toBeLessThan(sp.indexOf('update public.orders'));
  });

  it('отправка: версия заказа — первой проверкой ветки draft → ready_to_launch', () => {
    const body = noComments(defIn(J, 'order_v4_transition')?.body ?? '');
    const branch = body.slice(body.indexOf("if v_row.status = 'draft' and p_to = 'ready_to_launch' then"));
    const firstIf = branch.split('\n').slice(1).find((l) => /^\s*if\b/.test(l));
    expect(firstIf).toMatch(/p_expected_updated_at is not null and v_row\.updated_at is distinct from p_expected_updated_at/);
  });
});

/** Тексты отказов J, которые видит человек: `message = '…'` и `'reason', '…'` (до « — ») */
function humanTexts(sql: string): string[] {
  const code = noComments(sql);
  const out = new Set<string>();
  for (const m of code.matchAll(/message\s*=\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of code.matchAll(/'reason',\s*'([^']+)'/g)) out.add(m[1]);
  return [...out].map((t) => t.split(' — ')[0].trimEnd()).filter((t) => !t.startsWith('PRECHECK'));
}

/** Недостижимые тексты B: видимость черновика уже требует автора или руководство */
const UNREACHABLE = ['Отправить в работу может автор заказа или руководитель'];

describe('пробы J: тексты, файлы, мутации', () => {
  const launch = readFileSync(join(PROBES, 'order_v4_launch.sql'), 'utf8');
  const rights = readFileSync(join(PROBES, 'order_v4_rights.sql'), 'utf8');
  const probeNames = new Set([...launch.matchAll(/pg_temp\.p\('([a-z0-9_]+)'/g)].map((m) => m[1]));

  it('каждый текст отказа J есть в ожиданиях проб', () => {
    const texts = humanTexts(J);
    expect(texts.length).toBeGreaterThan(30);
    const missing = texts.filter((t) => !UNREACHABLE.includes(t) && !launch.includes(t) && !rights.includes(t));
    expect(missing).toEqual([]);
    for (const t of UNREACHABLE) expect(texts, t).toContain(t);
  });

  it('пробы J называют миграцию J и разделы прав из плана', () => {
    expect(launch).toContain('20261018120000_order_v4_launch');
    for (const name of ['msw_no_label', 'ms2_after_3min', 'fake_check', 'fake_empty_check', 'ms2_return_race',
      'msa_own_check', 'rop_override_self_check', 'rop_self_ms', 'rop_rop2_ms', 'seq_unchanged', 'helper_closed',
      'oldcopy_check', 'oldcopy_prod', 'toctou_pay_fresh', 'toctou_label_cleared', 'toctou_prod', 'toctou_pay_erp',
      'race_override_prod', 'race_own_prod']) {
      expect(probeNames.has(name), name).toBe(true);
    }
  });

  it('остаточный путь подделки (объект МС у заказа ERP продавца) записан пробой и README, а не скрыт', () => {
    // Находка безопасности №1 закрыта частично: хелпер сверяет только владельца объекта.
    // Пока путь открыт, пробы фиксируют его как OK; закроют — ожидания станут отказом,
    // и README обязан перестать называть путь открытым (правка одним коммитом).
    for (const name of ['resid_seller_perm', 'resid_doc', 'resid_check', 'resid_prod', 'resid_worker_doc']) {
      expect(probeNames.has(name), name).toBe(true);
    }
    const readme = readFileSync(join(PROBES, 'README.md'), 'utf8');
    const open = /select pg_temp\.p\('resid_prod', 'OK /.test(launch);
    expect(readme.includes('Остаточный путь подделки'), 'README: раздел об остаточном пути').toBe(open);
    expect(launch).toContain('ОСТАТОЧНЫЙ ПУТЬ ПОДДЕЛКИ');
  });

  it('генератор мутаций: каждая правка находится ровно один раз, «убиваемая» проба есть', async () => {
    const url = pathToFileURL(join(PROBES, 'mutations/make-mutations.mjs')).href;
    const mod = (await import(/* @vite-ignore */ url)) as {
      MUTATIONS: { name: string; fn: string; kills: string; equivalent?: boolean }[];
      PRE_J_MD5: Record<string, string>;
      mutate: (sql: string, m: unknown) => string;
    };
    expect(mod.MUTATIONS.length).toBeGreaterThanOrEqual(16);
    for (const mu of mod.MUTATIONS) {
      const mutated = mod.mutate(J, mu);
      expect(mutated, mu.name).not.toBe(J);
      if (mu.equivalent) continue;
      const killed = [...mu.kills.matchAll(/[a-z0-9_]{4,}/g)].map((m) => m[0]).filter((n) => probeNames.has(n));
      expect(killed.length, `${mu.name}: ${mu.kills}`).toBeGreaterThan(0);
    }
    // литералы предусловия генератора = литералы сторожа
    for (const [sig, value] of Object.entries(mod.PRE_J_MD5)) {
      expect(PRE_J_MD5[sig.split('(')[0]], sig).toBe(value);
    }
  });
});

/**
 * ПАРИТЕТ С КЛИЕНТОМ. Гейты экрана пишет задача 4 (`layout/orderNav.ts`), серверные
 * условия отправки — задача 2 (`tz/model/sendChecklist.ts`, `SERVER_SEND_RULES`).
 * До слияния волны 1 (T4 → T2 → T1) этих экспортов нет, и эти тесты красные —
 * так задумано планом: сторож зеленеет на перебазированной ветке.
 */
describe('паритет гейтов экрана с J', () => {
  it('SQL J: гейты перехода, запуска и оплаты — как в таблице ожиданий', () => {
    const tr = noComments(defIn(J, 'order_v4_transition')?.body ?? '');
    const branch = (from: string, to: string) => {
      const start = tr.indexOf(`v_row.status = '${from}' and p_to = '${to}' then`);
      return tr.slice(start, tr.indexOf('elsif', start + 1));
    };
    expect(branch('draft', 'ready_to_launch')).toMatch(/if not \(coalesce\(v_author, false\) or coalesce\(v_lead, false\)\)/);
    for (const [from, to] of [['ready_to_launch', 'draft'], ['ready_to_launch', 'production'], ['production', 'done']]) {
      expect(branch(from, to), `${from}→${to}`).toMatch(/if not \(v_ms or coalesce\(v_boss, false\)\) then/);
    }
    const lc = noComments(defIn(J, 'order_v4_launch_check')?.body ?? '');
    expect(lc).toMatch(/if not \(v_ms or coalesce\(v_boss, false\)\) then/);
    const sp = noComments(defIn(J, 'order_v4_set_payment')?.body ?? '');
    expect(sp).toMatch(/if not \(v_ms and v_row\.status = 'ready_to_launch'\) then/);
    expect(sp).toMatch(/if p_kind is null or v_reason is not null then/);
    expect(sp).toMatch(/if v_row\.created_by is not distinct from v_uid then/);
    expect(sp).toMatch(/if v_row\.status not in \('draft', 'ready_to_launch'\) then/);
    expect(sp).toMatch(/v_lead := coalesce\(v_role in \('admin', 'director', 'rop'\), false\);/);
  });

  it('эталонные гейты проходят, мутация «МС отмечает оплату в черновике» ловится', () => {
    expect(gateParityViolations(expectedGates)).toEqual([]);
    const mutated: GateModule = {
      ...expectedGates,
      canSetPayment: (p, o) => expectedGates.canSetPayment(p, o) || (o.status === 'draft' && p.is_ms === true),
    };
    expect(gateParityViolations(mutated).length).toBeGreaterThan(0);
    const ropReturns: GateModule = {
      ...expectedGates,
      canReturn: (p, o) => expectedGates.canReturn(p, o) || (o.status === 'ready_to_launch' && p.role === 'rop'),
    };
    expect(gateParityViolations(ropReturns).length).toBeGreaterThan(0);
  });

  it('layout/orderNav.ts (задача 4) — гейты равны J', async () => {
    const nav = (await import('./layout/orderNav')) as unknown as Partial<GateModule>;
    const missing = GATE_NAMES.filter((n) => typeof nav[n] !== 'function');
    expect(missing, 'гейты задачи 4 ещё не слиты').toEqual([]);
    expect(gateParityViolations(nav as GateModule)).toEqual([]);
  });

  it('tz/model/sendChecklist.ts (задача 2) — SERVER_SEND_RULES = условия отправки J', () => {
    const file = join(process.cwd(), 'src/orderstudio/tz/model/sendChecklist.ts');
    expect(existsSync(file), 'sendChecklist задачи 2 ещё не слит').toBe(true);
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const decl = text.match(/SERVER_SEND_RULES\s*=\s*\[([^\]]*)\]/);
    const rules = [...(decl?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const tr = noComments(defIn(J, 'order_v4_transition')?.body ?? '');
    const server: string[] = [];
    if (/i\.tz_pdf_path/.test(tr)) server.push('tz_pdf_path');
    if (/p\.method <> 'other'[\s\S]*p\.artwork_path/.test(tr)) server.push('artwork_path_except_other');
    expect(rules).toEqual(server.sort());
  });
});
