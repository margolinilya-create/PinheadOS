-- Пробы миграции K вехи 8 (20261018160000_order_v4_zone_notes): код зоны у нанесения
-- (`order_item_prints.zone_id`) и «Комментарий для цехов» (`orders.notes`) в сохранении
-- `order_v4_save_full`, ревизия клиента 4. Требует L (CHECK orders_notes_len, `notes` в стража).
-- До применения K — только сухим прогоном вместе с ней: supabase/rollout/m8/1-dryrun-K.sql.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=26 {…}
--
-- Файл годится для обёртки контроллера (MCP): в исполняемом тексте нет слов, на которых
-- MCP ждёт подтверждения. Заказы вставляются только суперпользователем с явным
-- order_number 'PROBE-…'. Роли — профили боя (как в order_v4_rights.sql):
--   SELLER  9285888e-4401-4b1b-b523-a3e6a9b90e82  внутри транзакции is_sales = true
--   SELLER2 e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  то же — чужой черновик ему не виден

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
 where id in ('9285888e-4401-4b1b-b523-a3e6a9b90e82', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values
  ('00000000-0000-4000-8000-000000000041', 'PROBE-41', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10),
  ('00000000-0000-4000-8000-000000000042', 'PROBE-42', 4, 'ready_to_launch', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);
insert into public.order_items (id, order_id) values
  ('00000000-0000-4000-8000-000000000b42', '00000000-0000-4000-8000-000000000042');
insert into public.order_item_prints (id, item_id, method) values
  ('00000000-0000-4000-8000-000000000c42', '00000000-0000-4000-8000-000000000b42', 'dtf');

-- ── SELLER: автор черновика ──────────────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
-- ревизия клиента: 3 — «Вышло обновление» до записи
select pg_temp.p('zn_rev3', 'P0001 Вышло обновление', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 3, "notes": "старая вкладка"}'::jsonb)$q$);
select pg_temp.p('zn_rev3_kept', 'OK -', $q$select coalesce(notes, '-') from public.orders where id = '00000000-0000-4000-8000-000000000041'$q$);
-- ревизия 4: zone_id нанесений двух позиций и комментарий; ответ несёт notes
select pg_temp.p('zn_save', 'OK {"id": "00000000-0000-4000-8000-000000000041", "notes": "Для цехов"', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "notes": "Для цехов", "items": [
    {"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone": "Грудь", "zone_id": "chest"}, {"method": "dtf", "zone": "Своя зона"}]},
    {"key": "00000000-0000-4000-8000-000000000b43", "prints": [{"method": "dtg", "zone": "Левый рукав", "zone_id": "sleeve-left"}]}]}'::jsonb)::text$q$);
select pg_temp.p('zn_save_effect', 'OK Для цехов/chest,-,sleeve-left', $q$select o.notes || '/' || string_agg(coalesce(p.zone_id, '-'), ',' order by i.sort_order, p.sort_order)
    from public.orders o join public.order_items i on i.order_id = o.id join public.order_item_prints p on p.item_id = i.id
   where o.id = '00000000-0000-4000-8000-000000000041' group by o.notes$q$);
select pg_temp.p('zn_updated_at', 'OK true', $q$with r as (select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "notes": "Для цехов", "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone": "Грудь", "zone_id": "chest"}]}]}'::jsonb) as v)
    select ((r.v->>'updated_at')::timestamptz = o.updated_at)::text from r, public.orders o where o.id = '00000000-0000-4000-8000-000000000041'$q$);
-- нет ключа notes — комментарий не трогается; пустая строка — очищает
select pg_temp.p('zn_no_key', 'OK {"id": "00000000-0000-4000-8000-000000000041", "notes": "Для цехов"', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone": "Грудь", "zone_id": "chest"}]}]}'::jsonb)::text$q$);
select pg_temp.p('zn_clear', 'OK {"id": "00000000-0000-4000-8000-000000000041", "notes": ""', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "notes": "", "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone": "Грудь", "zone_id": "chest"}]}]}'::jsonb)::text$q$);
select pg_temp.p('zn_clear_null', 'OK true', $q$select (notes is null)::text from public.orders where id = '00000000-0000-4000-8000-000000000041'$q$);
-- понятные отказы до записи: длина, тип, формат кода зоны
select pg_temp.p('zn_notes_2001', '22023 Комментарий для цехов', $q$select public.order_v4_save_full(jsonb_build_object('id', '00000000-0000-4000-8000-000000000041', 'client_rev', 4, 'notes', repeat('я', 2001)))$q$);
select pg_temp.p('zn_notes_2000', 'OK {"id"', $q$select public.order_v4_save_full(jsonb_build_object('id', '00000000-0000-4000-8000-000000000041', 'client_rev', 4, 'notes', repeat('я', 2000),
    'items', '[{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone": "Грудь", "zone_id": "chest"}]}]'::jsonb))::text$q$);
select pg_temp.p('zn_notes_number', '22023 Комментарий для цехов', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "notes": 5}'::jsonb)$q$);
select pg_temp.p('zn_bad_zone', '22023 Неверный код зоны нанесения', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone_id": "Грудь"}]}]}'::jsonb)$q$);
select pg_temp.p('zn_zone_64', '22023 Неверный код зоны нанесения', $q$select public.order_v4_save_full(jsonb_build_object('id', '00000000-0000-4000-8000-000000000041', 'client_rev', 4,
    'items', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000b41', 'prints', jsonb_build_array(jsonb_build_object('method', 'dtf', 'zone_id', 'a' || repeat('b', 63)))))))$q$);
select pg_temp.p('zn_zone_number', '22023 Неверный код зоны нанесения', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone_id": 5}]}]}'::jsonb)$q$);
select pg_temp.p('zn_refused_kept', 'OK 2000/chest', $q$select char_length(o.notes) || '/' || string_agg(coalesce(p.zone_id, '-'), ',')
    from public.orders o join public.order_items i on i.order_id = o.id join public.order_item_prints p on p.item_id = i.id
   where o.id = '00000000-0000-4000-8000-000000000041' group by o.notes$q$);
select pg_temp.p('zn_zone_63', 'OK {"id"', $q$select public.order_v4_save_full(jsonb_build_object('id', '00000000-0000-4000-8000-000000000041', 'client_rev', 4,
    'items', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000b41', 'prints', jsonb_build_array(jsonb_build_object('method', 'dtf', 'zone_id', 'a' || repeat('b', 62)))))))::text$q$);
-- прямая запись (REST): длину держит CHECK L, формат зоны — CHECK K, статус — страж строк
select pg_temp.p('zn_patch_notes_2001', '23514', $q$update public.orders set notes = repeat('я', 2001) where id = '00000000-0000-4000-8000-000000000041'$q$);
select pg_temp.p('zn_patch_zone_bad', '23514', $q$update public.order_item_prints set zone_id = 'Спина' where item_id = '00000000-0000-4000-8000-000000000b41'$q$);
select pg_temp.p('zn_patch_zone_ok', 'OK rows=1', $q$update public.order_item_prints set zone_id = 'back' where item_id = '00000000-0000-4000-8000-000000000b41'$q$);
select pg_temp.p('zn_sent', '42501 Заказ отправлен в работу', $q$update public.order_item_prints set zone_id = 'back' where id = '00000000-0000-4000-8000-000000000c42'$q$);
select pg_temp.p('zn_sent_save', '42501 Заказ отправлен в работу', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000042", "client_rev": 4, "notes": "x", "items": [{"key": "00000000-0000-4000-8000-000000000b42"}]}'::jsonb)$q$);
-- прямой вызов внутренней функции: порог прежний (3), новых полей она не знает —
-- zone_id нанесений своего черновика стирается (решение задачи 2, см. шапку K)
select pg_temp.p('zn_inner_rev3', 'OK {"id": "00000000-0000-4000-8000-000000000041"', $q$select public.order_v4_save('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000b41", "prints": [{"method": "dtf", "zone_id": "chest"}]}]}'::jsonb)::text$q$);
select pg_temp.p('zn_inner_no_zone', 'OK -', $q$select string_agg(coalesce(p.zone_id, '-'), ',') from public.order_item_prints p where p.item_id = '00000000-0000-4000-8000-000000000b41'$q$);
reset role;

-- ── SELLER2: чужой черновик ──────────────────────────────────────────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('zn_foreign', '42501 Заказ не найден или недоступен', $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000041", "client_rev": 4, "notes": "чужой"}'::jsonb)$q$);
select pg_temp.p('zn_foreign_patch', 'OK rows=0', $q$update public.orders set notes = 'чужой' where id = '00000000-0000-4000-8000-000000000041'$q$);
reset role;
select pg_temp.as_user(null);
select pg_temp.p('zn_column', 'OK text/YES', $q$select data_type || '/' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'order_item_prints' and column_name = 'zone_id'$q$);

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
