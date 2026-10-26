-- СУХОЙ ПРОГОН миграции O (веха 5в, Э9): миграция + пробы одной транзакцией, в конце —
-- исключение PROBE_RESULT, которое откатывает ВСЁ (в базе ничего не меняется).
-- Собран из supabase/migrations/20261026100000_garment_flats_hood_pocket.sql
-- и supabase/probes/flats_views_o.sql (сторож orderTemplatesRollout.test.ts сверяет текст).
--
-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=10 {…}

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- ── миграция O ───────────────────────────────────────────────────────────
-- =============================================================
-- Веха 5в, Э9 — виды флэта «Капюшон» и «Карман» (миграция O)
-- =============================================================
-- Клиент (`FLAT_VIEW_KINDS`, `FLAT_PATH_RE`) знает виды hood и pocket: их SVG
-- заводит админ в редакторе флэта («Флэты и зоны» → «Добавить вид»). Сервер
-- держит перечень видов в двух местах — оба расширяются здесь:
--   1. `garment_flat_path_ok` — путь SVG в бакете garment-flats (политика insert);
--   2. `catalog_value_check`, ветка garmentFlats — перечень видов записи флэта.
-- Якорей у капюшона и кармана нет (как у аксессуара): отступ — от верха зоны,
-- ось — середина зоны; объект `anchors` по-прежнему обязателен.
--
-- `catalog_value_check` — ПОДЛИННЫЙ текст миграции I (`20261018090000_flats_admin`,
-- сверка 26.10: md5 `prosrc` на бою = файлу I) с ОДНОЙ правкой — перечнем видов
-- (сторож catalogKeys.test.ts: тело O = тело I с заменой перечня). Права
-- функций `create or replace` сохраняет; revoke/grant ниже — повтор для явности.
--
-- Порядок выкатки: НЕЗАВИСИМ от фронта и безопасен до него — только расширяет
-- допустимое: старый фронт видов hood/pocket не пишет. Новый фронт без O получит
-- понятный отказ при сохранении флэта с этими видами (22023 / отказ загрузки SVG),
-- ничего не записав. ERP не затрагивается. Проба — supabase/probes/flats_views_o.sql.

create or replace function public.garment_flat_path_ok(p_name text)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select coalesce(p_name ~ '^flats/[a-z0-9][a-z0-9-]{0,62}/v[1-9][0-9]{0,3}/(front|back|sleeve_left|sleeve_right|hood|pocket)\.svg$', false);
$$;

revoke execute on function public.garment_flat_path_ok(text) from public, anon;
grant execute on function public.garment_flat_path_ok(text) to authenticated;

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
        or (w.v->>'kind') not in ('front', 'back', 'sleeve_left', 'sleeve_right', 'hood', 'pocket')
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

-- ── пробы ────────────────────────────────────────────────────────────────

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

select pg_temp.p('o_path_hood', 'OK true', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/hood.svg')::text$q$);
select pg_temp.p('o_path_pocket', 'OK true', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/pocket.svg')::text$q$);
select pg_temp.p('o_path_front', 'OK true', $q$select public.garment_flat_path_ok('flats/tshirt-freefit/v1/front.svg')::text$q$);
select pg_temp.p('o_path_collar', 'OK false', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/collar.svg')::text$q$);
select pg_temp.p('o_path_hood_png', 'OK false', $q$select public.garment_flat_path_ok('flats/hoodie-regular/v2/hood.png')::text$q$);
select pg_temp.p('o_live', 'OK ok', $q$select public.catalog_value_check('app_config', 'garmentFlats', value)::text || 'ok' from public.app_config where key = 'garmentFlats'$q$);
select pg_temp.p('o_flat_hood', 'OK ok', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_pocket', 'OK ok', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('pocket'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/pocket.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_collar', '22023', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('collar'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/collar.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);
select pg_temp.p('o_flat_hood_twice', '22023', $q$select (public.catalog_value_check('app_config', 'garmentFlats', (select jsonb_set(v, '{flats,0,views}', (v->'flats'->0->'views') || jsonb_build_array(
      jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg')), jsonb_set(jsonb_set(v->'flats'->0->'views'->0, '{kind}', to_jsonb('hood'::text)), '{svg_path}',
        to_jsonb('flats/' || (v->'flats'->0->>'id') || '/v' || (v->'flats'->0->>'version') || '/hood.svg'))))
    from (select value v from public.app_config where key = 'garmentFlats') s)))::text || 'ok'$q$);

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
