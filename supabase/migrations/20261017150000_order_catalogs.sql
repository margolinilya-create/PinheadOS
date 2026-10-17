-- Order v4, веха 4 единого потока, миграция G (17.10): справочники заказа.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m4-admin.md, задача 1.
-- Пробы: supabase/probes/order_catalogs.sql.
--
-- Что закрывает:
--   1. Справочники заказа (поставщики с палитрами, бирки, подвал ТЗ, правила
--      цены) ведёт руководство продаж — admin, director и rop (решение
--      владельца 17.10). Прямая запись в `app_config`/`catalog_config` по-прежнему
--      только admin/director, поэтому rop пишет через RPC с белым списком.
--   2. Затирание. Справочник — ОДНА строка jsonb, и клиентское «прочитать →
--      поправить → записать» молча затирает чужую правку (вторая вкладка,
--      второй администратор, `erp_sku_catalog_upsert` из ERP). RPC пишут
--      условно: `where value = p_base` — равенство jsonb смысловое (порядок
--      ключей и `1.0`/`1` не важны), md5 на клиенте не нужен. Не совпало —
--      `P0001` «Справочник изменён — загрузите свежую версию».
--   3. Чтение. Было: `app_config` читал любой `authenticated` (в том числе
--      отключённый и неодобренный профиль), прайс `app_config.prices` — тоже.
--      Стало: справочники — только активным и одобренным (`catalog_reader()`),
--      прайс — продажам, МС и руководству (`catalog_price_reader()`).
--      Старый ключ `catalog_config.prices` — как раньше, только руководству.
--   4. Запись напрямую (решение владельца — не закрываем) требует теперь
--      `active and approved` (`catalog_writer()`): отключённый admin писал.
--   5. Гигиена: у `anon` к таблицам справочников нет ничего, у `authenticated`
--      нет truncate/references/trigger.
--
-- Что добавляет:
--   · `catalog_put(p_table, p_key, p_value, p_base) returns timestamptz` —
--     белый список пар СТАТИЧЕСКИМИ ветками (без склейки строк):
--       продажи (admin, director, rop): catalog_config.suppliers,
--         app_config.labelLibrary, app_config.tzSettings;
--       только admin, director: catalog_config.{fabricsCatalog, trimCatalog},
--         app_config.{sku_catalog, extrasCatalog, hardwareCatalog,
--         categoryRules, zonesCatalog}.
--     Прайс (`app_config.prices`) и прочие ключи (`feature_flags`, старые
--     `catalog_config.{prices,labels,extras,fabrics}`) — 22023.
--     `p_base = null` — только для отсутствующей строки.
--   · `prices_patch(p_patch, p_base) returns jsonb` — правка верхних ключей
--     прайса; `p_base` — прежние значения ТЕХ ЖЕ ключей, сверка по каждому.
--     rop — только `packOptions`, `prepFees`, `minMarginPct`; admin и director —
--     любые существующие ключи и эти три. Тип ключа не меняется, `null` —
--     только у `minMarginPct`, ключи упаковки — подмножество CHECK ERP
--     (none/bopp/zip/other).
--   · Проверка формы (`catalog_value_check`): тип значения по ключу, лимит
--     1 МБ, hex цвета `^#[0-9A-Fa-f]{6}$`, обязательные поля и уникальность id.
--   · RPC сами ставят `updated_at`, у `catalog_config` — и `updated_by`.
--   · Сиды: `catalog_config.suppliers`, `app_config.labelLibrary`,
--     `app_config.tzSettings` — `on conflict do nothing`; три ключа прайса —
--     `jsonb_build_object(новые) || value` (существующее значение побеждает);
--     матрица флекса `flexMatrix` (= FLEX_MATRIX кода) — тем же способом.
--     JSON сидов = `pinhead-react/src/orderstudio/catalog/seeds.ts` (сторож
--     `catalog/seedsMatch.test.ts`).
--
-- На бою 17.10 (SELECT pg_policies, information_schema): у обеих таблиц
-- политики на команду (миграция 20260727230000), `anon` и `authenticated`
-- имеют ВСЕ привилегии, триггеров нет. Ключи: app_config — sku_catalog,
-- feature_flags, extrasCatalog, hardwareCatalog, categoryRules, prices,
-- zonesCatalog; catalog_config — extras, fabrics, labels, prices, trimCatalog,
-- fabricsCatalog. В `app_config.prices` нет packOptions/prepFees/minMarginPct
-- и flexMatrix (47 ключей; ключ правит вкладка «Флекс» в /sku).
-- Профилей director и rop на бою нет (пробы ставят роль внутри транзакции).
--
-- ВЫКАТКА: G — до мерджа. Между применением G и выкладкой фронта
-- НЕ сохранять каталог в `/sku`: старый редактор upsert-ом перезапишет прайс
-- целиком (без новых ключей) — прямая запись admin/director не закрыта.
-- Начальники цехов и прочие без продаж перестают получать `app_config.prices`:
-- клиент считает по `PRICES` из кода (catalogSlice, запасной путь).
--
-- Откат: новая миграция — прежние политики (20260727230000) и гранты
-- `anon`; `drop function` RPC и хелперов этого файла. Сиды можно оставить:
-- прежний клиент их не читает.

-- ── 1. Хелперы прав ──────────────────────────────────────────────────────

-- Читатель справочников: активный и одобренный профиль
create or replace function public.catalog_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true);
$$;

-- Читатель прайса `app_config.prices`: продажи, МС и руководство продаж
-- (admin входит в `sales_is_lead()`). Начальник цеха прайс не видит
create or replace function public.catalog_price_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.sales_is_lead() or public.sales_is_seller() or public.sales_is_ms();
$$;

-- Писатель напрямую (политики) и писатель каталога моделей через RPC:
-- admin/director, активный и одобренный
create or replace function public.catalog_writer()
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
       and p.role in ('admin', 'director'));
$$;

revoke execute on function public.catalog_reader() from public, anon;
revoke execute on function public.catalog_price_reader() from public, anon;
revoke execute on function public.catalog_writer() from public, anon;
grant execute on function public.catalog_reader() to authenticated;
grant execute on function public.catalog_price_reader() to authenticated;
grant execute on function public.catalog_writer() to authenticated;

-- ── 2. RLS: политика на команду ──────────────────────────────────────────

drop policy if exists app_config_select on public.app_config;
drop policy if exists app_config_insert on public.app_config;
drop policy if exists app_config_update on public.app_config;
drop policy if exists app_config_delete on public.app_config;

create policy app_config_select on public.app_config
  for select to authenticated
  using ((select public.catalog_reader())
         and (key <> 'prices' or (select public.catalog_price_reader())));
create policy app_config_insert on public.app_config
  for insert to authenticated
  with check ((select public.catalog_writer()));
create policy app_config_update on public.app_config
  for update to authenticated
  using ((select public.catalog_writer()))
  with check ((select public.catalog_writer()));
create policy app_config_delete on public.app_config
  for delete to authenticated
  using ((select public.catalog_writer()));

drop policy if exists catalog_config_select on public.catalog_config;
drop policy if exists catalog_config_insert on public.catalog_config;
drop policy if exists catalog_config_update on public.catalog_config;
drop policy if exists catalog_config_delete on public.catalog_config;

-- Старый `catalog_config.prices` — как раньше, только руководству продаж
create policy catalog_config_select on public.catalog_config
  for select to authenticated
  using ((select public.catalog_reader())
         and (key <> 'prices' or (select public.sales_is_lead())));
create policy catalog_config_insert on public.catalog_config
  for insert to authenticated
  with check ((select public.catalog_writer()));
create policy catalog_config_update on public.catalog_config
  for update to authenticated
  using ((select public.catalog_writer()))
  with check ((select public.catalog_writer()));
create policy catalog_config_delete on public.catalog_config
  for delete to authenticated
  using ((select public.catalog_writer()));

-- ── 3. Гигиена привилегий ────────────────────────────────────────────────

revoke all on table public.app_config from public, anon;
revoke all on table public.catalog_config from public, anon;
revoke truncate, references, trigger on table public.app_config from authenticated;
revoke truncate, references, trigger on table public.catalog_config from authenticated;
grant select, insert, update, delete on table public.app_config to authenticated;
grant select, insert, update, delete on table public.catalog_config to authenticated;

-- ── 4. Проверка формы записи ─────────────────────────────────────────────
-- Только для RPC этого файла (execute отозван у клиентов). Ошибка — 22023
-- с русским текстом: его показывает редактор.

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

-- Правила цены в прайсе: три ключа, которые правит руководство продаж
create or replace function public.prices_rule_check(p_key text, p_value jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_key = 'packOptions' then
    if coalesce(jsonb_typeof(p_value), '') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_value) o
                   where jsonb_typeof(o) <> 'object'
                      or coalesce(jsonb_typeof(o->'key'), '') <> 'string'
                      or (o->>'key') not in ('none', 'bopp', 'zip', 'other')
                      or coalesce(jsonb_typeof(o->'name'), '') <> 'string'
                      or coalesce(jsonb_typeof(o->'price'), '') <> 'number'
                      or (o->>'price')::numeric < 0)
       or (select count(*) <> count(distinct o->>'key') from jsonb_array_elements(p_value) o) then
      raise exception using errcode = '22023',
        message = 'Упаковка: виды только none, bopp, zip, other, без повторов; цена — число не меньше 0';
    end if;
  elsif p_key = 'prepFees' then
    if coalesce(jsonb_typeof(p_value), '') <> 'object'
       or exists (select 1 from jsonb_each(p_value) f
                   where f.key not in ('silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg',
                                       'sublimation', 'patch', 'other')
                      or jsonb_typeof(f.value) <> 'number'
                      or (f.value #>> '{}')::numeric < 0) then
      raise exception using errcode = '22023',
        message = 'Подготовка: суммы по методам нанесения — числа не меньше 0';
    end if;
  elsif p_key = 'minMarginPct' then
    if coalesce(jsonb_typeof(p_value), '') not in ('null', 'number')
       or (jsonb_typeof(p_value) = 'number'
           and ((p_value #>> '{}')::numeric < 0 or (p_value #>> '{}')::numeric > 100)) then
      raise exception using errcode = '22023',
        message = 'Порог маржи — процент от 0 до 100 или пусто';
    end if;
  end if;
end;
$$;

revoke execute on function public.prices_rule_check(text, jsonb) from public, anon, authenticated;

-- ── 5. catalog_put ───────────────────────────────────────────────────────

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
                   and p_key in ('sku_catalog', 'extrasCatalog', 'hardwareCatalog', 'categoryRules', 'zonesCatalog'));
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
  'Запись справочника с защитой от затирания: where value = p_base (миграция G, веха 4). Белый список пар, проверка формы.';

revoke execute on function public.catalog_put(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.catalog_put(text, text, jsonb, jsonb) to authenticated;

-- ── 6. prices_patch ──────────────────────────────────────────────────────

create or replace function public.prices_patch(p_patch jsonb, p_base jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_exists boolean;
  v_cur jsonb;
  v_key text;
  v_new jsonb;
  v_ts timestamptz;
begin
  if not public.sales_is_lead() then
    raise exception using errcode = '42501',
      message = 'Справочники меняет администратор, директор или руководитель продаж';
  end if;
  v_admin := public.catalog_writer();

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception using errcode = '22023', message = 'Правка прайса — объект ключей и их прежних значений';
  end if;
  if exists (select 1 from jsonb_object_keys(p_base) b where not p_patch ? b) then
    raise exception using errcode = '22023', message = 'Прежние значения — только для правимых ключей';
  end if;

  select value into v_cur from public.app_config where key = 'prices' for update;
  v_exists := found;
  v_cur := coalesce(v_cur, '{}'::jsonb);
  if jsonb_typeof(v_cur) <> 'object' then
    raise exception using errcode = '22023', message = 'Прайс в базе — не объект';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key in ('packOptions', 'prepFees', 'minMarginPct') then
      perform public.prices_rule_check(v_key, p_patch->v_key);
    elsif v_cur ? v_key then
      if not v_admin then
        raise exception using errcode = '42501',
          message = 'Руководитель продаж меняет только упаковку, подготовку и порог маржи';
      end if;
      if jsonb_typeof(p_patch->v_key) = 'null' then
        raise exception using errcode = '22023', message = 'Ключ прайса не очищается: ' || v_key;
      end if;
      if jsonb_typeof(v_cur->v_key) <> 'null'
         and jsonb_typeof(p_patch->v_key) <> jsonb_typeof(v_cur->v_key) then
        raise exception using errcode = '22023', message = 'Тип ключа прайса не меняется: ' || v_key;
      end if;
    else
      raise exception using errcode = '22023', message = 'Такого ключа прайса нет: ' || v_key;
    end if;
  end loop;

  -- Сверка с базой по каждому ключу: отсутствующий ключ и json null — одно и то же
  for v_key in select jsonb_object_keys(p_patch) loop
    if coalesce(v_cur->v_key, 'null'::jsonb) <> coalesce(p_base->v_key, 'null'::jsonb) then
      raise exception using errcode = 'P0001',
        message = 'Справочник изменён — загрузите свежую версию';
    end if;
  end loop;

  v_new := v_cur || p_patch;
  if octet_length(v_new::text) > 1048576 then
    raise exception using errcode = '22023', message = 'Справочник больше 1 МБ — сохранение отклонено';
  end if;

  if v_exists then
    update public.app_config set value = v_new, updated_at = now()
     where key = 'prices'
    returning updated_at into v_ts;
  else
    insert into public.app_config (key, value, updated_at)
    values ('prices', v_new, now())
    on conflict (key) do nothing
    returning updated_at into v_ts;
  end if;
  if v_ts is null then
    raise exception using errcode = 'P0001',
      message = 'Справочник изменён — загрузите свежую версию';
  end if;
  return jsonb_build_object('updated_at', v_ts);
end;
$$;

comment on function public.prices_patch(jsonb, jsonb) is
  'Правка верхних ключей app_config.prices со сверкой прежних значений (миграция G, веха 4). rop — только packOptions, prepFees, minMarginPct.';

revoke execute on function public.prices_patch(jsonb, jsonb) from public, anon;
grant execute on function public.prices_patch(jsonb, jsonb) to authenticated;

-- ── 7. Сиды (только добавление) ──────────────────────────────────────────
-- JSON = pinhead-react/src/orderstudio/catalog/seeds.ts (сторож seedsMatch.test.ts)

insert into public.catalog_config (key, value, updated_at)
values ('suppliers', $seed_suppliers$[
  {"id": "medastex", "name": "Медастекс", "isDefault": false, "fabricSupplierNames": ["Медас"], "active": true, "palette": {
    "groups": [
      {"id": "medastex-1", "label": "Белые / Кремовые"},
      {"id": "medastex-2", "label": "Жёлтые / Оранжевые"},
      {"id": "medastex-3", "label": "Розовые / Красные"},
      {"id": "medastex-4", "label": "Синие / Фиолетовые"},
      {"id": "medastex-5", "label": "Зелёные / Хаки"},
      {"id": "medastex-6", "label": "Коричневые / Земля"},
      {"id": "medastex-7", "label": "Серые / Чёрные"},
      {"id": "medastex-8", "label": "Меланжи"}
    ],
    "colors": [
      {"code": "01-01", "name": "Белый", "hex": "#F8F7F2", "group": "medastex-1", "active": true},
      {"code": "01-02", "name": "Молочный", "hex": "#F0EAD6", "group": "medastex-1", "active": true},
      {"code": "02-01", "name": "Кремовый", "hex": "#E8DABB", "group": "medastex-1", "active": true},
      {"code": "02-02", "name": "Бежевый", "hex": "#D9C9A3", "group": "medastex-1", "active": true},
      {"code": "03-01", "name": "Ванильный", "hex": "#F5E6A0", "group": "medastex-2", "active": true},
      {"code": "03-02", "name": "Светло-жёлтый", "hex": "#F0D060", "group": "medastex-2", "active": true},
      {"code": "04-01", "name": "Лимонный", "hex": "#F5E020", "group": "medastex-2", "active": true},
      {"code": "04-02", "name": "Жёлтый", "hex": "#F0C800", "group": "medastex-2", "active": true},
      {"code": "04-03", "name": "Золотистый", "hex": "#D4A017", "group": "medastex-2", "active": true},
      {"code": "04-04", "name": "Горчица", "hex": "#C8920A", "group": "medastex-2", "active": true},
      {"code": "05-01", "name": "Персик", "hex": "#F5C095", "group": "medastex-2", "active": true},
      {"code": "05-02", "name": "Оранжевый", "hex": "#F07020", "group": "medastex-2", "active": true},
      {"code": "05-03", "name": "Тёмно-оранжевый", "hex": "#D05010", "group": "medastex-2", "active": true},
      {"code": "06-01", "name": "Пудровый", "hex": "#EFB8C0", "group": "medastex-3", "active": true},
      {"code": "06-02", "name": "Нежно-розовый", "hex": "#E0789A", "group": "medastex-3", "active": true},
      {"code": "06-03", "name": "Розовый яркий", "hex": "#E0305A", "group": "medastex-3", "active": true},
      {"code": "07-01", "name": "Коралловый", "hex": "#E84040", "group": "medastex-3", "active": true},
      {"code": "07-02", "name": "Красный", "hex": "#C81010", "group": "medastex-3", "active": true},
      {"code": "08-01", "name": "Бордо", "hex": "#901828", "group": "medastex-3", "active": true},
      {"code": "08-02", "name": "Марсала", "hex": "#6E1520", "group": "medastex-3", "active": true},
      {"code": "09-01", "name": "Лиловый", "hex": "#CC70A0", "group": "medastex-3", "active": true},
      {"code": "09-02", "name": "Фуксия", "hex": "#B81870", "group": "medastex-3", "active": true},
      {"code": "09-19", "name": "Пыльная фуксия", "hex": "#8C4060", "group": "medastex-3", "active": true},
      {"code": "10-01", "name": "Голубой", "hex": "#90C8E8", "group": "medastex-4", "active": true},
      {"code": "10-02", "name": "Васильковый", "hex": "#4890D0", "group": "medastex-4", "active": true},
      {"code": "10-03", "name": "Синий", "hex": "#1858A8", "group": "medastex-4", "active": true},
      {"code": "11-01", "name": "Небесный", "hex": "#60A8E0", "group": "medastex-4", "active": true},
      {"code": "11-02", "name": "Электрик", "hex": "#2050C8", "group": "medastex-4", "active": true},
      {"code": "11-03", "name": "Ярко-синий", "hex": "#1030A0", "group": "medastex-4", "active": true},
      {"code": "12-01", "name": "Синий тёмный", "hex": "#183080", "group": "medastex-4", "active": true},
      {"code": "12-02", "name": "Navy", "hex": "#101C58", "group": "medastex-4", "active": true},
      {"code": "13-01", "name": "Индиго", "hex": "#1C1848", "group": "medastex-4", "active": true},
      {"code": "13-02", "name": "Тёмный индиго", "hex": "#120E30", "group": "medastex-4", "active": true},
      {"code": "14-01", "name": "Лаванда", "hex": "#C8A8DC", "group": "medastex-4", "active": true},
      {"code": "14-02", "name": "Сиреневый", "hex": "#9060B8", "group": "medastex-4", "active": true},
      {"code": "15-01", "name": "Светло-фиолетовый", "hex": "#B080D0", "group": "medastex-4", "active": true},
      {"code": "15-02", "name": "Фиолетовый", "hex": "#7030A0", "group": "medastex-4", "active": true},
      {"code": "15-03", "name": "Тёмно-фиолетовый", "hex": "#501880", "group": "medastex-4", "active": true},
      {"code": "16-01", "name": "Мятный", "hex": "#90D8C0", "group": "medastex-5", "active": true},
      {"code": "16-02", "name": "Бирюзовый", "hex": "#30B090", "group": "medastex-5", "active": true},
      {"code": "16-03", "name": "Тёмная бирюза", "hex": "#188068", "group": "medastex-5", "active": true},
      {"code": "17-01", "name": "Светло-зелёный", "hex": "#70C870", "group": "medastex-5", "active": true},
      {"code": "17-05", "name": "Зелёный", "hex": "#208820", "group": "medastex-5", "active": true},
      {"code": "18-01", "name": "Изумрудный", "hex": "#107050", "group": "medastex-5", "active": true},
      {"code": "18-02", "name": "Тёмно-зелёный", "hex": "#0C5030", "group": "medastex-5", "active": true},
      {"code": "18-03", "name": "Хаки зелёный", "hex": "#4A6040", "group": "medastex-5", "active": true},
      {"code": "18-04", "name": "Оливковый", "hex": "#6A6830", "group": "medastex-5", "active": true},
      {"code": "18-05", "name": "Тёмная олива", "hex": "#484020", "group": "medastex-5", "active": true},
      {"code": "19-01", "name": "Светлый хаки", "hex": "#B0A878", "group": "medastex-5", "active": true},
      {"code": "19-02", "name": "Хаки", "hex": "#8A7848", "group": "medastex-5", "active": true},
      {"code": "19-4151", "name": "Милитари", "hex": "#505830", "group": "medastex-5", "active": true},
      {"code": "20-01", "name": "Светло-коричневый", "hex": "#A06838", "group": "medastex-6", "active": true},
      {"code": "20-02", "name": "Коричневый", "hex": "#784020", "group": "medastex-6", "active": true},
      {"code": "20-04", "name": "Тёмно-коричневый", "hex": "#502810", "group": "medastex-6", "active": true},
      {"code": "20-05", "name": "Шоколадный", "hex": "#381808", "group": "medastex-6", "active": true},
      {"code": "21-01", "name": "Кэмел", "hex": "#C89050", "group": "medastex-6", "active": true},
      {"code": "21-02", "name": "Тёмный кэмел", "hex": "#A87030", "group": "medastex-6", "active": true},
      {"code": "21-03", "name": "Терракота", "hex": "#C05030", "group": "medastex-6", "active": true},
      {"code": "21-04", "name": "Кирпичный", "hex": "#A03820", "group": "medastex-6", "active": true},
      {"code": "22-01", "name": "Светлый песок", "hex": "#E0D0A8", "group": "medastex-6", "active": true},
      {"code": "22-02", "name": "Песок", "hex": "#C8B880", "group": "medastex-6", "active": true},
      {"code": "23-01", "name": "Светлый тауп", "hex": "#C0A888", "group": "medastex-6", "active": true},
      {"code": "23-02", "name": "Тауп", "hex": "#9A8060", "group": "medastex-6", "active": true},
      {"code": "23-03", "name": "Мокко", "hex": "#785840", "group": "medastex-6", "active": true},
      {"code": "24-01", "name": "Светлый камень", "hex": "#C8C0B0", "group": "medastex-6", "active": true},
      {"code": "24-02", "name": "Камень", "hex": "#A09880", "group": "medastex-6", "active": true},
      {"code": "24-03", "name": "Тёмный камень", "hex": "#807870", "group": "medastex-6", "active": true},
      {"code": "25-01", "name": "Пепельно-розовый", "hex": "#D4C0B8", "group": "medastex-6", "active": true},
      {"code": "25-02", "name": "Серо-розовый", "hex": "#BCA8A0", "group": "medastex-6", "active": true},
      {"code": "26-01", "name": "Тёмно-серый", "hex": "#585858", "group": "medastex-7", "active": true},
      {"code": "26-02", "name": "Антрацит", "hex": "#3A3A3A", "group": "medastex-7", "active": true},
      {"code": "27-01", "name": "Угольный", "hex": "#2E2E2E", "group": "medastex-7", "active": true},
      {"code": "28-01", "name": "Тёмный уголь", "hex": "#242424", "group": "medastex-7", "active": true},
      {"code": "28-02", "name": "Графит", "hex": "#1E1E1E", "group": "medastex-7", "active": true},
      {"code": "28-05", "name": "Тёмный графит", "hex": "#181818", "group": "medastex-7", "active": true},
      {"code": "29-01", "name": "Глубокий серый", "hex": "#202020", "group": "medastex-7", "active": true},
      {"code": "29-02", "name": "Почти чёрный", "hex": "#161616", "group": "medastex-7", "active": true},
      {"code": "29-03", "name": "Navy-Black", "hex": "#101820", "group": "medastex-7", "active": true},
      {"code": "30-01", "name": "Тёмный navy", "hex": "#0C1428", "group": "medastex-7", "active": true},
      {"code": "30-02", "name": "Ночной синий", "hex": "#101830", "group": "medastex-7", "active": true},
      {"code": "30-03", "name": "Тёмный navy-2", "hex": "#141E40", "group": "medastex-7", "active": true},
      {"code": "40-01", "name": "Чёрный", "hex": "#0F0F0F", "group": "medastex-7", "active": true},
      {"code": "40-02", "name": "Глубокий чёрный", "hex": "#080808", "group": "medastex-7", "active": true},
      {"code": "50-01", "name": "Белый меланж", "hex": "#EEEEEC", "group": "medastex-8", "active": true},
      {"code": "50-03", "name": "Светлый меланж", "hex": "#E2E2E0", "group": "medastex-8", "active": true},
      {"code": "50-04", "name": "Серый меланж св.", "hex": "#D0D0CE", "group": "medastex-8", "active": true},
      {"code": "50-05", "name": "Серый меланж", "hex": "#BCBCBA", "group": "medastex-8", "active": true},
      {"code": "50-07", "name": "Серебро меланж", "hex": "#ABABAA", "group": "medastex-8", "active": true},
      {"code": "50-08", "name": "Средний меланж", "hex": "#9A9A98", "group": "medastex-8", "active": true},
      {"code": "51-01", "name": "Розовый меланж", "hex": "#D8AABA", "group": "medastex-8", "active": true},
      {"code": "51-02", "name": "Голубой меланж", "hex": "#A8C0D8", "group": "medastex-8", "active": true},
      {"code": "51-03", "name": "Зелёный меланж", "hex": "#A0B898", "group": "medastex-8", "active": true},
      {"code": "51-04", "name": "Бежевый меланж", "hex": "#D0C0A8", "group": "medastex-8", "active": true},
      {"code": "51-05", "name": "Navy меланж", "hex": "#5A6070", "group": "medastex-8", "active": true},
      {"code": "51-06", "name": "Синий меланж", "hex": "#7080A0", "group": "medastex-8", "active": true},
      {"code": "51-07", "name": "Серо-синий меланж", "hex": "#8090A8", "group": "medastex-8", "active": true},
      {"code": "51-08", "name": "Тёмный меланж", "hex": "#686868", "group": "medastex-8", "active": true}
    ]
  }},
  {"id": "cottonprom", "name": "Коттонпром", "isDefault": true, "fabricSupplierNames": [], "active": true, "palette": {
    "groups": [
      {"id": "cottonprom-1", "label": "Белые / Кремовые"},
      {"id": "cottonprom-2", "label": "Бежевые / Коричневые"},
      {"id": "cottonprom-3", "label": "Розовые / Малиновые"},
      {"id": "cottonprom-4", "label": "Бордо / Тёмные"},
      {"id": "cottonprom-5", "label": "Оранжевые"},
      {"id": "cottonprom-6", "label": "Жёлтые"},
      {"id": "cottonprom-7", "label": "Зелёные"},
      {"id": "cottonprom-8", "label": "Бирюзовые / Мятные"},
      {"id": "cottonprom-9", "label": "Голубые"},
      {"id": "cottonprom-10", "label": "Синие"},
      {"id": "cottonprom-11", "label": "Серые / Антрацит"},
      {"id": "cottonprom-12", "label": "Сиреневые / Фиолетовые"},
      {"id": "cottonprom-13", "label": "Оливковые / Хаки"},
      {"id": "cottonprom-14", "label": "Тёмные / Чёрные"},
      {"id": "cottonprom-15", "label": "Меланж"}
    ],
    "colors": [
      {"code": "5001", "name": "Белый", "hex": "#FFFFFF", "group": "cottonprom-1", "active": true},
      {"code": "5002", "name": "Молочный", "hex": "#FAF6F0", "group": "cottonprom-1", "active": true},
      {"code": "5003", "name": "Слоновая кость", "hex": "#F5EDE0", "group": "cottonprom-1", "active": true},
      {"code": "5004", "name": "Бежевый светлый", "hex": "#C9A882", "group": "cottonprom-2", "active": true},
      {"code": "5005", "name": "Бежевый", "hex": "#BE9470", "group": "cottonprom-2", "active": true},
      {"code": "5006", "name": "Бежево-коричневый", "hex": "#AA8060", "group": "cottonprom-2", "active": true},
      {"code": "5007", "name": "Тауп", "hex": "#7D6960", "group": "cottonprom-2", "active": true},
      {"code": "5008", "name": "Пудровый розовый", "hex": "#D4A898", "group": "cottonprom-2", "active": true},
      {"code": "5009", "name": "Пыльная роза", "hex": "#C08878", "group": "cottonprom-2", "active": true},
      {"code": "5010", "name": "Серо-бежевый", "hex": "#8A7870", "group": "cottonprom-2", "active": true},
      {"code": "5011", "name": "Серо-лиловый", "hex": "#705870", "group": "cottonprom-2", "active": true},
      {"code": "5012", "name": "Сливовый", "hex": "#685068", "group": "cottonprom-2", "active": true},
      {"code": "5013", "name": "Нежно-розовый", "hex": "#F2C8D0", "group": "cottonprom-3", "active": true},
      {"code": "5014", "name": "Светло-розовый", "hex": "#EEC4CC", "group": "cottonprom-3", "active": true},
      {"code": "5015", "name": "Розовый", "hex": "#E8A8BC", "group": "cottonprom-3", "active": true},
      {"code": "5016", "name": "Розово-лиловый", "hex": "#D898C8", "group": "cottonprom-3", "active": true},
      {"code": "5017", "name": "Лиловый", "hex": "#C888C0", "group": "cottonprom-3", "active": true},
      {"code": "5018", "name": "Фуксия", "hex": "#960880", "group": "cottonprom-3", "active": true},
      {"code": "5019", "name": "Лососевый", "hex": "#EE6878", "group": "cottonprom-3", "active": true},
      {"code": "5020", "name": "Коралловый красный", "hex": "#E84858", "group": "cottonprom-3", "active": true},
      {"code": "5021", "name": "Малиновый", "hex": "#B01858", "group": "cottonprom-3", "active": true},
      {"code": "5022", "name": "Красный", "hex": "#C01838", "group": "cottonprom-3", "active": true},
      {"code": "5023", "name": "Светло-малиновый", "hex": "#C05878", "group": "cottonprom-3", "active": true},
      {"code": "5024", "name": "Алый", "hex": "#C81030", "group": "cottonprom-3", "active": true},
      {"code": "5025", "name": "Бордо", "hex": "#8C0020", "group": "cottonprom-4", "active": true},
      {"code": "5026", "name": "Тёмное бордо", "hex": "#780018", "group": "cottonprom-4", "active": true},
      {"code": "5027", "name": "Пурпурно-коричневый", "hex": "#582838", "group": "cottonprom-4", "active": true},
      {"code": "5028", "name": "Коричнево-серый", "hex": "#5A4A40", "group": "cottonprom-4", "active": true},
      {"code": "5029", "name": "Тёмный шоколад", "hex": "#2C1818", "group": "cottonprom-4", "active": true},
      {"code": "5030", "name": "Чёрно-коричневый", "hex": "#200C0C", "group": "cottonprom-4", "active": true},
      {"code": "5031", "name": "Светлый оранжевый", "hex": "#F87840", "group": "cottonprom-5", "active": true},
      {"code": "5032", "name": "Оранжевый", "hex": "#F07000", "group": "cottonprom-5", "active": true},
      {"code": "5033", "name": "Карамельный", "hex": "#C87830", "group": "cottonprom-5", "active": true},
      {"code": "5034", "name": "Тёмно-коричневый", "hex": "#983800", "group": "cottonprom-5", "active": true},
      {"code": "5035", "name": "Лососево-розовый", "hex": "#F07868", "group": "cottonprom-5", "active": true},
      {"code": "5036", "name": "Ярко-оранжевый", "hex": "#F05800", "group": "cottonprom-5", "active": true},
      {"code": "5037", "name": "Кремово-жёлтый", "hex": "#F5E098", "group": "cottonprom-6", "active": true},
      {"code": "5038", "name": "Лаймово-жёлтый", "hex": "#D8E000", "group": "cottonprom-6", "active": true},
      {"code": "5039", "name": "Жёлтый", "hex": "#F0D030", "group": "cottonprom-6", "active": true},
      {"code": "5040", "name": "Янтарный", "hex": "#F0B000", "group": "cottonprom-6", "active": true},
      {"code": "5041", "name": "Золотистый", "hex": "#C89800", "group": "cottonprom-6", "active": true},
      {"code": "5042", "name": "Лайм", "hex": "#D0E038", "group": "cottonprom-6", "active": true},
      {"code": "5043", "name": "Салатовый", "hex": "#B8D028", "group": "cottonprom-7", "active": true},
      {"code": "5044", "name": "Светло-зелёный", "hex": "#60C038", "group": "cottonprom-7", "active": true},
      {"code": "5045", "name": "Зелёный", "hex": "#40A828", "group": "cottonprom-7", "active": true},
      {"code": "5046", "name": "Изумрудный", "hex": "#187838", "group": "cottonprom-7", "active": true},
      {"code": "5047", "name": "Тёмно-зелёный", "hex": "#0C6838", "group": "cottonprom-7", "active": true},
      {"code": "5048", "name": "Хвойный", "hex": "#084830", "group": "cottonprom-7", "active": true},
      {"code": "5049", "name": "Голубой ледяной", "hex": "#CCE8F8", "group": "cottonprom-8", "active": true},
      {"code": "5050", "name": "Мятный", "hex": "#A8F0D8", "group": "cottonprom-8", "active": true},
      {"code": "5051", "name": "Бирюзово-мятный", "hex": "#70E8C0", "group": "cottonprom-8", "active": true},
      {"code": "5052", "name": "Бирюзовый", "hex": "#30C8A0", "group": "cottonprom-8", "active": true},
      {"code": "5053", "name": "Изумрудно-морской", "hex": "#009870", "group": "cottonprom-8", "active": true},
      {"code": "5054", "name": "Тёмно-морской", "hex": "#004030", "group": "cottonprom-8", "active": true},
      {"code": "5055", "name": "Лавандово-голубой", "hex": "#A8B8E8", "group": "cottonprom-9", "active": true},
      {"code": "5056", "name": "Ярко-голубой", "hex": "#28C0E8", "group": "cottonprom-9", "active": true},
      {"code": "5057", "name": "Небесно-голубой", "hex": "#48A8E8", "group": "cottonprom-9", "active": true},
      {"code": "5058", "name": "Синевато-голубой", "hex": "#4870C0", "group": "cottonprom-9", "active": true},
      {"code": "5059", "name": "Ледяной", "hex": "#C8F0F8", "group": "cottonprom-9", "active": true},
      {"code": "5060", "name": "Циановый", "hex": "#00C8E0", "group": "cottonprom-9", "active": true},
      {"code": "5061", "name": "Ярко-синий", "hex": "#0090D0", "group": "cottonprom-10", "active": true},
      {"code": "5062", "name": "Тёмно-бирюзовый", "hex": "#008898", "group": "cottonprom-10", "active": true},
      {"code": "5063", "name": "Серо-синий", "hex": "#507080", "group": "cottonprom-10", "active": true},
      {"code": "5064", "name": "Стальной голубой", "hex": "#8098B8", "group": "cottonprom-10", "active": true},
      {"code": "5065", "name": "Серо-голубой", "hex": "#6880A0", "group": "cottonprom-10", "active": true},
      {"code": "5066", "name": "Электрик", "hex": "#1848D8", "group": "cottonprom-10", "active": true},
      {"code": "5067", "name": "Морской синий", "hex": "#0050A8", "group": "cottonprom-10", "active": true},
      {"code": "5068", "name": "Тёмно-синий", "hex": "#003888", "group": "cottonprom-10", "active": true},
      {"code": "5069", "name": "Морская волна", "hex": "#1C5878", "group": "cottonprom-10", "active": true},
      {"code": "5070", "name": "Тёмно-стальной", "hex": "#283848", "group": "cottonprom-10", "active": true},
      {"code": "5071", "name": "Ночной", "hex": "#101828", "group": "cottonprom-10", "active": true},
      {"code": "5072", "name": "Индиго", "hex": "#202870", "group": "cottonprom-10", "active": true},
      {"code": "5073", "name": "Светло-серый", "hex": "#C8D0D4", "group": "cottonprom-11", "active": true},
      {"code": "5074", "name": "Тёплый серый", "hex": "#A09890", "group": "cottonprom-11", "active": true},
      {"code": "5075", "name": "Голубовато-серый", "hex": "#98B4C0", "group": "cottonprom-11", "active": true},
      {"code": "5076", "name": "Сине-серый", "hex": "#7890A0", "group": "cottonprom-11", "active": true},
      {"code": "5077", "name": "Тёмно-серый", "hex": "#3C4448", "group": "cottonprom-11", "active": true},
      {"code": "5078", "name": "Антрацит", "hex": "#2C3440", "group": "cottonprom-11", "active": true},
      {"code": "5079", "name": "Нежно-розово-лиловый", "hex": "#E8D0D8", "group": "cottonprom-12", "active": true},
      {"code": "5080", "name": "Сиреневый", "hex": "#B0A8C8", "group": "cottonprom-12", "active": true},
      {"code": "5081", "name": "Светло-сиреневый", "hex": "#D0B8DC", "group": "cottonprom-12", "active": true},
      {"code": "5082", "name": "Лавандовый", "hex": "#B890C8", "group": "cottonprom-12", "active": true},
      {"code": "5083", "name": "Ярко-фиолетовый", "hex": "#5048B8", "group": "cottonprom-12", "active": true},
      {"code": "5084", "name": "Фиолетовый", "hex": "#7830A0", "group": "cottonprom-12", "active": true},
      {"code": "5085", "name": "Лилово-серый", "hex": "#7C6898", "group": "cottonprom-12", "active": true},
      {"code": "5086", "name": "Тёмно-фиолетовый", "hex": "#502870", "group": "cottonprom-12", "active": true},
      {"code": "5087", "name": "Оливковый", "hex": "#A8A848", "group": "cottonprom-13", "active": true},
      {"code": "5088", "name": "Хаки-зелёный", "hex": "#608858", "group": "cottonprom-13", "active": true},
      {"code": "5089", "name": "Хаки", "hex": "#685E30", "group": "cottonprom-13", "active": true},
      {"code": "5090", "name": "Тёмное хаки", "hex": "#545020", "group": "cottonprom-13", "active": true},
      {"code": "5091", "name": "Тёмно-полночный", "hex": "#181C30", "group": "cottonprom-14", "active": true},
      {"code": "5092", "name": "Чёрный", "hex": "#141010", "group": "cottonprom-14", "active": true},
      {"code": "5093", "name": "Меланж светлый", "hex": "#D0D0CC", "group": "cottonprom-15", "active": true},
      {"code": "5094", "name": "Меланж серый", "hex": "#B0B0A8", "group": "cottonprom-15", "active": true},
      {"code": "5095", "name": "Меланж тёмный", "hex": "#909088", "group": "cottonprom-15", "active": true},
      {"code": "5096", "name": "Меланж тёмно-серый", "hex": "#707068", "group": "cottonprom-15", "active": true}
    ]
  }}
]$seed_suppliers$::jsonb, now())
on conflict (key) do nothing;

insert into public.app_config (key, value, updated_at)
values ('labelLibrary', $seed_labelLibrary${
  "kinds": [
    {"type": "size", "name": "Размерник", "variants": [], "materials": [], "active": true},
    {"type": "composition", "name": "Составник", "variants": [{"id": "standard", "name": "Стандартный", "price": 10, "withMaterial": false, "active": true}, {"id": "my-logo", "name": "С логотипом", "price": 30, "withMaterial": false, "active": true}, {"id": "no-logo", "name": "Без логотипа", "price": 10, "withMaterial": false, "active": true}], "materials": [], "active": true},
    {"type": "brand", "name": "Брендовая бирка", "variants": [{"id": "standard", "name": "Стандартная", "price": 30, "withMaterial": true, "active": true}, {"id": "custom", "name": "Своя (дизайн клиента)", "price": 45, "withMaterial": true, "active": true}, {"id": "send-own", "name": "Бирка клиента — пришлёт сам", "price": 0, "withMaterial": false, "active": true}], "materials": [{"key": "woven", "name": "Тканая", "priceDelta": 0, "active": true}, {"key": "polyester", "name": "Полиэстер", "priceDelta": -5, "active": true}, {"key": "canvas", "name": "Хлопковый канвас", "priceDelta": 10, "active": true}], "active": true},
    {"type": "care", "name": "Бирка по уходу", "variants": [], "materials": [], "active": true},
    {"type": "extra", "name": "Дополнительная бирка", "variants": [], "materials": [], "active": true},
    {"type": "hangtag", "name": "Хэнгтег", "variants": [{"id": "standard", "name": "Стандартный", "price": 15, "withMaterial": false, "active": true}, {"id": "custom", "name": "Свой", "price": 25, "withMaterial": false, "active": true}], "materials": [], "active": true},
    {"type": "sticker", "name": "Стикер на упаковку", "variants": [], "materials": [], "active": true},
    {"type": "patch", "name": "Флажок / патч", "variants": [], "materials": [], "active": true}
  ],
  "schemes": [{"id": "neck", "name": "На воротнике (спина)", "active": true}, {"id": "inseam", "name": "Петля вшивная (шов)", "active": true}]
}$seed_labelLibrary$::jsonb, now())
on conflict (key) do nothing;

insert into public.app_config (key, value, updated_at)
values ('tzSettings', $seed_tzSettings${"footerText": "Допуск по размещению нанесения — до 2 см"}$seed_tzSettings$::jsonb, now())
on conflict (key) do nothing;

-- Прайс: новые ключи СЛЕВА — существующее значение побеждает
update public.app_config
   set value = $seed_prices${"packOptions": [{"key": "none", "name": "Без упаковки", "price": 0}, {"key": "bopp", "name": "БОПП пакет", "price": 20}, {"key": "zip", "name": "ЗИП пакет", "price": 40}, {"key": "other", "name": "Другая — опишите в требованиях", "price": 0}], "prepFees": {}, "minMarginPct": null}$seed_prices$::jsonb || value
 where key = 'prices'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'packOptions' and value ? 'prepFees' and value ? 'minMarginPct');

-- Прайс: матрица флекса. На бою 17.10 ключа `flexMatrix` в прайсе нет (цена
-- бралась из FLEX_MATRIX кода), а `prices_patch` правит только существующие
-- ключи — без сида вкладку «Флекс» в /sku нельзя было бы сохранить.
-- JSON = FLEX_MATRIX из `pinhead-react/src/data/prices.js` (сторож seedsMatch.test.ts)
update public.app_config
   set value = jsonb_build_object('flexMatrix', $seed_flexMatrix${"A6": {"1": [450, 159, 141, 128], "2": [450, 206, 177, 148], "3": [450, 238, 203, 188]}, "A5": {"1": [600, 238, 203, 172], "2": [600, 285, 244, 204], "3": [600, 316, 270, 227]}, "A4": {"1": [750, 316, 270, 227], "2": [750, 405, 345, 291], "3": [750, 475, 405, 341]}, "A3": {"1": [850, 423, 352, 296], "2": [850, 519, 443, 374], "3": [850, 632, 540, 454]}}$seed_flexMatrix$::jsonb) || value
 where key = 'prices'
   and jsonb_typeof(value) = 'object'
   and not value ? 'flexMatrix';

notify pgrst, 'reload schema';
