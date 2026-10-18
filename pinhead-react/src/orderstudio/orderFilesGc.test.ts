// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLAT_HOLDERS,
  PATH_COLUMNS,
  TEXT_HOLDER_TABLES,
} from '../../scripts/lib/orderFileHolders.mjs';

/**
 * Сторож уборки файлов заказа `order-files-gc` (веха 8, задача 7, К8).
 *
 * Список носителей рукописный и отстаёт от схемы молча — тот же урок, что
 * у `storage-gc` (техпакет модели девять дней считался ничьим). Поэтому
 * колонки-носители ВЫВОДЯТСЯ из миграций: всякая `*_path`/`*_paths` у таблиц
 * `orders` и `order_*` обязана стоять в `PATH_COLUMNS`. Здесь же — копия модуля
 * у функции побайтно равна исходнику, удаление закрыто двумя условиями,
 * а еженедельный скрипт удалять не умеет.
 */

const ROOT = join(process.cwd(), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const HOLDERS_SRC = read('pinhead-react', 'scripts', 'lib', 'orderFileHolders.mjs');
const HOLDERS_COPY = read('supabase', 'functions', 'order-files-gc', 'orderFileHolders.mjs');
const EDGE_SRC = read('supabase', 'functions', 'order-files-gc', 'index.ts');
const SCRIPT_SRC = read('pinhead-react', 'scripts', 'order-files-gc.mjs');
/** Workflow без строк-комментариев: проверяются шаги, а не пояснения */
const WORKFLOW_SRC = read('.github', 'workflows', 'order-files-gc.yml').replace(/^\s*#[^\n]*$/gm, '');

const withoutSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

function migrationsSql(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => withoutSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));
}

const ORDER_TABLE = '(orders|order_\\w+)';
const PATH_COL = '(\\w+_paths?)\\s+text(\\[\\])?';

/** `table.column` всех колонок `*_path(s) text` таблиц заказа: create table и add column */
function pathColumnsFromMigrations(): Set<string> {
  const found = new Set<string>();
  for (const sql of migrationsSql()) {
    const create = new RegExp(`create table(?: if not exists)? public\\.${ORDER_TABLE}\\s*\\(([\\s\\S]*?)\\);`, 'gi');
    for (const m of sql.matchAll(create)) {
      for (const c of m[2].matchAll(new RegExp(`(?:^|[,(\\s])${PATH_COL}`, 'gi'))) found.add(`${m[1]}.${c[1]}`);
    }
    const alter = new RegExp(`alter table(?: if exists)? public\\.${ORDER_TABLE}\\b([^;]*);`, 'gi');
    for (const m of sql.matchAll(alter)) {
      for (const c of m[2].matchAll(new RegExp(`add column(?: if not exists)? ${PATH_COL}`, 'gi'))) {
        found.add(`${m[1]}.${c[1]}`);
      }
    }
  }
  return found;
}

describe('order-files-gc: носители выводятся из схемы', () => {
  const fromSql = pathColumnsFromMigrations();
  const listed = new Set(PATH_COLUMNS.map((c: { table: string; column: string }) => `${c.table}.${c.column}`));

  it('разбор миграций видит известные носители (иначе регулярка сломана)', () => {
    for (const known of ['orders.sticker_preview_path', 'order_items.tz_pdf_path',
      'order_item_prints.artwork_path', 'order_item_labels.preview_paths', 'order_notes_cards.image_path']) {
      expect(fromSql.has(known), known).toBe(true);
    }
  });

  it('каждая колонка `*_path(s)` таблиц заказа стоит в PATH_COLUMNS', () => {
    for (const col of fromSql) expect(listed.has(col), `${col} держит путь, но уборка его не читает`).toBe(true);
  });

  it('массив путей помечен `array`, строка — нет', () => {
    for (const c of PATH_COLUMNS as { column: string; array?: boolean }[]) {
      expect(Boolean(c.array), c.column).toBe(c.column.endsWith('_paths'));
    }
  });

  it('текстовый носитель покрывает каждую таблицу-носитель, шапку и журнал', () => {
    const text = new Set(TEXT_HOLDER_TABLES as string[]);
    for (const c of PATH_COLUMNS as { table: string }[]) expect(text.has(c.table), c.table).toBe(true);
    expect(text.has('orders')).toBe(true);
    expect(text.has('order_events')).toBe(true);
  });

  it('флэты: ключ `garmentFlats` и раскладка нанесения — носители, и они есть в схеме', () => {
    expect(FLAT_HOLDERS.catalogKey).toBe('garmentFlats');
    expect(FLAT_HOLDERS.layoutTable).toBe('order_item_prints');
    const all = migrationsSql().join('\n');
    expect(all).toMatch(/'garmentFlats'/);
    expect(all).toMatch(/alter table public\.order_item_prints[^;]*add column if not exists layout jsonb/);
  });
});

describe('order-files-gc: две копии модуля — один текст', () => {
  it('копия у edge-функции побайтно равна scripts/lib/orderFileHolders.mjs', () => {
    expect(HOLDERS_COPY).toBe(HOLDERS_SRC);
  });

  it('модуль без импортов: живёт одинаково в Node и Deno', () => {
    expect(HOLDERS_SRC).not.toMatch(/^\s*import\s/m);
    expect(HOLDERS_SRC).not.toMatch(/\bprocess\.env|\bDeno\.env/);
  });
});

describe('order-files-gc: ворота и режим функции', () => {
  const at = (needle: string) => EDGE_SRC.indexOf(needle);

  it('носители — из копии рядом с функцией', () => {
    expect(EDGE_SRC).toMatch(/from '\.\/orderFileHolders\.mjs'/);
  });

  it('`is_admin()` от лица вызывающего проверяется до отчёта', () => {
    expect(at("caller.rpc('is_admin')")).toBeGreaterThan(-1);
    expect(EDGE_SRC).toMatch(/isAdmin !== true\) return json\(/);
    expect(at("caller.rpc('is_admin')")).toBeLessThan(at('runReport('));
  });

  it('удаление — только через deleteAllowed(тело, секрет ORDER_FILES_GC_DELETE)', () => {
    expect(EDGE_SRC).toMatch(/deleteAllowed\(body, Deno\.env\.get\('ORDER_FILES_GC_DELETE'\)\)/);
    // Других чтений `apply` из тела нет — обойти секрет нечем
    expect(EDGE_SRC).not.toMatch(/\.apply\b/);
    // `remove` живёт в одной функции, и её зовут только после ветки отчёта
    expect(EDGE_SRC.match(/\.remove\(/g)).toHaveLength(1);
    const calls = [...EDGE_SRC.matchAll(/await removeCandidates\(/g)];
    expect(calls).toHaveLength(1);
    expect(at('if (!remove)')).toBeGreaterThan(-1);
    expect(at('if (!remove)')).toBeLessThan(calls[0].index ?? -1);
  });

  it('сбой выборки — ответ ошибкой до любой ветки удаления', () => {
    expect(at('if (!report.ok)')).toBeGreaterThan(-1);
    expect(at('if (!report.ok)')).toBeLessThan(at('if (!remove)'));
  });
});

describe('order-files-gc: еженедельный отчёт не удаляет и не печатает путей', () => {
  it('в скрипте нет кода удаления', () => {
    expect(SCRIPT_SRC).not.toMatch(/\.remove\(|deleteAllowed|--apply/);
    expect(SCRIPT_SRC).toMatch(/runReport\(db/);
  });

  it('в stdout и summary — только числа (reportNumbers), пути — только в файл --paths-out', () => {
    expect(SCRIPT_SRC).toMatch(/reportNumbers\(report\)/);
    const pathUses = [...SCRIPT_SRC.matchAll(/candidates\.map/g)];
    expect(pathUses).toHaveLength(1);
    const fileWrite = SCRIPT_SRC.indexOf('writeFileSync(pathsOut');
    expect(fileWrite).toBeGreaterThan(pathUses[0].index ?? Infinity);
  });

  it('workflow: ключ из секретов, путей нет ни в логе, ни в артефакте, секрета удаления нет', () => {
    // Репозиторий публичный: артефакт скачивает любой вошедший (урок storage-backup.yml)
    expect(WORKFLOW_SRC).toMatch(/node scripts\/order-files-gc\.mjs\s*\n/);
    expect(WORKFLOW_SRC).not.toMatch(/upload-artifact|--paths-out|paths\.json|retention-days/);
    expect(WORKFLOW_SRC).toMatch(/secrets\.SUPABASE_SERVICE_KEY/);
    expect(WORKFLOW_SRC).not.toMatch(/ORDER_FILES_GC_DELETE|--apply|cat [^\n]*paths/);
  });
});

describe('order-files-gc: живая уборка ERP не тронута', () => {
  it('storage-gc и её скрипт не знают бакетов и таблиц заказа', () => {
    for (const src of [read('supabase', 'functions', 'storage-gc', 'index.ts'), read('pinhead-react', 'scripts', 'storage-gc.mjs')]) {
      expect(src).not.toMatch(/order-artworks|garment-flats|order_item_prints|orderFileHolders/);
    }
  });
});
