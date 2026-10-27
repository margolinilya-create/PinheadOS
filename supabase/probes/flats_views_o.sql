-- Пробы миграции O вехи 5в (20261026100000_garment_flats_hood_pocket): виды флэта
-- «Капюшон» и «Карман» — путь SVG в бакете (`garment_flat_path_ok`) и форма справочника
-- `garmentFlats` (`catalog_value_check`). Справочник — ЖИВОЙ (`app_config.garmentFlats`),
-- к первому флэту дописывается вид; функция только проверяет, ничего не пишет.
-- До применения O — только сухим прогоном вместе с ней: supabase/rollout/m5c/2-dryrun-O.sql.
--
-- Вызов функции — в выражении ответа (`::text || 'ok'`): в `select 'ok' from (select f(…)) x`
-- планировщик функцию не вызывает — так первая редакция пробы «проходила» отказы.
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=10 {…}

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

select pg_temp.p('o_path_hood', 'OK true', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/hood.svg')::text$q$);
select pg_temp.p('o_path_pocket', 'OK true', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/pocket.svg')::text$q$);
select pg_temp.p('o_path_front', 'OK true', $q$select public.garment_flat_path_ok('flats/tshirt-freefit/v1/front.svg')::text$q$);
select pg_temp.p('o_path_collar', 'OK false', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/collar.svg')::text$q$);
select pg_temp.p('o_path_hood_png', 'OK false', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/hood.png')::text$q$);
select pg_temp.p('o_live', 'OK ok', $q$select public.catalog_value_check('app_config', 'garmentFlats', value)::text || 'ok' from public.app_config where key = 'garmentFlats'$q$);
select pg_temp.p('o_flat_hood', 'OK ok', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_pocket', 'OK ok', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('pocket'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/pocket.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_collar', '22023', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('collar'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/collar.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_hood_twice', '22023', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg')), jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);

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
