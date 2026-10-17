-- Order v4, веха 5а единого потока, миграция H (17.10): флэты изделий.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m5a-design.md, задача 2
-- (с разделами «Проверка безопасности», «Проверка скиллами», «Ответы владельца»).
-- Пробы: supabase/probes/garment_flats.sql (и order_v4_rights.sql — перегрузка
-- sales_set_staff(uuid, boolean) убрана).
--
-- Что добавляет:
--   1. Закрытый бакет `garment-flats` (SVG флэтов, 1 МБ, только image/svg+xml).
--      Путь — `flats/<flat_id>/v<N>/<вид>.svg`, ASCII, версия 1…9999
--      (`garment_flat_path_ok`). Объект неизменяем: новая версия флэта —
--      новый путь, старые заказы и PDF ссылаются на «свою» картинку.
--      Чтение — активным и одобренным (`catalog_reader()`), запись — admin
--      и director (`catalog_writer()`), UPDATE запрещён всем restrictive-
--      политикой (upsert, move, перезапись метаданных). Политики DELETE нет
--      (решение проверки безопасности L1): версии неизменяемы, уборка — 5б.
--   2. Ключ `app_config.garmentFlats` в `catalog_put` — только admin и director
--      (`v_admin_pair`), и его проверка формы в `catalog_value_check` (22023):
--      `svg_path` обязан равняться пути, выведенному из id, версии и вида.
--      Тела обеих функций — подлинный текст миграции G (на бою 17.10 md5
--      `prosrc` совпал с файлом G), правки только названные.
--   3. CHECK формы `order_item_prints.layout`: null или объект `v = 1`
--      не больше 8 КБ; CHECK `order_items.flat_id`: '' или id флэта.
--      На бою 17.10: layout не null — 0 строк, flat_id не пуст — 0 строк.
--   4. Две зоны штанов в живом `app_config.zonesCatalog` (решение владельца
--      17.10): `pants-front` «Штанина перед», `pants-back` «Штанина зад»,
--      только если зоны с таким id ещё нет (идемпотентно).
--   5. Удаление перегрузки `sales_set_staff(uuid, boolean)` (обёртка миграции F):
--      клиент зовёт только трёхаргументную (`api/salesStaff.ts`).
--
-- DDL по erp_* нет.
--
-- ВЫКАТКА: H — до мерджа (только добавляет; удаление неиспользуемой перегрузки).
-- Сухой прогон и применение — файлами через SQL Editor владельцем.
-- Сид флэтов — после выкладки фронта (кнопка «Загрузить типовые флэты»).
--
-- ОТКАТ (новой миграцией; фронт откатывается первым, H без фронта безопасна):
--   0. Объекты бакета удаляет владелец в панели Storage (политики DELETE нет).
--   1. drop policy if exists garment_flats_select / garment_flats_insert /
--      garment_flats_no_update on storage.objects;
--   2. delete from storage.buckets where id = 'garment-flats';
--   3. catalog_put и catalog_value_check — текстом миграции G
--      (20261017150000_order_catalogs.sql), ключ garmentFlats удалить из app_config;
--   4. alter table public.order_item_prints drop constraint order_item_prints_layout_check;
--      alter table public.order_items drop constraint order_items_flat_id_check;
--   5. drop function public.garment_flat_path_ok(text);
--   6. Зоны штанов можно оставить (прежний клиент их просто покажет).
--   Перегрузку sales_set_staff(uuid, boolean) НЕ возвращать: клиент её не зовёт.

-- ── 1. Бакет ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garment-flats', 'garment-flats', false, 1048576, array['image/svg+xml'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Путь объекта ──────────────────────────────────────────────────────
-- `$` в регулярке Postgres — конец строки (перевод строки в конце не проходит)

create or replace function public.garment_flat_path_ok(p_name text)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select coalesce(p_name ~ '^flats/[a-z0-9][a-z0-9-]{0,62}/v[1-9][0-9]{0,3}/(front|back|sleeve_left|sleeve_right)\.svg$', false);
$$;

revoke execute on function public.garment_flat_path_ok(text) from public, anon;
grant execute on function public.garment_flat_path_ok(text) to authenticated;

-- ── 3. Политики storage.objects: на команду ──────────────────────────────

drop policy if exists "garment_flats_select" on storage.objects;
drop policy if exists "garment_flats_insert" on storage.objects;
drop policy if exists "garment_flats_update" on storage.objects;
drop policy if exists "garment_flats_no_update" on storage.objects;
drop policy if exists "garment_flats_delete" on storage.objects;

create policy garment_flats_select on storage.objects
  for select to authenticated
  using (bucket_id = 'garment-flats' and (select public.catalog_reader()));

create policy garment_flats_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'garment-flats' and public.garment_flat_path_ok(name) and (select public.catalog_writer()));

-- Restrictive — AND с каждой permissive: ни upsert, ни move внутрь или наружу,
-- ни перезапись метаданных (в том числе против будущей широкой permissive)
create policy garment_flats_no_update on storage.objects
  as restrictive
  for update to authenticated
  using (bucket_id <> 'garment-flats')
  with check (bucket_id <> 'garment-flats');

-- ── 4. Проверка формы записи: + garmentFlats ─────────────────────────────
-- Текст миграции G, вставлена только ветка garmentFlats перед общими списками

create or replace function public.catalog_value_check(p_table text, p_key text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_bad text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    raise exception using errcode = '22023', message = 'Пустой справочник не сохраняется';
  end if;
  if octet_length(p_value::text) > 1048576 then
    raise exception using errcode = '22023', message = 'Справочник больше 1 МБ — сохранение отклонено';
  end if;

  -- Поставщики с палитрами
  if p_table = 'catalog_config' and p_key = 'suppliers' then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception using errcode = '22023', message = 'Поставщики — список';
    end if;
    select 'поставщик ' || coalesce(s->>'id', '?') into v_bad
      from jsonb_array_elements(p_value) s
     where jsonb_typeof(s) <> 'object'
        or coalesce(jsonb_typeof(s->'id'), '') <> 'string' or btrim(s->>'id') = ''
        or coalesce(jsonb_typeof(s->'name'), '') <> 'string' or btrim(s->>'name') = ''
        or coalesce(jsonb_typeof(s->'isDefault'), '') <> 'boolean'
        or coalesce(jsonb_typeof(s->'active'), '') <> 'boolean'
        or coalesce(jsonb_typeof(s->'fabricSupplierNames'), '') <> 'array'
        or exists (select 1 from jsonb_array_elements(s->'fabricSupplierNames') n
                    where jsonb_typeof(n) <> 'string')
        or coalesce(jsonb_typeof(s->'palette'), '') <> 'object'
        or coalesce(jsonb_typeof(s->'palette'->'groups'), '') <> 'array'
        or coalesce(jsonb_typeof(s->'palette'->'colors'), '') <> 'array'
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Поставщики: неверная запись — ' || v_bad;
    end if;
    if (select count(*) from jsonb_array_elements(p_value) s where (s->>'isDefault')::boolean) <> 1 then
      raise exception using errcode = '22023', message = 'Палитра по умолчанию должна быть ровно одна';
    end if;
    if (select count(*) <> count(distinct s->>'id') from jsonb_array_elements(p_value) s) then
      raise exception using errcode = '22023', message = 'Поставщики: id повторяется';
    end if;
    select 'группа ' || coalesce(g->>'id', '?') into v_bad
      from jsonb_array_elements(p_value) s, jsonb_array_elements(s->'palette'->'groups') g
     where jsonb_typeof(g) <> 'object'
        or coalesce(jsonb_typeof(g->'id'), '') <> 'string' or btrim(g->>'id') = ''
        or coalesce(jsonb_typeof(g->'label'), '') <> 'string'
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Палитра: неверная запись — ' || v_bad;
    end if;
    select 'цвет ' || coalesce(c->>'code', '?') into v_bad
      from jsonb_array_elements(p_value) s, jsonb_array_elements(s->'palette'->'colors') c
     where jsonb_typeof(c) <> 'object'
        or coalesce(jsonb_typeof(c->'code'), '') <> 'string' or btrim(c->>'code') = ''
        or coalesce(jsonb_typeof(c->'name'), '') <> 'string'
        or coalesce(jsonb_typeof(c->'hex'), '') <> 'string' or (c->>'hex') !~ '^#[0-9A-Fa-f]{6}$'
        or coalesce(jsonb_typeof(c->'group'), '') <> 'string'
        or coalesce(jsonb_typeof(c->'active'), '') <> 'boolean'
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Палитра: неверная запись — ' || v_bad;
    end if;
    -- Коды сравниваются после btrim — как у клиента (validateSuppliers):
    -- «01-01» и «01-01 » — один код
    select btrim(c->>'code') into v_bad
      from jsonb_array_elements(p_value) s, jsonb_array_elements(s->'palette'->'colors') c
     group by btrim(c->>'code') having count(*) > 1 limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Код цвета повторяется: ' || v_bad;
    end if;
    return;
  end if;

  -- Бирки: виды, варианты, материалы, схемы
  if p_table = 'app_config' and p_key = 'labelLibrary' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(jsonb_typeof(p_value->'kinds'), '') <> 'array'
       or coalesce(jsonb_typeof(p_value->'schemes'), '') <> 'array' then
      raise exception using errcode = '22023', message = 'Бирки: нужны списки видов и схем';
    end if;
    select 'вид ' || coalesce(k->>'type', '?') into v_bad
      from jsonb_array_elements(p_value->'kinds') k
     where jsonb_typeof(k) <> 'object'
        or coalesce(jsonb_typeof(k->'type'), '') <> 'string' or btrim(k->>'type') = ''
        or coalesce(jsonb_typeof(k->'name'), '') <> 'string'
        or coalesce(jsonb_typeof(k->'active'), '') <> 'boolean'
        or coalesce(jsonb_typeof(k->'variants'), '') <> 'array'
        or coalesce(jsonb_typeof(k->'materials'), '') <> 'array'
        or exists (select 1 from jsonb_array_elements(k->'variants') v
                    where jsonb_typeof(v) <> 'object'
                       or coalesce(jsonb_typeof(v->'id'), '') <> 'string' or btrim(v->>'id') = ''
                       or coalesce(jsonb_typeof(v->'name'), '') <> 'string'
                       or coalesce(jsonb_typeof(v->'price'), '') <> 'number' or (v->>'price')::numeric < 0
                       or coalesce(jsonb_typeof(v->'withMaterial'), '') <> 'boolean'
                       or coalesce(jsonb_typeof(v->'active'), '') <> 'boolean')
        or exists (select 1 from jsonb_array_elements(k->'materials') m
                    where jsonb_typeof(m) <> 'object'
                       or coalesce(jsonb_typeof(m->'key'), '') <> 'string' or btrim(m->>'key') = ''
                       or coalesce(jsonb_typeof(m->'name'), '') <> 'string'
                       or coalesce(jsonb_typeof(m->'priceDelta'), '') <> 'number'
                       or coalesce(jsonb_typeof(m->'active'), '') <> 'boolean')
        or (select count(*) <> count(distinct v->>'id') from jsonb_array_elements(k->'variants') v)
        or (select count(*) <> count(distinct m->>'key') from jsonb_array_elements(k->'materials') m)
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Бирки: неверная запись — ' || v_bad;
    end if;
    if (select count(*) <> count(distinct k->>'type') from jsonb_array_elements(p_value->'kinds') k) then
      raise exception using errcode = '22023', message = 'Бирки: вид повторяется';
    end if;
    select 'схема ' || coalesce(s->>'id', '?') into v_bad
      from jsonb_array_elements(p_value->'schemes') s
     where jsonb_typeof(s) <> 'object'
        or coalesce(jsonb_typeof(s->'id'), '') <> 'string' or btrim(s->>'id') = ''
        or coalesce(jsonb_typeof(s->'name'), '') <> 'string'
        or coalesce(jsonb_typeof(s->'active'), '') <> 'boolean'
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Бирки: неверная запись — ' || v_bad;
    end if;
    if (select count(*) <> count(distinct s->>'id') from jsonb_array_elements(p_value->'schemes') s) then
      raise exception using errcode = '22023', message = 'Бирки: схема повторяется';
    end if;
    return;
  end if;

  -- Настройки ТЗ
  if p_table = 'app_config' and p_key = 'tzSettings' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(jsonb_typeof(p_value->'footerText'), '') <> 'string'
       or char_length(p_value->>'footerText') > 2000 then
      raise exception using errcode = '22023', message = 'Подвал ТЗ — текст до 2000 знаков';
    end if;
    return;
  end if;

  -- Флэты изделий (миграция H, веха 5а). Начало ветки — сторож catalogKeys.test.ts
  -- сверяет: тело без этой ветки = тело G
  if p_table = 'app_config' and p_key = 'garmentFlats' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(jsonb_typeof(p_value->'version'), '') <> 'number' or (p_value->>'version') <> '1'
       or coalesce(jsonb_typeof(p_value->'flats'), '') <> 'array' then
      raise exception using errcode = '22023', message = 'Флэты: нужен объект версии 1 со списком flats';
    end if;
    -- Флэт: id, версия 1…9999 (целое), active, название, списки подбора, виды
    select 'флэт ' || left(coalesce(f->>'id', '?'), 80) into v_bad
      from jsonb_array_elements(p_value->'flats') f
     where jsonb_typeof(f) <> 'object'
        or coalesce(jsonb_typeof(f->'id'), '') <> 'string' or (f->>'id') !~ '^[a-z0-9][a-z0-9-]{0,62}$'
        or coalesce(jsonb_typeof(f->'version'), '') <> 'number' or (f->>'version') !~ '^[1-9][0-9]{0,3}$'
        or coalesce(jsonb_typeof(f->'active'), '') <> 'boolean'
        or coalesce(jsonb_typeof(f->'name'), '') <> 'string' or char_length(f->>'name') > 200
        or exists (select 1 from unnest(array['categories', 'fits', 'sku_codes']) l
                    where f ? l
                      and (jsonb_typeof(f->l) <> 'array'
                           or exists (select 1 from jsonb_array_elements(f->l) e
                                       where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 100)))
        or coalesce(jsonb_typeof(f->'views'), '') <> 'array' or jsonb_array_length(f->'views') = 0
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    if (select count(*) <> count(distinct f->>'id') from jsonb_array_elements(p_value->'flats') f) then
      raise exception using errcode = '22023', message = 'Флэты: id повторяется';
    end if;
    -- Вид: перечень, путь SVG выводится из id, версии и вида (клиент не направит
    -- флэт на чужой объект бакета), масштаб (0; 10], непустые зоны без повторов id
    select 'вид ' || left(f->>'id', 80) || '/' || left(coalesce(v->>'kind', '?'), 40) into v_bad
      from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(f->'views') v
     where jsonb_typeof(v) <> 'object'
        or coalesce(jsonb_typeof(v->'kind'), '') <> 'string'
        or (v->>'kind') not in ('front', 'back', 'sleeve_left', 'sleeve_right')
        or coalesce(jsonb_typeof(v->'svg_path'), '') <> 'string'
        or (v->>'svg_path') <> 'flats/' || (f->>'id') || '/v' || (f->>'version') || '/' || (v->>'kind') || '.svg'
        or coalesce(jsonb_typeof(v->'scale_mm_per_unit'), '') <> 'number'
        or (v->>'scale_mm_per_unit')::numeric <= 0 or (v->>'scale_mm_per_unit')::numeric > 10
        or coalesce(jsonb_typeof(v->'print_areas'), '') <> 'array' or jsonb_array_length(v->'print_areas') = 0
        or (select count(*) <> count(distinct a->>'id') from jsonb_array_elements(v->'print_areas') a)
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    if exists (select 1 from jsonb_array_elements(p_value->'flats') f
                where (select count(*) <> count(distinct v->>'kind') from jsonb_array_elements(f->'views') v)) then
      raise exception using errcode = '22023', message = 'Флэты: вид флэта повторяется';
    end if;
    -- Зона: id, название, zone_id (строка или null), многоугольник 3…256 точек
    -- с |координатой| ≤ 5000 мм, методы — из CHECK order_item_prints_method_check
    select 'зона ' || left(f->>'id', 80) || '/' || left(v->>'kind', 40) || '/' || left(coalesce(a->>'id', '?'), 80) into v_bad
      from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(f->'views') v,
           jsonb_array_elements(v->'print_areas') a
     where jsonb_typeof(a) <> 'object'
        or coalesce(jsonb_typeof(a->'id'), '') <> 'string' or (a->>'id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
        or coalesce(jsonb_typeof(a->'name'), '') <> 'string' or char_length(a->>'name') > 200
        or coalesce(jsonb_typeof(a->'zone_id'), 'null') not in ('string', 'null')
        or char_length(coalesce(a->>'zone_id', '')) > 64
        or coalesce(jsonb_typeof(a->'polygon_mm'), '') <> 'array'
        or jsonb_array_length(a->'polygon_mm') < 3 or jsonb_array_length(a->'polygon_mm') > 256
        or exists (select 1 from jsonb_array_elements(a->'polygon_mm') pt
                    where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                       or exists (select 1 from jsonb_array_elements(pt) c
                                   where jsonb_typeof(c) <> 'number' or abs((c #>> '{}')::numeric) > 5000))
        or (a ? 'methods'
            and (jsonb_typeof(a->'methods') <> 'array'
                 or exists (select 1 from jsonb_array_elements(a->'methods') m
                             where jsonb_typeof(m) <> 'string'
                                or (m #>> '{}') not in ('silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg',
                                                        'sublimation', 'patch', 'other'))))
        or (coalesce(jsonb_typeof(a->'default_method'), 'null') <> 'null'
            and (jsonb_typeof(a->'default_method') <> 'string'
                 or (a->>'default_method') not in ('silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg',
                                                   'sublimation', 'patch', 'other')))
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    return;
  end if;
  -- Конец ветки garmentFlats (миграция H)

  -- Каталог моделей и общий прайс-каталог: списки
  if (p_table = 'catalog_config' and p_key in ('fabricsCatalog', 'trimCatalog'))
     or (p_table = 'app_config'
         and p_key in ('sku_catalog', 'extrasCatalog', 'hardwareCatalog', 'categoryRules', 'zonesCatalog')) then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception using errcode = '22023', message = 'Справочник — список';
    end if;
    return;
  end if;

  raise exception using errcode = '22023', message = 'Такого справочника нет';
end;
$$;

revoke execute on function public.catalog_value_check(text, text, jsonb) from public, anon, authenticated;

-- ── 5. catalog_put: + garmentFlats (только admin, director) ─────────────
-- Текст миграции G, правка — только список v_admin_pair

create or replace function public.catalog_put(p_table text, p_key text, p_value jsonb, p_base jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sales_pair boolean;
  v_admin_pair boolean;
  v_ts timestamptz;
begin
  if not public.sales_is_lead() then
    raise exception using errcode = '42501',
      message = 'Справочники меняет администратор, директор или руководитель продаж';
  end if;

  -- Белый список: статические пары, регистр важен
  v_sales_pair := (p_table = 'catalog_config' and p_key = 'suppliers')
               or (p_table = 'app_config' and p_key in ('labelLibrary', 'tzSettings'));
  v_admin_pair := (p_table = 'catalog_config' and p_key in ('fabricsCatalog', 'trimCatalog'))
               or (p_table = 'app_config'
                   and p_key in ('sku_catalog', 'extrasCatalog', 'hardwareCatalog', 'categoryRules', 'zonesCatalog', 'garmentFlats'));
  if not coalesce(v_sales_pair or v_admin_pair, false) then
    raise exception using errcode = '22023', message = 'Такого справочника нет';
  end if;
  if v_admin_pair and not public.catalog_writer() then
    raise exception using errcode = '42501',
      message = 'Каталог моделей и тканей меняет администратор или директор';
  end if;

  perform public.catalog_value_check(p_table, p_key, p_value);

  if p_table = 'catalog_config' then
    if p_base is null then
      insert into public.catalog_config (key, value, updated_at, updated_by)
      values (p_key, p_value, now(), (select auth.uid()))
      on conflict (key) do nothing
      returning updated_at into v_ts;
    else
      update public.catalog_config
         set value = p_value, updated_at = now(), updated_by = (select auth.uid())
       where key = p_key and value = p_base
      returning updated_at into v_ts;
    end if;
  else
    if p_base is null then
      insert into public.app_config (key, value, updated_at)
      values (p_key, p_value, now())
      on conflict (key) do nothing
      returning updated_at into v_ts;
    else
      update public.app_config
         set value = p_value, updated_at = now()
       where key = p_key and value = p_base
      returning updated_at into v_ts;
    end if;
  end if;

  if v_ts is null then
    raise exception using errcode = 'P0001',
      message = 'Справочник изменён — загрузите свежую версию';
  end if;
  return v_ts;
end;
$$;

comment on function public.catalog_put(text, text, jsonb, jsonb) is
  'Запись справочника с защитой от затирания: where value = p_base (миграция G, веха 4; garmentFlats — миграция H, веха 5а). Белый список пар, проверка формы.';

revoke execute on function public.catalog_put(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.catalog_put(text, text, jsonb, jsonb) to authenticated;

-- ── 6. Форма нанесения и флэт позиции ────────────────────────────────────
-- `layout` — только геометрия холста (PrintLayoutV1): объект версии 1, ≤ 8 КБ.
-- Таблицы малые, на бою 17.10 layout не null и flat_id не пуст — 0 строк

alter table public.order_item_prints drop constraint if exists order_item_prints_layout_check;
alter table public.order_item_prints add constraint order_item_prints_layout_check
  check (layout is null
         or (jsonb_typeof(layout) = 'object'
             and layout->>'v' = '1'
             and octet_length(layout::text) <= 8192));

alter table public.order_items drop constraint if exists order_items_flat_id_check;
alter table public.order_items add constraint order_items_flat_id_check
  check (flat_id = '' or flat_id ~ '^[a-z0-9][a-z0-9-]{0,62}$');

-- ── 7. Зоны штанов в живом справочнике зон ───────────────────────────────
-- Дописываются только отсутствующие по id; существующие зоны не меняются.
-- Значения = ZONES_CATALOG_DEFAULT (`pinhead-react/src/data/constants.js`, задача 1)

update public.app_config c
   set value = c.value || (
         select jsonb_agg(z order by (z->>'sortOrder')::int)
           from jsonb_array_elements($zones$[
             {"id": "pants-front", "name": "Штанина перед", "forCategories": ["pants"], "sortOrder": 11},
             {"id": "pants-back", "name": "Штанина зад", "forCategories": ["pants"], "sortOrder": 12}
           ]$zones$::jsonb) z
          where not exists (select 1 from jsonb_array_elements(c.value) e where e->>'id' = z->>'id')),
       updated_at = now()
 where c.key = 'zonesCatalog'
   and jsonb_typeof(c.value) = 'array'
   and exists (select 1 from jsonb_array_elements($zones$[{"id": "pants-front"}, {"id": "pants-back"}]$zones$::jsonb) z
                where not exists (select 1 from jsonb_array_elements(c.value) e where e->>'id' = z->>'id'));

-- ── 8. Перегрузка sales_set_staff(uuid, boolean) ─────────────────────────

drop function if exists public.sales_set_staff(uuid, boolean);

notify pgrst, 'reload schema';
