-- СУХОЙ ПРОГОН ОТКАТА L после apply (КОНТРОЛЛЕР): тот же откат поверх применённой L, пробы после отката.
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=13 {…}

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие отката: L применена, стражи — тела L ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018150000') then
    raise exception 'L в журнале нет — откатывать нечего';
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_guard()');
  if v is distinct from '4fec238885f48f569a520c46f40bef72' then
    raise exception 'Страж на бою не равен L — откат сверить вручную: order_v4_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_delete_guard()');
  if v is distinct from 'f2e4a081d688472c48cd9f3850a2ee45' then
    raise exception 'Страж на бою не равен L — откат сверить вручную: order_v4_delete_guard() (md5 %)', v;
  end if;
end;
$pre$;

-- ── Откат L: стражи — тела B, но `notes` остаётся полем черновика ──
-- (K пишет notes через order_v4_save_full: тело B без notes дало бы 42501 на каждом
-- сохранении с комментарием). CHECK orders_notes_len остаётся (безвреден). Таблица журнала
-- остаётся без грантов, триггер выключен; гранты order_comments не возвращаются.
create or replace function public.order_v4_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- ALLOWED: ровно колонки UPDATE в order_v4_save + order_v4_set_urgent_days.
  -- Совпадение держит сторож orderV4Rights.test.ts (разбор SQL обеих функций)
  c_allowed constant text[] := array[
    'kind',
    'parent_id',
    'bitrix_deal',
    'title',
    'customer',
    'contact',
    'manager_name',
    'due_date',
    'delivery_method',
    'delivery_address',
    'packaging',
    'packaging_note',
    'packaging_width_mm',
    'packaging_height_mm',
    'stickers',
    'stickers_note',
    'sticker_preview_path',
    'no_chestny_znak',
    'urgent',
    'discount_mode',
    'discount_value',
    'price_total',
    'price_margin_pct',
    'urgent_days',
    -- L:begin notes-allowed
    -- «Комментарий для цехов» (веха 8): поле черновика, длину держит CHECK orders_notes_len
    'notes',
    -- L:end notes-allowed
    'updated_at'
  ];
  -- База заполняет сама: при INSERT вне RPC свободны (status и created_by
  -- сверяются отдельно, номер — по последовательности)
  c_db_filled constant text[] := array[
    'id',
    'order_number',
    'created_at',
    'created_by',
    'schema_version',
    'status',
    'data'
  ];
  -- При INSERT вне RPC — только умолчание: null, кроме перечисленных в c_insert_defaults
  c_insert_empty constant text[] := array[
    'total_sum',
    'total_qty',
    'item_type',
    'artwork_link',
    -- L:begin notes-insert-empty
    -- L:was|    'notes',
    -- L:end notes-insert-empty
    'erp_order_id',
    'paid_at',
    'tz_ready_at',
    'tech_checked_at',
    'archived_at',
    'paid_kind',
    'paid_override_reason',
    'sent_at',
    'launch_started_at',
    'launch_by',
    'launched_at',
    'launched_by'
  ];
  c_insert_defaults constant jsonb := '{"total_sum": 0, "total_qty": 0}'::jsonb;
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_rpc boolean := coalesce(current_setting('order_v4.rpc', true), '') = 'on'
                   and current_user <> 'authenticated';
  v_number text;
  v_key text;
  v_value jsonb;
begin
  if tg_op = 'INSERT' then
    if new.schema_version is distinct from 4 then return new; end if;
  elsif old.schema_version is distinct from 4 and new.schema_version is distinct from 4 then
    return new;
  end if;

  -- Служебный доступ (service_role, миграции): роль запроса и текущая роль
  -- не клиентские
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon')
     and current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;

  if tg_op = 'UPDATE' and new.schema_version is distinct from old.schema_version then
    raise exception using errcode = '42501', message = 'Версию заказа менять нельзя';
  end if;

  -- Путь превью стикера — только файл ЭТОГО заказа (как в order_v4_save)
  if coalesce(new.sticker_preview_path, '') <> ''
     and not public.order_artwork_path_ok(new.id, new.sticker_preview_path) then
    raise exception using errcode = '22023', message = 'Путь файла не принадлежит заказу';
  end if;

  -- Родитель: не сам заказ; новый или сменённый — виден вызывающему
  -- (страж — invoker: подзапрос идёт под RLS вызывающего)
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception using errcode = '42501', message = c_hidden;
    end if;
    if (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id)
       and not exists (select 1 from public.orders o where o.id = new.parent_id) then
      raise exception using errcode = '42501', message = c_hidden;
    end if;
  end if;

  if v_rpc then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' or new.created_by is distinct from v_uid then
      raise exception using errcode = '42501',
        message = 'Новый заказ — только черновик без служебных отметок';
    end if;
    for v_key, v_value in
      select key, value from jsonb_each(to_jsonb(new) - c_allowed - c_db_filled)
    loop
      if not (v_key = any (c_insert_empty))
         or v_value is distinct from coalesce(c_insert_defaults -> v_key, 'null'::jsonb) then
        raise exception using errcode = '42501',
          message = 'Новый заказ — только черновик без служебных отметок';
      end if;
    end loop;
    -- Номер — только из последовательности: тот, что умолчание колонки
    -- выдало в этом сеансе. Иной (подделка, своё значение) заменяется новым
    -- номером; законная вставка номер не тратит дважды
    begin
      v_number := public.order_number_format(currval('public.order_number_seq'));
    exception when object_not_in_prerequisite_state then
      v_number := null;
    end;
    if new.order_number is distinct from v_number then
      new.order_number := public.generate_order_number();
    end if;
    return new;
  end if;

  -- UPDATE вне RPC.
  -- Действия FK `on delete set null` выполняются от владельца таблицы —
  -- клиент (`authenticated`) в эти ветки не попадёт. Пропускается ровно
  -- обнуление ссылки на удалённую строку, остальное не меняется.
  -- Ветка «родитель удалён» (orders_parent_id_fkey)
  if current_user <> 'authenticated'
     and old.parent_id is not null and new.parent_id is null
     and not exists (select 1 from public.orders o where o.id = old.parent_id)
     and (to_jsonb(new) - array['parent_id', 'updated_at'])
         = (to_jsonb(old) - array['parent_id', 'updated_at']) then
    return new;
  end if;
  -- Ветка «заказ ERP удалён» (orders_erp_order_id_fkey): ERP удаляет свой заказ,
  -- заказ v4 сохраняет статус и теряет только ссылку
  if current_user <> 'authenticated'
     and old.erp_order_id is not null and new.erp_order_id is null
     and not exists (select 1 from public.erp_orders e where e.id = old.erp_order_id)
     and (to_jsonb(new) - array['erp_order_id', 'updated_at'])
         = (to_jsonb(old) - array['erp_order_id', 'updated_at']) then
    return new;
  end if;
  if old.status is distinct from 'draft' then
    raise exception using errcode = '42501', message = 'Заказ отправлен в работу — правка закрыта';
  end if;
  if (to_jsonb(new) - c_allowed) is distinct from (to_jsonb(old) - c_allowed) then
    raise exception using errcode = '42501',
      message = 'Это поле заказа меняется только действием (отправка, оплата, запуск)';
  end if;
  return new;
end;
$$;

revoke execute on function public.order_v4_guard() from public, anon, authenticated;

create or replace function public.order_v4_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.schema_version is distinct from 4 then
    return old;
  end if;
  -- Служебный доступ (service_role, миграции)
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return old;
  end if;
  if old.status is distinct from 'draft' or old.erp_order_id is not null
     or exists (select 1 from public.erp_orders e where e.tz_order_id = old.id) then
    raise exception using errcode = '42501',
      message = 'Удалить можно только черновик, не запущенный в производство';
  end if;
  return old;
end;
$$;

revoke execute on function public.order_v4_delete_guard() from public, anon, authenticated;

revoke all on public.sales_staff_events from public, anon, authenticated;
alter table public.profiles disable trigger profiles_sales_staff_audit;

notify pgrst, 'reload schema';

-- ── Сверка отката: стражи = B + notes / B ──
do $chk$
declare v text;
begin
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_guard()');
  if v is distinct from '95329c51fb463e39266d420ef7dda452' then
    raise exception 'ОТКАТ: страж не равен телу отката: order_v4_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_delete_guard()');
  if v is distinct from '328e9df158071c55cbec4e655686d9b7' then
    raise exception 'ОТКАТ: страж не равен телу отката: order_v4_delete_guard() (md5 %)', v;
  end if;
end;
$chk$;

-- ── Пробы после отката L ──

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
