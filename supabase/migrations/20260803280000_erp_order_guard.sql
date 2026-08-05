-- Стражи заказа и позиции: закрываем R1 и R2 из аудита 03.08.2026.
--
-- Что было. `erp_orders` UPDATE = `erp_is_member()` без стража: ЛЮБОЙ сотрудник
-- ERP — включая рабочего цеха — мог через `/rest/v1/erp_orders?id=eq...` изменить
-- срок клиента, менеджера, заказчика, название и статус любого заказа. То же
-- у `erp_order_items`: количество и вид изделия.
--
-- Почему стражем, а не политикой. RLS работает на уровне СТРОКИ и не умеет
-- «эту колонку можно, ту нельзя», а одна и та же операция UPDATE здесь несёт
-- три разных смысла с разными правами. Тот же приём, что у `erp_stage_guard`
-- и `erp_material_guard`.
--
-- ГЛАВНОЕ ПРАВИЛО, по которому подобраны условия: страж разрешает ровно то,
-- что разрешает интерфейс. Строже клиента — «кнопка есть, а действие падает»,
-- и виноватым выглядит цех. Поэтому вместе с этой миграцией правится и клиент:
-- инлайн-правки полей заказа гейтятся `order.manage` и без права показываются
-- на чтение (тот же приём, что у плановых дат этапа).

create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields boolean;
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, и запирать через
  -- него починку и серверные задачи страж не должен.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- ── Пометка «тестовый» ──
  -- В интерфейсе переключатель виден только admin/director, поэтому и здесь
  -- `is_admin()`, а не `order.manage`: спрятать боевой заказ от всей фабрики
  -- не должен уметь менеджер.
  if new.is_demo is distinct from old.is_demo and not public.is_admin() then
    raise exception 'erp_order_guard: пометка «тестовый» доступна только администратору'
      using errcode = '42501';
  end if;

  -- ── Отгрузка (status, shipped_*, delivered_at) НАМЕРЕННО не гейтится ──
  -- Заказ отгружает СКЛАД, и отдельного права на это в матрице нет: кнопка
  -- «Отгрузить» доступна любому сотруднику, когда заказ готов. Завести право
  -- пришлось бы сразу в матрицу, сид, DEFAULT_PERMISSIONS и оба теста-зеркала;
  -- пока интерфейс отгрузку не гейтит, страж тоже не гейтит — иначе он станет
  -- строже интерфейса, а это ровно тот отказ, которого мы избегаем.
  -- Поэтому эти колонки просто отсутствуют в списке ниже.

  -- ── Поля заказа: их ведёт менеджер ──
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
    or new.stickers        is distinct from old.stickers
    or new.stickers_note   is distinct from old.stickers_note
    or new.no_chestny_znak is distinct from old.no_chestny_znak
    or new.tz_required     is distinct from old.tz_required
    or new.created_by      is distinct from old.created_by;

  if v_fields and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_order_guard() is
  'Разделяет UPDATE erp_orders по правам: поля — order.manage, is_demo — is_admin, отгрузка — как в интерфейсе (без права).';

drop trigger if exists erp_orders_guard on public.erp_orders;
create trigger erp_orders_guard
  before update on public.erp_orders
  for each row execute function public.erp_order_guard();

-- ── Позиции заказа ──
-- Клиент НЕ пишет в `erp_order_items` после создания ни в одном месте: заказ
-- собирается транзакцией `erp_create_order`, а позже правятся только этапы.
-- То есть открытый на запись `erp_is_member()` был поверхностью атаки
-- с нулевым легитимным использованием — здесь можно быть строгим без риска
-- разойтись с интерфейсом.
create or replace function public.erp_order_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_item_guard: правка позиции заказа требует права order.manage'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function public.erp_order_item_guard() is
  'UPDATE erp_order_items требует order.manage: клиент туда не пишет вовсе.';

drop trigger if exists erp_order_items_guard on public.erp_order_items;
create trigger erp_order_items_guard
  before update on public.erp_order_items
  for each row execute function public.erp_order_item_guard();

-- Функции-триггеры клиенту не нужны никогда (правило миграции 20260803250000).
revoke execute on function public.erp_order_guard()      from anon, authenticated, public;
revoke execute on function public.erp_order_item_guard() from anon, authenticated, public;
