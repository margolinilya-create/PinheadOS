// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FLATS_BUCKET, FLAT_ID_RE, FLAT_MAX_BYTES, FLAT_MIME, FLAT_PATH_RE, FLAT_VIEW_KINDS } from './api/garmentFlats';

/**
 * СТОРОЖ БАКЕТА ФЛЭТОВ (веха 5а, миграция H `…_garment_flats.sql`).
 *
 * Флэты — неизменяемые версии: старые заказы и PDF ссылаются на «свою»
 * картинку. Ломается молча:
 *   · `public = true` — вечная ссылка мимо `catalog_reader()`;
 *   · запись без `garment_flat_path_ok(name)` — флэт по кириллическому или
 *     чужому пути, справочник указывает на объект, которого нет;
 *   · permissive UPDATE или DELETE — подмена картинки старых заказов
 *     (`upsert`, `move`), restrictive снимается молча;
 *   · константы клиента и бакета разъехались — загрузка падает у людей;
 *   · регулярка пути клиента шире серверной — сид пишет справочник
 *     на путь, который сервер не пропустит.
 * Общая проверка «каждая permissive-политика storage.objects ограничена
 * бакетом» — в `orderArtworksBucket.test.ts` (обходит все миграции).
 */
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
const noComments = (sql: string) => sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const hFile = files.filter((f) => f.endsWith('_garment_flats.sql')).at(-1);
if (!hFile) throw new Error('нет миграции *_garment_flats.sql');
const SQL = noComments(read(hFile));

/** Тексты `create policy … on storage.objects …;` */
const storagePolicies = (sql: string) =>
  (sql.match(/create\s+policy\s+[\s\S]*?;/gi) ?? []).filter((p) => /on\s+"?storage"?\s*\.\s*"?objects"?/i.test(p));

const policy = (name: string) => {
  const p = storagePolicies(SQL).find((x) => new RegExp(`create\\s+policy\\s+"?${name}"?\\s`, 'i').test(x));
  if (!p) throw new Error(`нет политики ${name}`);
  return norm(p);
};

/** Запись по пути защищена: тело insert содержит проверку пути и писателя */
const insertGuarded = (text: string) =>
  /with check \(bucket_id = 'garment-flats' and public\.garment_flat_path_ok\(name\) and \(select public\.catalog_writer\(\)\)\)/.test(norm(text));

describe('бакет garment-flats', () => {
  const stmt = /insert into storage\.buckets[^;]*?values\s*\(\s*'garment-flats'[^;]*;/i.exec(SQL)?.[0] ?? '';

  it('заведён: приватный, лимит и тип = константы клиента', () => {
    expect(FLATS_BUCKET).toBe('garment-flats');
    expect(norm(stmt)).toContain(`values ('garment-flats', 'garment-flats', false, ${FLAT_MAX_BYTES}, array['${FLAT_MIME}'])`);
  });

  it('повторное применение тоже делает бакет приватным', () => {
    const upd = /on conflict \(id\) do update\s+set([^;]*)/i.exec(stmt)?.[1] ?? '';
    expect(upd).toMatch(/\bpublic\s*=\s*false\b/);
    expect(upd).toMatch(/file_size_limit\s*=\s*excluded\.file_size_limit/);
    expect(upd).toMatch(/allowed_mime_types\s*=\s*excluded\.allowed_mime_types/);
  });
});

describe('garment_flat_path_ok = isFlatPath клиента', () => {
  const fn = /create or replace function public\.garment_flat_path_ok\(p_name text\)([\s\S]*?)\$\$([\s\S]*?)\$\$;/i.exec(SQL);

  it('immutable, invoker, search_path, без таблиц', () => {
    expect(fn, 'нет функции').not.toBeNull();
    const [, head, body] = fn!;
    expect(head).toMatch(/\bimmutable\b/);
    expect(head).toMatch(/security invoker/);
    expect(head).toMatch(/set search_path = public/);
    expect(body).not.toMatch(/\bfrom\b/i);
    expect(body).toMatch(/coalesce\(p_name ~ '[^']+', false\)/);
  });

  it('регулярка сервера = FLAT_PATH_RE клиента, виды = FLAT_VIEW_KINDS', () => {
    const server = /p_name ~ '([^']+)'/.exec(fn![2])?.[1] ?? '';
    expect(server).toBe(FLAT_PATH_RE.source.replace(/\\\//g, '/'));
    expect(server).toContain(`(${FLAT_VIEW_KINDS.join('|')})`);
    expect(FLAT_PATH_RE.flags).toBe('');
  });

  it('revoke from public, anon; grant authenticated', () => {
    expect(SQL).toMatch(/revoke execute on function public\.garment_flat_path_ok\(text\) from public, anon;/);
    expect(SQL).toMatch(/grant execute on function public\.garment_flat_path_ok\(text\) to authenticated;/);
  });
});

describe('политики storage.objects для garment-flats', () => {
  it('ровно три: select, insert и restrictive update; все пересоздаются явно', () => {
    const names = storagePolicies(SQL).map((p) => /create\s+policy\s+"?([\w-]+)"?/i.exec(p)?.[1]).sort();
    expect(names).toEqual(['garment_flats_insert', 'garment_flats_no_update', 'garment_flats_select']);
    for (const n of names) expect(SQL).toMatch(new RegExp(`drop policy if exists "${n}" on storage\\.objects;`));
    // прежние имена тоже снимаются: политика DELETE в 5а не заводится (L1)
    expect(SQL).toMatch(/drop policy if exists "garment_flats_delete" on storage\.objects;/);
    expect(SQL).toMatch(/drop policy if exists "garment_flats_update" on storage\.objects;/);
  });

  it('select — только читатель справочников', () => {
    expect(policy('garment_flats_select')).toBe(
      "create policy garment_flats_select on storage.objects for select to authenticated using (bucket_id = 'garment-flats' and (select public.catalog_reader()));");
  });

  it('insert — путь и писатель (admin, director)', () => {
    const p = policy('garment_flats_insert');
    expect(p).toMatch(/^create policy garment_flats_insert on storage\.objects for insert to authenticated with check /);
    expect(insertGuarded(p)).toBe(true);
    expect(p).not.toMatch(/using/);
  });

  it('самопроверка: insert без проверки пути — красный', () => {
    const mutated = policy('garment_flats_insert').replace(' and public.garment_flat_path_ok(name)', '');
    expect(insertGuarded(mutated)).toBe(false);
  });

  it('UPDATE запрещён restrictive: using и with check ровно bucket_id <> бакет', () => {
    expect(policy('garment_flats_no_update')).toBe(
      "create policy garment_flats_no_update on storage.objects as restrictive for update to authenticated using (bucket_id <> 'garment-flats') with check (bucket_id <> 'garment-flats');");
  });

  it('ни одна другая политика ни в одной миграции не упоминает garment-flats; DELETE нет нигде', () => {
    for (const f of files) {
      for (const p of storagePolicies(noComments(read(f)))) {
        if (!/garment-flats/.test(p)) continue;
        expect(f, p).toBe(hFile);
        expect(p, `${f}: DELETE по garment-flats`).not.toMatch(/for\s+(delete|all)\b/i);
      }
    }
  });

  it('миграции после H не снимают политики garment_flats_*', () => {
    for (const f of files.filter((x) => x > hFile)) {
      expect(noComments(read(f)), f).not.toMatch(/drop\s+policy\s+(?:if\s+exists\s+)?"?garment_flats_\w*"?\s+on\s+"?storage"?/i);
    }
  });
});

describe('CHECK формы нанесения и флэта позиции', () => {
  it('layout: null или объект версии 1 не больше 8 КБ', () => {
    expect(norm(SQL)).toContain(
      "add constraint order_item_prints_layout_check check (layout is null or (jsonb_typeof(layout) = 'object' and layout->>'v' = '1' and octet_length(layout::text) <= 8192));");
  });

  it('flat_id: пусто или id флэта — та же регулярка, что FLAT_ID_RE', () => {
    expect(norm(SQL)).toContain(
      `add constraint order_items_flat_id_check check (flat_id = '' or flat_id ~ '${FLAT_ID_RE.source}');`);
  });

  it('ERP не трогает, перегрузка sales_set_staff(uuid, boolean) снята, схема перечитывается', () => {
    expect(SQL).not.toMatch(/\berp_/);
    expect(SQL).toMatch(/drop function if exists public\.sales_set_staff\(uuid, boolean\);/);
    expect(SQL).toMatch(/notify pgrst, 'reload schema';\s*$/);
  });
});
