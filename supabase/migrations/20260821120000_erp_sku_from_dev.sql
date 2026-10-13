-- Перенос финального пакета разработки в каталог SKU (решение заказчика 21.08).
--
-- ЗАЧЕМ. Документ: «при следующем заказе этой модели экспериментальный цех
-- повторно не требуется». Пока пакет лежит только в карточке разработки,
-- менеджер повторного заказа о нём не знает: открывает визард, модели
-- в каталоге нет — и заводит разработку заново.
--
-- ПОЧЕМУ СЕРВЕРНАЯ ФУНКЦИЯ, А НЕ ЗАПИСЬ ИЗ КЛИЕНТА. Каталог хранится ОДНОЙ
-- строкой `app_config.sku_catalog` (JSON-массив артикулов). Клиентский путь
-- «прочитать массив → добавить элемент → записать обратно» — это два запроса
-- с окном между ними: редактор SKU, сохранивший каталог в этот момент, затрёт
-- новый артикул молча. Здесь чтение и запись идут ОДНИМ оператором внутри
-- транзакции, и второго писателя не появляется.
--
-- ЧТО ФУНКЦИЯ НЕ ДЕЛАЕТ. Не придумывает недостающее. Код, категория, цена
-- пошива и расход ткани приходят от человека через форму сверки
-- (`utils/skuFromDev` считает, чего не хватает): артикул с нулевой ценой
-- ломает расчёт заказа молча, и чинит его не тот, кто переносил.

alter table public.erp_experimental
  add column if not exists sku_code text;

comment on column public.erp_experimental.sku_code is
  'Артикул каталога, в который перенесён финальный пакет. Заполняется `erp_sku_from_dev`; повторный перенос запрещён — модель уже в каталоге.';

-- ПОЧЕМУ `SECURITY DEFINER`. RLS `app_config` пускает на запись только профили
-- `admin`/`director` (каталогом всегда правил Order Studio), а право
-- `catalog.edit` в матрице ERP есть ещё и у руководителя производства. Оставить
-- `INVOKER` значило бы «кнопка есть, действие падает» — запрещённое состояние
-- по правилам проекта. Обход RLS ограничен самой функцией: она пишет ОДИН ключ
-- `sku_catalog`, добавляет ровно один элемент и требует `catalog.edit` первой же
-- строкой. Расширение названо вслух: переносить модель в каталог теперь может
-- тот, кому матрица разрешила править каталоги, а не только админ.
create or replace function public.erp_sku_from_dev(p_dev uuid, p_sku jsonb)
returns text
language plpgsql
security definer
set search_path to 'public' as $$
declare
  v_dev public.erp_experimental;
  v_code text := nullif(btrim(coalesce(p_sku->>'code', '')), '');
  v_catalog jsonb;
begin
  -- Право то же, что у редактора каталога: перенос ДОБАВЛЯЕТ артикул,
  -- по которому потом считаются заказы
  if not public.erp_has_permission('catalog.edit') then
    raise exception 'erp_sku_from_dev: перенос в каталог требует права catalog.edit'
      using errcode = '42501';
  end if;

  select * into v_dev from public.erp_experimental where id = p_dev;
  if v_dev.id is null then
    raise exception 'erp_sku_from_dev: разработка не найдена';
  end if;

  -- Переносится ГОТОВАЯ модель. До «Готово к серии» пакет неполон — его
  -- полноту сторожит `erp_dev_package_guard`, и переносить недоделанное
  -- значило бы обойти тот гейт с другой стороны
  if coalesce(v_dev.outcome, '') <> 'ready_for_serial' then
    raise exception 'erp_sku_from_dev: в каталог переносится разработка, готовая к серии';
  end if;

  -- Повторный перенос запрещён: второй артикул той же модели — это два
  -- источника правды о ней, и заказы разойдутся по обоим
  if v_dev.sku_code is not null then
    raise exception 'erp_sku_from_dev: модель уже в каталоге (%). Правьте артикул в каталоге', v_dev.sku_code;
  end if;

  if v_code is null then
    raise exception 'erp_sku_from_dev: код артикула обязателен';
  end if;
  if coalesce((p_sku->>'sewingPrice')::numeric, 0) <= 0 then
    raise exception 'erp_sku_from_dev: цена пошива обязательна — иначе заказ считается бесплатным';
  end if;
  if nullif(btrim(coalesce(p_sku->>'category', '')), '') is null then
    raise exception 'erp_sku_from_dev: категория обязательна — от неё зависят правила визарда';
  end if;

  select coalesce(value, '[]'::jsonb) into v_catalog
    from public.app_config where key = 'sku_catalog';
  v_catalog := coalesce(v_catalog, '[]'::jsonb);

  if exists (
    select 1 from jsonb_array_elements(v_catalog) as e
     where e->>'code' = v_code
  ) then
    raise exception 'erp_sku_from_dev: артикул % уже есть в каталоге', v_code;
  end if;

  -- Чтение и запись ОДНИМ оператором: редактор каталога, сохраняющий в этот
  -- же момент, не может затереть новый артикул
  insert into public.app_config (key, value)
  values ('sku_catalog', v_catalog || jsonb_build_array(p_sku))
  on conflict (key) do update
    set value = coalesce(public.app_config.value, '[]'::jsonb) || jsonb_build_array(p_sku);

  update public.erp_experimental set sku_code = v_code, updated_at = now()
   where id = p_dev;

  return v_code;
end $$;

-- Право приходит от PUBLIC и наследуется `anon`, поэтому отзыв идёт у обоих,
-- и только потом выдаётся тому, кто действительно зовёт функцию
revoke execute on function public.erp_sku_from_dev(uuid, jsonb) from public, anon;
grant execute on function public.erp_sku_from_dev(uuid, jsonb) to authenticated;

comment on function public.erp_sku_from_dev(uuid, jsonb) is
  'Переносит финальный пакет разработки в каталог SKU одной транзакцией: добавляет артикул в app_config.sku_catalog и проставляет erp_experimental.sku_code. Недостающие поля не придумывает — их даёт форма сверки.';
