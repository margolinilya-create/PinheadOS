-- Пробы миграции T1 правок 19.10, часть B (20261020090000_erp_biz_tasks_schema):
-- таблицы бизнес-задач только на чтение, файл задачи только через RPC,
-- якорь треда, виды уведомлений, publication, право biz_task.manage,
-- менеджер заказа при подлинном запуске (Р3), страж заказа на INSERT.
-- Только после применения T1 (или сухим прогоном вместе с ней), ВЛАДЕЛЕЦ в SQL Editor.
-- Регресс — `order_v4_launch.sql` тем же прогоном (его ожидание не меняется).
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=35 {…}
--
-- Роли — профили боя: DIRECTOR 56ec3039-f326-42dd-b4de-870844b9468d (запускает
-- заказ v4, видит все заказы, order.manage), HEAD 9285888e-4401-4b1b-b523-a3e6a9b90e82
-- (автор заказов v4 — ожидаемый менеджер), WORKER cc9ed453-d3d7-4add-a361-8719a7701f97 —
-- внутри транзакции одобрен и заведён рабочим цеха (без order.manage).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create function pg_temp.p(p_name text, p_expect text, p_sql text) returns void
language plpgsql as $f$
declare v text; n bigint;
begin
  begin
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
  perform set_config('probe.r.' || p_name, v, true);
  perform set_config('probe.e.' || p_name, p_expect, true);
  perform set_config('probe.names', coalesce(nullif(current_setting('probe.names', true), ''), '') || p_name || ',', true);
end;
$f$;

create function pg_temp.as_user(p_uid text) returns void language sql as $f$
  select set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$f$;

-- ── Данные (суперпользователь) ───────────────────────────────────────────
select pg_temp.as_user(null);
create temp table fx (k text primary key, id uuid);
grant all on fx to authenticated;
create function pg_temp.fx(p_k text) returns uuid language sql stable as $f$
  select id from fx where k = p_k;
$f$;

update public.profiles set active = true, approved = true where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';
insert into public.erp_employees (full_name, role, profile_id)
values ('Проба рабочий T1', 'worker', 'cc9ed453-d3d7-4add-a361-8719a7701f97');

insert into public.erp_orders (title) values ('PROBE T1 заказ');
insert into fx values ('order', (select id from public.erp_orders where title = 'PROBE T1 заказ'));

insert into public.erp_biz_tasks (order_id, title, kind, assignee_id, creator_id, due_at)
values (pg_temp.fx('order'), 'PROBE T1 задача', 'delivery',
        'cc9ed453-d3d7-4add-a361-8719a7701f97', '56ec3039-f326-42dd-b4de-870844b9468d', now() + interval '2 days');
insert into fx values ('task', (select id from public.erp_biz_tasks where title = 'PROBE T1 задача'));

-- Заказы v4: подлинный запуск (метка DIRECTOR свежая), чужая метка, старая метка
insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date,
                           launch_by, launch_started_at)
values
  ('00000000-0000-4000-8000-0000b1000001', 'PROBE-T1-1', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82',
   '{}', 'Клиент', current_date + 10, '56ec3039-f326-42dd-b4de-870844b9468d', now()),
  ('00000000-0000-4000-8000-0000b1000002', 'PROBE-T1-2', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82',
   '{}', 'Клиент', current_date + 10, '9285888e-4401-4b1b-b523-a3e6a9b90e82', now()),
  ('00000000-0000-4000-8000-0000b1000003', 'PROBE-T1-3', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82',
   '{}', 'Клиент', current_date + 10, '56ec3039-f326-42dd-b4de-870844b9468d', now() - interval '11 minutes');

-- ── Суперпользователь: ограничения схемы ─────────────────────────────────
select pg_temp.p('thread_no_anchor', '23514', $q$insert into public.erp_chat_threads (order_id) values (null)$q$);
select pg_temp.p('thread_two_anchors', '23514', format($q$insert into public.erp_chat_threads (order_id, task_id) values (%L, %L)$q$,
  pg_temp.fx('order'), pg_temp.fx('task')));
select pg_temp.p('thread_task', 'OK rows=1', format($q$insert into public.erp_chat_threads (task_id) values (%L)$q$, pg_temp.fx('task')));
select pg_temp.p('thread_task_twice', '23505', format($q$insert into public.erp_chat_threads (task_id) values (%L)$q$, pg_temp.fx('task')));
select pg_temp.p('task_bad_kind', '23514', format($q$update public.erp_biz_tasks set kind = 'meeting' where id = %L$q$, pg_temp.fx('task')));
select pg_temp.p('task_bad_status', '23514', format($q$update public.erp_biz_tasks set status = 'overdue' where id = %L$q$, pg_temp.fx('task')));
select pg_temp.p('due_soon_once', 'OK rows=1', format($q$insert into public.erp_biz_task_events (task_id, kind, due_at) values (%L, 'due_soon', '2026-10-20 15:00+00')$q$, pg_temp.fx('task')));
select pg_temp.p('due_soon_twice', '23505', format($q$insert into public.erp_biz_task_events (task_id, kind, due_at) values (%L, 'due_soon', '2026-10-20 15:00+00')$q$, pg_temp.fx('task')));
select pg_temp.p('notify_task_kind', 'OK rows=1', format($q$insert into public.erp_notifications (user_id, kind, title, task_id) values ('cc9ed453-d3d7-4add-a361-8719a7701f97', 'task_assigned', 'PROBE', %L)$q$, pg_temp.fx('task')));
select pg_temp.p('notify_bad_kind', '23514', $q$insert into public.erp_notifications (user_id, kind, title) values ('cc9ed453-d3d7-4add-a361-8719a7701f97', 'task_foo', 'PROBE')$q$);
select pg_temp.p('publication', 'OK 2', $q$select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('erp_biz_tasks', 'erp_biz_task_events')$q$);
select pg_temp.p('permission_seed', 'OK director,manager,production_head', $q$select string_agg(role, ',' order by role) from public.erp_role_permissions where permission = 'biz_task.manage' and allowed$q$);

-- ── WORKER: читает, но не пишет ──────────────────────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;

select pg_temp.p('w_read', 'OK 1', format($q$select count(*)::text from public.erp_biz_tasks where id = %L$q$, pg_temp.fx('task')));
select pg_temp.p('w_insert_task', '42501', format($q$insert into public.erp_biz_tasks (order_id, title, kind, assignee_id, creator_id, due_at) values (%L, 'x', 'other', 'cc9ed453-d3d7-4add-a361-8719a7701f97', 'cc9ed453-d3d7-4add-a361-8719a7701f97', now())$q$, pg_temp.fx('order')));
select pg_temp.p('w_update_task', '42501', format($q$update public.erp_biz_tasks set status = 'done' where id = %L$q$, pg_temp.fx('task')));
select pg_temp.p('w_delete_task', '42501', format($q$delete from public.erp_biz_tasks where id = %L$q$, pg_temp.fx('task')));
select pg_temp.p('w_insert_watcher', '42501', format($q$insert into public.erp_biz_task_watchers (task_id, user_id) values (%L, 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$, pg_temp.fx('task')));
select pg_temp.p('w_insert_checklist', '42501', format($q$insert into public.erp_biz_task_checklist (task_id, text) values (%L, 'x')$q$, pg_temp.fx('task')));
select pg_temp.p('w_insert_event', '42501', format($q$insert into public.erp_biz_task_events (task_id, kind) values (%L, 'completed')$q$, pg_temp.fx('task')));
select pg_temp.p('w_insert_seen', '42501', format($q$insert into public.erp_biz_task_seen (task_id, user_id) values (%L, 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$, pg_temp.fx('task')));
select pg_temp.p('w_attach_kind', '42501', format($q$insert into public.erp_order_attachments (order_id, file_path, kind) values (%L, 'att/x/biz_task/a.pdf', 'biz_task')$q$, pg_temp.fx('order')));
select pg_temp.p('w_attach_link', '42501', format($q$insert into public.erp_order_attachments (order_id, file_path, kind, biz_task_id) values (%L, 'att/x/a.pdf', 'attachment', %L)$q$, pg_temp.fx('order'), pg_temp.fx('task')));
select pg_temp.p('w_attach_plain', 'OK rows=1', format($q$insert into public.erp_order_attachments (order_id, file_path, kind) values (%L, 'att/x/plain.pdf', 'attachment')$q$, pg_temp.fx('order')));
select pg_temp.p('w_manager_id', '42501', format($q$update public.erp_orders set manager_id = 'cc9ed453-d3d7-4add-a361-8719a7701f97' where id = %L$q$, pg_temp.fx('order')));
-- Прямой INSERT мимо erp_create_order (ревизия безопасности 19.10): страж
-- стоит и на INSERT — себя менеджером не назначить, подлинный запуск не подделать
select pg_temp.p('w_insert_manager_self', '42501', $q$insert into public.erp_orders (title, manager_id) values ('PROBE T1 сам себе менеджер', 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$);
select pg_temp.p('w_insert_forged_launch', '42501', $q$insert into public.erp_orders (title, tz_order_id, manager_id) values ('PROBE T1 чужой запуск', '00000000-0000-4000-8000-0000b1000001', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);

-- ── DIRECTOR запускает: менеджер — только при подлинном запуске ──────────
reset role;
-- Запуск и чтение — РАЗНЫМИ операторами (`pg_temp.launch_manager`): в одном
-- операторе снимок не видит строку, которую вставила вызванная в нём функция, и
-- «OK null» выходил бы и без строки; а `where id = f()` ещё и звал f() на каждую
-- строку erp_orders (на бою — дубль tz_order_id). Нет строки — «нет строки»
create function pg_temp.launch_manager(p_payload jsonb) returns text language plpgsql as $f$
declare v_id uuid; v_m uuid;
begin
  v_id := public.erp_create_order(p_payload);
  select manager_id into v_m from public.erp_orders where id = v_id;
  if not found then return 'нет строки'; end if;
  return coalesce(v_m::text, 'null');
end;
$f$;
select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;

select pg_temp.p('launch_authentic', 'OK 9285888e-4401-4b1b-b523-a3e6a9b90e82', $q$select pg_temp.launch_manager(jsonb_build_object('order', jsonb_build_object('title', 'PROBE T1 запуск', 'tz_order_id', '00000000-0000-4000-8000-0000b1000001', 'manager_id', 'cc9ed453-d3d7-4add-a361-8719a7701f97')))$q$);
select pg_temp.p('launch_erp_only', 'OK null', $q$select pg_temp.launch_manager(jsonb_build_object('order', jsonb_build_object('title', 'PROBE T1 из ERP', 'manager_id', 'cc9ed453-d3d7-4add-a361-8719a7701f97')))$q$);
select pg_temp.p('launch_foreign_mark', 'OK null', $q$select pg_temp.launch_manager(jsonb_build_object('order', jsonb_build_object('title', 'PROBE T1 чужая метка', 'tz_order_id', '00000000-0000-4000-8000-0000b1000002')))$q$);
select pg_temp.p('launch_stale_mark', 'OK null', $q$select pg_temp.launch_manager(jsonb_build_object('order', jsonb_build_object('title', 'PROBE T1 старая метка', 'tz_order_id', '00000000-0000-4000-8000-0000b1000003')))$q$);

-- Менеджер заказа в карточке — только сотрудник ERP (страж, Р3): рабочий
-- с активной карточкой ставится, снятая карточка — 22023, снять (NULL) можно
select pg_temp.p('d_manager_staff', 'OK rows=1', format($q$update public.erp_orders set manager_id = 'cc9ed453-d3d7-4add-a361-8719a7701f97' where id = %L$q$, pg_temp.fx('order')));
select pg_temp.p('d_manager_clear', 'OK rows=1', format($q$update public.erp_orders set manager_id = null where id = %L$q$, pg_temp.fx('order')));
select pg_temp.p('d_insert_staff', 'OK rows=1', $q$insert into public.erp_orders (title, manager_id) values ('PROBE T1 прямая вставка', 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$);
reset role;
select pg_temp.as_user(null);
update public.erp_employees set active = false where full_name = 'Проба рабочий T1';
select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('d_manager_no_card', '22023', format($q$update public.erp_orders set manager_id = 'cc9ed453-d3d7-4add-a361-8719a7701f97' where id = %L$q$, pg_temp.fx('order')));
select pg_temp.p('d_insert_no_card', '22023', $q$insert into public.erp_orders (title, manager_id) values ('PROBE T1 без карточки', 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$);
reset role;
select pg_temp.as_user(null);

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
