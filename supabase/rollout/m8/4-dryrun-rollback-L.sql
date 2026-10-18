-- СУХОЙ ПРОГОН ОТКАТА L до apply (КОНТРОЛЛЕР): предусловие, L, K (откат L годится и после K),
-- текст отката, сверка тел, пробы после отката (supabase/rollout/m8/probes-after-rollback-L.sql).
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=13 {…}

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
