-- ВЛОЖЕНИЯ ERP ДО 30 МБ, ТЕХПАСПОРТ НЕОБЯЗАТЕЛЕН (правки 19.10, пп. 4 и 5;
-- миграция S1 плана «Правки 19.10, часть A», Task 6).
--
-- 1. ЛИМИТ БАКЕТА `erp-attachments`: 20 → 30 МБ (31457280 = 30 * 1024 * 1024).
--    Документ: «увеличить допустимый размер одного файла с 15 до 30 МБ
--    включительно; лимит относится к каждому отдельному файлу». Решение Р9:
--    30 МБ получают ВСЕ вложения ERP (ТЗ, вложения заказа, файлы этапов —
--    один бакет, одна величина) и писатели Order (`erpFiles.ts`,
--    `sendChecklist.ts`, `launchFiles.ts`, мок бакета e2e). Сторож —
--    `attachmentLimits.test.ts`: клиентские константы равны числу ниже.
--
-- 2. `erp_dev_package_guard` БЕЗ УСЛОВИЯ `dev_passport`. Документ: «убрать
--    технический паспорт из обязательных условий кнопки „Завершить
--    разработку"… поле „Технический паспорт" и кнопку „Приложить" сохранить…
--    обязательность фото утверждённого образца этой правкой не меняется».
--    Тело — редакция `20260913002246_erp_dev_package_guard_back.sql` без
--    одного блока; формулировки прочих строк не меняются (их сверяет
--    `finalPackage.test.ts` с `utils/finalPackage.missingFinalPackage`).
--    Уже приложенные паспорта не трогаются — вид `dev_passport` остаётся.
--
-- ПОРЯДОК ВЫКЛАДКИ: «МЯГЧЕ — ДО ФРОНТА». Обе части делают сервер мягче:
-- бакет начинает принимать 30 МБ раньше, чем клиент их предложит, и страж
-- перестаёт требовать паспорт раньше, чем кнопка станет активной без него.
-- Обратный порядок дал бы «форма приняла — сервер отказал».
--
-- `sku-photos` НЕ ТРОГАЕТСЯ (своя величина каталога Order — сторож того же
-- файла). Откат — `supabase/rollout/r1910a/20261019090000_erp_attach_30mb_passport_optional_rollback.sql`.
--
-- КОММЕНТАРИЯ НА `storage.buckets` НЕТ: таблица принадлежит
-- `supabase_storage_admin`, `comment on` требует владения (42501, 15.09).

update storage.buckets
   set file_size_limit = 31457280   -- 30 * 1024 * 1024
 where id = 'erp-attachments';

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
     where a.experimental_id = new.id and a.kind = 'dev_photo') then
    v_missing := array_append(v_missing, 'Фото образца');
  end if;
  -- «Комментарии и особенности производства» документ помечает словами
  -- «при необходимости»: поле в форме есть, в этом перечне его нет.
  -- Техпаспорт — тоже (правка 19.10, п. 5): поле и файлы остаются, условия нет.

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
-- `from public, anon`: право приходит от PUBLIC, и `anon` наследует его.
revoke execute on function public.erp_dev_package_guard() from public, anon, authenticated;
