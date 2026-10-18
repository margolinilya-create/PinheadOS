-- Пробы после отката функций K (3-rollback-K-functions.sql): ревизия 3 снова принимается,
-- ответ без notes, колонка zone_id и её CHECK остаются, запись v3 закрыта (L).
-- Собираются в supabase/rollout/m8/build.mjs (4-dryrun-rollback-*). Слов, на которых MCP ждёт
-- подтверждения, в исполняемом тексте нет. Заказы — суперпользователем с явным order_number.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=6 {…}

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
insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values ('00000000-0000-4000-8000-000000000061', 'PROBE-61', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);
insert into public.order_items (id, order_id) values
  ('00000000-0000-4000-8000-000000000b61', '00000000-0000-4000-8000-000000000061');
select pg_temp.p('rk_column_kept', 'OK true', $q$select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_item_prints' and column_name = 'zone_id')::text$q$);

-- ── SELLER: ревизия 3 снова принимается, ответ без notes, v3 закрыт (L) ──
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('rk_rev3', 'OK {"id": "00000000-0000-4000-8000-000000000061"', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000061", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000b61", "prints": [{"method": "dtf"}]}]}'::jsonb)::text$q$);
select pg_temp.p('rk_zone_check_kept', '23514', $q$update public.order_item_prints set zone_id = 'Спина' where item_id = '00000000-0000-4000-8000-000000000b61'$q$);
select pg_temp.p('rk_no_notes_answer', 'OK false', $q$select (public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000061", "client_rev": 4, "notes": "x", "items": [{"key": "00000000-0000-4000-8000-000000000b61"}]}'::jsonb) ? 'notes')::text$q$);
select pg_temp.p('rk_notes_untouched', 'OK -', $q$select coalesce(notes, '-') from public.orders where id = '00000000-0000-4000-8000-000000000061'$q$);
select pg_temp.p('rk_v3_closed', '42501 Старые заказы (v3) только для чтения', $q$insert into public.orders (order_number, created_by, data) values ('PROBE-62', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}')$q$);
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

-- Сюда исполнение не доходит: исключение выше откатывает всё. Строка — для клиента,
-- который продолжает после ошибки (psql без ON_ERROR_STOP).
rollback;
