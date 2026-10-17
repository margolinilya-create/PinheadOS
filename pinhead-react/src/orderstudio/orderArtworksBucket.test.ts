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

/** Политики `storage.objects`: имя, команда, роль, тела USING и WITH CHECK */
function policiesOf(sql: string): Policy[] {
  const out: Policy[] = [];
  const re = /create policy\s+"?([a-z0-9_]+)"?\s+on\s+storage\.objects\s+for\s+(\w+)\s+to\s+(\w+)([^;]*);/gi;
  for (const m of sql.matchAll(re)) {
    const rest = m[4];
    out.push({
      name: m[1], cmd: m[2].toLowerCase(), role: m[3], text: m[0],
      using: clause(rest, 'using'), check: clause(rest, 'with check'),
    });
  }
  return out;
}

/** Тело `using (…)` / `with check (…)` по балансу скобок */
function clause(rest: string, kw: string): string | null {
  const re = new RegExp(`(?:^|\\s|\\))${kw.replace(' ', '\\s+')}\\s*\\(`, 'i');
  const m = re.exec(rest);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')' && --depth === 0) return rest.slice(start, i).trim();
  }
  throw new Error(`скобка ${kw} не закрыта`);
}

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
