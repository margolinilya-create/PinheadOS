-- Пробы миграции T3 правок 19.10, часть B (вторая половина 20261020100000_erp_biz_tasks_rpc):
-- диалог бизнес-задачи (ветка `p_task_id` в `erp_chat_send`/`erp_chat_page`/`erp_chat_edit`/
-- `erp_chat_delete`, `erp_chat_unread_tasks`) и напоминания по сроку (`erp_biz_task_reminders_run`).
-- Только после применения T1 и T2+T3 (или сухим прогоном вместе с ними), ВЛАДЕЛЕЦ в SQL Editor.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=53 {…}
--
-- Роли — те же профили боя, что в `erp_biz_tasks.sql` (признаки и карточки сотрудника
-- выставляются внутри транзакции, откат вернёт):
--   CREATOR  e73bd7fd-…  постановщик, сотрудник worker
--   ASSIGNEE 72b71eba-…  ответственный, сотрудник worker
--   WATCHER  43a8021c-…  наблюдатель, сотрудник worker
--   MANAGE   f13c33f3-…  должность ERP manager (biz_task.manage), не участник
--   OUTSIDER 64a22c1f-…  сотрудник worker, к задаче отношения не имеет
--   STAFF2   05bbc552-…  сотрудник worker; менеджер заказа
-- Если профили на бою изменятся — пробы покажут FAIL: правьте данные пробы, а не ожидания.
--
-- `erp_biz_task_reminders_run` проходит по ВСЕМ задачам базы: на бою внутри транзакции
-- он может завести события и чужим задачам — откат пробы их снимает; ожидания считают
-- только задачи пробы.
--
-- Проверено локально (19.10): PostgreSQL 16 с заглушкой схемы Supabase + прежние функции
-- чата + T1 + T2/T3 — fails=0 total=53.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Проба: SQL выполняется от имени p_uid (authenticated + JWT), 'anon' или суперпользователем
create function pg_temp.p(p_name text, p_expect text, p_sql text, p_uid text default null) returns void
language plpgsql as $f$
declare v text; n bigint;
begin
  begin
    if p_uid = 'anon' then
      execute 'set local role anon';
    elsif p_uid is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    if p_sql ~* '^\s*(select|with)\M' then
      execute p_sql into v;
      v := 'OK ' || coalesce(v, 'null');
    else
      execute p_sql;
      get diagnostics n = row_count;
      v := 'OK rows=' || n;
    end if;
  exception when others then
    v := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('probe.r.' || p_name, v, true);
  perform set_config('probe.e.' || p_name, p_expect, true);
  perform set_config('probe.names', coalesce(nullif(current_setting('probe.names', true), ''), '') || p_name || ',', true);
end;
$f$;

-- ── Данные (суперпользователь) ───────────────────────────────────────────
create temp table who (k text primary key, id uuid);
insert into who values
  ('creator',  'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26'),
  ('assignee', '72b71eba-f8a3-493d-aab5-25d7b7bb87dc'),
  ('watcher',  '43a8021c-6ddc-4a25-88f6-62e13b46c1c5'),
  ('manage',   'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9'),
  ('outsider', '64a22c1f-35b6-4e90-9cc1-cd6e04cc94b6'),
  ('staff2',   '05bbc552-bca2-490d-b275-46a3084dca7c');
create function pg_temp.uid(p_k text) returns text language sql stable as $f$
  select id::text from who where k = p_k;
$f$;

create temp table fx (k text primary key, id uuid);
create function pg_temp.fx(p_k text) returns uuid language sql stable as $f$
  select id from fx where k = p_k;
$f$;

update public.profiles set active = true, approved = true, role = 'manager', is_sales = false, is_ms = false
 where id in (select id from who);

insert into public.erp_employees (full_name, role, profile_id)
select 'Проба T3 ' || k, case k when 'manage' then 'manager' else 'worker' end, id
  from who
on conflict (profile_id) where profile_id is not null
  do update set role = excluded.role, active = true;

insert into public.erp_orders (title, manager_id) values ('PROBE T3 заказ', pg_temp.uid('staff2')::uuid);
insert into fx values ('order', (select id from public.erp_orders where title = 'PROBE T3 заказ'));
insert into public.erp_orders (title) values ('PROBE T3 заказ 2');
insert into fx values ('order2', (select id from public.erp_orders where title = 'PROBE T3 заказ 2'));

-- Задача диалога: постановщик CREATOR, ответственный ASSIGNEE, наблюдатель WATCHER
insert into public.erp_biz_tasks (order_id, title, kind, assignee_id, creator_id, due_at, status)
values (pg_temp.fx('order'), 'PROBE T3 диалог', 'delivery', pg_temp.uid('assignee')::uuid,
        pg_temp.uid('creator')::uuid, now() + interval '3 days', 'in_progress');
insert into fx values ('t', (select id from public.erp_biz_tasks where title = 'PROBE T3 диалог'));
insert into public.erp_biz_task_watchers (task_id, user_id) values (pg_temp.fx('t'), pg_temp.uid('watcher')::uuid);

-- Отправка в тред задачи от имени p_who: p_extra — дополнительные именованные аргументы
create function pg_temp.ts(p_body text, p_key text, p_extra text default '') returns text
language sql stable as $f$
  select format($q$select (public.erp_chat_send(p_order_id => null, p_body => %L, p_client_key => %L,
                  p_task_id => %L%s))::text$q$, p_body, p_key, pg_temp.fx('t'), p_extra);
$f$;

-- ── Перегрузки и старый вызов ────────────────────────────────────────────
select pg_temp.p('one_send', 'OK 1', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'erp_chat_send'$q$);
select pg_temp.p('one_page', 'OK 1', $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'erp_chat_page'$q$);
select pg_temp.p('old_send_9_named', 'OK false', format($q$select (public.erp_chat_send(p_order_id => %L, p_body => 'Сделка', p_client_key => '00000000-0000-4000-8000-0000b3000001',
  p_item_id => null, p_stage_id => null, p_experimental_id => null, p_reply_to => null, p_mentions => '{}'::uuid[], p_attachments => '[]'::jsonb))->>'duplicate'$q$,
  pg_temp.fx('order')), pg_temp.uid('outsider'));
select pg_temp.p('old_page_named', 'OK 1', format($q$select jsonb_array_length((public.erp_chat_page(p_order_id => %L, p_limit => 50))->'messages')::text$q$,
  pg_temp.fx('order')), pg_temp.uid('outsider'));

-- ── Кто пишет в тред задачи ──────────────────────────────────────────────
select pg_temp.p('outsider_send', '42501', pg_temp.ts('Посторонний', '00000000-0000-4000-8000-0000b3000002'), pg_temp.uid('outsider'));
select pg_temp.p('task_with_foreign_order', '22023', format($q$select public.erp_chat_send(p_order_id => %L, p_body => 'x',
  p_client_key => '00000000-0000-4000-8000-0000b3000003', p_task_id => %L)$q$, pg_temp.fx('order2'), pg_temp.fx('t')), pg_temp.uid('watcher'));
select pg_temp.p('task_with_own_order', '22023', format($q$select public.erp_chat_send(p_order_id => %L, p_body => 'x',
  p_client_key => '00000000-0000-4000-8000-0000b3000004', p_task_id => %L)$q$, pg_temp.fx('order'), pg_temp.fx('t')), pg_temp.uid('watcher'));
select pg_temp.p('task_unknown', 'P0002', format($q$select public.erp_chat_send(p_order_id => null, p_body => 'x',
  p_client_key => '00000000-0000-4000-8000-0000b3000005', p_task_id => gen_random_uuid())$q$), pg_temp.uid('watcher'));
select pg_temp.p('foreign_item', '22023', pg_temp.ts('Позиция', '00000000-0000-4000-8000-0000b3000006',
  format(', p_item_id => %L', gen_random_uuid())), pg_temp.uid('watcher'));

-- Наблюдатель пишет; зовёт постановщика и постороннего — позван только постановщик
select pg_temp.p('watcher_send_mention', 'OK ["e73bd7fd-92a4-4b7b-b62d-ce9462d77f26"]', format($q$select ((public.erp_chat_send(p_order_id => null,
  p_body => '@Постановщик @Посторонний, ткань у поставщика', p_client_key => '00000000-0000-4000-8000-0000b3000010',
  p_mentions => array[%L, %L]::uuid[], p_task_id => %L))->'mentioned')::text$q$,
  pg_temp.uid('creator'), pg_temp.uid('outsider'), pg_temp.fx('t')), pg_temp.uid('watcher'));
insert into fx values ('m_watcher', (select id from public.erp_chat_messages
  where client_key = '00000000-0000-4000-8000-0000b3000010'));
select pg_temp.p('thread_no_order', 'OK true', format($q$select (t.order_id is null and t.task_id = %L)::text
  from public.erp_chat_threads t join public.erp_chat_messages m on m.thread_id = t.id where m.id = %L$q$,
  pg_temp.fx('t'), pg_temp.fx('m_watcher')));
select pg_temp.p('mention_notice_only', 'OK task_mention:e73bd7fd', format($q$select string_agg(kind || ':' || left(user_id::text, 8), ',')
  from public.erp_notifications where message_id = %L$q$, pg_temp.fx('m_watcher')));
select pg_temp.p('mention_notice_link', 'OK true', format($q$select (link = '/biz-tasks/' || %L || '?msg=' || %L and task_id = %L)::text
  from public.erp_notifications where message_id = %L$q$, pg_temp.fx('t'), pg_temp.fx('m_watcher'), pg_temp.fx('t'), pg_temp.fx('m_watcher')));
select pg_temp.p('repeat_same_key', 'OK true', pg_temp.ts('повтор', '00000000-0000-4000-8000-0000b3000010')
  || '::jsonb->>''duplicate''', pg_temp.uid('watcher'));
select pg_temp.p('repeat_one_row', 'OK 1', $q$select count(*)::text from public.erp_chat_messages where client_key = '00000000-0000-4000-8000-0000b3000010'$q$);

-- Ответ ответственного на сообщение наблюдателя: ни chat_reply, ни chat_message (Р4)
select pg_temp.p('assignee_reply', 'OK false', pg_temp.ts('Заберу завтра', '00000000-0000-4000-8000-0000b3000011',
  format(', p_reply_to => %L', pg_temp.fx('m_watcher'))) || '::jsonb->>''duplicate''', pg_temp.uid('assignee'));
insert into fx values ('m_reply', (select id from public.erp_chat_messages where client_key = '00000000-0000-4000-8000-0000b3000011'));
select pg_temp.p('reply_no_notice', 'OK 0', format($q$select count(*)::text from public.erp_notifications where message_id = %L$q$, pg_temp.fx('m_reply')));
select pg_temp.p('no_chat_kinds', 'OK 0', format($q$select count(*)::text from public.erp_notifications n
  join public.erp_chat_messages m on m.id = n.message_id join public.erp_chat_threads t on t.id = m.thread_id
 where t.task_id = %L and n.kind like 'chat_%%'$q$, pg_temp.fx('t')));
select pg_temp.p('no_subscription', 'OK 0', format($q$select count(*)::text from public.erp_chat_subscriptions s
  join public.erp_chat_threads t on t.id = s.thread_id where t.task_id = %L$q$, pg_temp.fx('t')));
-- Руководитель с biz_task.manage пишет, не будучи участником
select pg_temp.p('manage_send', 'OK false', pg_temp.ts('Проверю', '00000000-0000-4000-8000-0000b3000012')
  || '::jsonb->>''duplicate''', pg_temp.uid('manage'));

-- ── Файлы треда задачи ───────────────────────────────────────────────────
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('erp-attachments', format('att/%s/chat/probe-t3-own.jpg', pg_temp.fx('order')), pg_temp.uid('watcher')::uuid, pg_temp.uid('watcher')),
  ('erp-attachments', format('att/%s/chat/probe-t3-foreign.jpg', pg_temp.fx('order')), pg_temp.uid('creator')::uuid, pg_temp.uid('creator')),
  ('erp-attachments', format('att/%s/biz_task/probe-t3-task.jpg', pg_temp.fx('order')), pg_temp.uid('watcher')::uuid, pg_temp.uid('watcher')),
  ('erp-attachments', format('att/%s/chat/probe-t3-other.jpg', pg_temp.fx('order2')), pg_temp.uid('watcher')::uuid, pg_temp.uid('watcher'));
select pg_temp.p('file_own', 'OK false', pg_temp.ts('', '00000000-0000-4000-8000-0000b3000020',
  format(', p_attachments => jsonb_build_array(jsonb_build_object(''file_path'', %L, ''file_name'', ''фото.jpg''))',
         format('att/%s/chat/probe-t3-own.jpg', pg_temp.fx('order')))) || '::jsonb->>''duplicate''', pg_temp.uid('watcher'));
select pg_temp.p('file_row', 'OK chat true', format($q$select a.kind || ' ' || (a.biz_task_id = %L and a.order_id = %L)::text
  from public.erp_order_attachments a join public.erp_chat_messages m on m.id = a.message_id
 where m.client_key = '00000000-0000-4000-8000-0000b3000020'$q$, pg_temp.fx('t'), pg_temp.fx('order')));
select pg_temp.p('file_foreign_owner', '42501', pg_temp.ts('', '00000000-0000-4000-8000-0000b3000021',
  format(', p_attachments => jsonb_build_array(jsonb_build_object(''file_path'', %L))',
         format('att/%s/chat/probe-t3-foreign.jpg', pg_temp.fx('order')))), pg_temp.uid('watcher'));
select pg_temp.p('file_task_folder', '42501', pg_temp.ts('', '00000000-0000-4000-8000-0000b3000022',
  format(', p_attachments => jsonb_build_array(jsonb_build_object(''file_path'', %L))',
         format('att/%s/biz_task/probe-t3-task.jpg', pg_temp.fx('order')))), pg_temp.uid('watcher'));
select pg_temp.p('file_other_order', '42501', pg_temp.ts('', '00000000-0000-4000-8000-0000b3000023',
  format(', p_attachments => jsonb_build_array(jsonb_build_object(''file_path'', %L))',
         format('att/%s/chat/probe-t3-other.jpg', pg_temp.fx('order2')))), pg_temp.uid('watcher'));

-- ── Лента и непрочитанное ────────────────────────────────────────────────
select pg_temp.p('deal_page_no_task', 'OK 1', format($q$select jsonb_array_length((public.erp_chat_page(%L))->'messages')::text$q$,
  pg_temp.fx('order')), pg_temp.uid('outsider'));
select pg_temp.p('task_page', 'OK 4', format($q$select jsonb_array_length((public.erp_chat_page(null, p_task_id => %L))->'messages')::text$q$,
  pg_temp.fx('t')), pg_temp.uid('outsider'));
select pg_temp.p('deal_unread_no_task', 'OK 1', format($q$select (public.erp_chat_unread_many(array[%L]::uuid[]))->>%L$q$,
  pg_temp.fx('order'), pg_temp.fx('order')), pg_temp.uid('creator'));
select pg_temp.p('task_unread_creator', 'OK 4', format($q$select unread::text from public.erp_chat_unread_tasks(array[%L]::uuid[])$q$,
  pg_temp.fx('t')), pg_temp.uid('creator'));
select pg_temp.p('task_unread_author', 'OK 2', format($q$select unread::text from public.erp_chat_unread_tasks(array[%L]::uuid[])$q$,
  pg_temp.fx('t')), pg_temp.uid('watcher'));
select pg_temp.p('task_mark_seen', 'OK 1', format($q$select public.erp_chat_mark_seen(array[%L]::uuid[])::text$q$,
  pg_temp.fx('m_watcher')), pg_temp.uid('creator'));
select pg_temp.p('task_unread_seen', 'OK 3', format($q$select unread::text from public.erp_chat_unread_tasks(array[%L]::uuid[])$q$,
  pg_temp.fx('t')), pg_temp.uid('creator'));

-- ── Правка: упоминание не-участника отброшено ────────────────────────────
select pg_temp.p('edit_mention_filtered', 'OK ["72b71eba-f8a3-493d-aab5-25d7b7bb87dc"]', format($q$select ((public.erp_chat_edit(%L,
  '@Ответственный @Посторонний, ткань у поставщика', array[%L, %L]::uuid[]))->'mentioned')::text$q$,
  pg_temp.fx('m_watcher'), pg_temp.uid('assignee'), pg_temp.uid('outsider')), pg_temp.uid('watcher'));

-- ── Удаление сообщения-результата: результат и история остаются ─────────
select pg_temp.p('result_set', 'OK Заберу завтра', format($q$select (public.erp_biz_task_set_result(%L, null, %L)).result_text$q$,
  pg_temp.fx('t'), pg_temp.fx('m_reply')), pg_temp.uid('assignee'));
select pg_temp.p('result_delete', 'OK true', format($q$select (public.erp_chat_delete(%L))->>'deleted'$q$, pg_temp.fx('m_reply')), pg_temp.uid('assignee'));
select pg_temp.p('result_kept', 'OK Заберу завтра|', format($q$select t.result_text || '|' || m.body from public.erp_biz_tasks t
  join public.erp_chat_messages m on m.id = %L where t.id = %L$q$, pg_temp.fx('m_reply'), pg_temp.fx('t')));
select pg_temp.p('result_history', 'OK 2 1', format($q$select count(*)::text || ' ' || count(*) filter (where payload->>'message_deleted' = 'true')::text
  from public.erp_biz_task_events where task_id = %L and kind = 'result_changed'$q$, pg_temp.fx('t')));

-- ── Напоминания по сроку ─────────────────────────────────────────────────
-- soon: срок через 2 ч, создана двое суток назад; fresh: срок через 2 ч, создана сейчас;
-- late: срок час назад, в работе; review: срок час назад, на проверке
insert into public.erp_biz_tasks (order_id, title, kind, assignee_id, creator_id, due_at, status, created_at) values
  (pg_temp.fx('order'), 'PROBE T3 soon',   'other', pg_temp.uid('assignee')::uuid, pg_temp.uid('creator')::uuid, now() + interval '2 hours', 'new',         now() - interval '2 days'),
  (pg_temp.fx('order'), 'PROBE T3 fresh',  'other', pg_temp.uid('assignee')::uuid, pg_temp.uid('creator')::uuid, now() + interval '2 hours', 'new',         now()),
  (pg_temp.fx('order'), 'PROBE T3 late',   'other', pg_temp.uid('assignee')::uuid, pg_temp.uid('creator')::uuid, now() - interval '1 hour',  'in_progress', now() - interval '2 days'),
  (pg_temp.fx('order'), 'PROBE T3 review', 'other', pg_temp.uid('assignee')::uuid, pg_temp.uid('creator')::uuid, now() - interval '1 hour',  'review',      now() - interval '2 days');
insert into fx select 'r_' || split_part(title, ' ', 3), id from public.erp_biz_tasks where title like 'PROBE T3 %' and title <> 'PROBE T3 диалог';

select pg_temp.p('remind_auth_closed', '42501', $q$select public.erp_biz_task_reminders_run()$q$, pg_temp.uid('manage'));
select pg_temp.p('remind_anon_closed', '42501', $q$select public.erp_biz_task_reminders_run()$q$, 'anon');
select pg_temp.p('remind_run1', 'OK', $q$select public.erp_biz_task_reminders_run()::text$q$);
select pg_temp.p('remind_run2', 'OK', $q$select public.erp_biz_task_reminders_run()::text$q$);
select pg_temp.p('remind_soon_once', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'due_soon'$q$, pg_temp.fx('r_soon')));
select pg_temp.p('remind_soon_notice', 'OK task_due_soon:72b71eba', format($q$select string_agg(kind || ':' || left(user_id::text, 8), ',') from public.erp_notifications where task_id = %L$q$, pg_temp.fx('r_soon')));
select pg_temp.p('remind_fresh_none', 'OK 0', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind in ('due_soon', 'overdue')$q$, pg_temp.fx('r_fresh')));
select pg_temp.p('remind_late_once', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'overdue'$q$, pg_temp.fx('r_late')));
select pg_temp.p('remind_late_notice', 'OK task_overdue:05bbc552,task_overdue:72b71eba,task_overdue:e73bd7fd', format($q$select string_agg(kind || ':' || left(user_id::text, 8), ',' order by user_id::text)
  from public.erp_notifications where task_id = %L$q$, pg_temp.fx('r_late')));
select pg_temp.p('remind_review_none', 'OK 0', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind in ('due_soon', 'overdue')$q$, pg_temp.fx('r_review')));
-- Просроченная (уже уведомлённая) сдана на проверку и возвращена: срок тот же —
-- повторного «просрочена» нет
update public.erp_biz_tasks set status = 'review', submitted_at = now() where id = pg_temp.fx('r_late');
select pg_temp.p('remind_return', 'OK in_progress', format($q$select (public.erp_biz_task_transition(%L, 'return', 'Нет накладной',
  (select updated_at from public.erp_biz_tasks where id = %L))).status$q$, pg_temp.fx('r_late'), pg_temp.fx('r_late')), pg_temp.uid('creator'));
select pg_temp.p('remind_after_return', 'OK', $q$select public.erp_biz_task_reminders_run()::text$q$);
select pg_temp.p('remind_late_still_once', 'OK 1', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'overdue'$q$, pg_temp.fx('r_late')));
-- Перенос срока: новый ключ — новое «просрочена»
update public.erp_biz_tasks set due_at = now() - interval '30 minutes' where id = pg_temp.fx('r_late');
select pg_temp.p('remind_after_move', 'OK', $q$select public.erp_biz_task_reminders_run()::text$q$);
select pg_temp.p('remind_moved_again', 'OK 2', format($q$select count(*)::text from public.erp_biz_task_events where task_id = %L and kind = 'overdue'$q$, pg_temp.fx('r_late')));
select pg_temp.p('remind_cron', 'OK */15 * * * *', $q$select schedule from cron.job where jobname = 'erp-biz-task-reminders'$q$);

-- ── Итог ─────────────────────────────────────────────────────────────────
do $$
declare
  v_names text[] := string_to_array(trim(trailing ',' from current_setting('probe.names', true)), ',');
  v_name text;
  v_got text;
  v_want text;
  v_fails int := 0;
  v_map jsonb := '{}'::jsonb;
begin
  foreach v_name in array v_names loop
    v_got := current_setting('probe.r.' || v_name, true);
    v_want := current_setting('probe.e.' || v_name, true);
    if v_got like v_want || '%' then
      v_map := v_map || jsonb_build_object(v_name, v_got);
    else
      v_fails := v_fails + 1;
      v_map := v_map || jsonb_build_object('FAIL ' || v_name, jsonb_build_object('got', v_got, 'want', v_want));
    end if;
  end loop;
  raise exception 'PROBE_RESULT fails=% total=% %', v_fails, array_length(v_names, 1), v_map::text;
end;
$$;

-- Сюда исполнение не доходит: исключение выше откатывает всё.
rollback;
