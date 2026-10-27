-- Пробы миграции P вехи 5в (20261026090000_order_templates_layouts): «Мои раскладки»
-- в `order_templates` — права таблицы, CHECK имени и данных, политики «свои + продажи».
-- До применения P — только сухим прогоном вместе с ней: supabase/rollout/m5c/1-dryrun-P.sql.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=23 {…}
--
-- Роли — профили боя (как в order_v4_rights.sql):
--   SELLER  9285888e-4401-4b1b-b523-a3e6a9b90e82  внутри транзакции is_sales = true
--   SELLER2 e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  внутри транзакции без признаков (не продажи)
--   ADMIN   b9c3e42e-9e07-44c2-8b15-839ce327c40c  profiles.role = admin (руководство продаж)

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
update public.profiles set is_sales = true, is_ms = false where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set is_sales = false, is_ms = false where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
insert into public.order_templates (id, name, created_by, data) values
  ('00000000-0000-4000-8000-0000000000f2', 'Чужая', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}');

-- ── SELLER: свои раскладки ───────────────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('tp_insert', 'OK rows=1', $q$insert into public.order_templates (id, name, created_by, data) values ('00000000-0000-4000-8000-0000000000f1', 'Грудь и спина', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_select_own', 'OK 1', $q$select count(*)::text from public.order_templates$q$);
select pg_temp.p('tp_insert_other_author', '42501', $q$insert into public.order_templates (name, created_by, data) values ('Подлог', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_insert_no_author', '42501', $q$insert into public.order_templates (name, data) values ('Без автора', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_name_empty', '23514', $q$insert into public.order_templates (name, created_by, data) values ('', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_name_61', '23514', $q$insert into public.order_templates (name, created_by, data) values (repeat('я', 61), '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_name_60', 'OK rows=1', $q$insert into public.order_templates (name, created_by, data) values (repeat('я', 60), '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_name_spaces', '23514', $q$insert into public.order_templates (name, created_by, data) values (' Грудь ', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
select pg_temp.p('tp_kind', '23514', $q$insert into public.order_templates (name, created_by, data) values ('Шаблон v3', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"items": []}')$q$);
select pg_temp.p('tp_no_v', '23514', $q$insert into public.order_templates (name, created_by, data) values ('Без версии', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "prints": [{}]}')$q$);
select pg_temp.p('tp_no_prints', '23514', $q$insert into public.order_templates (name, created_by, data) values ('Без нанесений', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1}')$q$);
select pg_temp.p('tp_v2', '23514', $q$insert into public.order_templates (name, created_by, data) values ('v2', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 2, "prints": [{}]}')$q$);
select pg_temp.p('tp_empty_prints', '23514', $q$insert into public.order_templates (name, created_by, data) values ('Пусто', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{"kind": "layout", "v": 1, "prints": []}')$q$);
select pg_temp.p('tp_21_prints', '23514', $q$insert into public.order_templates (name, created_by, data) select 'Много', '9285888e-4401-4b1b-b523-a3e6a9b90e82', jsonb_build_object('kind', 'layout', 'v', 1, 'prints', jsonb_agg(jsonb_build_object('view', 'front'))) from generate_series(1, 21)$q$);
select pg_temp.p('tp_too_big', '23514', $q$insert into public.order_templates (name, created_by, data) values ('Огромная', '9285888e-4401-4b1b-b523-a3e6a9b90e82', jsonb_build_object('kind', 'layout', 'v', 1, 'prints', (select jsonb_agg(jsonb_build_object('view', 'front', 'pad', md5(i::text))) from generate_series(1, 10) i) || (select jsonb_build_array(jsonb_build_object('pad', string_agg(md5(i::text), ''))) from generate_series(1, 600) i)))$q$);
select pg_temp.p('tp_update', '42501', $q$update public.order_templates set name = 'Другое' where id = '00000000-0000-4000-8000-0000000000f1'$q$);
select pg_temp.p('tp_truncate', '42501', $q$truncate public.order_templates$q$);
select pg_temp.p('tp_delete_foreign', 'OK rows=0', $q$delete from public.order_templates where id = '00000000-0000-4000-8000-0000000000f2'$q$);
select pg_temp.p('tp_delete_own', 'OK rows=1', $q$delete from public.order_templates where id = '00000000-0000-4000-8000-0000000000f1'$q$);
reset role;

-- ── SELLER2: не продажи — ни своих не видит, ни новых не пишет ──────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('tp_nonsales_select', 'OK 0', $q$select count(*)::text from public.order_templates$q$);
select pg_temp.p('tp_nonsales_insert', '42501', $q$insert into public.order_templates (name, created_by, data) values ('Моя', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
reset role;

-- ── anon: таблица закрыта ────────────────────────────────────────────────
select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('tp_anon_select', '42501', $q$select count(*)::text from public.order_templates$q$);
reset role;

-- ── ADMIN: руководство продаж пишет свои ─────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('tp_admin_insert', 'OK rows=1', $q$insert into public.order_templates (name, created_by, data) values ('Админа', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c', '{"kind": "layout", "v": 1, "flat_id": "tshirt-freefit", "prints": [{"view": "front", "area_id": "chest", "zone_id": "front", "method": "dtf", "width_mm": 250, "down_mm": 80, "dx_mm": 0, "rotation_deg": 0}]}')$q$);
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
