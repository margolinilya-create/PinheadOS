-- АВТОПУБЛИКАЦИЯ КАРТОЧКИ МОДЕЛИ ИЗ РАЗРАБОТКИ (правка заказчика 14.09, п. 6).
--
-- Разработка, завершённая с исходом «Готово к серии», обязана оставить после
-- себя КАРТОЧКУ МОДЕЛИ: техпакет, лекала, фото образца, ценовую вилку. Иначе
-- документ обещает зря — «при следующем заказе этой модели экспериментальный
-- цех повторно не требуется», а менеджер повторного заказа о пакете не знает
-- и заводит разработку заново.
--
-- ТРИГГЕР, А НЕ ВЫЗОВ ИЗ КЛИЕНТА. Между «завершить разработку» и «создать
-- карточку» клиент может потерять сеть — и разработка окажется завершённой
-- без карточки, а событие завершения больше не наступит. Одна транзакция.
--
-- ТОЛЬКО НА ПЕРЕХОДЕ `outcome → 'ready_for_serial'`, тот же приём, что
-- у `erp_dev_package_guard` и `erp_dev_handoff_to_warehouse`. Тем самым
-- требование «сама галочка не публикует» выполняется ПО ПОСТРОЕНИЮ: правка
-- `final_package` триггер не будит вовсе.
--
-- КАРТОЧКА РОЖДАЕТСЯ ЧЕРНОВИКОМ, А В ПРАЙС-КАТАЛОГ ВИЗАРДА НЕ УХОДИТ.
-- Пакет разработки не содержит ни кода артикула, ни категории, ни цены пошива
-- с расходом ткани — а артикул с нулевой ценой ломает визард МОЛЧА. Выпуск
-- остаётся отдельным действием (форма сверки `DevToSku` → `erp_sku_from_dev`),
-- и именно это описывают статусы документа.
--
-- КОД У ЧЕРНОВИКА ВРЕМЕННЫЙ (`DEV-<8 знаков id>`), потому что колонка `code`
-- уникальна и обязательна, а настоящего артикула у модели ещё нет. Он же
-- и заменяется при выпуске: `erp_sku_from_dev` находит карточку по
-- `experimental_id` и пишет в неё настоящий код. Выдумывать «похожий
-- на настоящий» код нельзя — его начали бы называть в переписке.

create or replace function public.erp_dev_sku_card_on_ready()
returns trigger
language plpgsql
/**
 * `security definer` обязателен: завершает разработку ТЕХНОЛОГ, а вставку
 * в `erp_sku_cards` политика пускает под `sku.edit`. У технолога оно есть
 * сегодня, но право снимается галочкой в админке — и с `invoker` снятая
 * галочка роняла бы цеху САМО ЗАВЕРШЕНИЕ разработки 42501-й ошибкой внутри
 * чужой транзакции. Тот же довод, что у автоперехода «Нанесения → Пошив».
 */
security definer
set search_path = public
as $$
declare
  v_card uuid;
  v_pkg  jsonb := coalesce(new.final_package, '{}'::jsonb);
begin
  if new.outcome is distinct from 'ready_for_serial'
     or old.outcome is not distinct from new.outcome then
    return null;
  end if;

  /**
   * ПЕРЕКЛЮЧАТЕЛЬ «Добавить модель в каталог SKU» — тот же, что читает гейт
   * полноты пакета (`erp_pkg_flag`). Выключен — модель в каталог не идёт,
   * и заводить ей карточку значило бы спорить с решением технолога.
   */
  if not public.erp_pkg_flag(v_pkg, 'add_to_sku') then
    return null;
  end if;

  /**
   * `experimental_id` УНИКАЛЕН — «одна разработка = одна карточка»
   * ограничением базы. Проверка здесь не заменяет его, а делает повтор
   * тихим: разработку можно закрыть, переоткрыть и закрыть снова, и второй
   * заход обязан найти прежнюю карточку, а не свалиться 23505 внутри
   * транзакции цеха.
   */
  select id into v_card from public.erp_sku_cards where experimental_id = new.id;
  if v_card is not null then
    return null;
  end if;

  insert into public.erp_sku_cards
    (code, name, category, description, fit,
     pattern_tech_name, pattern_version,
     status, experimental_id, source_item_id,
     final_package, price_min, price_max, created_by)
  values (
    'DEV-' || upper(left(replace(new.id::text, '-', ''), 8)),
    coalesce(nullif(btrim(coalesce(new.tech_name, '')), ''), 'Без названия'),
    nullif(btrim(coalesce(v_pkg->>'category', '')), ''),
    nullif(btrim(coalesce(v_pkg->>'description', '')), ''),
    -- Крой живёт в пакете («Крой / посадка» — обязательное поле гейта),
    -- а не в колонке разработки
    nullif(btrim(coalesce(v_pkg->>'fit', '')), ''),
    new.pattern_tech_name,
    new.pattern_version,
    'draft',
    new.id,
    new.item_id,
    v_pkg,
    new.price_min,
    new.price_max,
    (select auth.uid())
  )
  returning id into v_card;

  /**
   * ФАЙЛЫ НЕ КОПИРУЮТСЯ В БАКЕТ — карточка ссылается на уже загруженные
   * вложения разработки. Рядом со ссылкой лежит СНИМОК пути и имени:
   * `attachment_id` объявлен `on delete set null`, и удалённая разработка
   * не имеет права унести с собой техпаспорт модели.
   */
  insert into public.erp_sku_card_files
    (card_id, attachment_id, role, file_path, file_name, created_by)
  select v_card, a.id,
         case a.kind
           when 'dev_pattern'  then 'pattern'
           when 'dev_passport' then 'passport'
           when 'dev_photo'    then 'photo'
           else 'other'
         end,
         a.file_path, a.file_name, (select auth.uid())
    from public.erp_order_attachments a
   where a.experimental_id = new.id
     and a.kind in ('dev_pattern', 'dev_passport', 'dev_photo');

  return null;
end $$;

comment on function public.erp_dev_sku_card_on_ready() is
  'Завершение разработки «Готово к серии» заводит ЧЕРНОВИК карточки модели с файлами техпакета. Артикул визарда отдельным действием: пакет не содержит цены и категории.';

drop trigger if exists erp_dev_sku_card_on_ready on public.erp_experimental;
create trigger erp_dev_sku_card_on_ready
  after update on public.erp_experimental
  for each row execute function public.erp_dev_sku_card_on_ready();

revoke execute on function public.erp_dev_sku_card_on_ready() from public, anon, authenticated;

-- ── Бэкфилл ───────────────────────────────────────────────────────────────
/**
 * ТРИГГЕР ЛОВИТ ПЕРЕХОД, а разработка, завершённая ДО его появления, его
 * не переживёт: событие «Готово к серии» у неё уже случилось и больше
 * не наступит. Карточки такая модель не получила бы НИКОГДА — значит бэкфилл
 * не перестраховка, а часть правки.
 *
 * НА БОЮ 15.09 ОН ЗАПОЛНЯЕТ НОЛЬ СТРОК, и это сказано вслух: единственная
 * разработка (`Поло · Тёмно-синий MZ`) ещё в работе, `outcome` у неё пуст.
 * План предполагал обратное — «на бою она завершена», — и живая база это
 * поправила. Бэкфилл остаётся: он идемпотентен, а его отсутствие стоило бы
 * карточки первой же разработке, завершённой между выкладкой миграции
 * и фронтенда.
 */
insert into public.erp_sku_cards
  (code, name, category, description, fit,
   pattern_tech_name, pattern_version,
   status, experimental_id, source_item_id,
   final_package, price_min, price_max)
select
  -- Модель, уже выпущенная в прайс, заводится СО СВОИМ артикулом: временный
  -- `DEV-…` рядом с действующим кодом был бы вторым именем одной модели
  coalesce(nullif(btrim(coalesce(e.sku_code, '')), ''),
           'DEV-' || upper(left(replace(e.id::text, '-', ''), 8))),
  coalesce(nullif(btrim(coalesce(e.tech_name, '')), ''), 'Без названия'),
  nullif(btrim(coalesce(e.final_package->>'category', '')), ''),
  nullif(btrim(coalesce(e.final_package->>'description', '')), ''),
  nullif(btrim(coalesce(e.final_package->>'fit', '')), ''),
  e.pattern_tech_name,
  e.pattern_version,
  -- Уже выпущенная в прайс модель приезжает сразу «В работе»: сказать про
  -- действующий артикул «требует заполнения» было бы неправдой
  case when e.sku_code is not null then 'active' else 'draft' end,
  e.id,
  e.item_id,
  coalesce(e.final_package, '{}'::jsonb),
  e.price_min,
  e.price_max
from public.erp_experimental e
where e.outcome = 'ready_for_serial'
  and public.erp_pkg_flag(coalesce(e.final_package, '{}'::jsonb), 'add_to_sku')
  and not exists (select 1 from public.erp_sku_cards c where c.experimental_id = e.id)
  -- Код разработки мог уже уехать в прайс — тогда карточка с ним и заводится,
  -- а не со временным `DEV-…`; на такую строку сработает `do nothing`
  and not exists (select 1 from public.erp_sku_cards c where c.code = e.sku_code)
on conflict (code) do nothing;

insert into public.erp_sku_card_files
  (card_id, attachment_id, role, file_path, file_name)
select c.id, a.id,
       case a.kind
         when 'dev_pattern'  then 'pattern'
         when 'dev_passport' then 'passport'
         when 'dev_photo'    then 'photo'
         else 'other'
       end,
       a.file_path, a.file_name
  from public.erp_sku_cards c
  join public.erp_order_attachments a on a.experimental_id = c.experimental_id
 where c.experimental_id is not null
   and a.kind in ('dev_pattern', 'dev_passport', 'dev_photo')
   and not exists (
     select 1 from public.erp_sku_card_files f
      where f.card_id = c.id and f.attachment_id = a.id);
