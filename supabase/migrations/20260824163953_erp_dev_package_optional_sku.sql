-- Финальный пакет разработки: карточка SKU по желанию, лекала не спрашиваются.
-- Правки заказчика 24.08, пп. 4.5 и 4.6.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ (4.5). «Обязательные поля технической документации:
-- техническое название лекал, версия лекал, технический паспорт или
-- техописание, фото утверждённого образца, комментарии и особенности
-- производства при необходимости. Поле "Файл лекал или ссылка" не нужно».
-- Перечень исчерпывающий, и лекала из него прямо исключены.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ (4.6). «Карточка SKU создаётся только по желанию…
-- Если переключатель выключен, технолог заполняет ТОЛЬКО обязательную
-- техническую документацию и завершает разработку». Значит поля карточки SKU
-- (описание, крой, размерный ряд, ткани, нанесения, модификации, ценовая
-- вилка) обязательны РОВНО тогда, когда модель идёт в каталог.
--
-- ЧЕМ ЭТО БЫЛО ДО ПРАВКИ. Гейт требовал все двенадцать полей всегда, и
-- разработка «на пробу» не закрывалась вовсе: технолог обязан был выдумать
-- ценовую вилку и список модификаций для изделия, которое в каталог не идёт.
--
-- ГЕЙТ И СТРАЖ ОДНИМ КОММИТОМ (правило проекта). Клиентская половина —
-- `utils/finalPackage.missingFinalPackage` и `wantsSkuCard`; они перечисляют
-- РОВНО ТО ЖЕ и в том же порядке. Сверяет `finalPackage.test.ts`, читающий
-- текст этой миграции.
--
-- ЧТО НЕ ТРОГАЕМ. Вид вложения `dev_pattern` и ключ `pattern_link` остаются
-- в схеме: на проде 24.08 лежат один файл лекал и две ссылки — блок
-- совместимости не пуст. Снят ВВОД и обязательность, показ на чтение
-- сохранён (правило «legacy снимается после того, как опустеет блок
-- совместимости»).

-- ── 1. Признак «модель идёт в каталог» ───────────────────────────────────────
--
-- Живёт в самом пакете (`final_package.add_to_sku`), а не колонкой: страж
-- уже читает этот JSONB, и вторая колонка была бы вторым источником правды
-- о том же решении.
--
-- Сравнение СТРОГОЕ, jsonb с jsonb — дословное зеркало клиентского
-- `=== true`: строка "true" и число 1 значением флага не считаются.
-- Ключа у заведённых раньше разработок нет вовсе, и «не задано» обязано
-- читаться как «не идёт» — иначе правка никому не смягчила бы гейт.
create or replace function public.erp_pkg_flag(p_pkg jsonb, p_key text)
returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_pkg, '{}'::jsonb) -> p_key = 'true'::jsonb
$$;

revoke execute on function public.erp_pkg_flag(jsonb, text) from public, anon;
grant execute on function public.erp_pkg_flag(jsonb, text) to authenticated;

comment on function public.erp_pkg_flag(jsonb, text) is
  'Булев признак внутри final_package. Строгое сравнение с jsonb true — зеркало клиентского === true (utils/finalPackage.wantsSkuCard).';

-- ── 2. Страж «Готово к серии» ────────────────────────────────────────────────
--
-- Текст взят из действующей функции базы (`pg_get_functiondef` сверен
-- с репозиторием 24.08 — совпали), приведён к виду миграций проекта
-- и изменён в двух местах: снята проверка лекал, поля карточки SKU уведены
-- под флаг.
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
  'Гейт завершения разработки: техдокументация всегда, карточка SKU — только при final_package.add_to_sku. Перечисляет незаполненное ровно так же, как utils/finalPackage.missingFinalPackage.';

comment on column public.erp_experimental.final_package is
  'Пакет разработки: production_notes, add_to_sku (переключатель каталога SKU) и — при включённом — description, fit, size_row, features, finishes, limits, fabrics[], branding[], modifications[]. pattern_link оставлен для заведённых раньше разработок, ввода нет. Обязательность проверяют erp_dev_package_guard и utils/finalPackage — вместе.';
