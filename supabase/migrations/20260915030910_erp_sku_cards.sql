-- КАТАЛОГ SKU В ERP: СХЕМА, ПРАВА И ВЕРСИИ (правка заказчика 14.09, п. 6).
--
-- ЧТО ЭТО РЯДОМ С СУЩЕСТВУЮЩИМ КАТАЛОГОМ. `app_config.sku_catalog` —
-- ПРАЙС-КАТАЛОГ ВИЗАРДА: по нему считается заказ в Order Studio, его читают
-- редактор SKU, экспресс-расчёт и шаги визарда. На бою в нём 52 артикула.
-- `erp_sku_cards` — КАРТОЧКА ИЗДЕЛИЯ В ПРОИЗВОДСТВЕ: техпакет, файлы, версии,
-- история, связь с разработкой и с заказами. Связь между ними — по КОДУ,
-- и это сознательно: две сущности отвечают на разные вопросы («сколько
-- стоит» и «как это шьётся»), а слить их в одну значило бы либо тащить
-- производственные поля в прайс визарда, либо ценовые — в техпакет.
--
-- ЖИВАЯ БАЗА 15.09 ИЗМЕНИЛА ОДНО РЕШЕНИЕ. План предполагал, что каталог
-- наполнится публикациями из разработок. На бою разработка ОДНА, а моделей
-- у фабрики 52 — то есть вкладка открывалась бы пустой при полном прайсе.
-- Поэтому карточки засеваются из прайс-каталога следующей миграцией:
-- «механизм, которому нечем питаться, — не исполненное требование».
--
-- `app_config` читает любой вошедший (политика `app_config_select`), поэтому
-- «есть ли артикул в прайсе» экран спрашивает у самого прайса, а не хранит
-- у себя вторым флагом.

-- ── Права ─────────────────────────────────────────────────────────────────
/**
 * ЧЕТЫРЕ ПРАВА, а не одно, потому что решения разные: смотреть карточку,
 * править техпакет, ВЫПУСТИТЬ артикул в прайс визарда (после этого по нему
 * начнут считать заказы) и убрать модель из выбора.
 *
 * `sku.publish` выдаётся ровно тем, у кого сегодня `catalog.edit`
 * (директор и руководитель производства) — иначе правка молча отобрала бы
 * у кого-то работающий доступ.
 */
insert into public.erp_role_permissions (role, permission, allowed) values
  ('director',        'sku.view',    true),
  ('production_head', 'sku.view',    true),
  ('technologist',    'sku.view',    true),
  ('manager',         'sku.view',    true),
  ('dispatcher',      'sku.view',    true),
  ('designer',        'sku.view',    true),
  ('purchaser',       'sku.view',    true),
  ('director',        'sku.edit',    true),
  ('production_head', 'sku.edit',    true),
  ('technologist',    'sku.edit',    true),
  ('designer',        'sku.edit',    true),
  ('director',        'sku.publish', true),
  ('production_head', 'sku.publish', true),
  ('director',        'sku.archive', true),
  ('production_head', 'sku.archive', true)
on conflict (role, permission) do nothing;

-- ── Карточка ──────────────────────────────────────────────────────────────
create table if not exists public.erp_sku_cards (
  id uuid primary key default gen_random_uuid(),
  /**
   * КОД — та самая связь с прайс-каталогом визарда. Уникален: два артикула
   * с одним кодом означали бы два ответа на вопрос «что это за модель»,
   * и заказы разошлись бы по обоим.
   */
  code text not null unique,
  name text not null,
  category text,
  description text,
  /** Крой изделия — справочник `fit`, тот же, что у позиции заказа */
  fit text,
  /**
   * ТЕХНИЧЕСКОЕ НАЗВАНИЕ ЛЕКАЛ и их версия. Версия ЛЕКАЛ и версия КАРТОЧКИ —
   * разные величины (прямое требование документа): лекала меняются реже
   * описания, и «версия 3» у карточки не означает, что перешили лекала.
   */
  pattern_tech_name text,
  pattern_version text,
  card_version int not null default 1,
  /**
   * `draft` — «требует заполнения»: так приходит карточка, созданная
   * автоматически при завершении разработки. `active` — модель в работе,
   * `archived` — из выбора убрана, но история заказов по ней осталась.
   */
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  /**
   * Разработка, из которой модель вышла. UNIQUE — «одна разработка = одна
   * карточка» ОГРАНИЧЕНИЕМ: повтор нажатия, обновление страницы и повтор
   * запроса дают 23505, а не второй техпакет той же модели.
   */
  experimental_id uuid unique references public.erp_experimental(id) on delete set null,
  /** Позиция заказа, на которой модель отшили впервые — для «откуда это» */
  source_item_id uuid references public.erp_order_items(id) on delete set null,
  /** Технический пакет словами технолога: те же ключи, что у разработки */
  final_package jsonb not null default '{}'::jsonb,
  price_min numeric,
  price_max numeric,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_sku_cards_status_idx on public.erp_sku_cards (status, name);

comment on table public.erp_sku_cards is
  'Карточка изделия в производстве (техпакет, файлы, версии). Прайс-каталог визарда живёт отдельно в app_config.sku_catalog, связь — по коду.';

-- ── История версий ────────────────────────────────────────────────────────
/**
 * ВЕРСИИ ПИШЕТ ТРИГГЕР, А НЕ КЛИЕНТ. Отдай это клиенту — и правка через
 * REST (а карточку правят двое: технолог и дизайнер) не оставила бы истории
 * вовсе. Тот же довод, по которому аудит заказа ведёт `erp_log_changes`.
 */
create table if not exists public.erp_sku_card_versions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.erp_sku_cards(id) on delete cascade,
  version int not null,
  /** Снимок карточки ПОСЛЕ правки: «что стало», а не дельта */
  snapshot jsonb not null,
  /** Что именно изменилось — чтобы история читалась без сравнения снимков */
  changed_fields text[] not null default '{}',
  author_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (card_id, version)
);

-- ── Файлы карточки ────────────────────────────────────────────────────────
/**
 * ФАЙЛЫ НЕ КОПИРУЮТСЯ. Карточка ссылается на уже загруженное вложение
 * разработки (`erp_order_attachments`), а рядом лежит СНИМОК пути и имени:
 * разработку могут удалить, а техпакет модели обязан пережить её. Замена
 * файла — новая строка, прежняя получает `superseded_at`; DELETE-политики
 * нет вовсе, как у файлов финального пакета.
 */
create table if not exists public.erp_sku_card_files (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.erp_sku_cards(id) on delete cascade,
  attachment_id uuid references public.erp_order_attachments(id) on delete set null,
  /** Что это за файл: лекала, техпаспорт, фото образца, прочее */
  role text not null default 'other'
    check (role in ('pattern', 'passport', 'photo', 'other')),
  file_path text not null,
  file_name text,
  version int not null default 1,
  superseded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists erp_sku_card_files_card_idx
  on public.erp_sku_card_files (card_id) where superseded_at is null;

-- ── Связь позиции заказа с карточкой ──────────────────────────────────────
/**
 * ССЫЛКА, А НЕ ЗАМЕНА ПОЛЕЙ. Позиция продолжает хранить собственные
 * `product_type`, размерную сетку и техблок — это СНИМОК на момент заказа.
 * Правка карточки задним числом не имеет права переписать действующий
 * заказ (прямой запрет документа), и одной ссылкой это выразить нельзя.
 */
/*
 * СТРАЖ ПОЗИЦИИ ЭТУ КОЛОНКУ УЖЕ ЗАКРЫВАЕТ, и проверено это базой, а не
 * памятью: план требовал «вписать `sku_card_id` в перечень колонок
 * `erp_order_item_guard`», но действующая редакция функции колонок НЕ
 * ПЕРЕЧИСЛЯЕТ — она требует `order.manage` на любую правку позиции
 * (исключение одно, помеченная транзакция роллапа отгрузки). Дописывать
 * перечисление ради одной колонки значило бы сузить страж: всё, что в него
 * не попало, стало бы разрешённым.
 */
alter table public.erp_order_items
  add column if not exists sku_card_id uuid references public.erp_sku_cards(id);

create index if not exists erp_order_items_sku_card_idx
  on public.erp_order_items (sku_card_id) where sku_card_id is not null;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.erp_sku_cards enable row level security;
alter table public.erp_sku_card_versions enable row level security;
alter table public.erp_sku_card_files enable row level security;

create policy erp_sku_cards_read on public.erp_sku_cards
  for select to authenticated using (public.erp_has_permission('sku.view'));
create policy erp_sku_cards_insert on public.erp_sku_cards
  for insert to authenticated with check (public.erp_has_permission('sku.edit'));
/**
 * ОДНА UPDATE-ПОЛИТИКА, А РАЗБОР ПО КОЛОНКАМ — У СТРАЖА: RLS работает
 * на уровне строки и не видит, что именно изменилось. Правило проекта,
 * и здесь оно нужно буквально: «сменить описание» и «выпустить артикул
 * в прайс» — разные решения с разной ценой.
 */
create policy erp_sku_cards_update on public.erp_sku_cards
  for update to authenticated
  using (public.erp_has_permission('sku.edit')
      or public.erp_has_permission('sku.publish')
      or public.erp_has_permission('sku.archive'))
  with check (public.erp_has_permission('sku.edit')
      or public.erp_has_permission('sku.publish')
      or public.erp_has_permission('sku.archive'));
/**
 * DELETE-ПОЛИТИКИ НЕТ. Модель не удаляют, а архивируют: по ней есть заказы,
 * и удаление карточки оставило бы их без ответа на вопрос «что это было».
 */

create policy erp_sku_card_versions_read on public.erp_sku_card_versions
  for select to authenticated using (public.erp_has_permission('sku.view'));
/** Пишет только триггер (`definer`) — клиенту история не принадлежит */

create policy erp_sku_card_files_read on public.erp_sku_card_files
  for select to authenticated using (public.erp_has_permission('sku.view'));
create policy erp_sku_card_files_insert on public.erp_sku_card_files
  for insert to authenticated with check (public.erp_has_permission('sku.edit'));
create policy erp_sku_card_files_update on public.erp_sku_card_files
  for update to authenticated
  using (public.erp_has_permission('sku.edit'))
  with check (public.erp_has_permission('sku.edit'));

-- ── Страж: что каким правом меняется ──────────────────────────────────────
create or replace function public.erp_sku_card_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  /**
   * ВЫПУСК В РАБОТУ — отдельное право. После него по модели начнут
   * считать заказы, и «поправить описание» такой цены не имеет.
   */
  if new.status is distinct from old.status then
    if new.status = 'active' and not public.erp_has_permission('sku.publish') then
      raise exception 'erp_sku_card_guard: выпуск модели в работу требует права sku.publish'
        using errcode = '42501';
    end if;
    if new.status = 'archived' and not public.erp_has_permission('sku.archive') then
      raise exception 'erp_sku_card_guard: архивирование модели требует права sku.archive'
        using errcode = '42501';
    end if;
    if new.status = 'draft' and not public.erp_has_permission('sku.edit') then
      raise exception 'erp_sku_card_guard: возврат модели в черновик требует права sku.edit'
        using errcode = '42501';
    end if;
  end if;

  /**
   * КОД — ЭТО СВЯЗЬ С ПРАЙС-КАТАЛОГОМ. Смена кода рвёт её молча: карточка
   * останется, а артикул визарда будет описывать другую модель. Поэтому
   * то же право, что и на выпуск.
   */
  if new.code is distinct from old.code
     and not public.erp_has_permission('sku.publish') then
    raise exception 'erp_sku_card_guard: смена кода артикула требует права sku.publish'
      using errcode = '42501';
  end if;

  /**
   * ВЕРСИЮ КАРТОЧКИ ВЕДЁТ ТРИГГЕР ИСТОРИИ, и клиент её не пишет. Иначе
   * номер версии стал бы полем формы: две правки с одинаковым номером
   * и история, в которой нечего искать.
   */
  if new.card_version is distinct from old.card_version then
    raise exception 'erp_sku_card_guard: версию карточки ведёт система'
      using errcode = '42501';
  end if;

  if not public.erp_has_permission('sku.edit')
     and (new.name is distinct from old.name
       or new.category is distinct from old.category
       or new.description is distinct from old.description
       or new.fit is distinct from old.fit
       or new.pattern_tech_name is distinct from old.pattern_tech_name
       or new.pattern_version is distinct from old.pattern_version
       or new.final_package is distinct from old.final_package
       or new.price_min is distinct from old.price_min
       or new.price_max is distinct from old.price_max) then
    raise exception 'erp_sku_card_guard: правка карточки требует права sku.edit'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end $$;

comment on function public.erp_sku_card_guard() is
  'UPDATE erp_sku_cards: выпуск — sku.publish, архив — sku.archive, прочее — sku.edit. Версию карточки клиент не пишет.';

drop trigger if exists erp_sku_card_guard on public.erp_sku_cards;
create trigger erp_sku_card_guard
  before update on public.erp_sku_cards
  for each row execute function public.erp_sku_card_guard();

-- ── Версия карточки: номер и снимок ───────────────────────────────────────
/**
 * ИМЯ ТРИГГЕРА ВАЖНО: BEFORE-триггеры Postgres выполняет в алфавитном
 * порядке, и `erp_sku_card_guard` обязан отработать РАНЬШЕ
 * (`g` < `v`) — иначе страж увидел бы уже поднятый номер версии и решил,
 * что его поднял клиент.
 */
create or replace function public.erp_sku_card_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields text[] := '{}';
begin
  -- Перечисляем ЗНАЧИМЫЕ поля: служебные `updated_at` и `card_version`
  -- в истории были бы шумом, который прячет настоящую правку
  if new.name is distinct from old.name then v_fields := v_fields || 'name'; end if;
  if new.code is distinct from old.code then v_fields := v_fields || 'code'; end if;
  if new.category is distinct from old.category then v_fields := v_fields || 'category'; end if;
  if new.description is distinct from old.description then v_fields := v_fields || 'description'; end if;
  if new.fit is distinct from old.fit then v_fields := v_fields || 'fit'; end if;
  if new.pattern_tech_name is distinct from old.pattern_tech_name then v_fields := v_fields || 'pattern_tech_name'; end if;
  if new.pattern_version is distinct from old.pattern_version then v_fields := v_fields || 'pattern_version'; end if;
  if new.status is distinct from old.status then v_fields := v_fields || 'status'; end if;
  if new.final_package is distinct from old.final_package then v_fields := v_fields || 'final_package'; end if;
  if new.price_min is distinct from old.price_min then v_fields := v_fields || 'price_min'; end if;
  if new.price_max is distinct from old.price_max then v_fields := v_fields || 'price_max'; end if;

  -- Правка, не изменившая ничего значимого, версии не получает: иначе
  -- история копила бы строки «ничего не изменилось»
  if array_length(v_fields, 1) is null then
    return new;
  end if;

  new.card_version := old.card_version + 1;
  insert into public.erp_sku_card_versions (card_id, version, snapshot, changed_fields, author_id)
  values (new.id, new.card_version, to_jsonb(new), v_fields, (select auth.uid()));
  return new;
end $$;

comment on function public.erp_sku_card_version() is
  'Версия карточки SKU: номер и снимок пишет система. Правка без значимых изменений версии не получает.';

drop trigger if exists erp_sku_card_version on public.erp_sku_cards;
create trigger erp_sku_card_version
  before update on public.erp_sku_cards
  for each row execute function public.erp_sku_card_version();

-- ── Статистика заказов по модели ──────────────────────────────────────────
/**
 * СЧИТАЕТСЯ ТОЛЬКО ПО `sku_card_id`. Сравнения по названию здесь нет вовсе
 * (требование документа и защита от одноимённых моделей): «Худи» в трёх
 * заказах могут быть тремя разными изделиями.
 *
 * Исключаются ОТМЕНЁННЫЕ заказы — решение владельца 14.09. Признака
 * тестового заказа в системе нет: колонка `is_demo` снята правкой 12.09,
 * и фильтровать по нему нечего.
 *
 * `security invoker`: статистику видит тот, кому видны заказы.
 */
create or replace function public.erp_sku_card_stats(p_card uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'orders', count(distinct o.id),
    'qty', coalesce(sum(i.qty), 0),
    'last_order_at', max(o.created_at)
  )
  from public.erp_order_items i
  join public.erp_orders o on o.id = i.order_id
  where i.sku_card_id = p_card
    and o.status is distinct from 'cancelled';
$$;

comment on function public.erp_sku_card_stats(uuid) is
  'Сколько заказов и штук по модели. Только по sku_card_id — сравнение по названию дало бы чужие заказы одноимённых моделей. Отменённые не считаются.';

revoke execute on function public.erp_sku_card_guard() from anon, authenticated, public;
revoke execute on function public.erp_sku_card_version() from anon, authenticated, public;
revoke execute on function public.erp_sku_card_stats(uuid) from public, anon;
grant execute on function public.erp_sku_card_stats(uuid) to authenticated;
