-- КАТАЛОГ SKU: ОДИН ПИСАТЕЛЬ ПРАЙСА, ПРАВО НА ВЫПУСК И ЗАСЕВ КАРТОЧЕК
-- (правка заказчика 14.09, п. 6 — вторая миграция).
--
-- ТРИ ВЕЩИ, И КАЖДАЯ ИМЕЕТ СВОЮ ПРИЧИНУ:
--
-- 1. Запись в `app_config.sku_catalog` вынесена в `erp_sku_catalog_upsert`.
--    Массив артикулов — ОДНА строка `app_config`, и клиентское «прочитать →
--    дописать → записать» оставляет окно, в котором редактор SKU затирает
--    новый артикул молча. Писатель обязан остаться ровно один — это главная
--    ценность миграции 20260821120000, и терять её нельзя.
-- 2. Гейт `erp_sku_from_dev` переведён с `catalog.edit` на `sku.publish`
--    В ТОЙ ЖЕ миграции, где право засеяно (предыдущая): иначе кто-то
--    потерял бы доступ молча. Носители обоих прав совпадают — директор
--    и руководитель производства.
-- 3. Карточки засеяны из прайс-каталога. На бою в нём 52 артикула, а
--    разработка одна: без засева вкладка «Каталог SKU» открывалась бы
--    пустой при полном прайсе — «работа есть, результата нет».

-- ── Единственный писатель прайс-каталога ──────────────────────────────────
create or replace function public.erp_sku_catalog_upsert(p_sku jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(btrim(coalesce(p_sku->>'code', '')), '');
  v_catalog jsonb;
begin
  if not public.erp_has_permission('sku.publish') then
    raise exception 'erp_sku_catalog_upsert: выпуск артикула требует права sku.publish'
      using errcode = '42501';
  end if;

  if v_code is null then
    raise exception 'erp_sku_catalog_upsert: код артикула обязателен'
      using errcode = '22023';
  end if;
  /**
   * ЦЕНА И КАТЕГОРИЯ ОБЯЗАТЕЛЬНЫ, и это не педантизм: артикул с нулевой
   * ценой ломает визард МОЛЧА (заказ считается бесплатным), а от категории
   * зависят правила подбора техник и размеров.
   */
  if coalesce((p_sku->>'sewingPrice')::numeric, 0) <= 0 then
    raise exception 'erp_sku_catalog_upsert: цена пошива обязательна — иначе заказ считается бесплатным'
      using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_sku->>'category', '')), '') is null then
    raise exception 'erp_sku_catalog_upsert: категория обязательна — от неё зависят правила визарда'
      using errcode = '22023';
  end if;

  select coalesce(value, '[]'::jsonb) into v_catalog
    from public.app_config where key = 'sku_catalog';
  v_catalog := coalesce(v_catalog, '[]'::jsonb);

  if exists (select 1 from jsonb_array_elements(v_catalog) e where e->>'code' = v_code) then
    raise exception 'erp_sku_catalog_upsert: артикул % уже есть в каталоге', v_code
      using errcode = '23505';
  end if;

  insert into public.app_config (key, value)
  values ('sku_catalog', v_catalog || jsonb_build_array(p_sku))
  on conflict (key) do update
    set value = coalesce(public.app_config.value, '[]'::jsonb) || jsonb_build_array(p_sku);

  return v_code;
end $$;

comment on function public.erp_sku_catalog_upsert(jsonb) is
  'Единственный писатель app_config.sku_catalog. Клиентское «прочитать → дописать → записать» затирало бы соседний артикул молча.';

-- ── Перенос модели из разработки ──────────────────────────────────────────
/**
 * ТЕЛО ПЕРЕЕХАЛО, ПРАВИЛА ОСТАЛИСЬ. Функция по-прежнему отвечает за ОДНО:
 * разработка, готовая к серии, переносится в каталог один раз. Запись
 * в прайс теперь делает `erp_sku_catalog_upsert`, а рядом появилось второе
 * следствие — карточка ERP получает код и выпускается в работу.
 *
 * Карточки может и не быть (разработка старше правки 14.09) — тогда она
 * заводится здесь же. Ветка не «на всякий случай»: на бою такая разработка
 * ровно одна, и без неё перенос оставил бы модель в прайсе без техпакета.
 */
create or replace function public.erp_sku_from_dev(p_dev uuid, p_sku jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dev public.erp_experimental;
  v_code text := nullif(btrim(coalesce(p_sku->>'code', '')), '');
  v_card uuid;
begin
  if not public.erp_has_permission('sku.publish') then
    raise exception 'erp_sku_from_dev: перенос в каталог требует права sku.publish'
      using errcode = '42501';
  end if;

  select * into v_dev from public.erp_experimental where id = p_dev;
  if v_dev.id is null then
    raise exception 'erp_sku_from_dev: разработка не найдена';
  end if;

  if coalesce(v_dev.outcome, '') <> 'ready_for_serial' then
    raise exception 'erp_sku_from_dev: в каталог переносится разработка, готовая к серии';
  end if;

  if v_dev.sku_code is not null then
    raise exception 'erp_sku_from_dev: модель уже в каталоге (%). Правьте артикул в каталоге', v_dev.sku_code;
  end if;

  -- Прайс пишет ОДИН оператор — вынесенная функция; проверки кода, цены
  -- и категории живут там же
  perform public.erp_sku_catalog_upsert(p_sku);

  /**
   * Карточка ERP: своя, если разработка её уже получила (триггер
   * автопубликации), иначе заводится здесь. `on conflict (code)` — не
   * гипотетика: тот же код мог приехать засевом из прайс-каталога.
   */
  select id into v_card from public.erp_sku_cards where experimental_id = p_dev;
  if v_card is null then
    insert into public.erp_sku_cards
      (code, name, category, description, fit, pattern_tech_name,
       experimental_id, status, final_package, created_by)
    values
      (v_code,
       coalesce(nullif(btrim(coalesce(p_sku->>'name', '')), ''), v_code),
       nullif(btrim(coalesce(p_sku->>'category', '')), ''),
       nullif(btrim(coalesce(p_sku->>'description', '')), ''),
       nullif(btrim(coalesce(p_sku->>'fit', '')), ''),
       v_dev.pattern_tech_name,
       p_dev, 'active', coalesce(v_dev.final_package, '{}'::jsonb), (select auth.uid()))
    on conflict (code) do update
      set experimental_id = excluded.experimental_id,
          status = 'active';
  else
    update public.erp_sku_cards
       set code = v_code,
           name = coalesce(nullif(btrim(coalesce(p_sku->>'name', '')), ''), name),
           category = coalesce(nullif(btrim(coalesce(p_sku->>'category', '')), ''), category),
           status = 'active'
     where id = v_card;
  end if;

  update public.erp_experimental set sku_code = v_code, updated_at = now()
   where id = p_dev;

  return v_code;
end $$;

comment on function public.erp_sku_from_dev(uuid, jsonb) is
  'Перенос модели из разработки: артикул в прайс визарда (через erp_sku_catalog_upsert) и карточка ERP в работу. Право — sku.publish.';

revoke execute on function public.erp_sku_catalog_upsert(jsonb) from public, anon;
grant execute on function public.erp_sku_catalog_upsert(jsonb) to authenticated;

-- ── Засев карточек из прайс-каталога ──────────────────────────────────────
/**
 * ПОЧЕМУ ЗАСЕВ ОБЯЗАТЕЛЕН. Правило проекта: «прежде чем строить механизм,
 * посмотрите, ЧЕМ он будет питаться». Карточки должны были наполняться
 * публикациями из разработок — а разработка на бою одна при 52 моделях
 * в прайсе. Вкладка открывалась бы пустой, и это выглядело бы как поломка,
 * а не как пустой каталог.
 *
 * СТАТУС `active`, а не `draft`: эти модели РАБОТАЮТ — по ним считают заказы
 * прямо сейчас. «Требует заполнения» сказало бы неправду о действующем
 * артикуле; техпакет у них и правда пуст, и это видно в самой карточке.
 *
 * Идемпотентно по коду: повтор миграции не заводит вторую карточку.
 */
insert into public.erp_sku_cards (code, name, category, description, fit, status)
select
  e->>'code',
  coalesce(nullif(btrim(coalesce(e->>'name', '')), ''), e->>'code'),
  nullif(btrim(coalesce(e->>'category', '')), ''),
  nullif(btrim(coalesce(e->>'description', '')), ''),
  nullif(btrim(coalesce(e->>'fit', '')), ''),
  'active'
from public.app_config, jsonb_array_elements(value) e
where key = 'sku_catalog'
  and nullif(btrim(coalesce(e->>'code', '')), '') is not null
on conflict (code) do nothing;
