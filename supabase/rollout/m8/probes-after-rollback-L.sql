-- Пробы после отката L (3-rollback-L.sql): клиент снова пишет v3, `notes` — поле черновика,
-- CHECK длины на месте, журнал признаков выключен и закрыт, order_comments закрыта.
-- Собираются в supabase/rollout/m8/build.mjs (4-dryrun-rollback-*). Слов, на которых MCP ждёт
-- подтверждения, в исполняемом тексте нет. Заказы — суперпользователем с явным order_number.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=13 {…}

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

-- ── Данные (суперпользователь) ───────────────────────────────────────────
select pg_temp.as_user(null);
update public.profiles set is_sales = true, is_ms = false
 where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set is_sales = false, is_ms = false
 where id = '05bbc552-bca2-490d-b275-46a3084dca7c';
insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-000000000052', 'PROBE-52', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000000000053', 'PROBE-53', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);
select pg_temp.p('rl_guard_body', 'OK false', $q$select (prosrc ~ 'Старые заказы')::text from pg_proc where oid = to_regprocedure('public.order_v4_guard()')$q$);
select pg_temp.p('rl_guard_notes', 'OK true', $q$select (prosrc ~ '''notes''')::text from pg_proc where oid = to_regprocedure('public.order_v4_guard()')$q$);

-- ── SELLER: v3 снова пишется клиентом, notes — поле черновика ────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('rl_v3_insert', 'OK rows=1', $q$insert into public.orders (id, order_number, created_by, data) values ('00000000-0000-4000-8000-000000000051', 'PROBE-51', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
select pg_temp.p('rl_v3_update', 'OK rows=1', $q$update public.orders set data = '{"x":1}' where id = '00000000-0000-4000-8000-000000000051'$q$);
select pg_temp.p('rl_notes_draft', 'OK rows=1', $q$update public.orders set notes = 'Для цехов' where id = '00000000-0000-4000-8000-000000000052'$q$);
select pg_temp.p('rl_notes_2001', '23514', $q$update public.orders set notes = repeat('я', 2001) where id = '00000000-0000-4000-8000-000000000052'$q$);
select pg_temp.p('rl_notes_sent', '42501 Заказ отправлен в работу', $q$update public.orders set notes = 'x' where id = '00000000-0000-4000-8000-000000000053'$q$);
select pg_temp.p('rl_events_read', '42501', $q$select count(*)::text from public.sales_staff_events$q$);
select pg_temp.p('rl_comments_read', '42501', $q$select count(*)::text from public.order_comments$q$);
reset role;

-- ── ADMIN: журнал выключен и закрыт ──────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('rl_set_staff', 'OK', $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', true)$q$);
select pg_temp.p('rl_admin_events_read', '42501', $q$select count(*)::text from public.sales_staff_events$q$);
reset role;
select pg_temp.as_user(null);
select pg_temp.p('rl_no_event', 'OK 0', $q$select count(*)::text from public.sales_staff_events where profile_id = '05bbc552-bca2-490d-b275-46a3084dca7c'$q$);
select pg_temp.p('rl_table_kept', 'OK true', $q$select (to_regclass('public.sales_staff_events') is not null)::text$q$);

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
