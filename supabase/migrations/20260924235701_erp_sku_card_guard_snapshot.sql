-- Страж карточки модели (`erp_sku_card_guard`) переходит с перечисления
-- охраняемых колонок на перечисление ИСКЛЮЧЕНИЙ — пятым после четырёх
-- стражей `20260924231233` (обзор 24.09, п. 13; сессия 68).
--
-- ЧТО БЫЛО ОТКРЫТО. Сверка поимённого списка с живой схемой 24.09:
-- `id`, `experimental_id`, `source_item_id`, `created_by`, `created_at`
-- не охранялись ничем. UPDATE-политика пускает держателей `sku.edit`,
-- `sku.publish` и `sku.archive`, поэтому технолог или дизайнер (`sku.edit`)
-- перепривязывал карточку к чужой разработке, менял ей автора и позицию-
-- источник. `experimental_id` уникален («одна разработка — одна карточка»),
-- и перепривязка отнимала карточку у разработки, к которой она относилась.
--
-- ПРАВИЛА:
--   · `experimental_id` — под `sku.publish`. Сделать его неизменным для всех
--     нельзя: `erp_sku_from_dev` (security definer, сама требует
--     `sku.publish`) меняет его у существующей карточки через
--     `insert … on conflict (code) do update set experimental_id = …`,
--     а это UPDATE, и страж его видит;
--   · `source_item_id` пишется один раз, при заведении карточки, и дальше
--     не меняется ни у кого;
--   · `id`, `created_at`, `created_by`, `card_version` и любая колонка,
--     добавленная позже, неизменны: их держит сравнение снимков.
--
-- ОБНУЛЕНИЕ ССЫЛКИ БАЗОЙ. У `experimental_id` и `source_item_id` внешний
-- ключ `on delete set null`. Удаляя разработку или позицию заказа, Postgres
-- обновляет карточку, этот UPDATE проходит через страж, и `auth.uid()`
-- в нём — того, кто удалял. Без отдельной ветки сравнение снимков заперло бы
-- удаление позиции, из которой завели модель, у всех, включая админа.
-- Ветка узнаёт такое обнуление по факту: ссылка ушла в NULL, а строки,
-- на которую она указывала, больше нет. С клиента эту ветку не открыть:
-- пока родитель жив, обнулить ссылку нельзя, а после удаления её уже
-- обнулила сама база.
--
-- ЧТО НЕ МЕНЯЕТСЯ ДЛЯ ИНТЕРФЕЙСА. Писатели сверены: форма карточки
-- (`SkuCardPage`) шлёт описательные поля под `sku.edit` и статус под
-- `sku.publish`/`sku.archive`; `erp_sku_from_dev` — код, название,
-- категорию, статус и привязку под `sku.publish`; `erp_dev_sku_card_on_ready`
-- только вставляет. Новые запреты касаются колонок, которые интерфейс
-- не пишет, поэтому клиентский гейт не нужен.
--
-- Текст функции взят с ЖИВОЙ базы (`pg_get_functiondef`, 24.09); меняется
-- только вычисление «что изменилось».

create or replace function public.erp_sku_card_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  /**
   * Поля, которые меняются по ПРАВУ: у каждого ниже своя проверка.
   * Остальное сравнивается снимком строки и неизменно — в том числе
   * колонка, которую допишут позже.
   */
  v_free constant text[] := array[
    'status', 'code', 'experimental_id', 'source_item_id', 'updated_at',
    'name', 'category', 'description', 'fit', 'pattern_tech_name',
    'pattern_version', 'final_package', 'price_min', 'price_max'];
  v_dev_gone boolean;
  v_item_gone boolean;
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  /**
   * ССЫЛКУ ОБНУЛЯЕТ САМА БАЗА, когда удалён родитель (`on delete set null`).
   * Узнаётся по факту: ссылка ушла в NULL, а строки, на которую она
   * указывала, больше нет. Пока родитель жив, эта ветка закрыта.
   */
  v_dev_gone := new.experimental_id is null and old.experimental_id is not null
    and not exists (select 1 from public.erp_experimental e where e.id = old.experimental_id);
  v_item_gone := new.source_item_id is null and old.source_item_id is not null
    and not exists (select 1 from public.erp_order_items i where i.id = old.source_item_id);

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
   * ПРИВЯЗКА К РАЗРАБОТКЕ — то же право, что и выпуск: её меняет
   * `erp_sku_from_dev`, которая сама требует `sku.publish`. Держатель одного
   * `sku.edit` перепривязывал бы карточку к чужой разработке.
   */
  if new.experimental_id is distinct from old.experimental_id
     and not v_dev_gone
     and not public.erp_has_permission('sku.publish') then
    raise exception 'erp_sku_card_guard: привязка карточки к разработке требует права sku.publish'
      using errcode = '42501';
  end if;

  /**
   * ПОЗИЦИЯ-ИСТОЧНИК пишется один раз, когда разработка заводит карточку,
   * и дальше не меняется ни у кого.
   */
  if new.source_item_id is distinct from old.source_item_id
     and not v_item_gone then
    raise exception 'erp_sku_card_guard: позиция-источник карточки не меняется'
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

  -- Всё остальное неизменно — одним сравнением снимков, без перечня колонок:
  -- `id`, `created_at`, `created_by` и то, что допишут в таблицу позже
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'erp_sku_card_guard: это поле карточки ведёт система'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end $function$;

revoke execute on function public.erp_sku_card_guard() from public, anon, authenticated;
