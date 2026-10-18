// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_PUT_KEYS, SALES_CATALOG_KEYS } from '../api/catalogAdmin';
import { GARMENT_TYPES } from '../design/types';
import { FLATS_CASES } from '../design/catalog/flatsCases';
import { TZ_ROW_CODES, ZONE_ID_RE } from './tzRows';

/**
 * Сторож ключей справочников (веха 4, миграция G).
 *
 * Загрузчик (`lib/catalogs.loadAllCatalogs`) СКЛАДЫВАЕТ строки `catalog_config`
 * и `app_config` в один объект по ключу: ключ, заведённый в обеих таблицах,
 * молча перекрывается вторым. Поэтому справочник обязан жить ровно в одной
 * таблице — и новый ключ не должен совпасть со старым ключом соседней таблицы.
 * Единственное известное исключение — `prices` (старый `catalog_config.prices`
 * читает только руководство, `app_config.prices` перекрывает его в загрузчике,
 * и в белый список записи не входит ни тот, ни другой).
 *
 * Белый список `catalog_put` в миграции = `CATALOG_PUT_KEYS` клиента:
 * клиент, пишущий ключ, которого сервер не примет, — ошибка, видимая только на бою.
 */
const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const ALL = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
const G_FILE = ALL.find((f) => f.endsWith('_order_catalogs.sql')) ?? 'нет';
/**
 * Белый список читается из ПОСЛЕДНЕЙ миграции, пересоздающей `catalog_put`
 * (с вехи 5а — H `…_garment_flats`): именно её текст исполняет база
 */
const PUT_FILE = ALL.filter((f) => /create or replace function public\.catalog_put\(/.test(read(f))).at(-1) ?? 'нет';
const G = read(PUT_FILE);

/** Ключи на бою 17.10 (SELECT key FROM …) — старые, в белый список не входят */
const LIVE_KEYS = {
  catalog_config: ['extras', 'fabrics', 'labels', 'prices', 'trimCatalog', 'fabricsCatalog'],
  app_config: ['sku_catalog', 'feature_flags', 'extrasCatalog', 'hardwareCatalog', 'categoryRules', 'prices', 'zonesCatalog'],
};
/** Имена, которые загрузчик выводит сам (`sku_catalog`/`sku` → `skuCatalog`) */
const LOADER_NAMES = ['skuCatalog', 'sku'];

type Pairs = Record<'catalog_config' | 'app_config', string[]>;

/** Пары из выражения `v_<имя> := (p_table = '…' and p_key …) or (…);` функции catalog_put */
function pairsOf(variable: string): Pairs {
  const m = new RegExp(`${variable} := ([\\s\\S]*?);`).exec(G);
  if (!m) throw new Error(`нет ${variable} в ${PUT_FILE}`);
  const out: Pairs = { catalog_config: [], app_config: [] };
  const re = /p_table = '(\w+)'\s+and p_key (?:= '(\w+)'|in \(([^)]+)\))/g;
  for (const g of m[1].matchAll(re)) {
    const table = g[1] as keyof Pairs;
    const keys = g[2] ? [g[2]] : g[3].split(',').map((k) => k.trim().replace(/'/g, ''));
    out[table].push(...keys);
  }
  return out;
}

const sorted = (p: Pairs) => ({ catalog_config: [...p.catalog_config].sort(), app_config: [...p.app_config].sort() });

describe('ключи справочников', () => {
  it('ключ белого списка живёт ровно в одной таблице', () => {
    const both = CATALOG_PUT_KEYS.catalog_config.filter((k) => (CATALOG_PUT_KEYS.app_config as readonly string[]).includes(k));
    expect(both).toEqual([]);
  });

  it('новые ключи не совпадают со старыми ключами соседней таблицы и именами загрузчика', () => {
    const all = [...CATALOG_PUT_KEYS.catalog_config, ...CATALOG_PUT_KEYS.app_config];
    for (const k of CATALOG_PUT_KEYS.catalog_config) expect(LIVE_KEYS.app_config, k).not.toContain(k);
    for (const k of CATALOG_PUT_KEYS.app_config) expect(LIVE_KEYS.catalog_config, k).not.toContain(k);
    for (const k of all) expect(LOADER_NAMES, k).not.toContain(k);
  });

  it('старые ключи (prices, feature_flags, labels, extras, fabrics) в белый список записи не входят', () => {
    const all: string[] = [...CATALOG_PUT_KEYS.catalog_config, ...CATALOG_PUT_KEYS.app_config];
    for (const k of ['prices', 'feature_flags', 'labels', 'extras', 'fabrics']) expect(all, k).not.toContain(k);
  });

  it('белый список catalog_put в миграции = клиент', () => {
    const sales = pairsOf('v_sales_pair');
    const admin = pairsOf('v_admin_pair');
    expect(sorted(sales)).toEqual(sorted({
      catalog_config: [...SALES_CATALOG_KEYS.catalog_config], app_config: [...SALES_CATALOG_KEYS.app_config],
    }));
    expect(sorted({
      catalog_config: [...sales.catalog_config, ...admin.catalog_config],
      app_config: [...sales.app_config, ...admin.app_config],
    })).toEqual(sorted({
      catalog_config: [...CATALOG_PUT_KEYS.catalog_config], app_config: [...CATALOG_PUT_KEYS.app_config],
    }));
  });

  it('разбор белого списка не пуст (сторож ловит переименование)', () => {
    expect(pairsOf('v_sales_pair').catalog_config).toEqual(['suppliers']);
    expect(pairsOf('v_admin_pair').app_config.length).toBe(6);
  });
});

/** Тело функции `public.<fn>(` между `as $$` и `$$;` */
function bodyOf(sql: string, fn: string): string {
  const m = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql);
  if (!m) throw new Error(`нет ${fn}`);
  return m[1];
}

/**
 * Миграция H пересоздаёт `catalog_put` и `catalog_value_check` «подлинным
 * текстом G» (на бою 17.10 md5 `prosrc` совпал с файлом G). Правка вне
 * названных мест — молчаливый откат чужой правки или новая дыра.
 */
describe('миграция H: тела функций справочников = G плюс названные правки', () => {
  const H_FILE = ALL.find((f) => f.endsWith('_garment_flats.sql')) ?? 'нет';
  const G0 = read(G_FILE);
  const H = read(H_FILE);
  const BRANCH = / {2}-- Флэты изделий \(миграция H, веха 5а\)[\s\S]*? {2}-- Конец ветки garmentFlats \(миграция H\)\n\n/;

  it('H — последняя редакция catalog_put', () => {
    expect(PUT_FILE).toBe(H_FILE);
  });

  it('catalog_put: тело H = тело G, кроме garmentFlats в v_admin_pair', () => {
    const h = bodyOf(H, 'catalog_put');
    expect(h).not.toBe(bodyOf(G0, 'catalog_put'));
    expect(h.replace(", 'zonesCatalog', 'garmentFlats')", ", 'zonesCatalog')")).toBe(bodyOf(G0, 'catalog_put'));
  });

  it('catalog_value_check: тело H = тело G плюс ветка garmentFlats', () => {
    const h = bodyOf(H, 'catalog_value_check');
    expect(h).toMatch(BRANCH);
    expect(h.replace(BRANCH, '')).toBe(bodyOf(G0, 'catalog_value_check'));
  });

  it('ветка garmentFlats: svg_path выводится из id, версии и вида; методы = CHECK нанесения', () => {
    const branch = BRANCH.exec(bodyOf(H, 'catalog_value_check'))?.[0] ?? '';
    expect(branch).toContain("(v->>'svg_path') <> 'flats/' || (f->>'id') || '/v' || (f->>'version') || '/' || (v->>'kind') || '.svg'");
    expect(branch).toContain("(f->>'id') !~ '^[a-z0-9][a-z0-9-]{0,62}$'");
    expect(branch).toContain("(f->>'version') !~ '^[1-9][0-9]{0,3}$'");
    const methods = /check \(method in \(([^)]*)\)\)/.exec(read(ALL.find((f) => f.endsWith('_order_v4_tz_fields.sql')) ?? ''))?.[1] ?? '';
    const codes = [...methods.matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(codes).toHaveLength(8);
    for (const list of branch.match(/not in \('silkscreen'[^)]*\)/g) ?? []) {
      expect([...list.matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual(codes);
    }
    expect((branch.match(/not in \('silkscreen'[^)]*\)/g) ?? []).length).toBe(2);
  });

  it('garmentFlats — только admin и director (не в SALES_CATALOG_KEYS)', () => {
    expect(CATALOG_PUT_KEYS.app_config).toContain('garmentFlats');
    expect(SALES_CATALOG_KEYS.app_config as readonly string[]).not.toContain('garmentFlats');
    expect(pairsOf('v_admin_pair').app_config).toContain('garmentFlats');
  });
});

/**
 * Миграция I (веха 5б, «Флэты и зоны»): `catalog_value_check` — подлинный текст H
 * с тремя названными правками (ветка флэтов заменена, ветка зон добавлена,
 * `zonesCatalog` убран из общего списка) и триггер-страж ключей. Перечни SQL
 * обязаны совпадать с клиентом, случаи справочника флэтов — с пробами сервера.
 */
describe('миграция I: форма флэтов и зон, страж app_config', () => {
  const H_FILE = ALL.find((f) => f.endsWith('_garment_flats.sql')) ?? 'нет';
  const I_FILE = ALL.find((f) => f.endsWith('_flats_admin.sql')) ?? 'нет';
  const H = read(H_FILE);
  const I = read(I_FILE);
  const CHECK_FILE = ALL.filter((f) => /create or replace function public\.catalog_value_check\(/.test(read(f))).at(-1);
  const BRANCH_H = / {2}-- Флэты изделий \(миграция H, веха 5а\)[\s\S]*? {2}-- Конец ветки garmentFlats \(миграция H\)\n\n/;
  const BRANCH_I = / {2}-- Флэты изделий \(миграция I, веха 5б\)[\s\S]*? {2}-- Конец ветки garmentFlats \(миграция I\)\n\n/;
  const ZONES_I = / {2}-- Зоны нанесения \(миграция I, веха 5б\)[\s\S]*? {2}-- Конец ветки zonesCatalog \(миграция I\)\n\n/;
  const bodyI = bodyOf(I, 'catalog_value_check');
  const flatsBranch = BRANCH_I.exec(bodyI)?.[0] ?? '';
  const zonesBranch = ZONES_I.exec(bodyI)?.[0] ?? '';
  /** Исполняемый текст миграции: строки-комментарии убраны */
  const code = I.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  /** Коды из списков `not in ('a', 'b', …)`, начинающихся с `first` */
  const listsFrom = (text: string, first: string) =>
    [...text.matchAll(new RegExp(`not in \\(('${first}'[^)]*)\\)`, 'g'))].map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));

  it('I сортируется после H и после всех миграций 5а — последняя по имени', () => {
    expect(I_FILE).not.toBe('нет');
    expect(I_FILE > H_FILE).toBe(true);
    // после I — только миграции следующих вех (J вехи 6+7 — 20261018120000 и дальше)
    expect(ALL.filter((f) => f > I_FILE).every((f) => f >= '20261018120000')).toBe(true);
  });

  it('I — последняя редакция catalog_value_check, H остаётся последней редакцией catalog_put', () => {
    expect(CHECK_FILE).toBe(I_FILE);
    expect(PUT_FILE).toBe(H_FILE);
  });

  it('тело I = тело H, кроме ветки флэтов, ветки зон и общего списка', () => {
    expect(flatsBranch).not.toBe('');
    expect(zonesBranch).not.toBe('');
    const branchH = BRANCH_H.exec(bodyOf(H, 'catalog_value_check'))?.[0] ?? '';
    expect(branchH).not.toBe('');
    // zonesCatalog ушёл из общего списка «справочник — список» (иначе ветка зон — мёртвый код)
    expect(bodyI).toContain("'hardwareCatalog', 'categoryRules')) then");
    expect(bodyI.indexOf(zonesBranch)).toBeLessThan(bodyI.indexOf('-- Каталог моделей и общий прайс-каталог'));
    const back = bodyI
      .replace(flatsBranch, () => branchH)
      .replace(zonesBranch, '')
      .replace("'hardwareCatalog', 'categoryRules')) then", "'hardwareCatalog', 'categoryRules', 'zonesCatalog')) then");
    expect(back).toBe(bodyOf(H, 'catalog_value_check'));
  });

  it('ветка флэтов: svg_path текущих и исторических видов — по версии владельца вида', () => {
    expect(flatsBranch).toContain("(w.v->>'svg_path') <> 'flats/' || w.fid || '/v' || w.ver || '/' || (w.v->>'kind') || '.svg'");
    expect(flatsBranch).toMatch(/union all\s+select f->>'id', h->>'version'/);
    expect(flatsBranch).toContain("(f->>'id') !~ '^[a-z0-9][a-z0-9-]{0,62}$'");
    expect(flatsBranch).toContain("(f->>'version') !~ '^[1-9][0-9]{0,3}$'");
  });

  it('перечни SQL = клиент: строки ТЗ, типы изделий, техники', () => {
    // строки ТЗ — списки, где за 'front' идёт 'front_l' (перечень видов тоже начинается с 'front')
    const tz = [...listsFrom(flatsBranch, "front', 'front_l"), ...listsFrom(zonesBranch, "front', 'front_l")];
    expect(tz).toHaveLength(2);
    for (const list of tz) expect(list).toEqual([...TZ_ROW_CODES]);
    const types = listsFrom(flatsBranch, 'tshirt');
    expect(types).toHaveLength(1);
    expect(types[0]).toEqual([...GARMENT_TYPES]);
    const methods = /check \(method in \(([^)]*)\)\)/.exec(read(ALL.find((f) => f.endsWith('_order_v4_tz_fields.sql')) ?? ''))?.[1] ?? '';
    const codes = [...methods.matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(codes).toHaveLength(8);
    const lists = listsFrom(flatsBranch, 'silkscreen');
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toEqual(codes);
  });

  it('id зоны: регулярка в ветке зон и у zone_id флэта = ZONE_ID_RE', () => {
    const src = ZONE_ID_RE.source;
    const zoneId = /\(a->>'zone_id'\) !~ '([^']*)'/.exec(flatsBranch)?.[1];
    const catalogId = /\(z->>'id'\) !~ '([^']*)'/.exec(zonesBranch)?.[1];
    expect(zoneId).toBe(src);
    expect(catalogId).toBe(src);
  });

  it('в I нет политик, catalog_put и erp_*; из триггеров — ровно страж; конец — notify pgrst', () => {
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/catalog_put/);
    expect(code).not.toMatch(/erp_/);
    expect([...code.matchAll(/create trigger (\w+)/gi)].map((m) => m[1])).toEqual(['app_config_order_catalog_guard']);
    expect(code.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('страж: before insert/update/delete, security definer, закрыт от клиентов, DELETE — только служебно', () => {
    const guard = bodyOf(code, 'app_config_order_catalog_guard');
    expect(code).toMatch(/before insert or update or delete on public\.app_config\s+for each row execute function public\.app_config_order_catalog_guard\(\)/);
    expect(code).toMatch(/function public\.app_config_order_catalog_guard\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = public/);
    expect(code).toContain('revoke execute on function public.app_config_order_catalog_guard() from public, anon, authenticated;');
    expect(code).toContain('revoke execute on function public.catalog_value_check(text, text, jsonb) from public, anon, authenticated;');
    expect(guard).toContain("perform public.catalog_value_check('app_config', new.key, new.value)");
    expect(guard).toContain("v_role = 'service_role'");
    expect(guard).toContain("session_user = 'postgres' and v_role not in ('authenticated', 'anon')");
    expect(guard).not.toMatch(/current_user/);
    // запись истории сравнивается точным равенством, а не containment
    expect(guard).toContain('where ne = oe');
    expect(guard).not.toContain('@>');
  });

  it('паритет клиент-сервер: случаи FLATS_CASES = пробы fc_* (имя и ожидание, в обе стороны)', () => {
    const probes = readFileSync(join(MIGRATIONS, '../probes/flats_admin.sql'), 'utf8');
    const server = new Map([...probes.matchAll(/pg_temp\.p\('fc_(\w+)', '(OK|22023)/g)].map((m) => [m[1], m[2]]));
    const client = new Map(FLATS_CASES.map((c) => [c.name, c.ok ? 'OK' : '22023']));
    expect(server.size).toBeGreaterThan(40);
    expect(Object.fromEntries(server)).toEqual(Object.fromEntries(client));
  });
});
