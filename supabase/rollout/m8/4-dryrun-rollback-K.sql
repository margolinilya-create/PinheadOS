-- СУХОЙ ПРОГОН ОТКАТА функций K до apply (КОНТРОЛЛЕР): предусловие, K, откат, сверка, пробы
-- после отката (supabase/rollout/m8/probes-after-rollback-K.sql).
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=6 {…}

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие: L применена, K нет; функции — тела D/B, стражи — тела L ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018150000') then
    raise exception 'Сначала миграция L (20261018150000)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261018160000') then
    raise exception 'Миграция K уже записана в schema_migrations';
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save(jsonb)');
  if v is distinct from '06a632efc09bf431c0c3c861960c22d9' then
    raise exception 'Функции на бою не совпадают с D/B: order_v4_save(jsonb) (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
  if v is distinct from '6be40fb03b7eec70b76bf5de08b57c83' then
    raise exception 'Функции на бою не совпадают с D/B: order_v4_save_full(jsonb) (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_child_guard()');
  if v is distinct from '75051f6f7d964b8be7b8888e0bb826ff' then
    raise exception 'Функции на бою не совпадают с D/B: order_v4_child_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_guard()');
  if v is distinct from '4fec238885f48f569a520c46f40bef72' then
    raise exception 'Страж на бою не равен L: order_v4_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_delete_guard()');
  if v is distinct from 'f2e4a081d688472c48cd9f3850a2ee45' then
    raise exception 'Страж на бою не равен L: order_v4_delete_guard() (md5 %)', v;
  end if;
end;
$pre$;

-- ── Миграция K ──
-- Order v4, веха 8 единого потока, миграция K (18.10): код зоны у нанесения
-- (`order_item_prints.zone_id`) и «Комментарий для цехов» (`orders.notes`) в сохранении;
-- ревизия клиента 4.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решение К5). ВЫКАТКА: L (20261018150000) → фронт с SALES_CLIENT_REV = 4 → K
-- не позже 30 минут после появления новой сборки в /version.json. Фронт ревизии 4
-- со старым сервером работает: поле комментария он показывает, только когда ответ
-- сохранения несёт ключ `notes` (его добавляет K). ОТКАТ ФРОНТА ⇒ СНАЧАЛА откат функций K
-- (supabase/rollout/m8/3-rollback-K-functions.sql: тело `order_v4_save_full` до K,
-- порог ревизии 3), затем фронт. Колонку `zone_id` откат функций оставляет
-- (nullable, безвредна); её снимает файл владельца 3b-drop-zone-id.sql по желанию.
--
-- Тело `order_v4_save_full` — подлинный текст миграции D (20261017101513_order_v4_client_rev,
-- md5 `prosrc` на бою — литерал задачи 0); правки — блоки
--   -- K:begin <метка> … [-- K:was|<строка D дословно>] … -- K:end <метка>
-- Обратная замена даёт тело D побайтно (сторож orderV4M8.test.ts).
--
-- Почему меняется только обёртка (решение задачи 2, отступление от текста плана):
-- в теле `order_v4_save` есть операторы удаления строк позиций, нанесений, бирок
-- и карточек — с ними файл нельзя применить через MCP `execute_sql` (он ждёт
-- подтверждения), и откат функций K перестал бы быть «без подтверждения». Поэтому
-- `order_v4_save` K не пересоздаёт: проверку формата, запись `zone_id` и `notes`
-- и порог ревизии 4 несёт `order_v4_save_full` — ровно её зовёт клиент
-- (`api/salesOrders.ts`). Прямой вызов `order_v4_save` в обход обёртки (ревизия ≥ 3)
-- не знает новых полей и сотрёт `zone_id` нанесений СВОЕГО черновика — это порча своих
-- данных, а не права (права держат RLS и стражи, как в D).
-- `order_v4_child_guard` K тоже не меняет: страж строк заказа не перечисляет колонки,
-- он пускает любую правку только у черновика — `zone_id` им покрыт (проба zn_sent).
-- `order_v4_guard` и CHECK `orders_notes_len` — миграция L.
--
-- Регулярка кода зоны — ровно `ZONE_ID_RE.source` из
-- pinhead-react/src/orderstudio/catalog/tzRows.ts (тот же ключ, что у справочника зон
-- в `catalog_value_check`; сторож orderV4M8.test.ts). Таблицы `erp_*` миграция не трогает.

-- ── 1. Код зоны у нанесения ──────────────────────────────────────────────
alter table public.order_item_prints
  add column if not exists zone_id text null
  constraint order_item_prints_zone_id_check
  check (zone_id is null or zone_id ~ '^[a-z0-9][a-z0-9_-]{0,62}$');

-- ── 2. Сохранение: ревизия 4, проверка и запись zone_id и notes ──────────
create or replace function public.order_v4_save_full(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved jsonb;
  v_id uuid;
  v_expected timestamptz;
  v_current timestamptz;
  v_status text;
  -- K:begin decl
  v_updated timestamptz;
  v_notes text;
  -- K:end decl
begin
  -- K:begin rev
  -- K:was|  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
  if coalesce((p_order->>'client_rev')::int, 0) < 4 then
  -- K:end rev
    raise exception using errcode = 'P0001',
      message = 'Вышло обновление — обновите страницу, правка не сохранена';
  end if;

  -- Конкурентная правка: строка существующего заказа берётся FOR UPDATE —
  -- параллельное сохранение из второй вкладки ждёт и видит уже новый updated_at
  v_id := nullif(p_order->>'id', '')::uuid;
  v_expected := nullif(p_order->>'expected_updated_at', '')::timestamptz;
  if v_id is not null and v_expected is not null then
    select updated_at, status into v_current, v_status
      from public.orders
     where id = v_id and schema_version = 4
       for update;
    -- Не черновик — сверку пропускаем: правку закрывает страж «правка закрыта»
    -- (42501), и вкладка узнаёт настоящую причину, а не «изменён в другой вкладке»
    if found and v_status = 'draft' and v_current is distinct from v_expected then
      raise exception using errcode = 'P0001',
        message = 'Заказ изменён в другой вкладке — обновите страницу';
    end if;
  end if;

  -- K:begin validate
  -- Понятный отказ до записи: нарушение CHECK внутри сохранения откатило бы его
  -- целиком без внятного текста. Длину держит и таблица (CHECK orders_notes_len, L),
  -- формат кода зоны — CHECK order_item_prints_zone_id_check
  if p_order ? 'notes' and (jsonb_typeof(p_order->'notes') not in ('string', 'null')
     or char_length(coalesce(p_order->>'notes', '')) > 2000) then
    raise exception using errcode = '22023',
      message = 'Комментарий для цехов — не длиннее 2000 знаков';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_order->'items') = 'array'
                                     then p_order->'items' else '[]'::jsonb end) as it(v)
     cross join lateral jsonb_array_elements(case when jsonb_typeof(it.v->'prints') = 'array'
                                                  then it.v->'prints' else '[]'::jsonb end) as pr(v)
     where pr.v ? 'zone_id'
       and (jsonb_typeof(pr.v->'zone_id') not in ('string', 'null')
            or (pr.v->>'zone_id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$')) then
    raise exception using errcode = '22023', message = 'Неверный код зоны нанесения';
  end if;
  -- K:end validate
  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  -- K:begin write
  -- `order_v4_save` пишет нанесения заново (порядок — sort_order позиции и нанесения),
  -- код зоны и комментарий дописываются здесь, в той же транзакции; страж строк
  -- заказа пускает правку только черновика. Нет ключа `notes` — комментарий не трогается
  v_id := (v_saved->>'id')::uuid;
  if p_order ? 'notes' then
    update public.orders set notes = nullif(p_order->>'notes', '')
     where id = v_id and schema_version = 4;
  end if;
  update public.order_item_prints as p
     set zone_id = z.zone_id
    from (select i.id as item_id, (pr.n - 1)::integer as sort_order,
                 nullif(pr.v->>'zone_id', '') as zone_id
            from jsonb_array_elements(coalesce(p_order->'items', '[]'::jsonb)) with ordinality as it(v, n)
            join public.order_items i on i.order_id = v_id and i.sort_order = it.n - 1
           cross join lateral jsonb_array_elements(coalesce(it.v->'prints', '[]'::jsonb))
                 with ordinality as pr(v, n)) as z
   where p.item_id = z.item_id and p.sort_order = z.sort_order
     and p.zone_id is distinct from z.zone_id;
  -- Ответ: новый updated_at и комментарий — по ключу `notes` клиент узнаёт,
  -- что сервер знает поле (окно «фронт ревизии 4 → K», К5)
  select o.updated_at, o.notes into v_updated, v_notes from public.orders o where o.id = v_id;
  return v_saved || jsonb_build_object('updated_at', v_updated, 'notes', coalesce(v_notes, ''));
  -- K:was|  return v_saved;
  -- K:end write
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── Откат функций K: обёртка — тело D (порог ревизии 3); колонка zone_id остаётся ──
create or replace function public.order_v4_save_full(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved jsonb;
  v_id uuid;
  v_expected timestamptz;
  v_current timestamptz;
  v_status text;
begin
  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
    raise exception using errcode = 'P0001',
      message = 'Вышло обновление — обновите страницу, правка не сохранена';
  end if;

  -- Конкурентная правка: строка существующего заказа берётся FOR UPDATE —
  -- параллельное сохранение из второй вкладки ждёт и видит уже новый updated_at
  v_id := nullif(p_order->>'id', '')::uuid;
  v_expected := nullif(p_order->>'expected_updated_at', '')::timestamptz;
  if v_id is not null and v_expected is not null then
    select updated_at, status into v_current, v_status
      from public.orders
     where id = v_id and schema_version = 4
       for update;
    -- Не черновик — сверку пропускаем: правку закрывает страж «правка закрыта»
    -- (42501), и вкладка узнаёт настоящую причину, а не «изменён в другой вкладке»
    if found and v_status = 'draft' and v_current is distinct from v_expected then
      raise exception using errcode = 'P0001',
        message = 'Заказ изменён в другой вкладке — обновите страницу';
    end if;
  end if;

  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  return v_saved;
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ── Сверка отката: обёртка = тело D ──
do $chk$
declare v text;
begin
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');
  if v is distinct from '6be40fb03b7eec70b76bf5de08b57c83' then
    raise exception 'ОТКАТ: обёртка не равна телу D: order_v4_save_full(jsonb) (md5 %)', v;
  end if;
end;
$chk$;

-- ── Пробы после отката K ──

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
