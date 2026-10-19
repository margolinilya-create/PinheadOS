// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { functionBody, migration, migrationFiles, withoutComments } from './migrations.testutil';

/**
 * ОТКАТ ПРАВОК 19.10, ПЛАН B (`supabase/rollout/r1910b/`, Task 10).
 *
 * Откат T2 (`20261020100000_erp_biz_tasks_rpc`) — НЕ дословно прежние тела
 * (так решено в Task 3: чат записан заново без ветки задач), поэтому сторож
 * сверяет СОСТАВ, а не тела: каждая функция, которую миграция создаёт
 * впервые, откатом снимается `drop function if exists` с той же подписью;
 * каждая функция, которая жила до миграции, откатом возвращается и не несёт
 * ветки задач. Новая функция в миграции без строки в откате — красный тест:
 * откат, забывший писателя, оставит на бою RPC в таблицы без клиента.
 * Тела чата без `task_id` и порядок `unschedule` сторожит `bizTasksChat.test.ts`.
 */

const ROLLOUT = join(process.cwd(), '../supabase/rollout/r1910b');
const SUFFIX = '_rollback.sql';
const T1 = '20261020090000_erp_biz_tasks_schema.sql';
const T2 = '20261020100000_erp_biz_tasks_rpc.sql';
const DEFINES = /create or replace function public\.([a-z_0-9]+)\(/g;

const rollbacks = readdirSync(ROLLOUT).filter((f) => f.endsWith(SUFFIX)).sort();
const rbSql = readFileSync(join(ROLLOUT, '20261020100000_erp_biz_tasks_rpc_rollback.sql'), 'utf8');
const rb = withoutComments(rbSql);

function definedIn(sql: string): string[] {
  return [...new Set([...withoutComments(sql).matchAll(DEFINES)].map((m) => m[1]))].sort();
}

function definedBefore(fn: string, target: string): boolean {
  const re = new RegExp(`create or replace function public\\.${fn}\\(`);
  return migrationFiles().some((f) => f < target && re.test(withoutComments(migration(f))));
}

/** Типы аргументов функции из `create or replace function public.fn(...)` — для подписи `drop` */
function argTypes(sql: string, fn: string): string {
  const head = `create or replace function public.${fn}(`;
  const at = sql.indexOf(head);
  if (at < 0) throw new Error(`нет ${fn}`);
  let depth = 1;
  let i = at + head.length;
  for (; i < sql.length && depth > 0; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
  }
  const args = sql.slice(at + head.length, i - 1).trim();
  if (!args) return '';
  return args
    .split(/,(?![^(]*\))/)
    .map((a) => a.replace(/\s+default\s+[\s\S]*$/i, '').trim().split(/\s+/).slice(1).join(' '))
    .map((t) => ({ int: 'integer', 'timestamp with time zone': 'timestamptz' } as Record<string, string>)[t] ?? t)
    .join(', ');
}

describe('откат правок 19.10 (план B)', () => {
  const t2 = withoutComments(migration(T2));
  const created = definedIn(t2);
  const fresh = created.filter((fn) => !definedBefore(fn, T2));
  const restored = created.filter((fn) => definedBefore(fn, T2));

  it('один откат — T2; T1 серверного отката не имеет (таблицы с данными не удаляются)', () => {
    expect(rollbacks).toEqual(['20261020100000_erp_biz_tasks_rpc_rollback.sql']);
    expect(migrationFiles()).toContain(T1);
    expect(migrationFiles()).toContain(T2);
    expect(migrationFiles().filter((f) => f.includes('rollback'))).toEqual([]);
    expect(rb).not.toMatch(/drop table/i);
    expect(rb).not.toMatch(/alter table/i);
  });

  it('прежние функции чата возвращаются, новые снимаются — состав равен миграции', () => {
    expect(restored).toEqual(['erp_chat_delete', 'erp_chat_edit', 'erp_chat_page', 'erp_chat_send']);
    expect(definedIn(rb)).toEqual(restored);
    for (const fn of fresh) {
      expect(rb, `${fn}: миграция создаёт, откат не снимает`)
        .toContain(`drop function if exists public.${fn}(${argTypes(t2, fn)});`);
    }
    for (const fn of restored) {
      expect(functionBody(rbSql, fn), `${fn}: в откате ветка задачи`).not.toMatch(/task_id|biz_task/);
    }
  });

  it('новые подписи чата снимаются до возврата прежних, расписание — первым', () => {
    for (const fn of ['erp_chat_send', 'erp_chat_page']) {
      const drop = rb.indexOf(`drop function if exists public.${fn}(${argTypes(t2, fn)});`);
      expect(drop, `${fn}: нет drop новой подписи`).toBeGreaterThan(-1);
      expect(drop).toBeLessThan(rb.indexOf(`create or replace function public.${fn}(`));
    }
    expect(rb.indexOf("cron.unschedule('erp-biz-task-reminders')"))
      .toBeLessThan(rb.indexOf('drop function if exists public.erp_biz_task_reminders_run()'));
    expect(rb).toMatch(/^\s*begin;/m);
    expect(rb.indexOf('commit;')).toBeLessThan(rb.lastIndexOf("notify pgrst, 'reload schema';"));
  });

  it('README выкатки: T1 → T2 → фронт, предусловия, пробы, проверки и триггеры отката', () => {
    const readme = readFileSync(join(ROLLOUT, 'README.md'), 'utf8');
    const t1 = readme.indexOf('20261020090000');
    const t2at = readme.indexOf('20261020100000');
    expect(t1).toBeGreaterThan(-1);
    expect(t1).toBeLessThan(t2at);
    expect(readme).toMatch(/T1 → T2, затем фронт/);
    // Предусловие: часть A выкачена
    for (const a of ['20261019090000', '20261019100000', '20261019110000']) expect(readme).toContain(a);
    expect(readme).toMatch(/APPLIED\.json/);
    expect(readme).toMatch(/npm run migrations:verify/);
    expect(readme).toMatch(/notify pgrst, 'reload schema'/);
    expect(readme).toMatch(/нерабочее время/);
    // Ожидания проб — те же, что в файлах проб
    for (const [probe, total] of [['erp_biz_tasks_schema.sql', 31], ['erp_biz_tasks.sql', 407], ['erp_biz_tasks_chat.sql', 55]] as const) {
      expect(readme).toContain(probe);
      expect(readme).toContain(`total=${total}`);
      const text = readFileSync(join(process.cwd(), '../supabase/probes', probe), 'utf8');
      expect(text, `${probe}: ожидание в README расходится с пробой`).toContain(`total=${total}`);
    }
    // Проверки после T2
    expect(readme).toMatch(/erp_chat_send/);
    expect(readme).toMatch(/cron\.job\b/);
    expect(readme).toMatch(/cron\.job_run_details/);
    expect(readme).toMatch(/succeeded/);
    for (const trigger of ['fails>0', '42883', 'PGRST202', 'not unique', 'failed', 'unschedule', 'Ошибки интерфейса']) {
      expect(readme).toContain(trigger);
    }
    expect(readme).toMatch(/Таблицы при откате не удаляются/);
    for (const f of rollbacks) expect(readme).toContain(f);
  });
});
