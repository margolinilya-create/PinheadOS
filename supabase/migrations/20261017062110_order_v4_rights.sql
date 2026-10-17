-- Order v4, веха 2 единого потока, миграция B (17.10): права заказа v4.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m2-data-rights.md,
-- «Решения» пп. 1–5 и поправки «Проверка плана скиллами» и «Проверка
-- безопасности» (они приоритетнее: журнал — `order_events`, страж —
-- белый список и на INSERT/UPDATE/DELETE, запуск — через `order_v4_launch_check`).
--
-- Что закрывает:
--   · прямой `UPDATE orders` ставил заказу v4 любой статус (`production`, `done`)
--     мимо всех проверок — теперь статус, оплата и связь с ERP меняются только
--     RPC этого файла (`security definer`, свой гейт);
--   · позиции, нанесения, бирки и карточки правились в любом статусе — теперь
--     только у черновика;
--   · политики `orders` не смотрели на `active`/`approved` профиля.
--
-- Таблицы `erp_*` миграция НЕ трогает (ERP заморожен): только ЧИТАЕТ
-- `erp_employees` (кто МС) и `erp_orders` (заказ ERP этого запуска).
--
-- Режим RPC стража: definer-функция ставит `set_config('order_v4.rpc','on', true)`
-- перед своим UPDATE и `'off'` сразу после. Страж верит метке, только если
-- `current_user <> 'authenticated'` (внутри definer это владелец функции;
-- клиенту такое недоступно). Парность on/off держит сторож orderV4Rights.test.ts.
--
-- Откат: новая миграция с прежними политиками `orders_*`
-- (20260727230000_orderstudio_rls_perf.sql, раздел orders) и `drop trigger`
-- стражей этого файла.

-- ── 1. Кто есть кто ──────────────────────────────────────────────────────

-- Руководство продаж: admin, director, rop — активный и одобренный профиль
create or replace function public.sales_is_lead()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role in ('admin', 'director', 'rop'));
$$;

-- Менеджер сопровождения (МС): активная строка erp_employees с ролью manager,
-- привязанная к активному и одобренному профилю вызывающего
create or replace function public.sales_is_ms()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.erp_employees e on e.profile_id = p.id
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and e.active is true and e.role = 'manager');
$$;

-- Менеджер продаж (автор заказа): профиль manager, активный и одобренный.
-- В ERP такие профили бывают кем угодно (сегодня — production_head): права
-- продаж и права цеха — разные вопросы
create or replace function public.sales_is_seller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role = 'manager');
$$;

revoke execute on function public.sales_is_lead() from public, anon;
grant execute on function public.sales_is_lead() to authenticated;
revoke execute on function public.sales_is_ms() from public, anon;
grant execute on function public.sales_is_ms() to authenticated;
revoke execute on function public.sales_is_seller() from public, anon;
grant execute on function public.sales_is_seller() to authenticated;

-- Есть ли у заказа заказ ERP (любой, в том числе невидимый вызывающему):
-- страж `orders` — security invoker, а RLS ERP не обязана показывать менеджеру
-- продаж чужие ей заказы
create or replace function public.order_v4_has_erp(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.erp_orders e where e.tz_order_id = p_order);
$$;

revoke execute on function public.order_v4_has_erp(uuid) from public, anon;
grant execute on function public.order_v4_has_erp(uuid) to authenticated;

-- ── 2. RLS orders: политики на команду ───────────────────────────────────
-- v3 — как раньше (руководство или свой заказ менеджера), но профиль обязан
-- быть активным и одобренным. МС видит v4 с этапа «К запуску» и дальше.

drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists orders_delete on public.orders;

create policy orders_select on public.orders
  for select to authenticated
  using (
    (select public.sales_is_lead())
    or ((select public.sales_is_seller()) and created_by = (select auth.uid()))
    or (schema_version = 4
        and status in ('ready_to_launch', 'production', 'done')
        and (select public.sales_is_ms()))
  );
create policy orders_insert on public.orders
  for insert to authenticated
  with check (
    (select public.sales_is_lead())
    or ((select public.sales_is_seller()) and created_by = (select auth.uid()))
  );
create policy orders_update on public.orders
  for update to authenticated
  using (
    (select public.sales_is_lead())
    or ((select public.sales_is_seller()) and created_by = (select auth.uid()))
  )
  with check (
    (select public.sales_is_lead())
    or ((select public.sales_is_seller()) and created_by = (select auth.uid()))
  );
create policy orders_delete on public.orders
  for delete to authenticated
  using (
    (select public.sales_is_lead())
    or ((select public.sales_is_seller()) and created_by = (select auth.uid()))
  );

-- ── 3. Журнал событий заказа ─────────────────────────────────────────────
-- Переходы статуса и отметки оплаты (кто, когда, причина). Пишут только
-- definer-RPC этого файла; клиенту — только чтение через родителя.

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('status', 'payment')),
  from_status text,
  to_status text,
  payment_kind text,
  reason text,
  actor uuid,
  at timestamptz not null default now()
);

create index if not exists order_events_order_at_idx on public.order_events (order_id, at);

alter table public.order_events enable row level security;

drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

revoke insert, update, delete, truncate on public.order_events from public, anon, authenticated;

-- ── 4. Страж orders (v4) ─────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE OR DELETE. Срабатывает, если old ИЛИ new — v4:
-- через смену версии его не обойти. Перечисляет ИСКЛЮЧЕНИЯ (белый список):
-- вне режима RPC меняются только колонки, которые пишут `order_v4_save`
-- (миграция 20261017053703) и `order_v4_set_urgent_days`, и только у черновика.
-- Пути файлов и родитель проверяются в любом режиме.

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
    'updated_at'
  ];
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_rpc boolean := coalesce(current_setting('order_v4.rpc', true), '') = 'on'
                   and current_user <> 'authenticated';
  v_number text;
begin
  if tg_op = 'INSERT' then
    if new.schema_version is distinct from 4 then return new; end if;
  elsif tg_op = 'DELETE' then
    if old.schema_version is distinct from 4 then return old; end if;
  elsif old.schema_version is distinct from 4 and new.schema_version is distinct from 4 then
    return new;
  end if;

  -- Служебный доступ (service_role, миграции): пользователя нет, роль не клиентская
  if v_uid is null and current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;

  if tg_op = 'UPDATE' and new.schema_version is distinct from old.schema_version then
    raise exception using errcode = '42501', message = 'Версию заказа менять нельзя';
  end if;

  if tg_op = 'DELETE' then
    if old.status is distinct from 'draft' or old.erp_order_id is not null
       or public.order_v4_has_erp(old.id) then
      raise exception using errcode = '42501',
        message = 'Удалить можно только черновик, не запущенный в производство';
    end if;
    return old;
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
    if new.status is distinct from 'draft'
       or new.created_by is distinct from v_uid
       or new.erp_order_id is not null
       or new.paid_at is not null or new.paid_kind is not null
       or new.paid_override_reason is not null
       or new.sent_at is not null
       or new.launch_started_at is not null or new.launch_by is not null
       or new.launched_at is not null or new.launched_by is not null
       or new.archived_at is not null
       or new.tz_ready_at is not null or new.tech_checked_at is not null then
      raise exception using errcode = '42501',
        message = 'Новый заказ — только черновик без служебных отметок';
    end if;
    -- Номер — только из умолчания колонки (generate_order_number): тот, что
    -- последовательность только что выдала в этом сеансе. Формат — как
    -- в generate_order_number()
    begin
      select 'PH-' || lpad(s.n::text, greatest(4, length(s.n::text)), '0')
        into v_number
        from (select currval('public.order_number_seq') as n) s;
    exception when object_not_in_prerequisite_state then
      v_number := null;
    end;
    if new.order_number is distinct from v_number then
      raise exception using errcode = '42501', message = 'Номер заказа присваивает база';
    end if;
    return new;
  end if;

  -- UPDATE вне RPC.
  -- Ветка «родитель удалён»: `parent_id … on delete set null` обнуляет ссылку
  -- и у отправленного заказа — пропускаем ровно это: прежнего родителя больше
  -- нет, а кроме parent_id (и updated_at) ничего не меняется. Действие FK
  -- выполняется от владельца таблицы — клиент (`authenticated`) сюда не попадёт
  if current_user <> 'authenticated'
     and old.parent_id is not null and new.parent_id is null
     and not exists (select 1 from public.orders o where o.id = old.parent_id)
     and (to_jsonb(new) - array['parent_id', 'updated_at'])
         = (to_jsonb(old) - array['parent_id', 'updated_at']) then
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

drop trigger if exists orders_v4_guard on public.orders;
create trigger orders_v4_guard
  before insert or update or delete on public.orders
  for each row execute function public.order_v4_guard();

-- ── 5. Стражи строк заказа ───────────────────────────────────────────────
-- Позиции, нанесения, бирки, карточки заметок: запись — только пока заказ v4
-- в черновике; строку нельзя перенести в другой заказ/позицию; пути файлов —
-- только `orders/<id этого заказа>/…`. Родитель проверяется по old И new,
-- с `for share` (гонка с переходом статуса исключена).
-- Режима RPC здесь нет: ни одна RPC этого файла строки заказа не пишет,
-- а внутри definer-стража `current_user` — всегда владелец, и метку
-- нечем было бы проверить. Сохранение (`order_v4_save`, invoker) пишет
-- строки только черновика — его страж пропускает.

create or replace function public.order_v4_child_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_by_order boolean := tg_table_name in ('order_items', 'order_notes_cards');
  v_rec jsonb;
  v_order uuid;
  v_new_order uuid;
  v_status text;
  v_version smallint;
  v_path text;
begin
  -- Служебный доступ (service_role, миграции): пользователя нет
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE'
     and ((v_old->'order_id') is distinct from (v_new->'order_id')
          or (v_old->'item_id') is distinct from (v_new->'item_id')) then
    raise exception using errcode = '42501', message = 'Строку заказа нельзя перенести в другой заказ';
  end if;

  foreach v_rec in array array_remove(array[v_old, v_new], null) loop
    if v_by_order then
      v_order := (v_rec->>'order_id')::uuid;
    else
      select i.order_id into v_order from public.order_items i where i.id = (v_rec->>'item_id')::uuid;
    end if;
    if v_rec is not distinct from v_new then
      v_new_order := v_order;
    end if;
    if v_order is null then
      continue;                                  -- позиция уже удалена (каскад)
    end if;
    select o.status, o.schema_version into v_status, v_version
      from public.orders o where o.id = v_order
       for share;
    if not found or v_version is distinct from 4 then
      continue;                                  -- родитель удалён (каскад) или v3
    end if;
    if v_status is distinct from 'draft' then
      raise exception using errcode = '42501', message = 'Заказ отправлен в работу — правка закрыта';
    end if;
  end loop;

  if v_new is not null then
    for v_path in
      select x from (
        select v_new->>'tz_pdf_path' union all
        select v_new->>'artwork_path' union all
        select v_new->>'attach_image_path' union all
        select v_new->>'image_path') t(x)
       where coalesce(x, '') <> ''
      union all
      select e from jsonb_array_elements_text(coalesce(v_new->'preview_paths', '[]'::jsonb)) as e
    loop
      if not public.order_artwork_path_ok(v_new_order, v_path) then
        raise exception using errcode = '22023', message = 'Путь файла не принадлежит заказу';
      end if;
    end loop;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.order_v4_child_guard() from public, anon, authenticated;

drop trigger if exists order_items_v4_guard on public.order_items;
create trigger order_items_v4_guard
  before insert or update or delete on public.order_items
  for each row execute function public.order_v4_child_guard();
drop trigger if exists order_item_prints_v4_guard on public.order_item_prints;
create trigger order_item_prints_v4_guard
  before insert or update or delete on public.order_item_prints
  for each row execute function public.order_v4_child_guard();
drop trigger if exists order_item_labels_v4_guard on public.order_item_labels;
create trigger order_item_labels_v4_guard
  before insert or update or delete on public.order_item_labels
  for each row execute function public.order_v4_child_guard();
drop trigger if exists order_notes_cards_v4_guard on public.order_notes_cards;
create trigger order_notes_cards_v4_guard
  before insert or update or delete on public.order_notes_cards
  for each row execute function public.order_v4_child_guard();

-- ── 6. Переход статуса ───────────────────────────────────────────────────
--   draft → ready_to_launch   автор-менеджер или admin/director/rop; клиент, срок, позиции
--   ready_to_launch → draft   МС или admin/director; причина обязательна
--   ready_to_launch → production  МС или admin/director; был launch_check;
--                             заказ ERP ЭТОГО запуска; оплата или причина без оплаты
--   production → done         МС или admin/director
--   draft → archived          автор-менеджер или admin
-- «Нет заказа» и «не ваш заказ» — одна ошибка 42501.

create or replace function public.order_v4_transition(p_id uuid, p_to text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_boss boolean;
  v_author boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.orders%rowtype;
  v_from text;
  v_erp uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  if p_to is null or p_to not in ('ready_to_launch', 'draft', 'production', 'done', 'archived') then
    raise exception using errcode = '22023', message = 'Неизвестный статус заказа';
  end if;
  if length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'Причина — не длиннее 500 символов';
  end if;

  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := v_role in ('admin', 'director', 'rop');
  v_boss := v_role in ('admin', 'director');

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  v_from := v_row.status;
  v_author := v_role = 'manager' and v_row.created_by = v_uid;
  -- Видимость — правила RLS orders_select, повторённые явно
  if not (coalesce(v_lead, false) or coalesce(v_author, false)
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;

  -- Повтор запуска после сбоя ответа: уже в производстве — ответ тот же
  if p_to = 'production' and v_row.status = 'production' and (v_ms or coalesce(v_boss, false)) then
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id);
  end if;

  if v_row.status = 'draft' and p_to = 'ready_to_launch' then
    if not (coalesce(v_author, false) or coalesce(v_lead, false)) then
      raise exception using errcode = '42501', message = 'Отправить в работу может автор заказа или руководитель';
    end if;
    if coalesce(btrim(v_row.customer), '') = '' then
      raise exception using errcode = 'P0001', message = 'Не указан клиент';
    end if;
    if v_row.due_date is null then
      raise exception using errcode = 'P0001', message = 'Не указан срок';
    end if;
    if not exists (select 1 from public.order_items i where i.order_id = p_id) then
      raise exception using errcode = 'P0001', message = 'В заказе нет позиций';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'ready_to_launch', sent_at = now(), updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'ready_to_launch' and p_to = 'draft' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Вернуть заказ может МС или руководитель производства';
    end if;
    if v_reason is null then
      raise exception using errcode = 'P0001', message = 'Укажите причину возврата';
    end if;
    -- Заказ ERP уже создан (сбой между созданием и переходом) — возврат
    -- оставил бы его сиротой с занятой связью
    if exists (select 1 from public.erp_orders e
                where e.tz_order_id = p_id and e.status <> 'cancelled') then
      raise exception using errcode = 'P0001',
        message = 'Заказ уже создан в производстве — сначала завершите запуск';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'draft', launch_started_at = null, launch_by = null, updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'ready_to_launch' and p_to = 'production' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Запустить заказ может МС или руководитель производства';
    end if;
    if v_row.launch_started_at is null then
      raise exception using errcode = 'P0001', message = 'Сначала проверка запуска';
    end if;
    if v_row.paid_at is null and v_row.paid_override_reason is null then
      raise exception using errcode = 'P0001', message = 'Нет отметки оплаты';
    end if;
    select e.id into v_erp from public.erp_orders e
     where e.tz_order_id = p_id
       and e.created_at >= v_row.launch_started_at
       and e.tz_number = v_row.order_number
       and e.status <> 'cancelled'
     order by e.created_at desc
     limit 1;
    if v_erp is null then
      raise exception using errcode = 'P0001', message = 'Заказ ERP этого запуска не найден';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders
       set status = 'production', erp_order_id = v_erp, launched_at = now(), launched_by = v_uid,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'production' and p_to = 'done' then
    if not (v_ms or coalesce(v_boss, false)) then
      raise exception using errcode = '42501', message = 'Завершить заказ может МС или руководитель производства';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'done', updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  elsif v_row.status = 'draft' and p_to = 'archived' then
    if not (coalesce(v_author, false) or v_role = 'admin') then
      raise exception using errcode = '42501', message = 'В архив черновик убирает автор или администратор';
    end if;
    perform set_config('order_v4.rpc', 'on', true);
    update public.orders set status = 'archived', archived_at = now(), updated_at = now()
     where id = p_id returning * into v_row;
    perform set_config('order_v4.rpc', 'off', true);

  else
    raise exception using errcode = 'P0001', message = 'Такой переход статуса недоступен';
  end if;

  insert into public.order_events (order_id, kind, from_status, to_status, reason, actor)
  values (p_id, 'status', v_from, p_to, v_reason, v_uid);

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'erp_order_id', v_row.erp_order_id);
end;
$$;

revoke execute on function public.order_v4_transition(uuid, text, text) from public, anon;
grant execute on function public.order_v4_transition(uuid, text, text) to authenticated;

-- ── 7. Проверка запуска ──────────────────────────────────────────────────
-- Шаг ДО создания заказа ERP: проверяет условия перехода в production и
-- ставит `launch_started_at` — переход примет только заказ ERP, созданный
-- после этой метки, с тем же номером и не отменённый. Невыполненное
-- условие — ответ `{ ok: false, reason }`, не исключение.
-- Сирота прошлой попытки (заказ ERP этого запуска есть, переход не прошёл)
-- метку не сбрасывает: `{ ok: true, already: true, erp_order_id }`.

create or replace function public.order_v4_launch_check(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_boss boolean;
  v_row public.orders%rowtype;
  v_erp uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := v_role in ('admin', 'director', 'rop');
  v_boss := v_role in ('admin', 'director');

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  if not (coalesce(v_lead, false)
          or (v_role = 'manager' and v_row.created_by = v_uid)
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  if not (v_ms or coalesce(v_boss, false)) then
    raise exception using errcode = '42501', message = 'Запустить заказ может МС или руководитель производства';
  end if;

  if v_row.erp_order_id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'erp_order_id', v_row.erp_order_id);
  end if;
  if v_row.status is distinct from 'ready_to_launch' then
    return jsonb_build_object('ok', false, 'reason', 'Заказ не ожидает запуска');
  end if;
  if v_row.paid_at is null and v_row.paid_override_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'Нет отметки оплаты');
  end if;
  if not exists (select 1 from public.order_items i where i.order_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'В заказе нет позиций');
  end if;

  -- Заказ ERP с этой связью уже есть
  if exists (select 1 from public.erp_orders e where e.tz_order_id = p_id) then
    select e.id into v_erp from public.erp_orders e
     where e.tz_order_id = p_id
       and v_row.launch_started_at is not null
       and e.created_at >= v_row.launch_started_at
       and e.tz_number = v_row.order_number
       and e.status <> 'cancelled';
    if v_erp is not null then
      return jsonb_build_object('ok', true, 'already', true, 'erp_order_id', v_erp,
                                'launch_started_at', v_row.launch_started_at);
    end if;
    return jsonb_build_object('ok', false, 'reason',
      'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства');
  end if;

  perform set_config('order_v4.rpc', 'on', true);
  update public.orders set launch_started_at = now(), launch_by = v_uid
   where id = p_id returning * into v_row;
  perform set_config('order_v4.rpc', 'off', true);

  return jsonb_build_object('ok', true, 'already', false, 'launch_started_at', v_row.launch_started_at);
end;
$$;

revoke execute on function public.order_v4_launch_check(uuid) from public, anon;
grant execute on function public.order_v4_launch_check(uuid) to authenticated;

-- ── 8. Оплата ────────────────────────────────────────────────────────────
-- Отметку (prepaid | full | null — снять) ставят автор-менеджер и руководство
-- (admin/director/rop), только в draft и ready_to_launch. Причина «запуск без
-- оплаты» (`p_override_reason`) — только руководство.
-- Снятие причины: вызов руководства с `p_kind = null` и без причины снимает
-- И отметку, И причину (полный сброс). Автор `p_kind = null` снимает только
-- свою отметку — решение руководства остаётся. Каждый вызов — событие журнала.

create or replace function public.order_v4_set_payment(
  p_id uuid, p_kind text, p_override_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_hidden constant text := 'Заказ не найден или недоступен';
  v_uid uuid := (select auth.uid());
  v_role text;
  v_ms boolean;
  v_lead boolean;
  v_author boolean;
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_row public.orders%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Нужен вход в систему';
  end if;
  if p_kind is not null and p_kind not in ('prepaid', 'full') then
    raise exception using errcode = '22023', message = 'Вид оплаты: prepaid или full';
  end if;
  if length(p_override_reason) > 500 then
    raise exception using errcode = '22023', message = 'Причина — не длиннее 500 символов';
  end if;
  select p.role into v_role from public.profiles p
   where p.id = v_uid and p.active is true and p.approved is true;
  v_role := coalesce(v_role, '');                -- нет профиля / отключён — никто
  v_ms := public.sales_is_ms();
  v_lead := coalesce(v_role in ('admin', 'director', 'rop'), false);

  select * into v_row from public.orders where id = p_id and schema_version = 4 for update;
  if not found then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  v_author := coalesce(v_role = 'manager' and v_row.created_by = v_uid, false);
  if not (v_lead or v_author
          or (v_ms and v_row.status in ('ready_to_launch', 'production', 'done'))) then
    raise exception using errcode = '42501', message = c_hidden;
  end if;
  if not (v_lead or v_author) then
    raise exception using errcode = '42501', message = 'Оплату отмечает автор заказа или руководитель';
  end if;
  if v_row.status not in ('draft', 'ready_to_launch') then
    raise exception using errcode = 'P0001', message = 'Оплату отмечают до запуска';
  end if;
  if v_reason is not null and not v_lead then
    raise exception using errcode = '42501', message = 'Запуск без оплаты разрешает только руководитель';
  end if;

  perform set_config('order_v4.rpc', 'on', true);
  update public.orders
     set paid_at = case when p_kind is null then null else now() end,
         paid_kind = p_kind,
         paid_override_reason = case
           when v_reason is not null then v_reason
           when p_kind is null and v_lead then null
           else paid_override_reason end,
         updated_at = now()
   where id = p_id returning * into v_row;
  perform set_config('order_v4.rpc', 'off', true);

  insert into public.order_events (order_id, kind, payment_kind, reason, actor)
  values (p_id, 'payment', p_kind, v_reason, v_uid);

  return jsonb_build_object(
    'id', v_row.id,
    'paid_at', v_row.paid_at,
    'paid_kind', v_row.paid_kind,
    'paid_override_reason', v_row.paid_override_reason);
end;
$$;

revoke execute on function public.order_v4_set_payment(uuid, text, text) from public, anon;
grant execute on function public.order_v4_set_payment(uuid, text, text) to authenticated;
