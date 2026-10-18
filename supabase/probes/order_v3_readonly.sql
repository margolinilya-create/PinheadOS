-- Пробы миграции L вехи 8 (20261018150000_order_v3_readonly_staff_audit): заказ v3 клиенту
-- только для чтения, комментарий к заказу — поле черновика с потолком 2000 знаков,
-- `order_comments` закрыта, журнал смены признаков `sales_staff_events`.
-- До применения L — только сухим прогоном вместе с ней: supabase/rollout/m8/1-dryrun-L.sql.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=35 {…}
--
-- Файл годится для обёртки контроллера (MCP): в исполняемом тексте нет слов, на которых
-- MCP ждёт подтверждения. Поэтому удаление строки v3 клиентом (42501) и обнуление
-- parent_id у строки v3 действием FK проверяют пробы прав: supabase/probes/order_v4_rights.sql
-- (a_v3_remove, s_parent_deleted_v3) — их прогоняет владелец в SQL Editor.
-- Заказы вставляются только суперпользователем с явным order_number 'PROBE-…';
-- создание черновика RPC тратит номер, поэтому здесь — проверка текста вставки
-- `order_v4_save` (явная версия 4) и сохранение существующего черновика.
-- Роли — профили боя (как в order_v4_rights.sql):
--   SELLER 9285888e-4401-4b1b-b523-a3e6a9b90e82  внутри транзакции is_sales = true
--   ROP    22d22715-1487-480a-aea1-53a7bd52df2d  внутри транзакции role = 'rop'
--   HEAD   05bbc552-bca2-490d-b275-46a3084dca7c  без признаков; ему признаки ставит ROP и служебно
--   ADMIN  b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

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

-- ── Данные (суперпользователь, auth.uid() пуст — служебный доступ) ───────
select pg_temp.as_user(null);
update public.profiles set is_sales = true, is_ms = false
 where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set role = 'rop', is_sales = false, is_ms = false
 where id = '22d22715-1487-480a-aea1-53a7bd52df2d';
update public.profiles set is_sales = false, is_ms = false
 where id = '05bbc552-bca2-490d-b275-46a3084dca7c';

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-000000000031', 'PROBE-31', 3, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"x":1}', null, null),
  ('00000000-0000-4000-8000-000000000032', 'PROBE-32', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000000000033', 'PROBE-33', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);

-- ── Служебный доступ: v3 правится и вставляется как раньше ──────────────
select pg_temp.p('svc_v3_update', 'OK rows=1', $q$update public.orders set data = '{"x":2}' where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('svc_v3_insert', 'OK rows=1', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-34', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
-- служебная смена признака пишет событие без автора
select pg_temp.p('svc_flag', 'OK rows=1', $q$update public.profiles set is_ms = true where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('svc_event', 'OK ms/true/-/service', $q$select kind || '/' || on_value || '/' || coalesce(actor::text, '-') || '/' || source from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c' order by id desc limit 1$q$);
select pg_temp.p('svc_flag_same', 'OK rows=1', $q$update public.profiles set is_ms = true, name = name where id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('svc_event_once', 'OK 1', $q$select count(*)::text from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
-- вставка заказа RPC сохранения — с явной версией 4 (умолчание колонки 3 клиенту закрыто)
select pg_temp.p('svc_save_inserts_v4', 'OK true', $q$select (prosrc ~ 'into public\.orders \(schema_version, status, created_by, data\)\s+values \(4, ''draft''')::text from pg_proc where oid = to_regprocedure('public.order_v4_save(jsonb)')$q$);

-- ── ROP: руководство продаж ──────────────────────────────────────────────
select pg_temp.as_user('22d22715-1487-480a-aea1-53a7bd52df2d');
set local role authenticated;
select pg_temp.p('rop_v3_update', '42501 Старые заказы (v3) только для чтения', $q$update public.orders set data = '{"x":3}' where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('rop_v3_insert', '42501 Старые заказы (v3) только для чтения: новый заказ', $q$insert into public.orders (order_number, schema_version, created_by, data) values ('PROBE-35', 3, '22d22715-1487-480a-aea1-53a7bd52df2d', '{}')$q$);
select pg_temp.p('rop_set_sales', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', true)$q$);
select pg_temp.p('rop_event', 'OK sales/true/22d22715-1487-480a-aea1-53a7bd52df2d/rpc', $q$select kind || '/' || on_value || '/' || coalesce(actor::text, '-') || '/' || source from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c' order by id desc limit 1$q$);
select pg_temp.p('rop_set_same', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', true)$q$);
select pg_temp.p('rop_event_count', 'OK 2', $q$select count(*)::text from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('rop_unset_sales', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', false)$q$);
select pg_temp.p('rop_event_off', 'OK sales/false/rpc', $q$select kind || '/' || on_value || '/' || source from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c' order by id desc limit 1$q$);
select pg_temp.p('rop_events_write', '42501', $q$insert into public.sales_staff_events (profile_id, kind, on_value, source) values ('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', true, 'rpc')$q$);
reset role;

-- ── SELLER: автор v3 и черновика v4 ──────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('s_v3_sees', 'OK {"x": 2}', $q$select data::text from public.orders where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('s_v3_insert', '42501 Старые заказы (v3) только для чтения: новый заказ', $q$insert into public.orders (order_number, schema_version, created_by, data) values ('PROBE-36', 3, '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
select pg_temp.p('s_v3_insert_default', '42501 Старые заказы (v3) только для чтения: новый заказ', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-37', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
select pg_temp.p('s_v3_update', '42501 Старые заказы (v3) только для чтения', $q$update public.orders set data = '{"x":4}' where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('s_v3_to_v4', '42501', $q$update public.orders set schema_version = 4 where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('s_save_draft', 'OK {"id": "00000000-0000-4000-8000-000000000032"', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000032", "client_rev": 4, "title": "проба L", "customer": "Клиент"}'::jsonb)::text$q$);
-- notes — поле черновика: прямой PATCH автора через REST
select pg_temp.p('s_notes_draft', 'OK rows=1', $q$update public.orders set notes = 'Для цехов' where id = '00000000-0000-4000-8000-000000000032'$q$);
select pg_temp.p('s_notes_2000', 'OK rows=1', $q$update public.orders set notes = repeat('я', 2000) where id = '00000000-0000-4000-8000-000000000032'$q$);
select pg_temp.p('s_notes_2001', '23514', $q$update public.orders set notes = repeat('я', 2001) where id = '00000000-0000-4000-8000-000000000032'$q$);
select pg_temp.p('s_notes_sent', '42501 Заказ отправлен в работу', $q$update public.orders set notes = 'x' where id = '00000000-0000-4000-8000-000000000033'$q$);
select pg_temp.p('s_comments_read', '42501', $q$select count(*)::text from public.order_comments$q$);
select pg_temp.p('s_comments_write', '42501', $q$insert into public.order_comments (order_id, author_name, author_role, text) values ('00000000-0000-4000-8000-000000000032', 'x', 'manager', 'x')$q$);
select pg_temp.p('s_events_read', 'OK 0', $q$select count(*)::text from public.sales_staff_events$q$);
select pg_temp.p('s_events_write', '42501', $q$insert into public.sales_staff_events (profile_id, kind, on_value, source) values ('9285888e-4401-4b1b-b523-a3e6a9b90e82', 'sales', true, 'rpc')$q$);
select pg_temp.p('s_events_update', '42501', $q$update public.sales_staff_events set source = 'rpc'$q$);
reset role;

-- ── ADMIN ────────────────────────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_events_read', 'OK 3', $q$select count(*)::text from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('a_comments_read', '42501', $q$select count(*)::text from public.order_comments$q$);
select pg_temp.p('a_v3_update', '42501 Старые заказы (v3) только для чтения', $q$update public.orders set status = 'review' where id = '00000000-0000-4000-8000-000000000031'$q$);
select pg_temp.p('a_audit_fn_closed', '42501', $q$select public.profiles_sales_staff_audit()$q$);
reset role;

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

-- Сюда исполнение не доходит: исключение выше откатывает всё. Строка — для клиента,
-- который продолжает после ошибки (psql без ON_ERROR_STOP).
rollback;
