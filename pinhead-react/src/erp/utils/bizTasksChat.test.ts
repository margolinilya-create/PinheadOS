// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  functionBody, migration, migrationFiles, withoutComments, withoutJsComments,
} from './migrations.testutil';

/**
 * ДИАЛОГ БИЗНЕС-ЗАДАЧИ И НАПОМИНАНИЯ ПО СРОКУ (правки 19.10, п. 7; T3 —
 * в той же миграции, что писатели T2: лимит неприменённых ≤ 5).
 *
 * Диалог задачи — тред существующего чата с якорем `task_id` и пустым
 * `order_id`. Значит, весь доступ к нему — в ветке `p_task_id` тех же
 * definer-функций чата: кто пишет (участник или manage), кого можно позвать
 * (только участников), какие уведомления уходят (только `task_mention`, Р4),
 * какие файлы цепляются (только свои объекты под `att/<заказ>/chat/`).
 * Пересоздание `erp_chat_send`/`erp_chat_page` с новым параметром — `drop`
 * старой подписи в той же транзакции: две перегрузки дали бы PostgREST
 * неоднозначный вызов (PGRST203) для старого клиента.
 */

const FILE = '20261020100000_erp_biz_tasks_rpc.sql';
const clean = (sql: string): string => withoutJsComments(withoutComments(sql));
const SQL = clean(migration(FILE));
const body = (fn: string): string => clean(functionBody(migration(FILE), fn));

const ROLLBACK = join(process.cwd(),
  '../supabase/rollout/r1910b/20261020100000_erp_biz_tasks_rpc_rollback.sql');

const OLD_SEND = 'uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb';
const NEW_SEND = `${OLD_SEND}, uuid`;
const OLD_PAGE = 'uuid, uuid, uuid, uuid, timestamptz, uuid, integer';
const NEW_PAGE = `${OLD_PAGE}, uuid`;

/** Оператор SQL, в котором стоит метка, — от ближайшего `insert` до `;` */
function insertWith(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`нет ${marker}`);
  const start = text.lastIndexOf('insert into', at);
  return text.slice(start, text.indexOf(';', at));
}

describe('диалог задачи: отправка', () => {
  const send = body('erp_chat_send');

  it('ветка задачи требует p_order_id null и участника', () => {
    expect(send).toMatch(/p_task_id is not null and \(p_order_id is not null or p_experimental_id is not null\)/);
    const both = send.slice(send.indexOf('p_task_id is not null and (p_order_id'));
    expect(both.slice(0, both.indexOf('end if'))).toMatch(/errcode = '22023'/);

    const gate = send.indexOf('public.erp_biz_task_is_participant(p_task_id, v_me)');
    expect(gate, 'нет проверки участника').toBeGreaterThan(0);
    expect(send.slice(gate, gate + 300)).toMatch(/or public\.erp_biz_task_can_manage\(\)\)/);
    expect(send.slice(gate, gate + 400)).toMatch(/errcode = '42501'/);
    // Гейт задачи — до первой записи
    expect(gate).toBeLessThan(send.indexOf('insert into'));

    // Писать — только действующий сотрудник ERP: ворота писателей до проверки участника
    const staff = send.indexOf('perform public.erp_biz_task_gate();');
    expect(staff, 'нет ворот сотрудника в ветке задачи').toBeGreaterThan(0);
    expect(staff).toBeLessThan(gate);

    // Тред задачи — по task_id, второй тред гонкой не заводится
    expect(send).toMatch(/where t\.task_id = p_task_id/);
    expect(send).toMatch(/on conflict \(task_id\) where task_id is not null do nothing/);
    // Контекст — против заказа ЗАДАЧИ, а не переданного p_order_id
    expect(send).toMatch(/i\.id = p_item_id and i\.order_id = v_order/);
    expect(send).toMatch(/s\.id = p_stage_id and i\.order_id = v_order/);
  });

  it('файлы треда задачи — только свои объекты под att/<заказ>/chat/', () => {
    expect(send).toMatch(/'att\/' \|\| v_order::text \|\| '\/chat\/'/);
    expect(send).toMatch(/o\.bucket_id = 'erp-attachments'/);
    expect(send).toMatch(/coalesce\(o\.owner_id, o\.owner::text\) = v_me::text/);
    const check = send.indexOf("'/chat/'");
    expect(send.slice(check, check + 700)).toMatch(/errcode = '42501'/);
    // Носитель файла знает задачу — вкладка «Файлы» карточки
    expect(insertWith(send, "'chat'")).toMatch(/biz_task_id/);
  });

  it('упоминания треда задачи — участники', () => {
    const pick = send.slice(send.indexOf('into v_mentions'));
    const stmt = pick.slice(0, pick.indexOf(';'));
    expect(stmt).toMatch(/p_task_id is null or public\.erp_biz_task_is_participant\(p_task_id, p\.id\)/);

    const edit = body('erp_chat_edit');
    const epick = edit.slice(edit.indexOf('into v_mentions'));
    expect(epick.slice(0, epick.indexOf(';')))
      .toMatch(/v_task is null or public\.erp_biz_task_is_participant\(v_task, p\.id\)/);
    expect(edit).toMatch(/select t\.task_id into v_task\s+from public\.erp_chat_threads t\s+where t\.id = v_row\.thread_id/);
  });

  it('сообщение задачи не пишет chat_message/chat_reply', () => {
    // Сделочная рассылка — только при p_task_id is null
    expect(send).toMatch(/if p_task_id is null then\s+insert into public\.erp_notifications/);
    expect(send.match(/insert into public\.erp_notifications/g)).toHaveLength(2);
    const task = insertWith(send, "'task_mention'");
    expect(task).not.toMatch(/'chat_(mention|reply|message)'/);
    expect(task).not.toMatch(/erp_chat_subscriptions/);
    expect(task).toMatch(/from unnest\(v_mentions\) u/);
    expect(task).toMatch(/u is distinct from v_me/);
    expect(task).toMatch(/on conflict \(user_id, message_id\) where message_id is not null do nothing/);
    expect(task).toMatch(/'\/biz-tasks\/' \|\| p_task_id::text \|\| '\?msg=' \|\| v_id::text/);
    // Автоподписка «Все сообщения» — только у сделки
    const sub = insertWith(send, 'erp_chat_subscriptions (thread_id');
    expect(send.slice(send.lastIndexOf('if ', send.indexOf(sub)), send.indexOf(sub)))
      .toMatch(/if p_task_id is null then/);
  });

  it('непрочитанное задач — своя функция, сделочную не трогаем', () => {
    expect(SQL).not.toMatch(/function public\.erp_chat_unread_many\(/);
    expect(SQL).not.toMatch(/function public\.erp_chat_unread\(/);
    const u = clean(migration(FILE).slice(migration(FILE).indexOf('function public.erp_chat_unread_tasks(')));
    expect(u).toMatch(/^function public\.erp_chat_unread_tasks\(p_task_ids uuid\[\]\)\s+returns table\(task_id uuid, unread int\)/);
    const b = body('erp_chat_unread_tasks');
    expect(b).toMatch(/t\.task_id = any\(coalesce\(p_task_ids, '\{\}'::uuid\[\]\)\)/);
    expect(b).toMatch(/m\.author_id is distinct from \(select auth\.uid\(\)\)/);
    expect(b).toMatch(/m\.deleted_at is null/);
    expect(b).toMatch(/erp_chat_message_reads/);
    expect(SQL).toMatch(/grant execute on function public\.erp_chat_unread_tasks\(uuid\[\]\) to authenticated;/);
  });
});

describe('диалог задачи: лента', () => {
  it('тред задачи — только при p_task_id; сделочные — только без него', () => {
    const page = body('erp_chat_page');
    expect(page).toMatch(/where p_task_id is null and t\.order_id = p_order_id/);
    expect(page).toMatch(/where p_task_id is null and e\.order_id = p_order_id/);
    expect(page).toMatch(/where p_task_id is not null and t\.task_id = p_task_id/);
  });
});

describe('удаление сообщения-результата', () => {
  it('delete сообщения-результата не трогает result_text', () => {
    const del = body('erp_chat_delete');
    expect(del).toMatch(/set body = ''\s*,\s*deleted_at = now\(\)/);
    expect(del).not.toMatch(/update public\.erp_biz_tasks/);
    expect(del).not.toMatch(/delete from public\.erp_biz_task_events/);
    // След в истории: сообщение-результат удалено, текст результата сохранён
    expect(del).toMatch(/t\.result_message_id = p_message_id/);
    expect(del).toMatch(/'result_changed'/);
    expect(del).toMatch(/'message_deleted', true/);
  });
});

describe('напоминания по сроку', () => {
  it('reminders_run: только service_role, активные статусы, ключ срока', () => {
    expect(SQL).toMatch(/revoke execute on function public\.erp_biz_task_reminders_run\(\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.erp_biz_task_reminders_run\(\) to service_role;/);
    expect(SQL).not.toMatch(/grant execute on function public\.erp_biz_task_reminders_run\(\) to authenticated/);

    const b = body('erp_biz_task_reminders_run');
    expect(b.match(/t\.status in \('new', 'in_progress', 'paused'\)/g)).toHaveLength(2);
    expect(b).toMatch(/t\.due_at - now\(\) <= interval '24 hours'/);
    expect(b).toMatch(/t\.created_at < t\.due_at - interval '24 hours'/);
    expect(b).toMatch(/t\.due_at < now\(\)/);
    expect(b.match(/on conflict \(task_id, kind, due_at\) where kind in \('due_soon', 'overdue'\) do nothing/g))
      .toHaveLength(2);
    expect(b).toMatch(/'task_due_soon'/);
    expect(b).toMatch(/'task_overdue', array\[r\.assignee_id, r\.creator_id, r\.manager_id\]/);
    // Уведомления — тем же единственным писателем
    expect(b).not.toMatch(/insert into public\.erp_notifications/);
  });

  it('cron: снять прежнее расписание в exists, затем раз в 15 минут', () => {
    const cron = SQL.slice(SQL.indexOf('do $cron$'));
    expect(cron).toMatch(/if exists \(select 1 from cron\.job where jobname = 'erp-biz-task-reminders'\) then\s+perform cron\.unschedule\('erp-biz-task-reminders'\);/);
    expect(cron).toMatch(/perform cron\.schedule\('erp-biz-task-reminders', '\*\/15 \* \* \* \*',\s+'select public\.erp_biz_task_reminders_run\(\)'\);/);
  });
});

describe('пересоздание функций чата', () => {
  it('одна перегрузка erp_chat_send и erp_chat_page', () => {
    for (const [fn, oldArgs, newArgs] of [
      ['erp_chat_send', OLD_SEND, NEW_SEND],
      ['erp_chat_page', OLD_PAGE, NEW_PAGE],
    ]) {
      const drop = SQL.indexOf(`drop function if exists public.${fn}(${oldArgs});`);
      const create = SQL.indexOf(`create or replace function public.${fn}(`);
      expect(drop, `${fn}: нет drop старой подписи`).toBeGreaterThan(0);
      expect(drop).toBeLessThan(create);
      expect(SQL).toContain(`revoke execute on function public.${fn}(${newArgs}) from public, anon, authenticated;`);
      expect(SQL).toContain(`grant execute on function public.${fn}(${newArgs}) to authenticated;`);
    }
    expect(SQL).toMatch(/p_attachments jsonb default '\[\]'::jsonb,\s+p_task_id uuid default null::uuid\s*\)\s+returns jsonb/);
    expect(SQL).toMatch(/p_limit integer default 50,\s+p_task_id uuid default null::uuid\s*\)\s+returns jsonb/);
    expect(SQL.lastIndexOf("notify pgrst, 'reload schema';"))
      .toBeGreaterThan(SQL.indexOf('create or replace function public.erp_chat_page('));

    // Позже этой миграции send/page никто не пересоздаёт в старой подписи
    for (const f of migrationFiles().filter((x) => x > FILE)) {
      expect(migration(f), f).not.toMatch(/function public\.erp_chat_(send|page)\(/);
    }
  });

  it('rollback-файл — тела без ветки задач', () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const rb = clean(readFileSync(ROLLBACK, 'utf8'));
    // Сначала снимается расписание, затем функции
    expect(rb).toMatch(/if exists \(select 1 from cron\.job where jobname = 'erp-biz-task-reminders'\) then\s+perform cron\.unschedule\('erp-biz-task-reminders'\);/);
    expect(rb).toContain(`drop function if exists public.erp_chat_send(${NEW_SEND});`);
    expect(rb).toContain(`drop function if exists public.erp_chat_page(${NEW_PAGE});`);
    expect(rb).toContain('drop function if exists public.erp_chat_unread_tasks(uuid[]);');
    expect(rb).toContain('drop function if exists public.erp_biz_task_reminders_run();');
    for (const fn of ['erp_chat_send', 'erp_chat_page', 'erp_chat_edit', 'erp_chat_delete']) {
      const b = clean(functionBody(readFileSync(ROLLBACK, 'utf8'), fn));
      expect(b, `${fn}: в откате осталась ветка задачи`).not.toMatch(/task_id|biz_task/);
    }
    expect(rb).toContain(`grant execute on function public.erp_chat_send(${OLD_SEND}) to authenticated;`);
    expect(rb).toContain(`grant execute on function public.erp_chat_page(${OLD_PAGE}) to authenticated;`);
    // Писатели T2 тоже снимаются — откат всей миграции
    for (const fn of ['erp_biz_task_create(jsonb, uuid)', 'erp_biz_task_notify(uuid, bigint, text, uuid[], text, text)',
      'erp_profile_is_staff(uuid)', 'erp_biz_task_counts(uuid)']) {
      expect(rb).toContain(`drop function if exists public.${fn};`);
    }
    expect(rb).toMatch(/notify pgrst, 'reload schema';\s*$/);
  });
});
