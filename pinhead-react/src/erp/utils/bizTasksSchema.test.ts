// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  functionBody, latestDefining, migration, withoutComments,
} from './migrations.testutil';
import { BIZ_TASK_KINDS, BIZ_TASK_STATUSES } from './bizTasks';

/**
 * БИЗНЕС-ЗАДАЧИ: СХЕМА (правки 19.10, п. 7; миграция T1).
 *
 * Задачу клиент только ЧИТАЕТ: писатели — `security definer` RPC следующей
 * миграции, событие истории и уведомления ложатся одной транзакцией с самим
 * изменением. Поэтому сторож проверяет не «есть ли политики», а что их ровно
 * одна — на чтение, — и что ни одна команда записи клиенту не открыта.
 * Политика `for all` или забытая `for insert` дала бы задачу «от чужого
 * имени» и историю без события — ровно то, ради чего писатель один.
 */

const FILE = '20261020090000_erp_biz_tasks_schema.sql';
const SQL = withoutComments(migration(FILE));

const TABLES = [
  'erp_biz_tasks',
  'erp_biz_task_watchers',
  'erp_biz_task_checklist',
  'erp_biz_task_events',
  'erp_biz_task_seen',
];

/** Список строк из `check (<col> in (…))` у названного ограничения */
function checkList(constraint: string): string[] {
  const at = SQL.indexOf(`constraint ${constraint}`);
  if (at < 0) throw new Error(`нет ограничения ${constraint}`);
  const tail = SQL.slice(at);
  const body = tail.slice(tail.indexOf(' in (') + 5, tail.indexOf(')'));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('бизнес-задачи: таблицы только на чтение', () => {
  it.each(TABLES)('%s: RLS включён, ровно одна политика select и нет политик записи', (t) => {
    expect(SQL).toContain(`create table if not exists public.${t} (`);
    expect(SQL).toContain(`alter table public.${t} enable row level security;`);
    const policies = [...SQL.matchAll(new RegExp(`create policy (\\w+) on public\\.${t}\\b([^;]*);`, 'g'))];
    expect(policies, `${t}: политик должно быть ровно одна`).toHaveLength(1);
    const [, , rest] = policies[0];
    if (t === 'erp_biz_task_seen') {
      // Отметка «видел» — личная (ревизия безопасности B1): каждый читает
      // только свою. Факт «ответственный открыл задачу» постановщику и manage
      // отдаёт писатель `erp_biz_task_seen_by` с проверкой участия
      expect(rest).toMatch(/for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
      expect(rest).not.toContain('erp_is_member');
    } else {
      expect(rest).toMatch(/for select to authenticated\s+using \(\(select public\.erp_is_member\(\)\)\)/);
    }
    expect(SQL).not.toMatch(new RegExp(`on public\\.${t}\\s+(as \\w+\\s+)?for (insert|update|delete|all)`));
  });

  it.each(TABLES)('%s: права — revoke у public/anon, select у authenticated', (t) => {
    expect(SQL).toContain(`revoke all on table public.${t} from public, anon;`);
    expect(SQL).toContain(`revoke insert, update, delete, truncate on table public.${t} from authenticated;`);
    expect(SQL).toContain(`grant select on table public.${t} to authenticated;`);
  });
});

describe('бизнес-задачи: перечни сходятся с клиентом', () => {
  it('CHECK статусов/типов = BIZ_TASK_STATUSES/BIZ_TASK_KINDS', () => {
    expect(checkList('erp_biz_tasks_status_check')).toEqual([...BIZ_TASK_STATUSES]);
    expect(checkList('erp_biz_tasks_kind_check')).toEqual([...BIZ_TASK_KINDS]);
    // Задача рождается новой: статус по умолчанию — первый в перечне
    expect(SQL).toMatch(/status text not null default 'new'/);
    expect(BIZ_TASK_STATUSES[0]).toBe('new');
  });

  it('события истории — полный перечень, напоминания по сроку уникальны', () => {
    expect(checkList('erp_biz_task_events_kind_check')).toEqual([
      'created', 'started', 'paused', 'resumed', 'submitted', 'accepted', 'returned',
      'completed', 'cancelled', 'reopened', 'assignee_changed', 'due_changed',
      'watchers_changed', 'edited', 'result_changed', 'checklist_changed',
      'due_soon', 'overdue',
    ]);
    // Второе «просрочена» на тот же срок не родится даже при двух прогонах
    // напоминаний подряд: ключ — задача, вид и срок, на который напомнили
    expect(SQL).toMatch(/create unique index if not exists erp_biz_task_events_due_uniq\s+on public\.erp_biz_task_events \(task_id, kind, due_at\)\s+where kind in \('due_soon', 'overdue'\)/);
  });

  it('повтор «Создать задачу» — тот же ряд: client_key уникален', () => {
    expect(SQL).toMatch(/client_key uuid unique/);
  });

  it('удаления задачи нет: заказ уносит её каскадом, профиль — нет', () => {
    expect(SQL).toMatch(/order_id uuid not null references public\.erp_orders\(id\) on delete cascade/);
    expect(SQL).toMatch(/assignee_id uuid not null references public\.profiles\(id\),/);
    expect(SQL).toMatch(/creator_id uuid not null references public\.profiles\(id\),/);
  });
});

describe('бизнес-задачи: тред, вложения, уведомления', () => {
  it('якорь треда — ровно один из трёх', () => {
    expect(SQL).toMatch(/drop constraint if exists erp_chat_thread_anchor/);
    expect(SQL).toMatch(/add constraint erp_chat_thread_anchor check \(\s*\(order_id is not null\)::int \+ \(experimental_id is not null\)::int\s*\+ \(task_id is not null\)::int = 1\)/);
    expect(SQL).toMatch(/create unique index if not exists erp_chat_thread_task_uniq\s+on public\.erp_chat_threads \(task_id\) where task_id is not null/);
    // Индекс треда сделки не трогается: у треда задачи order_id пуст
    expect(SQL).not.toMatch(/erp_chat_thread_order_uniq/);
  });

  it('прямая вставка biz_task запрещена restrictive-политикой', () => {
    expect(SQL).toMatch(/create policy erp_order_attachments_no_biz_task on public\.erp_order_attachments\s+as restrictive\s+for insert to authenticated\s+with check \(kind <> 'biz_task' and biz_task_id is null\)/);
    expect(SQL).toMatch(/add column if not exists biz_task_id uuid\s+references public\.erp_biz_tasks\(id\) on delete cascade/);
  });

  it('уведомление о событии задачи — одно на человека', () => {
    expect(SQL).toMatch(/add column if not exists task_id uuid\s+references public\.erp_biz_tasks\(id\) on delete cascade/);
    expect(SQL).toMatch(/add column if not exists task_event_id bigint\s+references public\.erp_biz_task_events\(id\) on delete cascade/);
    expect(SQL).toMatch(/create unique index if not exists erp_notifications_task_event_uniq\s+on public\.erp_notifications \(user_id, task_event_id\) where task_event_id is not null/);
  });

  it('publication содержит erp_biz_tasks и erp_biz_task_events', () => {
    expect(SQL).toMatch(/alter publication supabase_realtime add table public\.erp_biz_tasks, public\.erp_biz_task_events;/);
    // Остальные три меняются только вместе с событием задачи — подписки им не нужно
    for (const t of ['erp_biz_task_watchers', 'erp_biz_task_checklist', 'erp_biz_task_seen']) {
      expect(SQL).not.toMatch(new RegExp(`publication[^;]*${t}`));
    }
  });

  it('право biz_task.manage засеяно по должности, без запасной роли', () => {
    const seed = SQL.slice(SQL.indexOf('insert into public.erp_role_permissions'));
    const block = seed.slice(0, seed.indexOf(';'));
    const roles = [...block.matchAll(/\('(\w+)', 'biz_task\.manage', true\)/g)].map((m) => m[1]).sort();
    expect(roles).toEqual(['director', 'manager', 'production_head']);
    expect(block).toMatch(/on conflict \(role, permission\) do nothing/);
  });
});

describe('менеджер заказа (Р3)', () => {
  const body = withoutComments(functionBody(latestDefining('erp_create_order'), 'erp_create_order'));

  it('колонка — профиль, обнуляется при его удалении', () => {
    expect(SQL).toMatch(/alter table public\.erp_orders\s+add column if not exists manager_id uuid references public\.profiles\(id\) on delete set null/);
  });

  it('erp_create_order берёт manager_id только при подлинном запуске', () => {
    expect(latestDefining('erp_create_order')).toBe(migration(FILE));
    // Из присланного тела заказа менеджер не берётся никогда
    expect(body).not.toMatch(/v_order->>'manager_id'/);
    const pick = body.slice(body.indexOf('into v_manager_id'));
    const where = pick.slice(0, pick.indexOf(';'));
    expect(where).toMatch(/from public\.orders v/);
    expect(where).toMatch(/v\.id = nullif\(v_order->>'tz_order_id', ''\)::uuid/);
    expect(where).toMatch(/v\.schema_version = 4/);
    expect(where).toMatch(/v\.status = 'ready_to_launch'/);
    expect(where).toMatch(/v\.erp_order_id is null/);
    expect(where).toMatch(/v\.launch_by = \(select auth\.uid\(\)\)/);
    expect(where).toMatch(/v\.launch_started_at > now\(\) - interval '10 minutes'/);
    expect(body).toMatch(/select v\.created_by\s+into v_manager_id/);
    expect(body).toMatch(/tz_number, purchase_required, manager_id\)/);
    expect(body).toMatch(/coalesce\(\(v_order->>'purchase_required'\)::boolean, true\),\s+v_manager_id\)/);
  });

  it('тело erp_create_order — прежнее целиком плюс менеджер', () => {
    // Функция пересоздаётся ЦЕЛИКОМ: каждая строка прежней редакции обязана
    // остаться и в том же порядке — иначе пересоздание молча потеряло ветку
    const prev = functionBody(migration('20260907203932_erp_garment_source.sql'), 'erp_create_order')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const next = functionBody(migration(FILE), 'erp_create_order')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    let at = 0;
    const lost: string[] = [];
    for (const line of prev) {
      const found = next.indexOf(line, at);
      // Одна строка меняется: список колонок INSERT заказа дополнен manager_id
      if (found < 0) {
        if (line !== 'status, created_by, tz_required, tz_order_id, tz_number, purchase_required)'
          && line !== "coalesce((v_order->>'purchase_required')::boolean, true))") lost.push(line);
        continue;
      }
      at = found + 1;
    }
    expect(lost).toEqual([]);
    expect(next.length - prev.length).toBeLessThan(25);
  });

  it('страж заказа: ветка «родитель удалён» для manager_id', () => {
    const guard = withoutComments(functionBody(latestDefining('erp_order_guard'), 'erp_order_guard'));
    expect(latestDefining('erp_order_guard')).toBe(migration(FILE));
    expect(guard).toMatch(/new\.manager_id is null and old\.manager_id is not null\s+and not exists \(select 1 from public\.profiles p where p\.id = old\.manager_id\)/);
    // Сама колонка — под order.manage: в исключениях сравнения снимков её нет
    const rest = guard.slice(guard.indexOf('v_rest :='));
    expect(rest.slice(0, rest.indexOf(';'))).not.toContain("'manager_id'");
    expect(SQL).toMatch(/revoke execute on function public\.erp_order_guard\(\) from public, anon, authenticated;/);
  });

  it('страж заказа: менеджер — только сотрудник ERP (Р3), проверяется смена значения', () => {
    const guard = withoutComments(functionBody(latestDefining('erp_order_guard'), 'erp_order_guard'));
    const at = guard.indexOf('new.manager_id is not null');
    expect(at).toBeGreaterThan(-1);
    const branch = guard.slice(at, guard.indexOf('end if;', at));
    expect(branch).toMatch(/new\.manager_id is distinct from old\.manager_id/);
    expect(branch).toMatch(/from public\.erp_employees e/);
    expect(branch).toMatch(/e\.active and p\.active is true and p\.approved is true/);
    expect(branch).toMatch(/errcode = '22023'/);
    // Ветка «родитель удалён» идёт раньше: обнуление каскадом сюда не доходит
    expect(guard.indexOf('not exists (select 1 from public.profiles p where p.id = old.manager_id)')).toBeLessThan(at);
  });
});
