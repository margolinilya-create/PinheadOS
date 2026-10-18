-- Пробы админки «Флэты и зоны»: миграция I (…_flats_admin, веха 5б) —
-- форма app_config.garmentFlats с историей версий и app_config.zonesCatalog
-- в catalog_value_check, триггер-страж app_config_order_catalog_guard
-- (прямая запись мимо RPC и через catalog_put), права записи по ролям,
-- регресс белого списка, бакет garment-flats для ролей 5б, живые данные.
-- До применения I на бою — только сухим прогоном вместе с ней в одной
-- транзакции (после H: предусловие файлов выкатки).
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=113 {…}
--
-- Как запускать — supabase/probes/README.md. Коротко: вставить файл ЦЕЛИКОМ
-- в SQL Editor и выполнить, в тихое время. Файл сам открывает транзакцию,
-- последний DO бросает исключение 'PROBE_RESULT …' — откатывается всё:
-- справочник garmentFlats (его строка удаляется владельцем и заводится
-- пустой — нужна чистая база для случаев FLATS_CASES), роли профилей.
-- Каждая проба записи откатывает свою запись сама (`pg_temp.put_rb`,
-- `pg_temp.sql_rb` — исключение PRB01 внутри подтранзакции), поэтому
-- пробы друг на друга не влияют.
--
-- Имена проб `fc_<имя>` — случаи FLATS_CASES (`design/catalog/flatsCases.ts`)
-- с тем же ожиданием (OK / 22023): паритет клиент-сервер сторожит
-- `catalog/catalogKeys.test.ts`. Значения повторяют случаи по смыслу (заметка
-- `note` случая), база — `validFlatsCatalog()` (`pg_temp.vc()`).
--
-- Окно совместимости (шапка миграции I): пробы `z_old_sku_*` — значения,
-- которые пишет старый /sku (жёсткое удаление зоны, id длиной 70 из
-- replace(/[^a-z0-9-]/g, '-'), название = id соседней зоны), — после I
-- отклоняются (22023). Поэтому I применяется в день мерджа 5б.
--
-- ВНИМАНИЕ: в файле есть `delete` и `update` — MCP execute_sql ждёт
-- подтверждения; прогон — через SQL Editor владельцем. DELETE строки
-- garmentFlats в начале — служебный (session_user = postgres без JWT
-- клиента): страж пускает только его и service_role.
--
-- Роли — профили боя, как в garment_flats.sql (роль ставится внутри транзакции):
--   ADMIN    b9c3e42e-9e07-44c2-8b15-839ce327c40c  admin
--   ROP      e73bd7fd-92a4-4b7b-b62d-ce9462d77f26  manager → внутри транзакции rop
--   SELLER   9285888e-4401-4b1b-b523-a3e6a9b90e82  manager, внутри транзакции is_sales = true
--   HEAD     05bbc552-bca2-490d-b275-46a3084dca7c  manager → внутри транзакции production
--            (начальник цеха: одобрен, проходит catalog_reader, но не sales_is_lead)
--   MS       f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9  manager; внутри транзакции is_ms = true
--   PENDING  cc9ed453-d3d7-4add-a361-8719a7701f97  внутри транзакции admin, active = true,
--            approved остаётся false (неодобренный admin)
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

-- Текущее значение справочника (база для catalog_put)
create function pg_temp.cur(p_key text) returns jsonb language sql stable as $f$
  select value from public.app_config where key = p_key;
$f$;

-- catalog_put с откатом: запись проходит целиком (форма, страж, where value = base)
-- и откатывается исключением PRB01; любая другая ошибка уходит в pg_temp.p
create function pg_temp.put_rb(p_key text, p_value jsonb, p_base jsonb) returns text
language plpgsql as $f$
begin
  perform public.catalog_put('app_config', p_key, p_value, p_base);
  raise exception using errcode = 'PRB01', message = 'откат пробы';
exception when sqlstate 'PRB01' then
  return 'put';
end;
$f$;

-- Прямая запись с откатом: число строк и откат
create function pg_temp.sql_rb(p_sql text) returns text
language plpgsql as $f$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  raise exception using errcode = 'PRB01', message = n::text;
exception when sqlstate 'PRB01' then
  return 'rows=' || sqlerrm;
end;
$f$;

-- Живое значение ключа проходит форму I (строки нет — тоже ответ)
create function pg_temp.live(p_key text) returns text language plpgsql as $f$
declare v jsonb;
begin
  select value into v from public.app_config where key = p_key;
  if v is null then
    return 'строки нет';
  end if;
  perform public.catalog_value_check('app_config', p_key, v);
  return 'форма верна';
end;
$f$;

-- validFlatsCatalog() из flatsCases.ts: типовой флэт футболки, перед и спина
create function pg_temp.vc() returns jsonb language sql immutable as $f$
  select $j${"version": 1, "flats": [{"id": "tshirt-regular", "name": "Футболка Regular", "garment_type": "tshirt",
    "typical": true, "active": true, "version": 1, "sku_codes": [], "categories": ["tshirts"], "fits": ["regular"],
    "base_size": "M", "sizes": ["M"], "views": [
      {"kind": "front", "svg_path": "flats/tshirt-regular/v1/front.svg", "scale_mm_per_unit": 1,
       "anchors": {"neckline_point": {"x": 300, "y": 92}, "center_axis_x": 300},
       "print_areas": [{"id": "chest", "name": "Грудь", "zone_id": "front",
         "polygon_mm": [[150, 140], [450, 140], [450, 540], [150, 540]], "safe_inset_mm": 5}]},
      {"kind": "back", "svg_path": "flats/tshirt-regular/v1/back.svg", "scale_mm_per_unit": 1,
       "anchors": {"neckline_point": {"x": 300, "y": 40}, "center_axis_x": 300},
       "print_areas": [{"id": "back", "name": "Грудь", "zone_id": "back",
         "polygon_mm": [[150, 100], [450, 100], [450, 500], [150, 500]], "safe_inset_mm": 5},
         {"id": "label", "name": "Этикетка", "zone_id": null,
         "polygon_mm": [[260, 48], [340, 48], [340, 80], [260, 80]], "safe_inset_mm": 5}]}]}]}$j$::jsonb;
$f$;

-- Флэт образца, выпущенный версией p_ver: пути v<p_ver>, в истории — v1 образца
create function pg_temp.vh(p_ver int) returns jsonb language sql immutable as $f$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.vc(),
    '{flats,0,version}', to_jsonb(p_ver)),
    '{flats,0,views,0,svg_path}', to_jsonb('flats/tshirt-regular/v' || p_ver || '/front.svg')),
    '{flats,0,views,1,svg_path}', to_jsonb('flats/tshirt-regular/v' || p_ver || '/back.svg')),
    '{flats,0,history}', jsonb_build_array(jsonb_build_object('version', 1, 'views', pg_temp.vc()#>'{flats,0,views}')));
$f$;

-- Второй флэт: копия образца с другим id (пути — по id), active и кодом модели
create function pg_temp.other(p_id text, p_active boolean, p_sku text) returns jsonb language sql immutable as $f$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.vc()->'flats'->0,
    '{id}', to_jsonb(p_id)), '{active}', to_jsonb(p_active)), '{sku_codes}', jsonb_build_array(p_sku)),
    '{views,0,svg_path}', to_jsonb('flats/' || p_id || '/v1/front.svg')),
    '{views,1,svg_path}', to_jsonb('flats/' || p_id || '/v1/back.svg'));
$f$;

-- Вид левого рукава версии 1 (якоря рукава)
create function pg_temp.sleeve() returns jsonb language sql immutable as $f$
  select $j${"kind": "sleeve_left", "svg_path": "flats/tshirt-regular/v1/sleeve_left.svg", "scale_mm_per_unit": 1,
    "anchors": {"sleeve_bottom_y": 500, "sleeve_center_x": 150},
    "print_areas": [{"id": "sleeve", "name": "Левый рукав", "zone_id": "sleeve-l",
      "polygon_mm": [[100, 100], [200, 100], [200, 300], [100, 300]], "safe_inset_mm": 5}]}$j$::jsonb;
$f$;

-- Справочник зон, к которому дописаны зоны p_add
create function pg_temp.zplus(p_add jsonb) returns jsonb language sql stable as $f$
  select pg_temp.cur('zonesCatalog') || p_add;
$f$;

-- ── Данные (суперпользователь) ──────────────────────────────────────────
select pg_temp.as_user(null);

update public.profiles set role = 'rop' where id = 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26';
update public.profiles set is_sales = true where id = '9285888e-4401-4b1b-b523-a3e6a9b90e82';
update public.profiles set role = 'production' where id = '05bbc552-bca2-490d-b275-46a3084dca7c';
update public.profiles set is_ms = true where id = 'f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9';
update public.profiles set role = 'admin', active = true, approved = false where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';
update public.profiles set active = false where id = '56ec3039-f326-42dd-b4de-870844b9468d';

-- ── Живые данные (до правки справочника пробами) ─────────────────────────
select pg_temp.p('live_zonesCatalog', 'OK', $q$select pg_temp.live('zonesCatalog')$q$);
select pg_temp.p('live_garmentFlats', 'OK', $q$select pg_temp.live('garmentFlats')$q$);
-- WARN, а не FAIL: zone_id флэтов, которых нет среди id живого справочника зон
-- (строки нет — среди ZONES_CATALOG_DEFAULT); владелец видит расхождение до 5б
select pg_temp.p('warn_flat_zone_ids', 'OK',
  $q$with zones as (
       select z->>'id' id from public.app_config c, jsonb_array_elements(c.value) z where c.key = 'zonesCatalog'
       union all
       select unnest(array['front', 'back', 'sleeve-l', 'sleeve-r', 'hood', 'pocket', 'side-a', 'side-b',
                           'leg-l', 'leg-r', 'pants-front', 'pants-back'])
        where not exists (select 1 from public.app_config where key = 'zonesCatalog'))
     select 'расхождений: ' || count(distinct a->>'zone_id') || coalesce(' — ' || string_agg(distinct a->>'zone_id', ', '), '')
       from public.app_config c, jsonb_array_elements(c.value->'flats') f, jsonb_array_elements(f->'views') v,
            jsonb_array_elements(v->'print_areas') a
      where c.key = 'garmentFlats' and jsonb_typeof(a->'zone_id') = 'string'
        and (a->>'zone_id') not in (select id from zones)$q$);

-- ── Устройство: страж, права на функции ──────────────────────────────────
select pg_temp.p('guard_trigger', 'OK app_config_order_catalog_guard:31',
  $q$select string_agg(tgname || ':' || tgtype, ',') from pg_trigger where tgrelid = 'public.app_config'::regclass and not tgisinternal$q$);
select pg_temp.p('guard_definer', 'OK true/{search_path=public}',
  $q$select prosecdef::text || '/' || proconfig::text from pg_proc where oid = 'public.app_config_order_catalog_guard()'::regprocedure$q$);
select pg_temp.p('guard_exec_closed', 'OK false/false',
  $q$select has_function_privilege('authenticated', 'public.app_config_order_catalog_guard()', 'execute')::text || '/'
         || has_function_privilege('anon', 'public.app_config_order_catalog_guard()', 'execute')::text$q$);
select pg_temp.p('check_exec_closed', 'OK false',
  $q$select has_function_privilege('authenticated', 'public.catalog_value_check(text, text, jsonb)', 'execute')::text$q$);

-- ── Чистый справочник флэтов: удаление владельцем (служебно) ─────────────
select pg_temp.p('postgres_delete_flats', 'OK rows=', $q$delete from public.app_config where key = 'garmentFlats'$q$);
insert into public.app_config (key, value, updated_at) values ('garmentFlats', '{"version": 1, "flats": []}', now());

-- ── ADMIN: случаи FLATS_CASES через catalog_put (каждый откатывается) ────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('fc_valid', 'OK', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vc(), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_not_object', '22023', $q$select pg_temp.put_rb('garmentFlats', '["flats"]', pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_version_2', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{version}', '2'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_dup_id', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats}', (pg_temp.vc()->'flats') || (pg_temp.vc()->'flats')), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_bad_id', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,id}', '"Tshirt X"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_foreign_path', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,svg_path}', '"flats/hoodie-regular/v1/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_dotdot_path', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,svg_path}', '"flats/tshirt-regular/v1/../../x/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_version_0', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,version}', '0'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_version_10000', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,version}', '10000'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_dup_view', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(pg_temp.vc(), '{flats,0,views,1,kind}', '"front"'), '{flats,0,views,1,svg_path}', '"flats/tshirt-regular/v1/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_view_sleeve', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,kind}', '"sleeve"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_scale_0', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,scale_mm_per_unit}', '0'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_scale_11', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,scale_mm_per_unit}', '11'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_no_areas', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas}', '[]'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_dup_area', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,1,print_areas,1,id}', '"back"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_polygon_2', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,polygon_mm}', '[[0, 0], [10, 10]]'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_polygon_257', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,polygon_mm}',
       (select jsonb_agg(jsonb_build_array(g, case when g % 2 = 1 then 0 else 100 end)) from generate_series(0, 256) g)), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_coord_5001', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,polygon_mm,1,0}', '5001'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_coord_string', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,polygon_mm,1,0}', '"450"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_method_screenprint', '22023',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,methods}', '["screenprint"]'), pg_temp.cur('garmentFlats'))$q$);
-- в H проходило: техника по умолчанию вне допустимых зоны
select pg_temp.p('fc_default_not_in_methods', '22023 Флэты: неверная запись — зона tshirt-regular/front/chest',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,methods}', '["dtf"]'),
       '{flats,0,views,0,print_areas,0,default_method}', '"embroidery"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_methods_ok', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,methods}', '["dtf", "dtg"]'),
       '{flats,0,views,0,print_areas,0,default_method}', '"dtg"'), pg_temp.cur('garmentFlats'))$q$);
-- в H проходило: zone_id не код зоны
select pg_temp.p('fc_zone_id_bad', '22023 Флэты: неверная запись — зона tshirt-regular/front/chest',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,zone_id}', '"Грудь"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_name_201', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,name}', to_jsonb(repeat('ф', 201))), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_active_string', '22023', $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,active}', '"true"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_no_neckline', '22023', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vc() #- '{flats,0,views,0,anchors,neckline_point}', pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_shopper_no_neckline', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,garment_type}', '"shopper"') #- '{flats,0,views,0,anchors,neckline_point}', pg_temp.cur('garmentFlats'))$q$);
-- Случаи вехи 5б: история, строки ТЗ, коды моделей, тип, рукава, якоря, отступ
select pg_temp.p('fc_history_ok', 'OK', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_tz_row_ok', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,tz_row}', '"front_l"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_sku_dup_inactive_ok', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(pg_temp.vc(), '{flats,0,sku_codes}', '["T-001"]'),
       '{flats}', (jsonb_set(pg_temp.vc(), '{flats,0,sku_codes}', '["T-001"]')->'flats') || jsonb_build_array(pg_temp.other('tshirt-regular-2', false, 'T-001'))),
       pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_sleeve_ok', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views}', (pg_temp.vc()#>'{flats,0,views}') || jsonb_build_array(pg_temp.sleeve())), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_history_path_foreign', '22023 Флэты: неверная запись — вид tshirt-regular/front (история v1)',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vh(2), '{flats,0,history,0,views,0,svg_path}', '"flats/tshirt-regular/v2/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_history_path_other_flat', '22023 Флэты: неверная запись — вид tshirt-regular/front (история v1)',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vh(2), '{flats,0,history,0,views,0,svg_path}', '"flats/hoodie-regular/v1/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_history_path_traversal', '22023 Флэты: неверная запись — вид tshirt-regular/front (история v1)',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vh(2), '{flats,0,history,0,views,0,svg_path}', '"flats/tshirt-regular/v1/../../hoodie-regular/v1/front.svg"'), pg_temp.cur('garmentFlats'))$q$);
-- версия записи истории = текущей; пути записи — по её версии, ловит только «меньше текущей»
select pg_temp.p('fc_history_version_ge', '22023 Флэты: неверная запись — история tshirt-regular/v2',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(jsonb_set(pg_temp.vh(2), '{flats,0,history,0,version}', '2'),
       '{flats,0,history,0,views,0,svg_path}', '"flats/tshirt-regular/v2/front.svg"'),
       '{flats,0,history,0,views,1,svg_path}', '"flats/tshirt-regular/v2/back.svg"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_history_dup_version', '22023 Флэты: версия в истории флэта повторяется',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vh(3), '{flats,0,history}', (pg_temp.vh(3)#>'{flats,0,history}') || (pg_temp.vh(3)#>'{flats,0,history}')), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_history_bad_view', '22023 Флэты: неверная запись — зона tshirt-regular/front/chest (история v1)',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vh(2), '{flats,0,history,0,views,0,print_areas,0,polygon_mm}', '[[0, 0], [10, 10]]'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_tz_row_bad', '22023 Флэты: неверная запись — зона',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,tz_row}', '"hood"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_sku_dup_active', '22023 Флэты: модель «T-001» у двух активных флэтов',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(jsonb_set(pg_temp.vc(), '{flats,0,sku_codes}', '["T-001"]'),
       '{flats}', (jsonb_set(pg_temp.vc(), '{flats,0,sku_codes}', '["T-001"]')->'flats') || jsonb_build_array(pg_temp.other('tshirt-regular-2', true, 'T-001'))),
       pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_sku_code_65', '22023 Флэты: неверная запись — флэт tshirt-regular',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,sku_codes}', jsonb_build_array(repeat('a', 65))), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_garment_type_bad', '22023 Флэты: неверная запись — флэт tshirt-regular',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,garment_type}', '"jacket"'), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_typical_missing', '22023 Флэты: неверная запись — флэт tshirt-regular',
  $q$select pg_temp.put_rb('garmentFlats', pg_temp.vc() #- '{flats,0,typical}', pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_sleeve_no_anchor', '22023 Флэты: неверная запись — вид tshirt-regular/sleeve_left',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views}', (pg_temp.vc()#>'{flats,0,views}') || jsonb_build_array(pg_temp.sleeve() #- '{anchors,sleeve_center_x}')), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_front_no_axis', '22023 Флэты: неверная запись — вид tshirt-regular/front',
  $q$select pg_temp.put_rb('garmentFlats', pg_temp.vc() #- '{flats,0,views,0,anchors,center_axis_x}', pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('fc_inset_negative', '22023 Флэты: неверная запись — зона',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.vc(), '{flats,0,views,0,print_areas,0,safe_inset_mm}', '-1'), pg_temp.cur('garmentFlats'))$q$);

-- ── ADMIN: справочник зон ────────────────────────────────────────────────
select pg_temp.p('z_roundtrip', 'OK', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_tz_row_active_ok', 'OK',
  $q$select pg_temp.put_rb('zonesCatalog', jsonb_set(jsonb_set(pg_temp.cur('zonesCatalog'), '{0,tz_row}', '"front"'), '{1,active}', 'false'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_add_ok', 'OK',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe_zone", "name": "Проба", "forCategories": null, "sortOrder": 99, "tz_row": "other", "active": true}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_not_array', '22023 Зоны: нужен список', $q$select pg_temp.put_rb('zonesCatalog', '{}', pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_dup_id', '22023 Зоны: id повторяется',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus(jsonb_build_array(jsonb_set(pg_temp.cur('zonesCatalog')->0, '{name}', '"Проба"'))), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_dup_name_case', '22023 Зоны: название',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus(jsonb_build_array(jsonb_build_object('id', 'probe-x', 'name', '  ' || upper(pg_temp.cur('zonesCatalog')->0->>'name') || ' '))), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_cyrillic_id', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "грудь", "name": "Проба"}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_empty_name', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe-x", "name": "  "}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_tz_row_hood', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe-x", "name": "Проба", "tz_row": "hood"}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_active_string', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe-x", "name": "Проба", "active": "false"}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_for_categories_number', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe-x", "name": "Проба", "forCategories": [5]}]'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_201', '22023 Зоны: нужен список',
  $q$select pg_temp.put_rb('zonesCatalog', (select jsonb_agg(jsonb_build_object('id', 'z' || g, 'name', 'Зона ' || g)) from generate_series(1, 201) g), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_base_changed', 'P0001', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), '[]')$q$);
-- Окно совместимости: что пишет старый /sku
select pg_temp.p('z_old_sku_delete', '22023 Зоны: зона',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog') - (jsonb_array_length(pg_temp.cur('zonesCatalog')) - 1), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_old_sku_id70', '22023 Зоны: неверная запись',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus(jsonb_build_array(jsonb_build_object('id', repeat('a-', 35), 'name', repeat('a-', 35)))), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('z_old_sku_name_eq_id', '22023 Зоны: название',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.zplus('[{"id": "probe-y", "name": "probe-y"}, {"id": "probe-z", "name": "probe-y"}]'), pg_temp.cur('zonesCatalog'))$q$);

-- ── Регресс белого списка ────────────────────────────────────────────────
select pg_temp.p('reg_admin_sku_catalog', 'OK', $q$select pg_temp.put_rb('sku_catalog', pg_temp.cur('sku_catalog'), pg_temp.cur('sku_catalog'))$q$);
reset role;

-- ── Страж: флэт с историей (v2, в истории v1) ────────────────────────────
select pg_temp.as_user(null);
update public.app_config set value = pg_temp.vh(2), updated_at = now() where key = 'garmentFlats';

select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
-- прямая запись admin мимо RPC
select pg_temp.p('g_meta_same_version_ok', 'OK rows=1',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(pg_temp.vh(2), '{flats,0,name}', '"Футболка"') where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_release_ok', 'OK rows=1',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.vh(2),
       '{flats,0,version}', '3'),
       '{flats,0,views,0,svg_path}', '"flats/tshirt-regular/v3/front.svg"'),
       '{flats,0,views,1,svg_path}', '"flats/tshirt-regular/v3/back.svg"'),
       '{flats,0,history}', (pg_temp.vh(2)#>'{flats,0,history}') || jsonb_build_array(jsonb_build_object('version', 2, 'views', pg_temp.vh(2)#>'{flats,0,views}'))) where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_drop_history', '22023 Флэты: история флэта «tshirt-regular» изменена',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = pg_temp.vh(2) #- '{flats,0,history}' where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_version_down', '22023 Флэты: версия флэта «tshirt-regular» понижена',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = pg_temp.vc() where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_flat_gone', '22023 Флэты: флэт «tshirt-regular» удалён',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = '{"version": 1, "flats": []}' where key = 'garmentFlats'$s$)$q$);
-- надмножество записи v1: дописанный вид (containment @> пропустил бы)
select pg_temp.p('g_history_superset_view', '22023 Флэты: история флэта',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(pg_temp.vh(2), '{flats,0,history,0,views}',
       (pg_temp.vh(2)#>'{flats,0,history,0,views}') || jsonb_build_array(pg_temp.sleeve())) where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_history_extra_field', '22023 Флэты: история флэта',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(pg_temp.vh(2), '{flats,0,history,0,note}', '"x"') where key = 'garmentFlats'$s$)$q$);
-- выпуск версии без записи прежних видов в историю
select pg_temp.p('g_release_without_history', '22023 Флэты: история флэта',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(jsonb_set(jsonb_set(pg_temp.vh(2),
       '{flats,0,version}', '3'),
       '{flats,0,views,0,svg_path}', '"flats/tshirt-regular/v3/front.svg"'),
       '{flats,0,views,1,svg_path}', '"flats/tshirt-regular/v3/back.svg"') where key = 'garmentFlats'$s$)$q$);
-- форма и при прямой записи
select pg_temp.p('g_sku_dup', '22023 Флэты: модель «T-001»',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(jsonb_set(pg_temp.vh(2), '{flats,0,sku_codes}', '["T-001"]'),
       '{flats}', (jsonb_set(pg_temp.vh(2), '{flats,0,sku_codes}', '["T-001"]')->'flats') || jsonb_build_array(pg_temp.other('probe-two', true, 'T-001'))) where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_tz_row_bad', '22023 Флэты: неверная запись — зона',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(pg_temp.vh(2), '{flats,0,views,0,print_areas,0,tz_row}', '"hood"') where key = 'garmentFlats'$s$)$q$);
select pg_temp.p('g_insert_bad_form', '22023',
  $q$select pg_temp.sql_rb($s$insert into public.app_config (key, value) values ('garmentFlats', '[]') on conflict (key) do update set value = excluded.value$s$)$q$);
-- зоны: удаление и переименование
select pg_temp.p('gz_zone_gone', '22023 Зоны: зона',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = value - 0 where key = 'zonesCatalog'$s$)$q$);
select pg_temp.p('gz_rename', '22023 Зоны: название зоны',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = jsonb_set(value, '{0,name}', '"Проба"') where key = 'zonesCatalog'$s$)$q$);
select pg_temp.p('gz_rekey', '42501 Справочник «zonesCatalog» не удаляется',
  $q$select pg_temp.sql_rb($s$update public.app_config set key = 'zonesCatalog_old' where key = 'zonesCatalog'$s$)$q$);
-- DELETE строк ключей — отказ даже admin
select pg_temp.p('g_delete_keys', '42501 Справочник',
  $q$select pg_temp.sql_rb($s$delete from public.app_config where key in ('garmentFlats', 'zonesCatalog')$s$)$q$);
select pg_temp.p('g_delete_zones', '42501 Справочник «zonesCatalog» не удаляется',
  $q$select pg_temp.sql_rb($s$delete from public.app_config where key = 'zonesCatalog'$s$)$q$);
-- через RPC — тот же страж
select pg_temp.p('r_put_drop_history', '22023 Флэты: история флэта',
  $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2) #- '{flats,0,history}', pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('r_put_zone_gone', '22023 Зоны: зона',
  $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog') - 0, pg_temp.cur('zonesCatalog'))$q$);
-- сид 5а поверх справочника с историей: прочие записи сырыми, новый флэт дописан
select pg_temp.p('r_seed_over_history_ok', 'OK',
  $q$select pg_temp.put_rb('garmentFlats', jsonb_set(pg_temp.cur('garmentFlats'), '{flats}',
       (pg_temp.cur('garmentFlats')->'flats') || jsonb_build_array(pg_temp.other('probe-seed', true, 'S-1'))), pg_temp.cur('garmentFlats'))$q$);
-- бакет 5б: путь вне формулы — отказ и admin
select pg_temp.p('b_admin_v10000', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/x/v10000/front.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
select pg_temp.p('b_admin_dotdot', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/x/v1/../y.svg', 'b9c3e42e-9e07-44c2-8b15-839ce327c40c')$q$);
reset role;

-- ── Роли без права записи флэтов и зон ───────────────────────────────────
-- ROP: справочники заказа — да (регресс), флэты и зоны — нет, бакет — нет
select pg_temp.as_user('e73bd7fd-92a4-4b7b-b62d-ce9462d77f26');
set local role authenticated;
select pg_temp.p('rop_put_flats', '42501', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('rop_put_zones', '42501', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('reg_rop_labels', 'OK', $q$select pg_temp.put_rb('labelLibrary', pg_temp.cur('labelLibrary'), pg_temp.cur('labelLibrary'))$q$);
select pg_temp.p('rop_direct_zones', 'OK rows=0',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = '[]' where key = 'zonesCatalog'$s$)$q$);
select pg_temp.p('rop_delete_zones', 'OK rows=0',
  $q$select pg_temp.sql_rb($s$delete from public.app_config where key = 'zonesCatalog'$s$)$q$);
select pg_temp.p('rop_bucket_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/tshirt-regular/v3/front.svg', 'e73bd7fd-92a4-4b7b-b62d-ce9462d77f26')$q$);
reset role;
-- SELLER
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('seller_put_flats', '42501', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('seller_put_zones', '42501', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), pg_temp.cur('zonesCatalog'))$q$);
select pg_temp.p('seller_bucket_ins', '42501',
  $q$insert into storage.objects (bucket_id, name, owner) values ('garment-flats', 'flats/tshirt-regular/v3/front.svg', '9285888e-4401-4b1b-b523-a3e6a9b90e82')$q$);
reset role;
-- MS
select pg_temp.as_user('f13c33f3-cd7a-4f24-b6f5-855ca2b24ba9');
set local role authenticated;
select pg_temp.p('ms_put_flats', '42501', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('ms_put_zones', '42501', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), pg_temp.cur('zonesCatalog'))$q$);
reset role;
-- Начальник цеха (production): читает справочник, не пишет
select pg_temp.as_user('05bbc552-bca2-490d-b275-46a3084dca7c');
set local role authenticated;
select pg_temp.p('head_reads_zones', 'OK true', $q$select (pg_temp.cur('zonesCatalog') is not null)::text$q$);
select pg_temp.p('head_put_flats', '42501', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), pg_temp.cur('garmentFlats'))$q$);
select pg_temp.p('head_put_zones', '42501', $q$select pg_temp.put_rb('zonesCatalog', pg_temp.cur('zonesCatalog'), pg_temp.cur('zonesCatalog'))$q$);
reset role;
-- Неодобренный admin: отказ на первой ветке (sales_is_lead)
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('pending_put_flats', '42501 Справочники меняет', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), null)$q$);
select pg_temp.p('pending_put_zones', '42501 Справочники меняет', $q$select pg_temp.put_rb('zonesCatalog', '[]', null)$q$);
select pg_temp.p('pending_direct_zones', 'OK rows=0',
  $q$select pg_temp.sql_rb($s$update public.app_config set value = '[]' where key = 'zonesCatalog'$s$)$q$);
reset role;
-- Отключённый admin
select pg_temp.as_user('56ec3039-f326-42dd-b4de-870844b9468d');
set local role authenticated;
select pg_temp.p('offadmin_put_flats', '42501', $q$select pg_temp.put_rb('garmentFlats', pg_temp.vh(2), null)$q$);
select pg_temp.p('offadmin_put_zones', '42501', $q$select pg_temp.put_rb('zonesCatalog', '[]', null)$q$);
select pg_temp.p('offadmin_delete_zones', 'OK rows=0',
  $q$select pg_temp.sql_rb($s$delete from public.app_config where key = 'zonesCatalog'$s$)$q$);
reset role;
-- Аноним: execute отозван
select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('anon_put_flats', '42501', $q$select public.catalog_put('app_config', 'garmentFlats', '{}'::jsonb, null)::text$q$);
select pg_temp.p('anon_put_zones', '42501', $q$select public.catalog_put('app_config', 'zonesCatalog', '[]'::jsonb, null)::text$q$);
reset role;

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
