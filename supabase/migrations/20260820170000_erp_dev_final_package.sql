-- Финальный технический пакет разработки (правки заказчика 20.08), ч.2.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Разработку нельзя перевести в "Готово к серии", пока
-- обязательные данные не заполнены… Если чего-то не хватает, система должна
-- показать, какие поля ещё не заполнены». Перечень: техническое название
-- и версия лекал, файл или ссылка на лекала, техпаспорт, фото образца,
-- карточка SKU, доступные ткани, доступные нанесения, возможные модификации,
-- ценовая вилка.
--
-- ЗАЧЕМ ЭТО ВООБЩЕ. Не ради строгости: «при следующем заказе этой модели
-- экспериментальный цех повторно не требуется». Разработка, закрытая без
-- пакета, не экономит ничего — модель придётся разрабатывать заново.
--
-- ГЕЙТ И СТРАЖ ОДНИМ КОММИТОМ (правило проекта). Клиентская половина —
-- `utils/finalPackage.missingFinalPackage`, и она перечисляет РОВНО ТО ЖЕ.
-- Страж строже клиента дал бы «кнопка есть, действие падает»; мягче — дыру.

-- ── 1. Что ищут и показывают — колонками, остальное JSON ─────────────────────
--
-- В колонки вынесено то, по чему ищут и что показывают в списке: название
-- и версия лекал, ценовая вилка. Карточка SKU, ткани, нанесения и модификации
-- читаются ТОЛЬКО вместе с разработкой — им отдельная таблица не нужна, пакет
-- один-к-одному с разработкой.
alter table public.erp_experimental
  add column if not exists pattern_tech_name text,
  add column if not exists pattern_version   text,
  add column if not exists price_min         numeric(12,2),
  add column if not exists price_max         numeric(12,2),
  add column if not exists final_package     jsonb not null default '{}'::jsonb;

comment on column public.erp_experimental.final_package is
  'Карточка SKU разработки: description, fit, size_row, features, finishes, limits, pattern_link, fabrics[], branding[], modifications[]. Обязательность проверяют erp_dev_package_guard и utils/finalPackage — вместе.';

-- ── 2. Файлы пакета ──────────────────────────────────────────────────────────
--
-- Файлы живут в общей таблице вложений и привязываются к РАЗРАБОТКЕ: лекала
-- и техпаспорт относятся не к позиции заказа, а к модели, которую этот заказ
-- породил. `on delete cascade` — те же правила, что у остальных вложений;
-- сами объекты в бакете убирает клиент ДО удаления строки.
alter table public.erp_order_attachments
  add column if not exists experimental_id uuid
    references public.erp_experimental(id) on delete cascade;

create index if not exists erp_att_experimental_idx
  on public.erp_order_attachments (experimental_id)
  where experimental_id is not null;

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list',
                  'dev_pattern', 'dev_passport', 'dev_photo'));

-- ── 2а. Файл пакета можно снять ──────────────────────────────────────────────
--
-- DELETE вложений стоял на `is_admin()`, и для заказа это верно: приложенный
-- файл — часть его истории. Для пакета разработки — нет: техпаспорт выходит
-- новой версией, фото переснимают, а «поменять файл» через администратора
-- означает, что менять его не будут вовсе. Открываем РОВНО виды пакета
-- и ровно под правом раздела; остальные вложения остаются как были.
--
-- Политика на отдельную КОМАНДУ и рядом с существующей: `is_admin()` внутри
-- этой же ветки не повторяем — админ проходит своей политикой (для DELETE
-- разрешающие политики складываются по OR).
drop policy if exists erp_att_delete_dev on public.erp_order_attachments;
create policy erp_att_delete_dev on public.erp_order_attachments
  for delete to authenticated
  using (
    experimental_id is not null
    and kind in ('dev_pattern', 'dev_passport', 'dev_photo')
    and public.erp_has_permission('experimental.manage')
  );

-- ── 3. Проверка списка внутри JSON ───────────────────────────────────────────
--
-- Отдельная функция, потому что списков три и повторять разбор трижды значит
-- получить три слегка разных правила. `jsonb_typeof` обязателен: на не-массиве
-- `jsonb_array_elements_text` бросает исключение, и «поле не заполнено»
-- стало бы неотличимо от «страж сломался».
create or replace function public.erp_pkg_list_filled(p_pkg jsonb, p_key text)
returns boolean
language sql immutable set search_path = public as $$
  select case
    when jsonb_typeof(coalesce(p_pkg, '{}'::jsonb) -> p_key) <> 'array' then false
    else exists (
      select 1
        from jsonb_array_elements_text(coalesce(p_pkg, '{}'::jsonb) -> p_key) as v
       where btrim(v) <> ''
    )
  end
$$;

create or replace function public.erp_pkg_text_filled(p_pkg jsonb, p_key text)
returns boolean
language sql immutable set search_path = public as $$
  select btrim(coalesce(coalesce(p_pkg, '{}'::jsonb) ->> p_key, '')) <> ''
$$;

revoke execute on function public.erp_pkg_list_filled(jsonb, text) from public, anon;
revoke execute on function public.erp_pkg_text_filled(jsonb, text) from public, anon;
grant execute on function public.erp_pkg_list_filled(jsonb, text) to authenticated;
grant execute on function public.erp_pkg_text_filled(jsonb, text) to authenticated;

-- ── 4. Страж «Готово к серии» ────────────────────────────────────────────────
--
-- Проверяется РОВНО переход в `ready_for_serial`: прочие исходы («не пошло
-- в серию», «отложено») пакета не требуют — незаконченная разработка и должна
-- закрываться незаконченной.
--
-- Пустой `auth.uid()` пропускается: это service_role, он и так минует RLS,
-- а запирать починку через SQL нельзя (правило проекта).
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

  if btrim(coalesce(new.pattern_tech_name, '')) = '' then
    v_missing := array_append(v_missing, 'Техническое название лекал');
  end if;
  if btrim(coalesce(new.pattern_version, '')) = '' then
    v_missing := array_append(v_missing, 'Версия лекал');
  end if;
  -- «Файл ИЛИ ссылка на лекала» — документ допускает оба варианта
  if not exists (
    select 1 from public.erp_order_attachments a
     where a.experimental_id = new.id and a.kind = 'dev_pattern')
     and not public.erp_pkg_text_filled(v_pkg, 'pattern_link') then
    v_missing := array_append(v_missing, 'Файл или ссылка на лекала');
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

  if array_length(v_missing, 1) > 0 then
    raise exception 'Не заполнен финальный пакет: %', array_to_string(v_missing, ', ')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- Обход `20260812160000` закрыл для REST триггерные функции, которые были
-- на тот момент; у заведённой позже обязан быть СВОЙ отзыв — иначе она
-- останется единственной вызываемой через `/rest/v1/rpc/…` и будет висеть
-- в предупреждениях адвизора, за которыми теряется настоящее.
-- Отзывать нужно `from public, anon`: право приходит от PUBLIC, и `anon`
-- наследует его — один `from anon` не делает ничего.
revoke execute on function public.erp_dev_package_guard() from public, anon, authenticated;

drop trigger if exists erp_dev_package_guard on public.erp_experimental;
create trigger erp_dev_package_guard
  before update on public.erp_experimental
  for each row execute function public.erp_dev_package_guard();

comment on function public.erp_dev_package_guard() is
  'Гейт «Готово к серии»: перечисляет незаполненное ровно так же, как utils/finalPackage.missingFinalPackage. Расхождение половин даёт «кнопка есть, действие падает».';
