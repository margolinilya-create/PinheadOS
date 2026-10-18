-- СУХОЙ ПРОГОН миграции M (20261018170000) + пробы supabase/probes/catalog_legacy.sql.
-- ВЛАДЕЛЕЦ в SQL Editor (оператор удаления). Перед прогоном — посмотреть снимок
-- supabase/snapshots/catalog_config_legacy_2026-10-18.json.
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=13 {…}. «значения изменились —
-- переснимите» — M НЕ применять: снимок устарел.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие: G применена, M нет (значения сверяет сама миграция по снимку) ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261017150000') then
    raise exception 'Сначала миграция G (20261017150000)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261018170000') then
    raise exception 'Миграция M уже записана в schema_migrations';
  end if;
end;
$pre$;

-- ── Миграция M ──
-- Справочники заказа, веха 8 единого потока, миграция M (18.10): старые ключи
-- `catalog_config` (`prices`, `labels`, `extras`, `fabrics`) удаляются.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решение К7). Значения сняты задачей 0 в репозиторий:
-- supabase/snapshots/catalog_config_legacy_2026-10-18.json (md5 `value::text`).
-- Последняя правка ключей — 11.05.2026; новые экраны их не читают (справочники
-- вехи 4 живут в `app_config` и `catalog_config.suppliers`).
--
-- ПРИМЕНЯЕТ ВЛАДЕЛЕЦ в SQL Editor (файлы supabase/rollout/m8/*-M.sql): MCP `execute_sql`
-- на операторе удаления ждёт подтверждения. Порядок с фронтом любой: клиент вехи 8
-- ключи не читает.
--
-- Предусловие — в самой миграции: строка с таким ключом, чьё значение разошлось
-- со снимком, — отказ «значения изменились — переснимите» (удалять несохранённое
-- нельзя). Строки нет — нечего сверять (`supabase db reset` локально).
--
-- Политика чтения G теряет ветку «старый `prices` — только руководству продаж»:
-- имя сохраняется (`alter policy`), обёртка `(select …)` — как в G.
-- Откат: supabase/rollout/m8/3-rollback-M.sql (вставка значений снимка, прежнее условие).

do $pre$
declare
  v_row record;
  c_md5 constant jsonb := '{
    "extras":  "378d803d6883ca5644155b6f8a853ea6",
    "fabrics": "7d939c429d033c13a986a9cb5a35a425",
    "labels":  "bcbc3031a827cf03b261ef40d349c362",
    "prices":  "15d6c08d3234d4d342748aa7c5a3e655"
  }'::jsonb;
begin
  for v_row in
    select key, md5(value::text) as h from public.catalog_config
     where key in ('prices', 'labels', 'extras', 'fabrics')
  loop
    if v_row.h is distinct from c_md5 ->> v_row.key then
      raise exception 'Значения catalog_config.% изменились после снимка (md5 %) — переснимите supabase/snapshots/catalog_config_legacy_2026-10-18.json',
        v_row.key, v_row.h;
    end if;
  end loop;
end;
$pre$;

delete from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics');

alter policy catalog_config_select on public.catalog_config
  using ((select public.catalog_reader()));

notify pgrst, 'reload schema';

-- ── Пробы M ──

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
update public.profiles set active = true where id = 'cc9ed453-d3d7-4add-a361-8719a7701f97';

-- ключей нет; живые ключи на месте
select pg_temp.p('cl_keys_gone', 'OK 0', $q$select count(*)::text from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics')$q$);
select pg_temp.p('cl_live_keys', 'OK true', $q$select (count(*) filter (where key = 'suppliers') = 1)::text from public.catalog_config$q$);
-- политика чтения без ветки старого prices, имя прежнее, обёртка (select …)
select pg_temp.p('cl_policy', 'OK true', $q$select (qual !~ 'prices' and qual ~ 'catalog_reader')::text from pg_policies where schemaname = 'public' and tablename = 'catalog_config' and policyname = 'catalog_config_select' and cmd = 'SELECT'$q$);
select pg_temp.p('cl_policies_4', 'OK 4', $q$select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'catalog_config'$q$);

-- ── SELLER: читает живые справочники; старый ключ RPC не заводит ─────────
select pg_temp.as_user('9285888e-4401-4b1b-b523-a3e6a9b90e82');
set local role authenticated;
select pg_temp.p('s_reads_suppliers', 'OK 1', $q$select count(*)::text from public.catalog_config where key = 'suppliers'$q$);
select pg_temp.p('s_reads_prices', 'OK true', $q$select (count(*) >= 0)::text from public.app_config where key = 'prices'$q$);
select pg_temp.p('s_put_old_key', '42501', $q$select public.catalog_put('catalog_config', 'labels', '{}', null)::text$q$);
reset role;

-- ── PENDING: не одобрен — ничего ─────────────────────────────────────────
select pg_temp.as_user('cc9ed453-d3d7-4add-a361-8719a7701f97');
set local role authenticated;
select pg_temp.p('pending_reads', 'OK 0', $q$select count(*)::text from public.catalog_config$q$);
reset role;

-- ── ADMIN: старые ключи RPC не принимает (регресс белого списка G) ──────
select pg_temp.as_user('b9c3e42e-9e07-44c2-8b15-839ce327c40c');
set local role authenticated;
select pg_temp.p('a_reads_all', 'OK 0', $q$select count(*)::text from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics')$q$);
select pg_temp.p('a_put_old_prices', '22023 Такого справочника нет', $q$select public.catalog_put('catalog_config', 'prices', '{}', null)::text$q$);
select pg_temp.p('a_put_old_fabrics', '22023 Такого справочника нет', $q$select public.catalog_put('catalog_config', 'fabrics', '{}', null)::text$q$);
select pg_temp.p('a_put_suppliers_stale', 'P0001', $q$select public.catalog_put('catalog_config', 'suppliers', (select value from public.catalog_config where key = 'suppliers'), '{"stale": true}')::text$q$);
reset role;

-- ── anon — ничего ────────────────────────────────────────────────────────
select pg_temp.as_user(null);
set local role anon;
select pg_temp.p('anon_cc', '42501 permission denied', $q$select count(*)::text from public.catalog_config$q$);
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
