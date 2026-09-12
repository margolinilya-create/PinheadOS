-- Тестовые заказы сняты целиком (правка заказчика 12.09, п. 6).
--
-- Механизм завела `20260803260000_erp_orders_is_demo`: 03.08 в проде было
-- 36 тестовых заказов из 147 — треть рабочего списка, раздувавшая счётчики
-- цехов и уведомления о просрочке. Флаг прятал их из списков, а разметку
-- делал человек в админке.
--
-- Заказчик просит убрать функционал: «полностью убрать функционал тестовых
-- заказов, удалить кнопку/иконку». Причина понятна из пилота — кнопка
-- с колбой стоит в строке каждого заказа рядом с «Отгрузить» и «Удалить»,
-- то есть цена промаха пальцем на планшете это исчезнувший из списков
-- боевой заказ, а пользы от режима больше нет: демо-заказов на проде НОЛЬ.
--
-- ПРОВЕРЕНО ПЕРЕД УДАЛЕНИЕМ: `select count(*) filter (where is_demo)
-- from erp_orders` = 0 при 15 заказах. Значит DROP ничего не показывает
-- задним числом — ни один заказ не «всплывёт» в списках после выкладки.
-- Тот же вопрос, что при снятии DTG 07.09: разметка снятия делается
-- по ЖИВЫМ ДАННЫМ, а не механически.

-- ── 1. Индекс уходит ВМЕСТЕ с колонкой ──
-- Частичный индекс `where is_demo = false` без колонки существовать не может,
-- и `drop column` снёс бы его каскадом молча. Снимаем явно: молчаливое
-- исчезновение объекта — это то, что потом ищут неделю.
drop index if exists public.erp_orders_not_demo_idx;

-- Списочные запросы теперь спрашивают только статус и срок, без предиката
-- по демо. Индекс под них остаётся нужным — заводим полный вместо частичного.
create index if not exists erp_orders_status_due_idx
  on public.erp_orders (status, due_date);

alter table public.erp_orders drop column if exists is_demo;

-- ── 2. Страж заказа теряет ветку `is_demo` ──
--
-- Текст функции ПОДЛИННЫЙ: взят из `20260907180055_erp_packaging_mm_print_effect_garment_kind`
-- (последнее определение), удалён ровно один блок — проверка пометки
-- «тестовый» под `is_admin()`. Остальное не тронуто: поимённый список
-- `v_fields` и ветка отгрузки обязаны остаться дословно, иначе колонка,
-- выпавшая из перечисления, перестанет охраняться вообще ничем.
create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields boolean;
  v_ship boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  v_fields :=
       new.bitrix_id       is distinct from old.bitrix_id
    or new.title           is distinct from old.title
    or new.customer        is distinct from old.customer
    or new.manager         is distinct from old.manager
    or new.launch_date     is distinct from old.launch_date
    or new.due_date        is distinct from old.due_date
    or new.buffer_days     is distinct from old.buffer_days
    or new.priority        is distinct from old.priority
    or new.notes           is distinct from old.notes
    or new.packaging       is distinct from old.packaging
    or new.packaging_note  is distinct from old.packaging_note
    or new.packaging_width_mm  is distinct from old.packaging_width_mm
    or new.packaging_height_mm is distinct from old.packaging_height_mm
    or new.stickers        is distinct from old.stickers
    or new.stickers_note   is distinct from old.stickers_note
    or new.no_chestny_znak is distinct from old.no_chestny_znak
    or new.tz_required     is distinct from old.tz_required
    or new.created_by      is distinct from old.created_by;

  if v_fields and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  -- ── Отгрузка и закрытие заказа ──
  v_ship :=
       new.status          is distinct from old.status
    or new.shipped_status  is distinct from old.shipped_status
    or new.shipped_at      is distinct from old.shipped_at
    or new.shipped_by      is distinct from old.shipped_by;

  if v_ship
     and not (public.erp_has_permission('warehouse.manage')
              or public.erp_has_permission('order.manage')) then
    raise exception 'erp_order_guard: отгрузка и закрытие заказа требуют права warehouse.manage или order.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_order_guard() is
  'Разбирает изменение заказа по колонкам: поля заказа (включая размер упаковки в мм, правки 07.09) — под order.manage, отгрузка и закрытие (status/shipped_*) — под warehouse.manage либо order.manage.';
