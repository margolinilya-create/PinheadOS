-- ИСПРАВЛЕНИЕ: `text[] || 'строка'` — ЭТО НЕ ДОБАВЛЕНИЕ ЭЛЕМЕНТА.
--
-- Нетипизированный литерал рядом с массивом Postgres приводит к ТИПУ МАССИВА,
-- то есть разбирает `'description'` как литерал массива и падает:
--   22P02 malformed array literal: "description"
--
-- ЦЕНА РОВНО ТА, ЧТО У ДЕФЕКТА 10.09 С АУДИТОМ: триггер `before update`
-- не мешает вставке и валится при ПЕРВОЙ ЖЕ правке — то есть у человека,
-- а не при выкладке. Карточку SKU стало бы нельзя отредактировать вовсе,
-- при том что создание работает.
--
-- Нашлось проверкой на живой базе от лица заведённого в транзакции технолога
-- (правило проекта: гейты проверяются опытом, а не вычиткой). Правится НОВОЙ
-- миграцией, а не правкой применённой: версия из журнала повторно
-- не исполняется, и правка файла дала бы зелёный репозиторий при живом
-- дефекте в проде.
--
-- `array_append` вместо `|| 'x'::text` намеренно: он не оставляет вопроса
-- о типах вовсе, и следующий, кто допишет сюда поле, не повторит ошибку.

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
  if new.name is distinct from old.name then v_fields := array_append(v_fields, 'name'); end if;
  if new.code is distinct from old.code then v_fields := array_append(v_fields, 'code'); end if;
  if new.category is distinct from old.category then v_fields := array_append(v_fields, 'category'); end if;
  if new.description is distinct from old.description then v_fields := array_append(v_fields, 'description'); end if;
  if new.fit is distinct from old.fit then v_fields := array_append(v_fields, 'fit'); end if;
  if new.pattern_tech_name is distinct from old.pattern_tech_name then v_fields := array_append(v_fields, 'pattern_tech_name'); end if;
  if new.pattern_version is distinct from old.pattern_version then v_fields := array_append(v_fields, 'pattern_version'); end if;
  if new.status is distinct from old.status then v_fields := array_append(v_fields, 'status'); end if;
  if new.final_package is distinct from old.final_package then v_fields := array_append(v_fields, 'final_package'); end if;
  if new.price_min is distinct from old.price_min then v_fields := array_append(v_fields, 'price_min'); end if;
  if new.price_max is distinct from old.price_max then v_fields := array_append(v_fields, 'price_max'); end if;

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

revoke execute on function public.erp_sku_card_version() from anon, authenticated, public;
