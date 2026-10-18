-- Order v4, веха 5б единого потока, миграция I (18.10): админка «Флэты и зоны» —
-- форма справочника флэтов с историей версий, форма справочника зон нанесения
-- и триггер-страж этих двух ключей app_config.
--
-- План: docs/superpowers/plans/2026-10-18-order-flow-m5b-flats-admin.md, задача 2
-- (с разделами «Проверка безопасности», «Проверка скиллами», «Проверка полноты плана»).
-- Пробы: supabase/probes/flats_admin.sql (новые) и garment_flats.sql (регресс H).
--
-- Что меняет:
--   1. catalog_value_check — подлинный текст миграции H (md5 prosrc тела H
--      22d8c1e49a3a60048d06523b20174d08 сверяют файлы выкатки), правки ровно три:
--      (а) ветка garmentFlats заменена: всё, что было в H, плюс тип изделия из
--          11 типов, typical, обязательные списки подбора (строки ≤ 64), код
--          модели — у одного активного флэта, история версий (`history[]`:
--          версия меньше текущей и уникальна, виды истории проверяются тем же
--          запросом, что и текущие, путь SVG — с версией записи), якоря по виду,
--          zone_id — null или код зоны, отступ ≥ 0, tz_row из 10 кодов,
--          default_method входит в methods. Тексты отказов H сохранены дословно;
--      (б) новая ветка zonesCatalog: список до 200 зон, id — код зоны, название
--          непустое и уникальное без учёта регистра и пробелов по краям (это
--          ключ нанесения в заказах), forCategories/sortOrder/requiresHood/
--          requiresPocket/active/tz_row — форма;
--      (в) 'zonesCatalog' убран из общего списка «справочник — список».
--   2. Триггер-страж app_config_order_catalog_guard (BEFORE INSERT/UPDATE/DELETE
--      на app_config, только ключи garmentFlats и zonesCatalog): прямая запись
--      мимо RPC проходит ту же форму; флэт и зона не исчезают (снимают
--      active: false), версия флэта не понижается, записи истории неизменяемы
--      (точное равенство jsonb, а не @>: containment частичный), при выпуске
--      версии прежние виды попадают в историю без изменений, название зоны
--      неизменно; DELETE строк этих ключей — только service_role и владелец
--      в SQL Editor (session_user = postgres без JWT клиента). Правило
--      проекта «права по колонкам — триггер-страж», «отключать, не удалять».
--
-- Чего нет: catalog_put (белый список прежний — оба ключа уже в v_admin_pair H),
-- политик (create policy), Storage, DDL по erp_*.
--
-- ОКНО СОВМЕСТИМОСТИ. Единственный редактор zonesCatalog до мерджа 5б — старый
-- /sku (ZonesCatalogTab + useSkuSave): id из toLowerCase().replace(/[^a-z0-9-]/g, '-')
-- без предела длины, название по умолчанию = id, уникальность названий не
-- проверяется, зоны удаляются жёстко. После I такое сохранение получит 22023
-- (форма или страж), а useSkuSave пишет справочники пакетно — возможно «часть
-- записана, зоны — нет». Поэтому I применяется В ТОТ ЖЕ ДЕНЬ, что и мердж 5б;
-- между применением I и мерджем зоны в /sku не правим.
--
-- ВЫКАТКА (файлами через SQL Editor владельцем): только ПОСЛЕ H. Каждый файл
-- выкатки начинается с предусловия: H в schema_migrations (20261017185435),
-- бакет garment-flats есть, md5 prosrc catalog_value_check = тело H — иначе
-- raise exception 'Сначала миграция H'. Сухой прогон — пробы flats_admin.sql
-- и garment_flats.sql (регресс) вместе с I в одной транзакции.
--
-- ОТКАТ (новой миграцией, ВМЕСТЕ с фронтом 5б и ПЕРВЫМ — до реверта фронта:
-- старый /sku жёстко удаляет зоны и упрётся в стража):
--   1. drop trigger if exists app_config_order_catalog_guard on public.app_config;
--      drop function if exists public.app_config_order_catalog_guard();
--   2. catalog_value_check — текстом миграции H (20261017185435_garment_flats.sql),
--      затем revoke execute … from public, anon, authenticated.
--   Данные с history, tz_row и active откату не мешают: H их пропускает.
--   После отката снятые зоны (active: false) старый фронт снова предложит
--   в подборе — до повторной выкладки зоны не снимать или вернуть active вручную.

-- ── 1. Проверка формы записи: garmentFlats строже, + zonesCatalog ────────
-- Текст миграции H, правки — только ветки флэтов и зон и общий список

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

  -- Флэты изделий (миграция I, веха 5б). Всё, что было в ветке H, плюс тип,
  -- typical, обязательные списки подбора, история версий, якоря, zone_id,
  -- tz_row, отступ и default_method из methods. Сторож catalogKeys.test.ts
  -- сверяет: тело с веткой H на месте этой и без ветки зон = тело H
  if p_table = 'app_config' and p_key = 'garmentFlats' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(jsonb_typeof(p_value->'version'), '') <> 'number' or (p_value->>'version') <> '1'
       or coalesce(jsonb_typeof(p_value->'flats'), '') <> 'array' then
      raise exception using errcode = '22023', message = 'Флэты: нужен объект версии 1 со списком flats';
    end if;
    -- Флэт: id, версия 1…9999 (целое), active, название, тип, typical,
    -- списки подбора (обязательны, строки ≤ 64), виды, история (нет или список)
    select 'флэт ' || left(coalesce(f->>'id', '?'), 80) into v_bad
      from jsonb_array_elements(p_value->'flats') f
     where jsonb_typeof(f) <> 'object'
        or coalesce(jsonb_typeof(f->'id'), '') <> 'string' or (f->>'id') !~ '^[a-z0-9][a-z0-9-]{0,62}$'
        or coalesce(jsonb_typeof(f->'version'), '') <> 'number' or (f->>'version') !~ '^[1-9][0-9]{0,3}$'
        or coalesce(jsonb_typeof(f->'active'), '') <> 'boolean'
        or coalesce(jsonb_typeof(f->'name'), '') <> 'string' or char_length(f->>'name') > 200
        or coalesce(jsonb_typeof(f->'garment_type'), '') <> 'string'
        or (f->>'garment_type') not in ('tshirt', 'polo', 'longsleeve', 'sweatshirt', 'hoodie', 'zip_hoodie',
                                        'half_zip', 'bomber', 'olympic', 'pants', 'shopper')
        or coalesce(jsonb_typeof(f->'typical'), '') <> 'boolean'
        or exists (select 1 from unnest(array['categories', 'fits', 'sku_codes']) l
                    where case when jsonb_typeof(f->l) = 'array'
                               then exists (select 1 from jsonb_array_elements(f->l) e
                                             where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 64)
                               else true end)
        or coalesce(jsonb_typeof(f->'views'), '') <> 'array' or jsonb_array_length(f->'views') = 0
        or coalesce(jsonb_typeof(f->'history'), 'array') <> 'array'
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    if (select count(*) <> count(distinct f->>'id') from jsonb_array_elements(p_value->'flats') f) then
      raise exception using errcode = '22023', message = 'Флэты: id повторяется';
    end if;
    -- Код модели — у одного активного флэта (иначе подбор неоднозначен)
    select e #>> '{}' into v_bad
      from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(f->'sku_codes') e
     where (f->>'active')::boolean
     group by e #>> '{}' having count(distinct f->>'id') > 1
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: модель «' || left(v_bad, 64) || '» у двух активных флэтов';
    end if;
    -- Запись истории: объект, версия 1…9999 меньше текущей, непустой список видов.
    -- Записи истории неизменяемы — это держит страж app_config_order_catalog_guard
    select 'история ' || left(f->>'id', 80) || '/v' || left(coalesce(h->>'version', '?'), 12) into v_bad
      from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(coalesce(f->'history', '[]')) h
     where jsonb_typeof(h) <> 'object'
        or coalesce(jsonb_typeof(h->'version'), '') <> 'number' or (h->>'version') !~ '^[1-9][0-9]{0,3}$'
        or case when (h->>'version') ~ '^[1-9][0-9]{0,3}$'
                then (h->>'version')::int >= (f->>'version')::int end
        or coalesce(jsonb_typeof(h->'views'), '') <> 'array' or jsonb_array_length(h->'views') = 0
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    if exists (select 1 from jsonb_array_elements(p_value->'flats') f
                where (select count(*) <> count(distinct h->>'version')
                         from jsonb_array_elements(coalesce(f->'history', '[]')) h)) then
      raise exception using errcode = '22023', message = 'Флэты: версия в истории флэта повторяется';
    end if;
    -- Вид (текущий и истории — одним запросом, версия владельца вида): перечень,
    -- путь SVG выводится из id, версии и вида (клиент не направит флэт на чужой
    -- объект бакета), масштаб (0; 10], якоря по виду, непустые зоны без повторов id
    select 'вид ' || left(w.fid, 80) || '/' || left(coalesce(w.v->>'kind', '?'), 40)
           || case when w.hist then ' (история v' || w.ver || ')' else '' end into v_bad
      from (select f->>'id' fid, f->>'version' ver, f->>'garment_type' gt, false hist, v
              from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(f->'views') v
            union all
            select f->>'id', h->>'version', f->>'garment_type', true, v
              from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(coalesce(f->'history', '[]')) h,
                   jsonb_array_elements(h->'views') v) w
     where jsonb_typeof(w.v) <> 'object'
        or coalesce(jsonb_typeof(w.v->'kind'), '') <> 'string'
        or (w.v->>'kind') not in ('front', 'back', 'sleeve_left', 'sleeve_right')
        or coalesce(jsonb_typeof(w.v->'svg_path'), '') <> 'string'
        or (w.v->>'svg_path') <> 'flats/' || w.fid || '/v' || w.ver || '/' || (w.v->>'kind') || '.svg'
        or coalesce(jsonb_typeof(w.v->'scale_mm_per_unit'), '') <> 'number'
        -- приведение — только у числа: OR не обещает порядок, иначе 22P02 вместо 22023
        or case when jsonb_typeof(w.v->'scale_mm_per_unit') = 'number'
                then (w.v->>'scale_mm_per_unit')::numeric <= 0 or (w.v->>'scale_mm_per_unit')::numeric > 10
           end
        -- якоря: рукав — низ и центр рукава; перед и спина — ось центра и горловина
        -- (у аксессуара горловины может не быть), как checkAnchors клиента
        or coalesce(jsonb_typeof(w.v->'anchors'), '') <> 'object'
        or ((w.v->>'kind') in ('sleeve_left', 'sleeve_right')
            and (coalesce(jsonb_typeof(w.v->'anchors'->'sleeve_bottom_y'), '') <> 'number'
                 or coalesce(jsonb_typeof(w.v->'anchors'->'sleeve_center_x'), '') <> 'number'))
        or ((w.v->>'kind') in ('front', 'back')
            and (coalesce(jsonb_typeof(w.v->'anchors'->'center_axis_x'), '') <> 'number'
                 or (w.gt <> 'shopper'
                     and (coalesce(jsonb_typeof(w.v->'anchors'->'neckline_point'->'x'), '') <> 'number'
                          or coalesce(jsonb_typeof(w.v->'anchors'->'neckline_point'->'y'), '') <> 'number'))))
        or coalesce(jsonb_typeof(w.v->'print_areas'), '') <> 'array' or jsonb_array_length(w.v->'print_areas') = 0
        or (select count(*) <> count(distinct a->>'id') from jsonb_array_elements(w.v->'print_areas') a)
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    if exists (select 1 from jsonb_array_elements(p_value->'flats') f
                where (select count(*) <> count(distinct v->>'kind') from jsonb_array_elements(f->'views') v)
                   or exists (select 1 from jsonb_array_elements(coalesce(f->'history', '[]')) h
                               where (select count(*) <> count(distinct v->>'kind') from jsonb_array_elements(h->'views') v))) then
      raise exception using errcode = '22023', message = 'Флэты: вид флэта повторяется';
    end if;
    -- Зона (текущая и истории): id, название, zone_id (null или код зоны справочника),
    -- многоугольник 3…256 точек с |координатой| ≤ 5000 мм, отступ ≥ 0, строка ТЗ
    -- из перечня, методы — из CHECK order_item_prints_method_check, техника
    -- по умолчанию — из методов зоны
    select 'зона ' || left(w.fid, 80) || '/' || left(w.v->>'kind', 40) || '/' || left(coalesce(a->>'id', '?'), 80)
           || case when w.hist then ' (история v' || w.ver || ')' else '' end into v_bad
      from (select f->>'id' fid, f->>'version' ver, false hist, v
              from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(f->'views') v
            union all
            select f->>'id', h->>'version', true, v
              from jsonb_array_elements(p_value->'flats') f, jsonb_array_elements(coalesce(f->'history', '[]')) h,
                   jsonb_array_elements(h->'views') v) w,
           jsonb_array_elements(w.v->'print_areas') a
     where jsonb_typeof(a) <> 'object'
        or coalesce(jsonb_typeof(a->'id'), '') <> 'string' or (a->>'id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
        or coalesce(jsonb_typeof(a->'name'), '') <> 'string' or char_length(a->>'name') > 200
        or coalesce(jsonb_typeof(a->'zone_id'), 'null') not in ('string', 'null')
        or char_length(coalesce(a->>'zone_id', '')) > 64
        or (jsonb_typeof(a->'zone_id') = 'string' and (a->>'zone_id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$')
        or coalesce(jsonb_typeof(a->'safe_inset_mm'), '') <> 'number'
        or case when jsonb_typeof(a->'safe_inset_mm') = 'number' then (a->>'safe_inset_mm')::numeric < 0 end
        or (a ? 'tz_row'
            and (jsonb_typeof(a->'tz_row') <> 'string'
                 or (a->>'tz_row') not in ('front', 'front_l', 'front_r', 'back', 'sleeve_l', 'sleeve_r',
                                           'hood_l', 'hood_r', 'pocket', 'other')))
        or coalesce(jsonb_typeof(a->'polygon_mm'), '') <> 'array'
        or jsonb_array_length(a->'polygon_mm') < 3 or jsonb_array_length(a->'polygon_mm') > 256
        or exists (select 1 from jsonb_array_elements(a->'polygon_mm') pt
                    where jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
                       or exists (select 1 from jsonb_array_elements(pt) c
                                   where jsonb_typeof(c) <> 'number'
                                      or case when jsonb_typeof(c) = 'number'
                                              then abs((c #>> '{}')::numeric) > 5000 end))
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
        or case when jsonb_typeof(a->'methods') = 'array' and jsonb_array_length(a->'methods') > 0
                     and jsonb_typeof(a->'default_method') = 'string'
                then not (a->'methods' ? (a->>'default_method')) end
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: неверная запись — ' || v_bad;
    end if;
    return;
  end if;
  -- Конец ветки garmentFlats (миграция I)

  -- Зоны нанесения (миграция I, веха 5б): справочник зон — список до 200 зон.
  -- Название — ключ нанесения в заказах (SalesPrint.zone), поэтому уникально
  -- без учёта регистра и пробелов по краям; неизменность названия и «не удалять»
  -- держит страж app_config_order_catalog_guard
  if p_table = 'app_config' and p_key = 'zonesCatalog' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 200 then
      raise exception using errcode = '22023', message = 'Зоны: нужен список до 200 зон';
    end if;
    select 'зона ' || left(coalesce(z->>'id', '?'), 80) into v_bad
      from jsonb_array_elements(p_value) z
     where jsonb_typeof(z) <> 'object'
        or coalesce(jsonb_typeof(z->'id'), '') <> 'string' or (z->>'id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$'
        or coalesce(jsonb_typeof(z->'name'), '') <> 'string' or btrim(z->>'name') = '' or char_length(z->>'name') > 200
        or coalesce(jsonb_typeof(z->'forCategories'), 'null') not in ('null', 'array')
        or case when jsonb_typeof(z->'forCategories') = 'array'
                then exists (select 1 from jsonb_array_elements(z->'forCategories') c
                              where jsonb_typeof(c) <> 'string' or char_length(c #>> '{}') > 64) end
        or (z ? 'sortOrder' and jsonb_typeof(z->'sortOrder') <> 'number')
        or (z ? 'requiresHood' and jsonb_typeof(z->'requiresHood') <> 'boolean')
        or (z ? 'requiresPocket' and jsonb_typeof(z->'requiresPocket') <> 'boolean')
        or (z ? 'active' and jsonb_typeof(z->'active') <> 'boolean')
        or (z ? 'tz_row'
            and (jsonb_typeof(z->'tz_row') <> 'string'
                 or (z->>'tz_row') not in ('front', 'front_l', 'front_r', 'back', 'sleeve_l', 'sleeve_r',
                                           'hood_l', 'hood_r', 'pocket', 'other')))
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Зоны: неверная запись — ' || v_bad;
    end if;
    if (select count(*) <> count(distinct z->>'id') from jsonb_array_elements(p_value) z) then
      raise exception using errcode = '22023', message = 'Зоны: id повторяется';
    end if;
    select min(btrim(z->>'name')) into v_bad
      from jsonb_array_elements(p_value) z
     group by lower(btrim(z->>'name')) having count(*) > 1
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Зоны: название «' || left(v_bad, 200) || '» повторяется';
    end if;
    return;
  end if;
  -- Конец ветки zonesCatalog (миграция I)

  -- Каталог моделей и общий прайс-каталог: списки
  if (p_table = 'catalog_config' and p_key in ('fabricsCatalog', 'trimCatalog'))
     or (p_table = 'app_config'
         and p_key in ('sku_catalog', 'extrasCatalog', 'hardwareCatalog', 'categoryRules')) then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception using errcode = '22023', message = 'Справочник — список';
    end if;
    return;
  end if;

  raise exception using errcode = '22023', message = 'Такого справочника нет';
end;
$$;

revoke execute on function public.catalog_value_check(text, text, jsonb) from public, anon, authenticated;

-- ── 2. Страж ключей garmentFlats и zonesCatalog ─────────────────────────
-- security definer: catalog_value_check закрыта от authenticated, а прямую
-- запись admin и director пропускают политики app_config_insert/_update.
-- Роль запроса читается из JWT (auth.role()): в security definer current_user —
-- владелец функции и о клиенте ничего не говорит

create or replace function public.app_config_order_catalog_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce((select auth.role()), '');
  v_bad text;
begin
  -- Удаление строки ключа (и перенос ключа под другое имя) — только служебно:
  -- service_role или владелец в SQL Editor и миграции (без JWT клиента)
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.key is distinct from new.key) then
    if old.key in ('garmentFlats', 'zonesCatalog')
       and not (v_role = 'service_role'
                or (session_user = 'postgres' and v_role not in ('authenticated', 'anon'))) then
      raise exception using errcode = '42501', message = 'Справочник «' || old.key || '» не удаляется';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  if new.key not in ('garmentFlats', 'zonesCatalog') then
    return new;
  end if;

  -- Прямая запись мимо RPC проходит ту же форму, что и catalog_put
  perform public.catalog_value_check('app_config', new.key, new.value);

  if tg_op = 'INSERT' or old.key is distinct from new.key then
    return new;
  end if;

  if new.key = 'garmentFlats' and jsonb_typeof(old.value->'flats') = 'array' then
    -- Флэт не исчезает: снимают с подбора (active: false)
    select left(o->>'id', 80) into v_bad
      from jsonb_array_elements(old.value->'flats') o
     where jsonb_typeof(o) = 'object' and jsonb_typeof(o->'id') = 'string'
       and not exists (select 1 from jsonb_array_elements(new.value->'flats') n where n->>'id' = o->>'id')
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: флэт «' || v_bad || '» удалён — снимите его с подбора';
    end if;
    -- Версия не понижается
    select left(o->>'id', 80) into v_bad
      from jsonb_array_elements(old.value->'flats') o, jsonb_array_elements(new.value->'flats') n
     where jsonb_typeof(o) = 'object' and n->>'id' = o->>'id'
       and jsonb_typeof(o->'version') = 'number'
       and (n->>'version')::numeric < (o->>'version')::numeric
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: версия флэта «' || v_bad || '» понижена';
    end if;
    -- Каждая запись прежней истории — в новой без изменений (точное равенство
    -- jsonb: @> пропустил бы дописанный в старую версию вид или лишнее поле);
    -- при росте версии прежние виды — в истории под прежней версией
    select left(o->>'id', 80) into v_bad
      from jsonb_array_elements(old.value->'flats') o, jsonb_array_elements(new.value->'flats') n
     where jsonb_typeof(o) = 'object' and n->>'id' = o->>'id'
       and (exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o->'history') = 'array'
                                                             then o->'history' else '[]' end) oe
                     where not exists (select 1 from jsonb_array_elements(coalesce(n->'history', '[]')) ne
                                        where ne = oe))
            or ((n->>'version') is distinct from (o->>'version')
                and not exists (select 1 from jsonb_array_elements(coalesce(n->'history', '[]')) ne
                                 where (ne->>'version') = (o->>'version')
                                   and ne->'views' = o->'views')))
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Флэты: история флэта «' || v_bad || '» изменена';
    end if;
  end if;

  if new.key = 'zonesCatalog' and jsonb_typeof(old.value) = 'array' then
    -- Зона не исчезает: снимают с подбора (active: false)
    select left(coalesce(o->>'name', o->>'id'), 200) into v_bad
      from jsonb_array_elements(old.value) o
     where jsonb_typeof(o) = 'object' and jsonb_typeof(o->'id') = 'string'
       and not exists (select 1 from jsonb_array_elements(new.value) n where n->>'id' = o->>'id')
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Зоны: зона «' || v_bad || '» удалена — снимите её с подбора';
    end if;
    -- Название — ключ нанесения в заказах: не меняется
    select left(coalesce(o->>'name', o->>'id'), 200) into v_bad
      from jsonb_array_elements(old.value) o, jsonb_array_elements(new.value) n
     where jsonb_typeof(o) = 'object' and n->>'id' = o->>'id'
       and (n->>'name') is distinct from (o->>'name')
     limit 1;
    if v_bad is not null then
      raise exception using errcode = '22023', message = 'Зоны: название зоны «' || v_bad || '» менять нельзя';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.app_config_order_catalog_guard() from public, anon, authenticated;

drop trigger if exists app_config_order_catalog_guard on public.app_config;
create trigger app_config_order_catalog_guard
  before insert or update or delete on public.app_config
  for each row execute function public.app_config_order_catalog_guard();

notify pgrst, 'reload schema';
