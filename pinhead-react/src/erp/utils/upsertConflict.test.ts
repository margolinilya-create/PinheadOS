import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Каждый `upsert(..., { onConflict })` обязан опираться на НЕ частичный уникальный
 * индекс.
 *
 * Найдено живым прогоном против прода, не тестами. `planStage` делал
 * `upsert(row, { onConflict: 'stage_id,work_date' })`, а индекс был частичный
 * (`where stage_id is not null`). PostgREST шлёт голый `ON CONFLICT (col, col)`,
 * и целевой индекс Postgres выводит ТОЛЬКО из списка колонок: частичный индекс
 * подходит, лишь если в ON CONFLICT продублирован его предикат. PostgREST такого
 * не умеет — значит постановка задачи в план падала на 42P10 при каждом вызове,
 * а не только при повторной постановке: спецификация ON CONFLICT проверяется при
 * планировании запроса, ещё до того как выяснится, есть ли конфликт.
 *
 * Почему это не поймали ни юнит-тесты, ни e2e: тесты слайса ходят в мок стора,
 * а e2e поднимает фронт с мок-ключами. Настоящего PostgREST не видел никто.
 * Тот же урок, что с ключом Storage — инвариант чужого API проверяется только
 * вызовом этого API, а раз вызвать в CI нельзя, сторожим соответствие схемы.
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(p);
  }
  return out;
}

export interface UpsertSite {
  file: string;
  table: string;
  columns: string[];
}

/**
 * Все точки `onConflict` в исходниках. Таблица берётся из ближайшего `from('…')`
 * ВЫШЕ по файлу — цепочка supabase-js разнесена по строкам, и одной регуляркой
 * пару «таблица + колонки» не снять.
 */
function collectUpsertSites(): UpsertSite[] {
  const sites: UpsertSite[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    const froms = [...src.matchAll(/\.from\(\s*['"]([\w.]+)['"]\s*\)/g)];
    for (const m of src.matchAll(/onConflict:\s*['"]([^'"]+)['"]/g)) {
      const at = m.index ?? 0;
      const owner = [...froms].reverse().find((f) => (f.index ?? 0) < at);
      if (!owner) continue;
      sites.push({
        file: file.slice(SRC.length + 1),
        table: owner[1],
        columns: m[1].split(',').map((c) => c.trim()).filter(Boolean),
      });
    }
  }
  return sites;
}

interface UniqueIndex {
  table: string;
  columns: string[];
  partial: boolean;
}

/**
 * Итоговое состояние уникальных ограничений после ВСЕХ миграций по порядку имён.
 * Порядок важен: индекс могли пересоздать (частичный → обычный), и «где-то в
 * репозитории есть подходящая строка» — не то же самое, что «в базе он такой».
 */
function collectUniqueIndexes(): UniqueIndex[] {
  const byName = new Map<string, UniqueIndex>();
  const anon: UniqueIndex[] = [];

  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');

    for (const m of sql.matchAll(/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
      byName.delete(m[1]);
    }

    const createRe =
      /create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s+on\s+(?:public\.)?(\w+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)([^;]*);/gi;
    for (const m of sql.matchAll(createRe)) {
      byName.set(m[1], {
        table: m[2],
        columns: m[3].split(',').map((c) => c.trim().replace(/\s+(asc|desc)$/i, '')),
        partial: /\bwhere\b/i.test(m[4] ?? ''),
      });
    }

    // unique (a, b) внутри create table и add constraint … unique (a, b)
    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
    for (const t of sql.matchAll(tableRe)) {
      for (const u of t[2].matchAll(/\bunique\s*\(([^)]+)\)/gi)) {
        anon.push({
          table: t[1],
          columns: u[1].split(',').map((c) => c.trim()),
          partial: false,
        });
      }
    }
    const addRe = /alter\s+table\s+(?:public\.)?(\w+)[\s\S]*?add\s+constraint\s+\w+\s+unique\s*\(([^)]+)\)/gi;
    for (const a of sql.matchAll(addRe)) {
      anon.push({
        table: a[1],
        columns: a[2].split(',').map((c) => c.trim()),
        partial: false,
      });
    }
  }
  return [...byName.values(), ...anon];
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Первичный ключ, объявленный колонкой (`key text primary key`) или строкой таблицы */
function primaryKeyColumns(table: string): string[] | null {
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const t = new RegExp(
      `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
      'i',
    ).exec(sql);
    if (!t) continue;
    const body = t[1];
    const composite = /\bprimary\s+key\s*\(([^)]+)\)/i.exec(body);
    if (composite) return composite[1].split(',').map((c) => c.trim());
    const single = /^\s*(\w+)[^,\n]*\bprimary\s+key\b/im.exec(body);
    if (single) return [single[1]];
  }
  return null;
}

const sites = collectUpsertSites();
const indexes = collectUniqueIndexes();

describe('upsert по onConflict опирается на выводимое ограничение', () => {
  it('точки upsert вообще находятся (иначе тест сторожил бы пустоту)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(5);
    expect(sites.some((s) => s.table === 'erp_calendar_slots')).toBe(true);
  });

  it.each(sites.map((s) => [`${s.file}: ${s.table}(${s.columns.join(',')})`, s] as const))(
    '%s — ограничение есть и оно НЕ частичное',
    (_label, site) => {
      const pk = primaryKeyColumns(site.table);
      if (pk && same(pk, site.columns)) return; // первичный ключ всегда выводим

      const matching = indexes.filter(
        (i) => i.table === site.table && same(i.columns, site.columns),
      );
      expect(
        matching.length,
        `нет уникального ограничения ${site.table}(${site.columns.join(', ')}) — upsert упадёт на 42P10`,
      ).toBeGreaterThan(0);

      expect(
        matching.some((i) => !i.partial),
        `ограничение ${site.table}(${site.columns.join(', ')}) только частичное: PostgREST шлёт ON CONFLICT без предиката, Postgres такой индекс не выведет → 42P10 при каждом вызове`,
      ).toBe(true);
    },
  );
});

describe('индекс плана перестал быть частичным', () => {
  const planIdx = indexes.filter(
    (i) => i.table === 'erp_calendar_slots' && same(i.columns, ['stage_id', 'work_date']),
  );

  it('он существует ровно один и не частичный', () => {
    expect(planIdx.length).toBe(1);
    expect(planIdx[0].partial).toBe(false);
  });

  it('починка лежит отдельной миграцией, а не правкой прежней', () => {
    // Прежнюю миграцию не переписываем: она уже применена в проде, и её правка
    // разошлась бы с состоянием базы у всех, кто её накатил.
    const fix = readFileSync(join(MIGRATIONS, '20260803200000_erp_calendar_upsert_fix.sql'), 'utf8');
    expect(fix).toMatch(/drop index if exists public\.erp_calendar_stage_date_idx/i);
    // Сверяем ИСПОЛНЯЕМЫЕ строки: в пояснении миграции прежний предикат назван
    // дословно, и проверка по всему файлу поймала бы комментарий, а не код.
    const runnable = fix.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(runnable).not.toMatch(/where\s+stage_id\s+is\s+not\s+null/i);
    const original = readFileSync(join(MIGRATIONS, '20260803140000_erp_production_planning.sql'), 'utf8');
    expect(original).toMatch(/where stage_id is not null/i);
  });
});
