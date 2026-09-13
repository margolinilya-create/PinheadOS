-- ФИНАЛЬНЫЙ ТЕХПАКЕТ СНОВА ОБЯЗАТЕЛЕН, ПРОВЕРКИ ОБРАЗЦА БОЛЬШЕ НЕТ
-- (правка заказчика 12.09, вторая порция, п. 5).
--
-- Документ: «убрать из рабочего сценария ТОЛЬКО блок „Проверка образца".
-- „Финальный технический пакет" оставить обязательным условием завершения
-- разработки. Кнопка „Завершить разработку" должна быть недоступна, пока
-- не заполнены обязательные данные финального пакета: техническое название
-- лекал, версия лекал, технический паспорт и фото утверждённого образца».
--
-- ЧТО БЫЛО СЛОМАНО. Правка 12.09 (первая порция, п. 9) сняла ОБА требования
-- разом: `20260912142715_erp_dev_package_optional.sql` оставила от стража
-- пустой `return new`, а на клиенте один флаг `devFinalPackageRequired` гасил
-- и блок проверки образца, и весь перечень недостающего. Разработку стало
-- можно закрыть с пустым техпакетом — ни названия лекал, ни версии,
-- ни паспорта, ни фото.
--
-- ПОЧЕМУ НЕ ОТКАТ К 20260830160000. Та редакция требует ещё и
-- `sample_approved_at` («Образец отшит и проверен») — то самое условие,
-- которое просят снять. Буквальный откат вернул бы проверку образца вместе
-- с техпакетом, то есть исполнил бы документ наоборот. Условия по образцу
-- здесь НЕТ и не будет: вход, которым это поле проставляли, убран из
-- сценария, и требование поля, которое некому заполнить, заперло бы
-- завершение разработки навсегда.
--
-- ПОЧЕМУ ТЕКСТ НАПИСАН ЯВНО, А НЕ СОБРАН ИЗ `pg_get_functiondef`. Приём
-- пересборки верен для функций на три сотни строк, но `latestDefining` ищет
-- в миграциях `create or replace function public.<имя>(` и, не найдя, читает
-- ПРЕЖНЮЮ редакцию — то есть сторож подтвердил бы снятое правило как
-- действующее. Это уже стоило проекту лишней миграции 12.09.
--
-- ФОРМУЛИРОВКИ ОДНИ С КЛИЕНТОМ: `utils/finalPackage.missingFinalPackage`
-- добавляет те же строки теми же словами. Человек читает один список —
-- и в кнопке, и в отказе сервера; сторожит `finalPackage.test.ts`.

create or replace function public.erp_dev_package_guard()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  -- `array_append`, а НЕ `v_missing || 'строка'`: у оператора `||` есть вариант
  -- `anyarray || anyarray`, и нетипизированный литерал Postgres предпочитает
  -- разобрать как массив — «malformed array literal» вместо перечня полей.
  v_missing text[] := '{}';
  v_pkg     jsonb  := coalesce(new.final_package, '{}'::jsonb);
begin
  if new.outcome is distinct from 'ready_for_serial'
     or old.outcome is not distinct from new.outcome then
    return new;
  end if;
  -- Пустой `auth.uid()` — это service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- ── Техдокументация: нужна ВСЕГДА (п. 4.5) ─────────────────────────────────
  if btrim(coalesce(new.pattern_tech_name, '')) = '' then
    v_missing := array_append(v_missing, 'Техническое название лекал');
  end if;
  if btrim(coalesce(new.pattern_version, '')) = '' then
    v_missing := array_append(v_missing, 'Версия лекал');
  end if;
  if not exists (
    select 1 from public.erp_order_attachments a
     where a.experimental_id = new.id and a.kind = 'dev_passport') then
    v_missing := array_append(v_missing, 'Технический паспорт');
  end if;
  if not exists (
    select 1 from public.erp_order_attachments a
     where a.experimental_id = new.id and a.kind = 'dev_photo') then
    v_missing := array_append(v_missing, 'Фото образца');
  end if;
  -- «Комментарии и особенности производства» документ помечает словами
  -- «при необходимости»: поле в форме есть, в этом перечне его нет.

  -- ── Карточка SKU: только если модель идёт в каталог (п. 4.6) ───────────────
  if public.erp_pkg_flag(v_pkg, 'add_to_sku') then
    if not public.erp_pkg_text_filled(v_pkg, 'description') then
      v_missing := array_append(v_missing, 'Описание изделия');
    end if;
    if not public.erp_pkg_text_filled(v_pkg, 'fit') then
      v_missing := array_append(v_missing, 'Крой / посадка');
    end if;
    if not public.erp_pkg_text_filled(v_pkg, 'size_row') then
      v_missing := array_append(v_missing, 'Размерный ряд');
    end if;

    if not public.erp_pkg_list_filled(v_pkg, 'fabrics') then
      v_missing := array_append(v_missing, 'Доступные ткани');
    end if;
    if not public.erp_pkg_list_filled(v_pkg, 'branding') then
      v_missing := array_append(v_missing, 'Доступные нанесения');
    end if;
    if not public.erp_pkg_list_filled(v_pkg, 'modifications') then
      v_missing := array_append(v_missing, 'Возможные модификации');
    end if;

    if new.price_min is null or new.price_max is null then
      v_missing := array_append(v_missing, 'Ценовая вилка');
    elsif new.price_min > new.price_max then
      v_missing := array_append(v_missing, 'Ценовая вилка: «от» больше «до»');
    end if;
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Не заполнен финальный пакет: %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- Пересозданная функция получает права заново — отзыв повторяется здесь же.
-- `from public, anon`: право приходит от PUBLIC, и `anon` наследует его —
-- один `from anon` не делает ничего.
revoke execute on function public.erp_dev_package_guard() from public, anon, authenticated;
