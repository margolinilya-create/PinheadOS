// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTWORK_BUCKET, ARTWORK_MAX_BYTES, ARTWORK_MIME_TYPES } from './api/artworks';

/**
 * СТОРОЖ ЗАКРЫТОГО БАКЕТА ФАЙЛОВ ЗАКАЗА (веха 2, миграция C
 * `…_order_artworks_bucket.sql`).
 *
 * Макеты клиента — его коммерческая тайна; утечка случается молча:
 *   · `public = true` (в том числе через `on conflict do update`) — вечная
 *     неотзываемая ссылка на каждый файл;
 *   · голое `::uuid` в политике — политики `storage.objects` вычисляются
 *     для строк всех бакетов, и ключ `att/new/…` из `erp-attachments`
 *     ронял бы чужое чтение с 22P02;
 *   · UPDATE без WITH CHECK или без проверки пути — `move` переносит файл
 *     в чужой заказ; запись без `draft` — правка после отправки;
 *   · `for all` или лишняя политика с этим бакетом — обход всех четырёх;
 *   · список типов клиента и бакета разъехались — загрузка падает у людей.
 */
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
/** SQL без строк-комментариев */
const noComments = (sql: string) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const bucketFile = files.filter((f) => f.endsWith('_order_artworks_bucket.sql')).at(-1);
if (!bucketFile) throw new Error('нет миграции *_order_artworks_bucket.sql');
const SQL = noComments(read(bucketFile));

interface Policy { name: string; cmd: string; role: string; using: string | null; check: string | null; text: string }

/**
 * ВСЕ `create policy … on storage.objects` — свободной регуляркой: без
 * требований к `for`/`to`/`as`, в любом регистре и с переносами строк.
 * Строгий разборщик ниже обязан распознать каждое найденное здесь — иначе
 * политика, написанная непривычно, прошла бы мимо проверки бакета.
 */
/** `storage.objects` в любой расстановке кавычек: `"storage"."objects"`, `storage."objects"` … */
const OBJECTS = '"?storage"?\\s*\\.\\s*"?objects"?';
/** Имя политики: идентификатор или строка в кавычках (с пробелами — `"Allow all"`) */
const NAME = '(?:"[^"]+"|[\\w-]+)';
const FREE_RE = new RegExp(`create\\s+policy\\s+${NAME}\\s+on\\s+${OBJECTS}(?![\\w"])[^;]*;`, 'gi');
const STRICT_RE = new RegExp(
  `^create\\s+policy\\s+(?:"(?<qname>[^"]+)"|(?<name>[\\w-]+))\\s+on\\s+${OBJECTS}`
  + '(?:\\s+as\\s+(?:permissive|restrictive))?'
  + '(?:\\s+for\\s+(?<cmd>all|select|insert|update|delete))?'
  + '(?:\\s+to\\s+(?<role>"?[\\w-]+"?(?:\\s*,\\s*"?[\\w-]+"?)*))?'
  + '(?=\\s|;)(?<rest>[\\s\\S]*);$',
  'i',
);

/**
 * Грубый НЕЗАВИСИМЫЙ счётчик: каждое `create policy`, в ближайших 200 знаках
 * которого (до `;`) есть storage.objects в любых кавычках. Не зависит от формы
 * имени — ловит то, мимо чего прошла бы FREE_RE.
 */
function roughCount(sql: string): number {
  const objects = new RegExp(OBJECTS, 'i');
  return [...sql.matchAll(/create\s+policy\b/gi)]
    .filter((m) => objects.test(sql.slice(m.index, m.index + 200).split(';')[0]))
    .length;
}

/** Индекс закрывающей скобки для `(` на позиции `open`; строки в кавычках пропускаются */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      i = s.indexOf("'", i + 1);
      if (i < 0) break;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error(`скобка не закрыта: ${s.slice(open, open + 60)}`);
}

/** Хвост после `to …`: `[using (…)] [with check (…)]` и ничего больше (`'` — конец строки EXECUTE); иначе null */
function clauses(rest: string): { using: string | null; check: string | null } | null {
  const out = { using: null as string | null, check: null as string | null };
  let r = rest;
  for (const [key, kw] of [['using', /^\s*using\s*\(/i], ['check', /^\s*with\s+check\s*\(/i]] as const) {
    const m = kw.exec(r);
    if (!m) continue;
    const open = m[0].length - 1;
    const close = closeParen(r, open);
    out[key] = r.slice(open + 1, close).trim();
    r = r.slice(close + 1);
  }
  return /^\s*'?\s*$/.test(r) ? out : null;
}

/** Строгий разбор одной найденной политики: имя, команда (по умолчанию all), роль (по умолчанию public), тела; не понял — null */
function parsePolicy(text: string): Policy | null {
  const m = STRICT_RE.exec(text);
  const g = m?.groups;
  const body = g ? clauses(g.rest) : null;
  if (!g || !body) return null;
  return {
    name: g.qname ?? g.name, cmd: (g.cmd ?? 'all').toLowerCase(), role: (g.role ?? 'public').replace(/"/g, ''),
    text, ...body,
  };
}

/** Найденные свободной регуляркой тексты и распознанные из них политики */
function scan(sql: string): { found: string[]; policies: Policy[] } {
  const found = [...sql.matchAll(FREE_RE)].map((m) => m[0]);
  return { found, policies: found.map(parsePolicy).filter((p): p is Policy => p !== null) };
}

/** Политики `storage.objects`: имя, команда, роль, тела USING и WITH CHECK */
const policiesOf = (sql: string): Policy[] => scan(sql).policies;

/** Части выражения на верхнем уровне скобок, разделённые словом `word` (and / or) */
function splitTop(e: string, word: 'and' | 'or'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "'") { i = e.indexOf("'", i + 1); if (i < 0) break; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && e.slice(i, i + word.length).toLowerCase() === word
      && !/\w/.test(e[i - 1] ?? ' ') && !/\w/.test(e[i + word.length] ?? ' ')) {
      parts.push(e.slice(from, i));
      from = i + word.length;
    }
  }
  parts.push(e.slice(from));
  return parts.map((x) => x.trim());
}

/** Снять скобки, охватывающие выражение целиком */
function unwrap(e: string): string {
  let x = e.trim();
  while (x.startsWith('(') && closeParen(x, 0) === x.length - 1) x = x.slice(1, -1).trim();
  return x;
}

/**
 * Литерал бакета, которым ОГРАНИЧЕНО тело политики, либо null. Ограничено —
 * значит, `bucket_id = '<литерал>'` — первый конъюнкт верхнего уровня и
 * на верхнем уровне нет `or` (`bucket_id = 'x' and a or b` = `(… and a) or b`
 * — дыра). Кавычки удвоены (`''x''`) внутри строки EXECUTE.
 */
function bucketOf(body: string): string | null {
  const e = unwrap(body);
  if (splitTop(e, 'or').length > 1) return null;
  const first = splitTop(e, 'and')[0];
  const m = /^bucket_id\s*=\s*('{1,2})([\w-]+)\1$/i.exec(unwrap(first));
  if (m) return m[2];
  return unwrap(first) !== first.trim() ? bucketOf(first) : null;
}

/**
 * Старые политики без фильтра по бакету — `"<файл>:<политика>": "причина"`.
 * Пусто: на 17.10 все 18 политик миграций начинаются с `bucket_id = '…'`.
 * Новое исключение — только с причиной и решением владельца.
 */
const BUCKET_EXCEPTIONS: Record<string, string> = {};

const POLICIES = policiesOf(SQL);
const byName = (n: string) => {
  const p = POLICIES.find((x) => x.name === n);
  if (!p) throw new Error(`нет политики ${n}`);
  return p;
};
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('бакет order-artworks', () => {
  const stmt = /insert into storage\.buckets[^;]*?values\s*\(\s*'order-artworks'[^;]*;/i.exec(SQL)?.[0] ?? '';

  it('заведён миграцией: приватный, лимит = ARTWORK_MAX_BYTES', () => {
    expect(stmt, 'нет insert into storage.buckets для order-artworks').not.toBe('');
    expect(ARTWORK_BUCKET).toBe('order-artworks');
    expect(stmt).toMatch(new RegExp(`'order-artworks',\\s*'order-artworks',\\s*false,\\s*${ARTWORK_MAX_BYTES}\\b`));
    expect(ARTWORK_MAX_BYTES).toBe(26214400);
  });

  it('повторное применение тоже делает бакет приватным и обновляет лимиты', () => {
    const upd = /on conflict \(id\) do update\s+set([^;]*)/i.exec(stmt)?.[1] ?? '';
    expect(upd).toMatch(/\bpublic\s*=\s*false\b/);
    expect(upd).toMatch(/file_size_limit\s*=\s*excluded\.file_size_limit/);
    expect(upd).toMatch(/allowed_mime_types\s*=\s*excluded\.allowed_mime_types/);
  });

  it('типы бакета = ARTWORK_MIME_TYPES клиента, без octet-stream и масок', () => {
    const arr = /array\[([^\]]*)\]/i.exec(stmt)?.[1] ?? '';
    const types = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...types].sort()).toEqual([...ARTWORK_MIME_TYPES].sort());
    expect(types.join(',')).not.toMatch(/octet-stream|\*/);
  });
});

describe('хелпер order_artwork_order_id', () => {
  const fn = /create or replace function public\.order_artwork_order_id\(p_name text\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/i.exec(SQL);

  it('immutable, invoker, search_path, без таблиц', () => {
    expect(fn, 'нет функции').not.toBeNull();
    const [, head, body] = fn!;
    expect(head).toMatch(/\bimmutable\b/i);
    expect(head).not.toMatch(/security definer/i);
    expect(head).toMatch(/set search_path = public/i);
    expect(body).not.toMatch(/\bfrom\b/i);
    expect(body).toMatch(/\^orders\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\//);
    // приведение — только внутри ветки CASE после регулярки
    expect(body).toMatch(/case\s+when\s+p_name\s*~[\s\S]*then\s+split_part\(p_name, '\/', 2\)::uuid/i);
  });

  it('revoke from public, anon; grant authenticated', () => {
    expect(SQL).toMatch(/revoke execute on function public\.order_artwork_order_id\(text\) from public, anon;/);
    expect(SQL).toMatch(/grant execute on function public\.order_artwork_order_id\(text\) to authenticated;/);
  });
});

describe('политики storage.objects во ВСЕХ миграциях — с фильтром по бакету', () => {
  const ALL = files.map((f) => {
    const sql = noComments(read(f));
    const { found, policies } = scan(sql);
    return { f, found, policies, rough: roughCount(sql) };
  });

  it('разборщик: политика без for/to/as распознаётся (cmd all, роль public)', () => {
    const [p] = policiesOf(`CREATE POLICY y ON storage.objects\n  USING (bucket_id = 'z');`);
    expect(p).toMatchObject({ name: 'y', cmd: 'all', role: 'public', using: "bucket_id = 'z'", check: null });
    const [q] = policiesOf(`create policy "q-1" on storage.objects as restrictive for insert to anon, "authenticated" with check (true);`);
    expect(q).toMatchObject({ name: 'q-1', cmd: 'insert', role: 'anon, authenticated', using: null, check: 'true' });
    const [quoted] = policiesOf(`create policy "Allow all" on "storage"."objects" for select to authenticated using (bucket_id = 'a');`);
    expect(quoted).toMatchObject({ name: 'Allow all', cmd: 'select', using: "bucket_id = 'a'" });
    expect(roughCount(`create policy "Allow all" on "storage"."objects" using (true);`)).toBe(1);
    expect(roughCount(`create policy a on public.x using (true);\ncreate policy b on public.y using (true);`)).toBe(0);
    const junk = scan('create policy z on storage.objects for select using (true) garbage;');
    expect(junk.found).toHaveLength(1);
    expect(junk.policies).toEqual([]);
  });

  it('bucketOf: литерал только для тела, ограниченного бакетом', () => {
    expect(bucketOf("bucket_id = 'a' and x")).toBe('a');
    expect(bucketOf("( (bucket_id='a') and x )")).toBe('a');
    expect(bucketOf("(bucket_id = 'a' and x) and y")).toBe('a');
    expect(bucketOf("bucket_id = ''sku-photos''")).toBe('sku-photos');
    expect(bucketOf("bucket_id = 'a' and (x or y)")).toBe('a');
    expect(bucketOf('true')).toBeNull();
    expect(bucketOf("x and bucket_id = 'a'")).toBeNull();
    expect(bucketOf("bucket_id = 'a' or true")).toBeNull();
    expect(bucketOf("bucket_id = 'a' and x or y")).toBeNull();
    expect(bucketOf("((bucket_id = 'a') and x) or y")).toBeNull();
    expect(bucketOf("(bucket_id = 'a' or x) and y")).toBeNull();
    expect(bucketOf("bucket_id = 'a' || 'b'")).toBeNull();
    expect(bucketOf("bucket_id <> 'a'")).toBeNull();
  });

  it('строгий разборщик распознал ровно столько политик, сколько нашла свободная регулярка', () => {
    const lost = ALL.flatMap(({ f, found }) => found.filter((t) => !parsePolicy(t)).map((t) => `${f}: ${t}`));
    expect(lost, 'политика есть, а разборщик её не понял — её тела никто не проверил').toEqual([]);
    for (const { f, found, policies, rough } of ALL) {
      expect(policies.length, f).toBe(found.length);
      // грубый счётчик видит столько же — FREE_RE не пропустила политику непривычной формы
      expect(found.length, `${f}: create policy … storage.objects по грубому счёту`).toBe(rough);
    }
    // политик storage.objects в миграциях на 17.10 — 18 (14 старых + 4 order-artworks): регулярка не «ослепла»
    expect(ALL.reduce((n, x) => n + x.found.length, 0)).toBeGreaterThanOrEqual(18);
  });

  it('каждое тело USING и WITH CHECK начинается с bucket_id = \'<литерал>\' (кроме перечисленных исключений)', () => {
    const bad: string[] = [];
    for (const { f, policies } of ALL) {
      for (const p of policies) {
        if (BUCKET_EXCEPTIONS[`${f}:${p.name}`]) continue;
        const bodies = [p.using, p.check].filter((b): b is string => b !== null);
        const buckets = bodies.map(bucketOf);
        if (bodies.length === 0 || buckets.some((b) => b === null) || new Set(buckets).size > 1) bad.push(`${f}: ${p.name}`);
      }
    }
    expect(bad, 'политика storage.objects без фильтра по бакету видит и пишет ЧУЖИЕ бакеты, в том числе order-artworks').toEqual([]);
  });

  it('исключения не устарели', () => {
    const all = new Set(ALL.flatMap(({ f, policies }) => policies.map((p) => `${f}:${p.name}`)));
    for (const [k, why] of Object.entries(BUCKET_EXCEPTIONS)) {
      expect(all.has(k), k).toBe(true);
      expect(why.length, k).toBeGreaterThan(10);
    }
  });

  it('политики storage.objects не правятся через alter policy (её тело мимо проверки выше)', () => {
    for (const f of files) expect(noComments(read(f)), f).not.toMatch(/alter\s+policy\s+\S+\s+on\s+storage\.objects/i);
  });
});

describe('политики storage.objects для order-artworks', () => {
  const CMDS: Record<string, string> = {
    order_artworks_select: 'select', order_artworks_insert: 'insert',
    order_artworks_update: 'update', order_artworks_delete: 'delete',
  };

  it('разборщик видит политику и её тела (самопроверка)', () => {
    const [p] = policiesOf(`create policy "x_p" on storage.objects for update to authenticated
      using (bucket_id = 'b' and (a or (b))) with check (bucket_id = 'b');`);
    expect(p).toMatchObject({ name: 'x_p', cmd: 'update', using: "bucket_id = 'b' and (a or (b))", check: "bucket_id = 'b'" });
  });

  it('ровно четыре политики, на команду, для authenticated, пересоздаются явно', () => {
    expect(POLICIES.map((p) => p.name).sort()).toEqual(Object.keys(CMDS).sort());
    for (const p of POLICIES) {
      expect(p.cmd, p.name).toBe(CMDS[p.name]);
      expect(p.role, p.name).toBe('authenticated');
      expect(SQL, p.name).toMatch(new RegExp(`drop policy if exists "?${p.name}"? on storage\\.objects;`));
    }
  });

  it('каждое тело начинается с bucket_id = \'order-artworks\'', () => {
    for (const p of POLICIES) {
      for (const body of [p.using, p.check].filter(Boolean)) {
        expect(norm(body), p.name).toMatch(/^bucket_id = 'order-artworks' and /);
      }
    }
  });

  it('нет голого ::uuid, auth.uid() и хелперы прав — только в (select …)', () => {
    for (const p of POLICIES) {
      expect(p.text, p.name).not.toMatch(/::uuid/);
      expect(p.text, p.name).not.toMatch(/foldername/);
      expect(p.text.replace(/\(select auth\.uid\(\)\)/g, ''), p.name).not.toMatch(/auth\.uid\(\)/);
      expect(p.text.replace(/\(select public\.sales_is_\w+\(\)\)/g, ''), p.name).not.toMatch(/sales_is_\w+\(\)/);
      // ключ файла в подзапросе к orders — квалифицированный: иначе колонка orders.name подменила бы его
      expect(p.text, p.name).toMatch(/o\.id = public\.order_artwork_order_id\(objects\.name\)/);
    }
  });

  it('select: только видимость заказа v4, без условий записи', () => {
    const p = byName('order_artworks_select');
    expect(p.check).toBeNull();
    expect(p.using).toMatch(/exists \(\s*select 1 from public\.orders o/);
    expect(p.using).toMatch(/o\.schema_version = 4/);
    expect(p.using).not.toMatch(/draft/);
  });

  it('insert, update, delete: путь заказа, черновик v4, автор-менеджер или руководство', () => {
    const bodies = [
      byName('order_artworks_insert').check,
      byName('order_artworks_update').using,
      byName('order_artworks_update').check,
      byName('order_artworks_delete').using,
    ];
    for (const b of bodies) {
      expect(b).toMatch(/public\.order_artwork_path_ok\(public\.order_artwork_order_id\(name\), name\)/);
      expect(b).toMatch(/o\.status = 'draft'/);
      expect(b).toMatch(/o\.schema_version = 4/);
      expect(norm(b)).toMatch(/\(\(select public\.sales_is_lead\(\)\) or \(o\.created_by = \(select auth\.uid\(\)\) and \(select public\.sales_is_seller\(\)\)\)\)/);
      expect(b).not.toMatch(/sales_is_ms/);
    }
    expect(byName('order_artworks_insert').using).toBeNull();
    expect(byName('order_artworks_delete').check).toBeNull();
  });

  it('update: и USING, и WITH CHECK, одинаковые — move не уносит файл в чужой заказ', () => {
    const p = byName('order_artworks_update');
    expect(p.using).not.toBeNull();
    expect(p.check).not.toBeNull();
    expect(norm(p.check)).toBe(norm(p.using));
    expect(norm(p.check)).toBe(norm(byName('order_artworks_insert').check));
  });

  it('ни одна другая политика ни в одной миграции не упоминает order-artworks', () => {
    const own = new Set(Object.keys(CMDS));
    for (const f of files) {
      for (const p of policiesOf(noComments(read(f)))) {
        if (!/order-artworks/.test(p.text)) continue;
        expect(own.has(p.name) && f === bucketFile, `${f}: ${p.name}`).toBe(true);
      }
      // `for all` по storage.objects нигде не заводится заново
      if (f >= bucketFile!) expect(noComments(read(f)), f).not.toMatch(/on storage\.objects\s+for all/i);
    }
  });
});
