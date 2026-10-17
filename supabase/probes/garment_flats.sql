-- Пробы флэтов изделий: миграция H (…_garment_flats, веха 5а) — бакет
-- garment-flats (путь, чтение, запись, запрет UPDATE, нет DELETE), ключ
-- app_config.garmentFlats в catalog_put (только admin и director) и его форма
-- в catalog_value_check, регресс белого списка G, CHECK формы
-- order_item_prints.layout и order_items.flat_id, зоны штанов в zonesCatalog,
-- удаление перегрузки sales_set_staff(uuid, boolean).
-- До применения H на бою — только сухим прогоном вместе с ней в одной транзакции.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=121 {…}
--
-- Как запускать — supabase/probes/README.md. Коротко: вставить файл ЦЕЛИКОМ
-- в SQL Editor и выполнить, в тихое время. Файл сам открывает транзакцию,
-- последний DO бросает исключение 'PROBE_RESULT …' — откатывается всё:
-- заказ PROBE-G1, строки storage.objects, справочник garmentFlats, роли
-- профилей и временная политика tmp_probe_any_update (пробы x_broad_*:
-- restrictive держит и против широкой permissive).
--
-- Строки storage.objects вставляются НАПРЯМУЮ (минуя Storage API): так
-- проверяются ровно политики RLS. Удаление — с `storage.allow_delete_query`
-- = 'true' (иначе триггер боя `protect_objects_delete` отвечает 42501 ещё до
-- политик). ВНИМАНИЕ: в файле есть `delete` и `update` — MCP execute_sql ждёт
-- подтверждения; прогон — через SQL Editor владельцем.
--
-- Роли — существующие профили боя (17.10 на бою нет ни director, ни rop:
-- роль ставится внутри транзакции, откат вернёт):
--   ADMIN    b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin
--   DIRECTOR 8f8cf33f-69e2-4565-8527-2e77d8489917  admin → внутри транзакции director
--   ROP      e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  manager → внутри транзакции rop
--   SELLER   9285888e-4401-4b1b-b523-a3e6a9b90e82  manager, внутри транзакции is_sales = true
--   HEAD     05bbc552-bca2-490d-b275-46a3084dca7c  manager (ERP production_head), без продаж —
--            начальник цеха
--   MS       f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9  manager; внутри транзакции is_ms = true
--   PENDING  cc9ed453-d3d7-4add-a361-8719a7701f97  отключён и не одобрен; внутри
--            транзакции active = true, approved остаётся false
--   OFFADMIN 56ec3039-f326-42dd-b4de-870844b9468d  admin; внутри транзакции active = false
-- Заказ ff1 (SELLER, draft v4) с позицией — под пробы CHECK через order_v4_save_full.
-- Если профили выше на бою изменятся — пробы покажут FAIL, правьте шапку и данные.

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

-- Правильный справочник флэтов: один флэт, один вид, одна зона
create function pg_temp.fv() returns jsonb language sql immutable as $f$
  select $j${"version": 1, "flats": [{"id": "probe-tee", "version": 1, "active": true, "name": "Проба",
    "categories": ["tshirts"], "fits": ["regular"], "sku_codes": [],
    "views": [{"kind": "front", "svg_path": "flats/probe-tee/v1/front.svg", "scale_mm_per_unit": 1,
      "print_areas": [{"id": "chest", "name": "Грудь", "zone_id": "front",
        "polygon_mm": [[0, 0], [100, 0], [100, 100]], "methods": ["dtf", "silkscreen"], "default_method": "dtf"}]}]}]}$j$::jsonb;
$f$;

-- Текущее значение справочника (база для catalog_put)
create function pg_temp.cur(p_table text, p_key text) returns jsonb language plpgsql stable as $f$
declare v jsonb;
begin
  if p_table = 'app_config' then
    select value into v from public.app_config where key = p_key;
  else
    select value into v from public.catalog_config where key = p_key;
  end if;
  return v;
end;
$f$;

-- ── Данные (суперпользователь) ──────────────────────────────────────────
select pg_temp.as_user(null);
select set_config('storage.allow_delete_query', 'true', true);

update public.profiles set role = 'director' where id = '8f8cf33f-69e2-4565-8527-2e77d8489917';
update public.profiles set role = 'rop' where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
update public.profiles set is_sales = true where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set is_ms = true where id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';
update public.profiles set active = true where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';
update public.profiles set active = false where id = '56ec3039-f326-42dd-b4de-870844b9468d';

insert into public.orders (id, order_number, schema_version, status, created_by, data, customer, due_date)
values ('00000000-0000-4000-8000-000000000ff1', 'PROBE-G1', 4, 'draft', '9285888e-4401-4b1b-b523-a3e6a9b90e82', '{}', 'Клиент', current_date + 10);
insert into public.order_items (id, order_id) values
  ('00000000-0000-4000-8000-000000000ff2', '00000000-0000-4000-8000-000000000ff1');

-- Флэт, уже лежащий в бакете, и объект ERP администратора — под перенос внутрь
insert into storage.objects (bucket_id, name, owner) values
  ('garment-flats', 'flats/probe-tee/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c'),
  ('erp-attachments', 'att/probe-flat-in.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c');

-- ── Бакет, хелпер, политики, данные миграции (суперпользователь) ─────────
select pg_temp.p('bucket_private', 'OK false/1048576/image/svg+xml',
  $q$select public::text || '/' || file_size_limit || '/' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'garment-flats'$q$);
select pg_temp.p('path_ok', 'OK true', $q$select public.garment_flat_path_ok('flats/tshirt-freefit/v1/front.svg')::text$q$);
select pg_temp.p('path_back_v9999', 'OK true', $q$select public.garment_flat_path_ok('flats/a/v9999/back.svg')::text$q$);
select pg_temp.p('path_sleeve_left', 'OK true', $q$select public.garment_flat_path_ok('flats/a/v2/sleeve_left.svg')::text$q$);
select pg_temp.p('path_v10000', 'OK false', $q$select public.garment_flat_path_ok('flats/a/v10000/front.svg')::text$q$);
select pg_temp.p('path_v0', 'OK false', $q$select public.garment_flat_path_ok('flats/a/v0/front.svg')::text$q$);
select pg_temp.p('path_no_version', 'OK false', $q$select public.garment_flat_path_ok('flats/a/front.svg')::text$q$);
select pg_temp.p('path_cyrillic', 'OK false', $q$select public.garment_flat_path_ok('flats/футболка/v1/front.svg')::text$q$);
select pg_temp.p('path_dotdot', 'OK false', $q$select public.garment_flat_path_ok('flats/../v1/front.svg')::text$q$);
select pg_temp.p('path_png', 'OK false', $q$select public.garment_flat_path_ok('flats/a/v1/front.png')::text$q$);
select pg_temp.p('path_upper', 'OK false', $q$select public.garment_flat_path_ok('flats/Tee/v1/front.svg')::text$q$);
select pg_temp.p('path_newline', 'OK false', $q$select public.garment_flat_path_ok(E'flats/a/v1/front.svg\n')::text$q$);
select pg_temp.p('path_sleeve', 'OK false', $q$select public.garment_flat_path_ok('flats/a/v1/sleeve.svg')::text$q$);
select pg_temp.p('path_prefix', 'OK false', $q$select public.garment_flat_path_ok('x/flats/a/v1/front.svg')::text$q$);
select pg_temp.p('path_null', 'OK false', $q$select public.garment_flat_path_ok(null)::text$q$);
select pg_temp.p('path_volatility', 'OK i', $q$select provolatile::text from pg_proc where oid = 'public.garment_flat_path_ok(text)'::regprocedure$q$);
select pg_temp.p('path_anon', 'OK false', $q$select has_function_privilege('anon', 'public.garment_flat_path_ok(text)', 'execute')::text$q$);
select pg_temp.p('path_auth', 'OK true', $q$select has_function_privilege('authenticated', 'public.garment_flat_path_ok(text)', 'execute')::text$q$);
select pg_temp.p('policies', 'OK garment_flats_insert:INSERT:PERMISSIVE,garment_flats_no_update:UPDATE:RESTRICTIVE,garment_flats_select:SELECT:PERMISSIVE',
  $q$select string_agg(policyname || ':' || cmd || ':' || permissive, ',' order by policyname) from pg_policies where schemaname = 'storage' and policyname like 'garment_flats_%'$q$);
select pg_temp.p('no_update_expr', 'OK (bucket_id <> ''garment-flats''::text)|(bucket_id <> ''garment-flats''::text)',
  $q$select qual || '|' || with_check from pg_policies where schemaname = 'storage' and policyname = 'garment_flats_no_update'$q$);
select pg_temp.p('zones_pants', 'OK pants-back:Штанина зад,pants-front:Штанина перед',
  $q$select string_agg((z->>'id') || ':' || (z->>'name'), ',' order by z->>'id') from public.app_config c, jsonb_array_elements(c.value) z where c.key = 'zonesCatalog' and z->>'id' like 'pants-%'$q$);
select pg_temp.p('zones_ids_unique', 'OK true',
  $q$select (count(*) = count(distinct z->>'id'))::text from public.app_config c, jsonb_array_elements(c.value) z where c.key = 'zonesCatalog'$q$);
select pg_temp.p('old_set_staff_gone', 'OK true', $q$select (to_regprocedure('public.sales_set_staff(uuid, boolean)') is null)::text$q$);
select pg_temp.p('set_staff3_kept', 'OK true', $q$select (to_regprocedure('public.sales_set_staff(uuid, text, boolean)') is not null)::text$q$);
select pg_temp.p('flats_key_absent', 'OK 0', $q$select count(*)::text from public.app_config where key = 'garmentFlats'$q$);

-- ── ADMIN ────────────────────────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('admin_ins', 'OK rows=1',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_cyrillic_path', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/футболка/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_dotdot_path', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/../probe/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_png_path', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/v1/front.png', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_no_version', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_v0', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/v0/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_v10000', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/v10000/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_sleeve_kind', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-new/v1/sleeve.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_newline', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', E'flats/probe-new/v1/back.svg\n', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('admin_upper', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/Probe-new/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
-- upsert (Storage `upsert: true`) = insert … on conflict do update: UPDATE запрещён.
-- С 17.10 у storage.objects версии: уникальность — частичный индекс (bucket_id, name collate "C") where archived_at is null
select pg_temp.p('admin_upsert', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-tee/v1/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c') on conflict (bucket_id, name collate "C") where archived_at is null do update set metadata = '{"x":1}'$q$);
select pg_temp.p('admin_update_meta', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('admin_rename', 'OK rows=0',
  $q$update storage.objects set name = 'flats/probe-tee/v2/front.svg' where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('admin_move_out', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'erp-attachments', name = 'att/probe-out.svg' where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
-- перенос ИЗ erp-attachments (erp_att_update пускает админа) — WITH CHECK restrictive
select pg_temp.p('admin_move_in', '42501',
  $q$update storage.objects set bucket_id = 'garment-flats', name = 'flats/probe-in/v1/front.svg' where bucket_id = 'erp-attachments' and name = 'att/probe-flat-in.svg'$q$);
-- политики DELETE нет: версии неизменяемы (уборка — веха 5б)
select pg_temp.p('admin_delete', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('admin_sees', 'OK 2',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats' and name like 'flats/probe-%'$q$);
-- справочник: строки нет — база null
select pg_temp.p('admin_put_new', 'OK 2', $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), null)::text$q$);
select pg_temp.p('admin_put_effect', 'OK probe-tee', $q$select value->'flats'->0->>'id' from public.app_config where key = 'garmentFlats'$q$);
select pg_temp.p('admin_put_stale', 'P0001 Справочник изменён',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), '{"version": 1, "flats": []}'::jsonb)::text$q$);
select pg_temp.p('admin_put_again_null', 'P0001',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), null)::text$q$);
-- форма записи — 22023
select pg_temp.p('cp_not_object', '22023 Флэты: нужен объект',
  $q$select public.catalog_put('app_config', 'garmentFlats', '[]'::jsonb, pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_version2', '22023 Флэты: нужен объект',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{version}', '2'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_dup_id', '22023 Флэты: id повторяется',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats}', (pg_temp.fv()->'flats') || (pg_temp.fv()->'flats')), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_bad_id', '22023 Флэты: неверная запись — флэт Tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(jsonb_set(pg_temp.fv(), '{flats,0,id}', '"Tee"'), '{flats,0,views,0,svg_path}', '"flats/Tee/v1/front.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_foreign_svg_path', '22023 Флэты: неверная запись — вид probe-tee/front',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,svg_path}', '"flats/other/v1/front.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_dotdot_svg_path', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,svg_path}', '"flats/probe-tee/v1/../../x/v1/front.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_wrong_version_path', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,version}', '2'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_flat_version0', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(jsonb_set(pg_temp.fv(), '{flats,0,version}', '0'), '{flats,0,views,0,svg_path}', '"flats/probe-tee/v0/front.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_flat_version10000', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(jsonb_set(pg_temp.fv(), '{flats,0,version}', '10000'), '{flats,0,views,0,svg_path}', '"flats/probe-tee/v10000/front.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_flat_version_float', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,version}', '1.5'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_active_string', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,active}', '"true"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_name_long', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,name}', to_jsonb(repeat('я', 201))), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_sku_codes_number', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,sku_codes}', '[5]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_no_views', '22023 Флэты: неверная запись — флэт probe-tee',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views}', '[]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_bad_kind', '22023 Флэты: неверная запись — вид probe-tee/sleeve',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(jsonb_set(pg_temp.fv(), '{flats,0,views,0,kind}', '"sleeve"'), '{flats,0,views,0,svg_path}', '"flats/probe-tee/v1/sleeve.svg"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_dup_kind', '22023 Флэты: вид флэта повторяется',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views}', (pg_temp.fv()#>'{flats,0,views}') || (pg_temp.fv()#>'{flats,0,views}')), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_scale0', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,scale_mm_per_unit}', '0'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_scale11', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,scale_mm_per_unit}', '11'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_no_areas', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas}', '[]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_dup_area', '22023 Флэты: неверная запись — вид',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas}', (pg_temp.fv()#>'{flats,0,views,0,print_areas}') || (pg_temp.fv()#>'{flats,0,views,0,print_areas}')), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_polygon2', '22023 Флэты: неверная запись — зона probe-tee/front/chest',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,polygon_mm}', '[[0, 0], [1, 1]]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_polygon257', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,polygon_mm}', (select jsonb_agg(jsonb_build_array(g, g)) from generate_series(1, 257) g)), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_coord_far', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,polygon_mm}', '[[0, 0], [6000, 0], [0, 10]]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_coord_string', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,polygon_mm}', '[[0, 0], ["10", 0], [0, 10]]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_bad_method', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,methods}', '["screenprint"]'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_bad_default_method', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,default_method}', '"screenprint"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_zone_number', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,zone_id}', '5'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('cp_area_bad_id', '22023 Флэты: неверная запись — зона',
  $q$select public.catalog_put('app_config', 'garmentFlats', jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,id}', '"Грудь"'), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
-- правильная правка: zone_id null (этикетка), вид спины без методов
select pg_temp.p('admin_put_update', 'OK 2',
  $q$select public.catalog_put('app_config', 'garmentFlats',
       jsonb_set(jsonb_set(pg_temp.fv(), '{flats,0,views,0,print_areas,0,zone_id}', 'null'), '{flats,0,views}',
         (pg_temp.fv()#>'{flats,0,views}') || '[{"kind": "back", "svg_path": "flats/probe-tee/v1/back.svg", "scale_mm_per_unit": 0.5, "print_areas": [{"id": "back", "name": "Спина", "polygon_mm": [[0, 0], [10, 0], [10, 10], [0, 10]]}]}]'::jsonb),
       pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
-- регресс белого списка G: прежние пары как раньше
select pg_temp.p('admin_put_sku_catalog', 'OK 2',
  $q$select public.catalog_put('app_config', 'sku_catalog', pg_temp.cur('app_config', 'sku_catalog'), pg_temp.cur('app_config', 'sku_catalog'))::text$q$);
select pg_temp.p('admin_put_prices', '22023 Такого справочника нет',
  $q$select public.catalog_put('app_config', 'prices', '{}'::jsonb, pg_temp.cur('app_config', 'prices'))::text$q$);
select pg_temp.p('admin_put_flats_other_table', '22023 Такого справочника нет',
  $q$select public.catalog_put('catalog_config', 'garmentFlats', pg_temp.fv(), null)::text$q$);
reset role;

-- ── DIRECTOR ─────────────────────────────────────────────────────────────
select pg_temp.as_user('8f8cf33f-69e2-4565-8527-2e77d8489917');
set local role authenticated;
select pg_temp.p('director_ins', 'OK rows=1',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-dir/v1/back.svg', '8f8cf33f-69e2-4565-8527-2e77d8489917')$q$);
select pg_temp.p('director_put', 'OK 2',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
reset role;

-- ── ROP: справочники заказа — да, флэты — нет ────────────────────────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('rop_sees', 'OK 3',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats' and name like 'flats/probe-%'$q$);
select pg_temp.p('rop_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-rop/v1/front.svg', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26')$q$);
select pg_temp.p('rop_delete', 'OK rows=0',
  $q$delete from storage.objects where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('rop_put_flats', '42501 Каталог моделей и тканей',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('rop_put_suppliers', 'OK 2',
  $q$select public.catalog_put('catalog_config', 'suppliers', pg_temp.cur('catalog_config', 'suppliers'), pg_temp.cur('catalog_config', 'suppliers'))::text$q$);
select pg_temp.p('rop_put_labels', 'OK 2',
  $q$select public.catalog_put('app_config', 'labelLibrary', pg_temp.cur('app_config', 'labelLibrary'), pg_temp.cur('app_config', 'labelLibrary'))::text$q$);
select pg_temp.p('rop_put_zones', '42501 Каталог моделей и тканей',
  $q$select public.catalog_put('app_config', 'zonesCatalog', pg_temp.cur('app_config', 'zonesCatalog'), pg_temp.cur('app_config', 'zonesCatalog'))::text$q$);
select pg_temp.p('rop_direct_flats', 'OK rows=0',
  $q$update public.app_config set value = '{}'::jsonb where key = 'garmentFlats'$q$);
-- перегрузки (uuid, boolean) нет; трёхаргументная на месте
select pg_temp.p('rop_set_staff_old', '42883',
  $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', true)$q$);
select pg_temp.p('rop_set_staff3', 'OK',
  $q$select public.sales_set_staff('05bbc552-bca2-490d-b275-46a3084dca7c', 'sales', false)$q$);
reset role;

-- ── SELLER ───────────────────────────────────────────────────────────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('seller_sees', 'OK 3',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats' and name like 'flats/probe-%'$q$);
select pg_temp.p('seller_reads_flats_key', 'OK probe-tee',
  $q$select value->'flats'->0->>'id' from public.app_config where key = 'garmentFlats'$q$);
select pg_temp.p('seller_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-s/v1/front.svg', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
-- `copy` из другого бакета = INSERT в garment-flats — тот же отказ
select pg_temp.p('seller_copy_in', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-tee/v2/front.svg', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
select pg_temp.p('seller_update', 'OK rows=0',
  $q$update storage.objects set metadata = '{"x":1}' where bucket_id = 'garment-flats'$q$);
select pg_temp.p('seller_put_flats', '42501 Справочники меняет',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
select pg_temp.p('seller_set_staff_old', '42883',
  $q$select public.sales_set_staff('9285888e-4401-4b1b-b523-a3e6a9b90e82', false)$q$);
-- CHECK формы нанесения и флэта позиции — через сохранение заказа v4
select pg_temp.p('save_layout_array', '23514',
  $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000ff1", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000ff2", "prints": [{"method": "dtf", "layout": [1, 2]}]}]}'::jsonb)::text$q$);
select pg_temp.p('save_layout_v2', '23514',
  $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000ff1", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000ff2", "prints": [{"method": "dtf", "layout": {"v": 2}}]}]}'::jsonb)::text$q$);
select pg_temp.p('save_layout_big', '23514',
  $q$select public.order_v4_save_full(jsonb_build_object('id', '00000000-0000-4000-8000-000000000ff1', 'client_rev', 3,
       'items', jsonb_build_array(jsonb_build_object('key', '00000000-0000-4000-8000-000000000ff2',
         'prints', jsonb_build_array(jsonb_build_object('method', 'dtf', 'layout', jsonb_build_object('v', 1, 'pad', repeat('x', 8200))))))))::text$q$);
select pg_temp.p('save_flat_id_bad', '23514',
  $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000ff1", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000ff2", "flat_id": "../x"}]}'::jsonb)::text$q$);
select pg_temp.p('save_layout_ok', 'OK {"id": "00000000-0000-4000-8000-000000000ff1"',
  $q$select public.order_v4_save_full('{"id": "00000000-0000-4000-8000-000000000ff1", "client_rev": 3, "items": [{"key": "00000000-0000-4000-8000-000000000ff2", "flat_id": "tshirt-freefit", "prints": [{"method": "dtf", "zone": "Грудь (перед)", "layout": {"v": 1, "flat_id": "tshirt-freefit", "flat_version": 1, "view": "front"}}]}]}'::jsonb)::text$q$);
select pg_temp.p('save_layout_ok_effect', 'OK tshirt-freefit/1',
  $q$select i.flat_id || '/' || (p.layout->>'v') from public.order_items i join public.order_item_prints p on p.item_id = i.id where i.id = '00000000-0000-4000-8000-000000000ff2'$q$);
reset role;

-- ── MS, начальник цеха ───────────────────────────────────────────────────
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-ms/v1/front.svg', 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')$q$);
select pg_temp.p('ms_put_flats', '42501',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
reset role;
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('head_sees', 'OK 3',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats' and name like 'flats/probe-%'$q$);
select pg_temp.p('head_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-head/v1/front.svg', '05bbc552-bca2-490d-b275-46a3084dca7c')$q$);
reset role;

-- ── Неодобренный, отключённый admin, аноним ──────────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('pending_sees', 'OK 0',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats'$q$);
select pg_temp.p('pending_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-p/v1/front.svg', 'cc9ed453-d3d7-4add-a361-8719a7701f97')$q$);
select pg_temp.p('pending_flats_key', 'OK 0', $q$select count(*)::text from public.app_config where key = 'garmentFlats'$q$);
reset role;
select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('offadmin_sees', 'OK 0',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats'$q$);
select pg_temp.p('offadmin_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/probe-off/v1/front.svg', '56ec3039-f326-42dd-b4de-870844b9468d')$q$);
select pg_temp.p('offadmin_put', '42501',
  $q$select public.catalog_put('app_config', 'garmentFlats', pg_temp.fv(), pg_temp.cur('app_config', 'garmentFlats'))::text$q$);
reset role;
select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('anon_sees', 'OK 0',
  $q$select count(*)::text from storage.objects where bucket_id = 'garment-flats'$q$);
select pg_temp.p('anon_ins', '42501',
  $q$insert into storage.objects (bucket_id, name) values ('garment-flats', 'flats/probe-anon/v1/front.svg')$q$);
select pg_temp.p('anon_put', '42501',
  $q$select public.catalog_put('app_config', 'garmentFlats', '{}'::jsonb, null)::text$q$);
select pg_temp.p('anon_path_helper', '42501',
  $q$select public.garment_flat_path_ok('flats/a/v1/front.svg')::text$q$);
reset role;

-- ── Restrictive держит и против будущей широкой permissive ─────────────
select pg_temp.as_user(null);
create policy tmp_probe_any_update on storage.objects for update to authenticated using (true) with check (true);
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('x_broad_meta', 'OK rows=0',
  $q$update storage.objects set metadata = '{"y":1}' where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('x_broad_move_out', 'OK rows=0',
  $q$update storage.objects set bucket_id = 'sku-photos' where bucket_id = 'garment-flats' and name = 'flats/probe-tee/v1/front.svg'$q$);
select pg_temp.p('x_broad_move_in', '42501',
  $q$update storage.objects set bucket_id = 'garment-flats', name = 'flats/probe-in2/v1/front.svg' where bucket_id = 'erp-attachments' and name = 'att/probe-flat-in.svg'$q$);
select pg_temp.p('x_broad_other_ok', 'OK rows=1',
  $q$update storage.objects set metadata = '{"y":1}' where bucket_id = 'erp-attachments' and name = 'att/probe-flat-in.svg'$q$);
reset role;
select pg_temp.as_user(null);
drop policy tmp_probe_any_update on storage.objects;

do $$
declare
  v_names text[] := array_remove(string_to_array(current_setting('probe.names', true), ','), '');
  v_name text;
  v_fails int := 0;
  v_out jsonb := '{}'::jsonb;
  v_r text;
  v_e text;
begin
  foreach v_name in array v_names loop
    v_r := current_setting('probe.r.' || v_name, true);
    v_e := current_setting('probe.e.' || v_name, true);
    if v_r not like v_e || '%' then
      v_fails := v_fails + 1;
      v_out := v_out || jsonb_build_object('FAIL ' || v_name, jsonb_build_object('got', v_r, 'want', v_e));
    else
      v_out := v_out || jsonb_build_object(v_name, v_r);
    end if;
  end loop;
  raise exception 'PROBE_RESULT fails=% total=% %', v_fails, cardinality(v_names), v_out;
end;
$$;

-- Сюда исполнение не доходит: исключение выше откатывает всё. Строка — для клиента,
-- который продолжает после ошибки (psql без ON_ERROR_STOP).
rollback;
