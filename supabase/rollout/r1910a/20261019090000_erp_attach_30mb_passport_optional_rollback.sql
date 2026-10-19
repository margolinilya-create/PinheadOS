-- ОТКАТ миграции 20261019090000_erp_attach_30mb_passport_optional.sql
-- (правки 19.10, Task 6). Выполняет владелец в SQL Editor — ПОСЛЕ отката
-- фронта (клиент на 30 МБ при бакете на 20 получил бы отказ Storage после
-- загрузки, кнопка без паспорта — 23514 от стража).
--
-- Возвращает лимит 20 МБ (20260915053342) и требование техпаспорта
-- (тело 20260913002246 дословно). Файлы больше 20 МБ, уже лежащие в бакете,
-- остаются: лимит действует на загрузку, а не на хранение.

update storage.buckets
   set file_size_limit = 20971520   -- 20 * 1024 * 1024
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

revoke execute on function public.erp_dev_package_guard() from public, anon, authenticated;
