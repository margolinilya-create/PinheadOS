-- «ОБРАЗЕЦ ОТШИТ» — ВТОРОЕ УСЛОВИЕ ЗАВЕРШЕНИЯ РАЗРАБОТКИ (правка 30.08, п. 4).
--
-- Документ: «Разработку считать завершённой после того, как образец отшит
-- И в заказ внесена обязательная техническая документация по изделию».
-- Условий два, а гейт проверял только второе: разработку можно было закрыть
-- и передать образец на склад, ни разу этот образец не собрав. Складская
-- задача «Приёмка готовой продукции» при этом заводится автоматически —
-- то есть склад начинал ждать вещь, которой нет.
--
-- ЧЕМ ПОДТВЕРЖДАЕТСЯ «ОТШИТ». Проверкой образца (`sample_approved_at`):
-- это единственное место, где человек говорит системе, что образец собран
-- и осмотрен, — и оно же переводит карточку в колонку «Финальный этап»
-- (`devBoardColumn`). Считать доказательством фото образца нельзя: файл
-- прикладывают и к незаконченной работе, а «Фото образца» уже стоит
-- в перечне отдельной строкой и отвечает на другой вопрос — вошло ли
-- изображение в техпакет.
--
-- ПОЧЕМУ НЕ ЭТАП «ПОШИВ ОБРАЗЦА». Состояние шагов вычисляется из задач
-- и намерения человека (`board_stage`), а обязательных задач этапов с 30.08
-- не создаётся вовсе: шаг «Пошив» у разработки без заведённых задач пуст
-- по построению, и гейт, построенный на нём, либо не срабатывал бы никогда,
-- либо запирал бы всех подряд. Проверка образца — состояние, которое
-- ставит ЧЕЛОВЕК, и оно есть у разработки любой формы.
--
-- ФОРМУЛИРОВКА ОДНА С КЛИЕНТОМ: `utils/finalPackage.missingFinalPackage`
-- добавляет ту же строку теми же словами. Человек читает один список —
-- и в кнопке, и в отказе сервера; сторожит `finalPackage.test.ts`,
-- читающий текст этой миграции.

create or replace function public.erp_dev_package_guard()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  -- `array_append`, а НЕ `v_missing || 'строка'`: у оператора `||` есть вариант
  -- `anyarray || anyarray`, и нетипизированный литерал Postgres предпочитает
  -- разобрать как массив — «malformed array literal» вместо перечня полей.
  -- Проверено на боевой базе: страж срабатывал, но объяснял непонятно.
  v_missing text[] := '{}';
  v_pkg     jsonb  := coalesce(new.final_package, '{}'::jsonb);
begin
  if new.outcome is distinct from 'ready_for_serial'
     or old.outcome is not distinct from new.outcome then
    return new;
  end if;
  if (select auth.uid()) is null then
    return new;
  end if;

  -- ── Образец: первое условие документа (п. 4) ───────────────────────────────
  if new.sample_approved_at is null then
    v_missing := array_append(v_missing, 'Образец отшит и проверен');
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
  -- Проверки лекал здесь тоже нет — «поле „Файл лекал или ссылка" не нужно».

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

comment on function public.erp_dev_package_guard() is
  'Гейт завершения разработки: отшитый и проверенный образец, техдокументация всегда, карточка SKU — только при final_package.add_to_sku. Перечисляет незаполненное ровно так же, как utils/finalPackage.missingFinalPackage.';
