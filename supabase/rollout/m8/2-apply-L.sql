-- ПРИМЕНЕНИЕ миграции L — после зелёных 1-dryrun-L, 1b-dryrun-L-regress (владелец),
-- 4-dryrun-rollback-L и мутаций L (каждая fails>0). ДО выкладки фронта вехи 8. КОНТРОЛЛЕР.
-- Ожидание: последний select — 't | 20261018150000'. Затем: пробы order_v3_readonly.sql на бою (fails=0),
-- APPLIED.json, npm run migrations:verify, 4b-dryrun-rollback-L-after-apply.sql (fails=0).
-- Откат — 3-rollback-L.sql (в любой момент: клиент вехи 8 v3 не пишет).

begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── Предусловие: J применена, L нет, стражи на бою — тела B (литералы задачи 0) ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018120000') then
    raise exception 'Сначала миграция J (20261018120000)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261018150000') then
    raise exception 'Миграция L уже записана в schema_migrations';
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_guard()');
  if v is distinct from '8dab43ebfb6d773f9c223844abb494fd' then
    raise exception 'Функции на бою не совпадают с B: order_v4_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_delete_guard()');
  if v is distinct from '328e9df158071c55cbec4e655686d9b7' then
    raise exception 'Функции на бою не совпадают с B: order_v4_delete_guard() (md5 %)', v;
  end if;
end;
$pre$;

-- ── Миграция L ──
-- Order v4, веха 8 единого потока, миграция L (18.10): старые заказы (v3) — только
-- чтение, комментарий к заказу — поле черновика с потолком длины, таблица
-- `order_comments` закрыта, журнал смены признаков «Ведёт заказы» / «МС».
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m8-polish-enable.md, задача 2
-- (решения К5, К6, «Проверка безопасности»). Порядок выкатки: L → фронт ревизии 4 → K
-- (L раньше K и по времени файла). Файлы выкатки — supabase/rollout/m8/.
--
-- Тела стражей — подлинный текст миграции B (20261017062110_order_v4_rights,
-- md5 `prosrc` на бою после J — литералы задачи 0); каждая правка — блок
--   -- L:begin <метка> … [-- L:was|<строка B дословно>] … -- L:end <метка>
-- Обратная замена блоков даёт тело B побайтно; замена всех блоков, кроме
-- `notes-*`, даёт тело отката L (B + классификация `notes`). Держит сторож
-- pinhead-react/src/orderstudio/orderV4M8.test.ts.
--
-- Что меняется:
--   · `order_v4_guard` (INSERT/UPDATE): ветки «пропустить не-v4» нет. Клиенту
--     (роль `authenticated`, не режим RPC) старый заказ — только чтение: вставка
--     с `schema_version` не 4 (и без неё — умолчание колонки 3) и правка строки
--     v3 — 42501. Проверка стоит ПОСЛЕ служебного доступа (SQL Editor, миграции,
--     service_role) и после веток FK «родитель удалён» / «заказ ERP удалён»:
--     обнуление ссылки действием FK идёт от владельца таблицы и проходит;
--   · `order_v4_guard`: `notes` — поле черновика (было «только пусто при вставке»).
--     RPC её пока не пишет; пишет `order_v4_save_full` после K;
--   · CHECK `orders_notes_len` (≤ 2000 знаков) — с той же минуты, с которой поле
--     пишется в обход RPC (`orders_update` пускает автора PATCH-ем через REST);
--   · `order_v4_delete_guard`: строка v3 клиенту — 42501 вместо пропуска;
--   · `order_comments`: гранты клиентских ролей отозваны целиком, политики
--     выключены (`using (false)`) — таблица пустая, без экранов и без uuid автора;
--   · `sales_staff_events` — журнал смены `profiles.is_sales` / `is_ms`. Пишет
--     AFTER UPDATE-триггер `profiles_sales_staff_audit` (security definer), поэтому
--     в журнал попадают и служебные смены (SQL Editor, service_role: `actor` null,
--     `source = 'service'`); через `sales_set_staff` — `actor` = вызывающий,
--     `source = 'rpc'`. Читает руководство продаж (`sales_is_lead()`), записи
--     клиенту нет. `sales_set_staff` не меняется.
--
-- Слов, на которых MCP `execute_sql` ждёт подтверждения, в исполняемом тексте
-- нет (сторож лексики): права отзываются `revoke all`, политики меняются
-- `alter policy`. Таблицы `erp_*` миграция не трогает.

-- ── 1. Стражи заказа: v3 только чтение, `notes` — поле черновика ─────────

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
  -- L:begin v3-skip
  -- Ветки «пропустить не-v4» больше нет: старые заказы (v3) клиенту только для чтения —
  -- отказ ниже, ПОСЛЕ служебного доступа и веток FK «родитель удалён» / «заказ ERP удалён» (веха 8, К6)
  -- L:was|  if tg_op = 'INSERT' then
  -- L:was|    if new.schema_version is distinct from 4 then return new; end if;
  -- L:was|  elsif old.schema_version is distinct from 4 and new.schema_version is distinct from 4 then
  -- L:was|    return new;
  -- L:was|  end if;
  -- L:was|
  -- L:end v3-skip
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
    -- L:begin v3-insert
    -- Новый заказ — только v4: умолчание колонки (3) клиенту больше не годится
    if new.schema_version is distinct from 4 then
      raise exception using errcode = '42501',
        message = 'Старые заказы (v3) только для чтения: новый заказ — укажите schema_version = 4';
    end if;
    -- L:end v3-insert
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
  -- L:begin v3-update
  -- Старый заказ (v3): клиенту только чтение. Ветки FK выше его тоже пропускают —
  -- удаление v4-родителя обнуляет parent_id строки v3
  if old.schema_version is distinct from 4 then
    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';
  end if;
  -- L:end v3-update
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
  -- L:begin v3-skip
  -- L:was|  if old.schema_version is distinct from 4 then
  -- L:was|    return old;
  -- L:was|  end if;
  -- L:end v3-skip
  -- Служебный доступ (service_role, миграции)
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon') then
    return old;
  end if;
  -- L:begin v3-delete
  -- Старый заказ (v3) клиент не удаляет: политика orders_delete пускает руководство и автора
  if old.schema_version is distinct from 4 then
    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';
  end if;
  -- L:end v3-delete
  if old.status is distinct from 'draft' or old.erp_order_id is not null
     or exists (select 1 from public.erp_orders e where e.tz_order_id = old.id) then
    raise exception using errcode = '42501',
      message = 'Удалить можно только черновик, не запущенный в производство';
  end if;
  return old;
end;
$$;

revoke execute on function public.order_v4_delete_guard() from public, anon, authenticated;

-- ── 2. Длина комментария к заказу ─────────────────────────────────────────
-- На бою 18.10 у всех строк `notes` пусто; `not valid` + `validate` — без долгой
-- блокировки на проверке старых строк.
alter table public.orders
  add constraint orders_notes_len check (notes is null or char_length(notes) <= 2000) not valid;
alter table public.orders validate constraint orders_notes_len;

-- ── 3. order_comments: закрыта целиком ───────────────────────────────────
-- Клиентский читатель (`store/useCommentsStore.ts`) убирает задача 8 вехи 8.
-- Политики остаются (без грантов недостижимы), но и сами ничего не пускают.
revoke all on public.order_comments from public, anon, authenticated;
alter policy order_comments_select on public.order_comments using (false);
alter policy order_comments_insert on public.order_comments with check (false);

-- ── 4. Журнал смены признаков «Ведёт заказы» / «МС» ──────────────────────
create table if not exists public.sales_staff_events (
  id bigserial primary key,
  profile_id uuid not null,
  kind text not null check (kind in ('sales', 'ms')),
  on_value boolean not null,
  actor uuid,
  source text not null check (source in ('rpc', 'service')),
  at timestamptz not null default now()
);

create index if not exists sales_staff_events_at_idx on public.sales_staff_events (at desc);

alter table public.sales_staff_events enable row level security;

create policy sales_staff_events_select on public.sales_staff_events
  for select to authenticated
  using ((select public.sales_is_lead()));

-- Пишет только триггер (владелец таблицы): клиенту — одно чтение по политике
revoke all on public.sales_staff_events from public, anon, authenticated;
grant select on public.sales_staff_events to authenticated;
revoke all on sequence public.sales_staff_events_id_seq from public, anon, authenticated;

-- Событие на каждую смену признака; повтор того же значения событий не даёт.
-- Клиент напрямую признаки не меняет (страж `profiles_sales_guard`), поэтому
-- `actor` не null означает вызов `sales_set_staff`
create or replace function public.profiles_sales_staff_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_source text := case when (select auth.uid()) is null then 'service' else 'rpc' end;
begin
  if new.is_sales is distinct from old.is_sales then
    insert into public.sales_staff_events (profile_id, kind, on_value, actor, source)
    values (new.id, 'sales', coalesce(new.is_sales, false), v_actor, v_source);
  end if;
  if new.is_ms is distinct from old.is_ms then
    insert into public.sales_staff_events (profile_id, kind, on_value, actor, source)
    values (new.id, 'ms', coalesce(new.is_ms, false), v_actor, v_source);
  end if;
  return null;
end;
$$;

revoke execute on function public.profiles_sales_staff_audit() from public, anon, authenticated;

create trigger profiles_sales_staff_audit
  after update of is_sales, is_ms on public.profiles
  for each row execute function public.profiles_sales_staff_audit();

notify pgrst, 'reload schema';

-- ── Сверка: стражи на бою = тексту L ──
do $chk$
declare v text;
begin
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_guard()');
  if v is distinct from '4fec238885f48f569a520c46f40bef72' then
    raise exception 'APPLY: страж не равен тексту L: order_v4_guard() (md5 %)', v;
  end if;
  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.order_v4_delete_guard()');
  if v is distinct from 'f2e4a081d688472c48cd9f3850a2ee45' then
    raise exception 'APPLY: страж не равен тексту L: order_v4_delete_guard() (md5 %)', v;
  end if;
end;
$chk$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261018150000', 'order_v3_readonly_staff_audit');

commit;

select to_regclass('public.sales_staff_events') is not null as l_on,
       (select max(version) from supabase_migrations.schema_migrations) as last_migration;
