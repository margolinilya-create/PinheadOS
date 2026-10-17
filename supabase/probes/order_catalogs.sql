-- Пробы справочников заказа: миграция G (…_order_catalogs, веха 4) — RPC
-- catalog_put / prices_patch, права чтения (catalog_reader, catalog_price_reader)
-- и прямой записи (catalog_writer), гигиена привилегий anon, сиды.
-- До применения G на бою — только сухим прогоном вместе с ней в одной транзакции.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=93 {…}
--
-- Как запускать — supabase/probes/README.md. Коротко: вставить файл ЦЕЛИКОМ
-- в SQL Editor и выполнить, в тихое время. Файл сам открывает транзакцию,
-- а последний DO бросает исключение 'PROBE_RESULT …' — всё откатывается:
-- правки справочников, роли профилей, строка ERP-прайса PROBE-SKU.
--
-- Сверка «прежние ключи после G не изменились» (`s_unchanged`) идёт по снимку
-- `pg_temp.g_before`, который сухой прогон (G-dryrun) делает ДО текста миграции.
-- Без снимка (прогон после применения) проба отвечает «same: снимка нет».
--
-- Роли — существующие профили боя (17.10 на бою нет ни director, ни rop:
-- роль ставится внутри транзакции, откат вернёт):
--   ADMIN    b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin
--   DIRECTOR 8f8cf33f-69e2-4565-8527-2e77d8489917  admin → внутри транзакции director
--   ROP      e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  manager → внутри транзакции rop
--   SELLER   9285888e-4401-4b1b-b523-a3e6a9b90e82  manager, внутри транзакции is_sales = true
--   HEAD     05bbc552-bca2-490d-b275-46a3084dca7c  manager (ERP production_head), без продаж —
--            начальник цеха
--   MS       f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9  manager; внутри транзакции МС по обоим
--            признакам: erp_employees.role = 'manager' и profiles.is_ms (если колонка
--            уже есть — миграция F), чтобы проба не зависела от порядка F и G
--   PENDING  cc9ed453-d3d7-4add-a361-8719a7701f97  отключён и не одобрен; внутри
--            транзакции active = true, approved остаётся false
--   OFFADMIN 56ec3039-f326-42dd-b4de-870844b9468d  admin; внутри транзакции active = false
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

-- Прежние ключи после G не изменились: снимок делает сухой прогон до миграции
create function pg_temp.unchanged() returns text language plpgsql as $f$
declare v text;
begin
  if to_regclass('pg_temp.g_before') is null then
    return 'same: снимка нет (прогон после применения G)';
  end if;
  execute $q$
    select case when count(*) = 0 then 'same' else 'DIFF ' || string_agg(b.t || '.' || b.key, ',') end
      from pg_temp.g_before b
      left join (select 'app_config' t, key, value from public.app_config
                 union all select 'catalog_config', key, value from public.catalog_config) a
        on a.t = b.t and a.key = b.key
     where a.key is null
        or md5(case when b.t = 'app_config' and b.key = 'prices' and jsonb_typeof(a.value) = 'object'
                    then (a.value - array(select k from unnest(array['packOptions', 'prepFees', 'minMarginPct', 'flexMatrix']) k
                                           where not coalesce(b.value ? k, false)))::text
                    else a.value::text end)
           <> md5(b.value::text)$q$ into v;
  return v;
end;
$f$;

-- ── Данные (суперпользователь) ──────────────────────────────────────────
select pg_temp.as_user(null);

update public.profiles set role = 'director' where id = '8f8cf33f-69e2-4565-8527-2e77d8489917';
update public.profiles set role = 'rop' where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
update public.profiles set is_sales = true where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set is_sales = false
 where id in ('05bbc552-bca2-490d-b275-46a3084dca7c', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26',
              'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c');
update public.profiles set active = true where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';
update public.profiles set active = false where id = '56ec3039-f326-42dd-b4de-870844b9468d';
update public.erp_employees set role = 'manager' where profile_id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_ms') then
    execute $u$update public.profiles set is_ms = (id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9')
                where id in ('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9', '05bbc552-bca2-490d-b275-46a3084dca7c',
                             '9285888e-4401-4b1b-b523-a3e6a9b90e82')$u$;
  end if;
end;
$$;

-- ── Сиды и неизменность прежних ключей (до любых правок) ─────────────────
select pg_temp.p('s_unchanged', 'OK same', $q$select pg_temp.unchanged()$q$);
select pg_temp.p('s_suppliers', 'OK 2/193/cottonprom',
  $q$select jsonb_array_length(value) || '/'
       || (select sum(jsonb_array_length(s->'palette'->'colors')) from jsonb_array_elements(value) s) || '/'
       || (select s->>'id' from jsonb_array_elements(value) s where (s->>'isDefault')::boolean)
     from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('s_labels', 'OK 8/2', $q$select jsonb_array_length(value->'kinds') || '/' || jsonb_array_length(value->'schemes') from public.app_config where key = 'labelLibrary'$q$);
select pg_temp.p('s_tz', 'OK Допуск по размещению нанесения — до 2 см', $q$select value->>'footerText' from public.app_config where key = 'tzSettings'$q$);
select pg_temp.p('s_prices', 'OK none,bopp,zip,other/{}/null',
  $q$select (select string_agg(o->>'key', ',') from jsonb_array_elements(value->'packOptions') o) || '/'
       || (value->'prepFees')::text || '/' || (value->'minMarginPct')::text
     from public.app_config where key = 'prices'$q$);
-- Матрица флекса засеяна (= FLEX_MATRIX кода): 4 формата, у A4 1 цв. — 750/316/270/227
select pg_temp.p('s_flex', 'OK 4/[750, 316, 270, 227]',
  $q$select (select count(*) from jsonb_object_keys(value->'flexMatrix')) || '/' || (value->'flexMatrix'->'A4'->'1')::text
     from public.app_config where key = 'prices'$q$);
select pg_temp.p('s_keys_unique', 'OK 0', $q$select count(*)::text from public.app_config a join public.catalog_config c using (key) where key <> 'prices'$q$);

-- ── Чтение ──────────────────────────────────────────────────────────────
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('r_head_sku', 'OK 1', $q$select count(*)::text from public.app_config where key = 'sku_catalog'$q$);
select pg_temp.p('r_head_suppliers', 'OK 1', $q$select count(*)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('r_head_prices', 'OK 0', $q$select count(*)::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('r_head_cc_prices', 'OK 0', $q$select count(*)::text from public.catalog_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('r_seller_prices', 'OK 1', $q$select count(*)::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('r_seller_cc_prices', 'OK 0', $q$select count(*)::text from public.catalog_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('r_rop_prices', 'OK 1', $q$select count(*)::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('r_rop_cc_prices', 'OK 1', $q$select count(*)::text from public.catalog_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('r_ms_prices', 'OK 1', $q$select count(*)::text from public.app_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('r_admin_prices', 'OK 1', $q$select count(*)::text from public.app_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('r_pending_app', 'OK 0', $q$select count(*)::text from public.app_config$q$);
select pg_temp.p('r_pending_cc', 'OK 0', $q$select count(*)::text from public.catalog_config$q$);
reset role;

select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('r_offadmin_app', 'OK 0', $q$select count(*)::text from public.app_config$q$);
reset role;

select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('anon_app', '42501 permission denied', $q$select count(*)::text from public.app_config$q$);
select pg_temp.p('anon_cc', '42501 permission denied', $q$select count(*)::text from public.catalog_config$q$);
select pg_temp.p('anon_put', '42501 permission denied', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', null)::text$q$);
select pg_temp.p('anon_patch', '42501 permission denied', $q$select public.prices_patch('{"minMarginPct":1}', '{"minMarginPct":null}')::text$q$);
reset role;

select pg_temp.p('priv_auth_truncate', 'OK false', $q$select has_table_privilege('authenticated', 'public.app_config', 'TRUNCATE')::text$q$);
select pg_temp.p('priv_auth_trigger', 'OK false', $q$select has_table_privilege('authenticated', 'public.catalog_config', 'TRIGGER')::text$q$);

-- ── Гонка с ERP: снимок прайс-каталога до записи из ERP ──────────────────
select set_config('probe.sku_base', (select value::text from public.app_config where key = 'sku_catalog'), true);

-- ── catalog_put: кто пишет ───────────────────────────────────────────────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('w_admin_tz', 'OK 2', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Проба A","n":1}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
-- другой порядок ключей и 1.0 вместо 1 — та же база
select pg_temp.p('w_base_reordered', 'OK 2', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Проба B"}', '{"n": 1.0, "footerText": "Проба A"}')::text$q$);
select pg_temp.p('w_conflict', 'P0001 Справочник изменён — загрузите свежую версию', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Проба C"}', '{"footerText":"Проба A","n":1}')::text$q$);
select pg_temp.p('w_null_base_exists', 'P0001 Справочник изменён', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Проба C"}', null)::text$q$);
select pg_temp.p('w_admin_zones', 'OK 2', $q$select public.catalog_put('app_config', 'zonesCatalog', '[{"id":"probe"}]', (select value from public.app_config where key = 'zonesCatalog'))::text$q$);
select pg_temp.p('w_admin_trim', 'OK 2', $q$select public.catalog_put('catalog_config', 'trimCatalog', '[]', (select value from public.catalog_config where key = 'trimCatalog'))::text$q$);
select pg_temp.p('w_admin_updated_by', 'OK b9c3e42e-9e07-44c2-8b15-839ce327c40c', $q$select updated_by::text from public.catalog_config where key = 'trimCatalog'$q$);
-- Белый список: прайс, флаги, старые ключи, регистр, чужая таблица
select pg_temp.p('w_pair_prices', '22023 Такого справочника нет', $q$select public.catalog_put('app_config', 'prices', '{}', null)::text$q$);
select pg_temp.p('w_pair_flags', '22023 Такого справочника нет', $q$select public.catalog_put('app_config', 'feature_flags', '{}', null)::text$q$);
select pg_temp.p('w_pair_cc_prices', '22023 Такого справочника нет', $q$select public.catalog_put('catalog_config', 'prices', '{}', null)::text$q$);
select pg_temp.p('w_pair_case', '22023 Такого справочника нет', $q$select public.catalog_put('App_config', 'sku_catalog', '[]', null)::text$q$);
select pg_temp.p('w_pair_profiles', '22023 Такого справочника нет', $q$select public.catalog_put('profiles', 'x', '{}', null)::text$q$);
select pg_temp.p('w_pair_null', '22023 Такого справочника нет', $q$select public.catalog_put(null, null, '{}', null)::text$q$);
-- Форма записи
select pg_temp.p('w_shape_hex_short', '22023 Палитра: неверная запись — цвет 01-01', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,palette,colors,0,hex}', '"#fff"'), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_shape_hex_inject', '22023 Палитра: неверная запись', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,palette,colors,0,hex}', to_jsonb('#ffffff" onload=alert(1)'::text)), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_shape_two_defaults', '22023 Палитра по умолчанию должна быть ровно одна', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,isDefault}', 'true'), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_shape_dup_code', '22023 Код цвета повторяется: 5001', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,palette,colors,0,code}', '"5001"'), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_shape_dup_code_trim', '22023 Код цвета повторяется: 5001', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,palette,colors,0,code}', '" 5001 "'), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_shape_tz_type', '22023 Подвал ТЗ', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":5}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
select pg_temp.p('w_shape_json_null', '22023 Пустой справочник', $q$select public.catalog_put('app_config', 'tzSettings', 'null', (select value from public.app_config where key = 'tzSettings'))::text$q$);
select pg_temp.p('w_shape_sql_null', '22023 Пустой справочник', $q$select public.catalog_put('app_config', 'tzSettings', null, (select value from public.app_config where key = 'tzSettings'))::text$q$);
select pg_temp.p('w_shape_sku_object', '22023 Справочник — список', $q$select public.catalog_put('app_config', 'sku_catalog', '{}', (select value from public.app_config where key = 'sku_catalog'))::text$q$);
select pg_temp.p('w_shape_label_price', '22023 Бирки: неверная запись — вид composition', $q$select public.catalog_put('app_config', 'labelLibrary',
  jsonb_set(value, '{kinds,1,variants,0,price}', '"10"'), value)::text from public.app_config where key = 'labelLibrary'$q$);
select pg_temp.p('w_shape_big', '22023 Справочник больше 1 МБ', $q$select public.catalog_put('app_config', 'tzSettings',
  jsonb_build_object('footerText', 'x', 'pad', repeat('x', 1100000)), (select value from public.app_config where key = 'tzSettings'))::text$q$);
-- Прямая запись активным админом остаётся (решение владельца)
select pg_temp.p('w_admin_direct', 'OK rows=1', $q$update public.app_config set value = value where key = 'feature_flags'$q$);
reset role;

-- Гонка: ERP дописал артикул между чтением и записью — отказ, свежая база — проходит
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('w_erp_upsert', 'OK PROBE-SKU', $q$select public.erp_sku_catalog_upsert('{"code":"PROBE-SKU","sewingPrice":100,"category":"tshirts"}')$q$);
select pg_temp.p('w_erp_race', 'P0001 Справочник изменён', $q$select public.catalog_put('app_config', 'sku_catalog', current_setting('probe.sku_base')::jsonb, current_setting('probe.sku_base')::jsonb)::text$q$);
select pg_temp.p('w_erp_fresh', 'OK 2', $q$select public.catalog_put('app_config', 'sku_catalog', value, value)::text from public.app_config where key = 'sku_catalog'$q$);
reset role;

select pg_temp.as_user('8f8cf33f-69e2-4565-8527-2e77d8489917');
set local role authenticated;
select pg_temp.p('w_director_suppliers', 'OK 2', $q$select public.catalog_put('catalog_config', 'suppliers',
  jsonb_set(value, '{0,name}', '"Медастекс (проба)"'), value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_director_fabrics', 'OK 2', $q$select public.catalog_put('catalog_config', 'fabricsCatalog', value, value)::text from public.catalog_config where key = 'fabricsCatalog'$q$);
reset role;

select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('w_rop_labels', 'OK 2', $q$select public.catalog_put('app_config', 'labelLibrary',
  jsonb_set(value, '{schemes,0,name}', '"Воротник (проба)"'), value)::text from public.app_config where key = 'labelLibrary'$q$);
select pg_temp.p('w_rop_tz', 'OK 2', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Проба rop"}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
select pg_temp.p('w_rop_suppliers', 'OK 2', $q$select public.catalog_put('catalog_config', 'suppliers', value, value)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('w_rop_sku', '42501 Каталог моделей и тканей меняет администратор или директор', $q$select public.catalog_put('app_config', 'sku_catalog', value, value)::text from public.app_config where key = 'sku_catalog'$q$);
select pg_temp.p('w_rop_fabrics', '42501 Каталог моделей', $q$select public.catalog_put('catalog_config', 'fabricsCatalog', value, value)::text from public.catalog_config where key = 'fabricsCatalog'$q$);
select pg_temp.p('w_rop_direct', '42501 new row violates row-level security', $q$insert into public.app_config (key, value) values ('tzSettings', '{"footerText":"мимо"}') on conflict (key) do update set value = excluded.value$q$);
select pg_temp.p('w_rop_direct_update', 'OK rows=0', $q$update public.app_config set value = '{"footerText":"мимо"}' where key = 'tzSettings'$q$);
reset role;

select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('w_seller_tz', '42501 Справочники меняет администратор, директор или руководитель продаж', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
reset role;

select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('w_head_tz', '42501 Справочники меняет', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
reset role;

select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('w_ms_tz', '42501 Справочники меняет', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', (select value from public.app_config where key = 'tzSettings'))::text$q$);
reset role;

select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('w_pending_tz', '42501 Справочники меняет', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', null)::text$q$);
reset role;

select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('w_offadmin_put', '42501 Справочники меняет', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"x"}', null)::text$q$);
select pg_temp.p('w_offadmin_upsert', '42501 new row violates row-level security', $q$insert into public.app_config (key, value) values ('tzSettings', '{"footerText":"мимо"}') on conflict (key) do update set value = excluded.value$q$);
-- Новый ключ без on conflict: проверяет только WITH CHECK писателя (чтение тут не заслоняет)
select pg_temp.p('w_offadmin_insert', '42501 new row violates row-level security', $q$insert into public.app_config (key, value) values ('probe_off', '{}')$q$);
select pg_temp.p('w_offadmin_update', 'OK rows=0', $q$update public.catalog_config set value = '[]' where key = 'trimCatalog'$q$);
reset role;

-- Отсутствующая строка: p_base = null вставляет
select pg_temp.as_user(null);
delete from public.app_config where key = 'tzSettings';
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('w_null_base_missing', 'OK 2', $q$select public.catalog_put('app_config', 'tzSettings', '{"footerText":"Новый"}', null)::text$q$);
reset role;

-- ── prices_patch ─────────────────────────────────────────────────────────
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('pp_rop_pack', 'OK {"updated_at"', $q$select public.prices_patch(
  '{"packOptions":[{"key":"none","name":"Без упаковки","price":0},{"key":"bopp","name":"БОПП","price":25},{"key":"zip","name":"ЗИП","price":40},{"key":"other","name":"Другая","price":0}]}',
  jsonb_build_object('packOptions', value->'packOptions'))::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_rop_pack_effect', 'OK 25', $q$select (value->'packOptions'->1->>'price') from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_rop_margin', 'OK {"updated_at"', $q$select public.prices_patch('{"minMarginPct":15}', '{"minMarginPct":null}')::text$q$);
select pg_temp.p('pp_rop_margin_null', 'OK {"updated_at"', $q$select public.prices_patch('{"minMarginPct":null}', '{"minMarginPct":15.0}')::text$q$);
select pg_temp.p('pp_rop_prep', 'OK {"updated_at"', $q$select public.prices_patch('{"prepFees":{"dtf":500,"silkscreen":1500}}', '{"prepFees":{}}')::text$q$);
select pg_temp.p('pp_rop_label', '42501 Руководитель продаж меняет только упаковку', $q$select public.prices_patch('{"label":31}', '{"label":30}')::text$q$);
select pg_temp.p('pp_rop_pack_extra', '22023 Упаковка', $q$select public.prices_patch('{"packOptions":[{"key":"gift","name":"Подарочная","price":10}]}',
  jsonb_build_object('packOptions', value->'packOptions'))::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_rop_pack_dup', '22023 Упаковка', $q$select public.prices_patch('{"packOptions":[{"key":"zip","name":"ЗИП","price":40},{"key":"zip","name":"ЗИП 2","price":45}]}',
  jsonb_build_object('packOptions', value->'packOptions'))::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_rop_pack_null', '22023 Упаковка', $q$select public.prices_patch('{"packOptions":null}',
  jsonb_build_object('packOptions', value->'packOptions'))::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_rop_prep_bad', '22023 Подготовка', $q$select public.prices_patch('{"prepFees":{"laser":100}}', '{"prepFees":{"dtf":500,"silkscreen":1500}}')::text$q$);
select pg_temp.p('pp_rop_margin_bad', '22023 Порог маржи', $q$select public.prices_patch('{"minMarginPct":"10"}', '{"minMarginPct":null}')::text$q$);
reset role;

select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
-- 30.0 в базе запроса = 30 в прайсе
select pg_temp.p('pp_admin_label', 'OK {"updated_at"', $q$select public.prices_patch('{"label":31}', '{"label":30.0}')::text$q$);
select pg_temp.p('pp_admin_conflict', 'P0001 Справочник изменён', $q$select public.prices_patch('{"label":32}', '{"label":30}')::text$q$);
select pg_temp.p('pp_admin_unknown', '22023 Такого ключа прайса нет: nope', $q$select public.prices_patch('{"nope":1}', '{}')::text$q$);
select pg_temp.p('pp_admin_type', '22023 Тип ключа прайса не меняется: label', $q$select public.prices_patch('{"label":"31"}', '{"label":31}')::text$q$);
select pg_temp.p('pp_admin_null', '22023 Ключ прайса не очищается: label', $q$select public.prices_patch('{"label":null}', '{"label":31}')::text$q$);
select pg_temp.p('pp_admin_base_extra', '22023 Прежние значения', $q$select public.prices_patch('{"label":32}', '{"label":31,"pack":0}')::text$q$);
-- Вкладка «Флекс» в /sku: матрица целиком, база — засеянная матрица
select pg_temp.p('pp_admin_flex', 'OK {"updated_at"', $q$select public.prices_patch(
  jsonb_build_object('flexMatrix', jsonb_set(value->'flexMatrix', '{A4,1,0}', '760')),
  jsonb_build_object('flexMatrix', value->'flexMatrix'))::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('pp_admin_effect', 'OK 31/500/null', $q$select (value->>'label') || '/' || (value->'prepFees'->>'dtf') || '/' || (value->'minMarginPct')::text from public.app_config where key = 'prices'$q$);
reset role;

select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('pp_seller', '42501 Справочники меняет', $q$select public.prices_patch('{"minMarginPct":1}', '{"minMarginPct":null}')::text$q$);
reset role;

select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('pp_head', '42501 Справочники меняет', $q$select public.prices_patch('{"minMarginPct":1}', '{"minMarginPct":null}')::text$q$);
reset role;
select pg_temp.as_user(null);

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
