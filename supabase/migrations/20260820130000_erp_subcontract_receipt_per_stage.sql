-- Приёмка подряда — задача склада на КАЖДЫЙ подрядный этап (правки 20.08).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «После возврата продукции в Pinhead создаётся задача
-- на склад: Приёмка подряда… Склад фиксирует: принято · брак · недостача ·
-- комментарий · фото. После подтверждения ERP смотрит следующий этап
-- маршрута». И отдельно: «в одной позиции может быть несколько подрядных
-- этапов… во вкладке "Подряд" будут две задачи».
--
-- ЧТО БЫЛО НЕ ТАК, И ЭТО НЕ МЕЛОЧЬ. Задача `subcontract_receipt` создавалась
-- ТОЛЬКО при легаси-признаке `op_type = 'finished_product'` — то есть у подряда
-- «под ключ», заведённого старой формой. **Подрядные этапы маршрута — те, что
-- документ описывает как основной сценарий, — задачи склада не порождали
-- вовсе.** Возврат от подрядчика никуда не попадал, приёмки не было, `qty_done`
-- этапа не приращался, следующий этап не открывался. Ровно то зависание,
-- на которое жалуется документ.
--
-- ── Уникальность ────────────────────────────────────────────────────────────
--
-- `unique (order_id, task_type)` означало ОДНУ приёмку подряда на заказ,
-- а этапов у заказа может быть несколько (сублимация и варка у одной позиции —
-- прямой пример документа). Разводим на два ЧАСТИЧНЫХ индекса: задачи без
-- этапа (приёмка материалов, маркировка, упаковка) остаются одной на заказ,
-- задачи при этапе уникальны по этапу.
--
-- И ТОГДА `ON CONFLICT` БОЛЬШЕ НЕ РАБОТАЕТ. PostgreSQL выводит целевой индекс
-- из списка колонок в `ON CONFLICT (…)`, а частичный по нему не выведет —
-- это 42P10 при КАЖДОМ срабатывании триггера, то самое правило, на котором
-- в проекте уже ловились с планом (`planStage`) и с возвратом подряда.
-- Поэтому все вставки в триггерах переписаны на `where not exists`:
-- читается одинаково и от формы индекса не зависит.

-- ── 1. Фаза «На переделке» ───────────────────────────────────────────────────
--
-- Седьмое состояние документа: «3 шт. можно отправить подрядчику на переделку,
-- основные 97 при этом не блокируются».
alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_phase_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_phase_check check (phase in (
    'planned',            -- согласовано, ещё не передавали
    'materials_ready',    -- есть что передать (интерфейс считает это сам)
    'sent',               -- передано (осталось от прежней модели)
    'at_contractor',      -- у подрядчика
    'ready_at_contractor',-- подрядчик закончил, забрать не успели
    'returned',           -- вернулось, ожидает приёмки складом
    'rework',             -- брак ушёл подрядчику на переделку
    'accepted',           -- склад принял
    'closed'              -- операция закрыта
  ));

-- ── 2. Задача склада знает свой этап ─────────────────────────────────────────
alter table public.erp_warehouse_tasks
  add column if not exists stage_id uuid references public.erp_item_stages(id) on delete cascade;

comment on column public.erp_warehouse_tasks.stage_id is
  'Этап маршрута, к которому относится задача (приёмка подряда). NULL — задача по заказу целиком.';

drop index if exists public.erp_warehouse_tasks_order_type_idx;

create unique index if not exists erp_warehouse_tasks_order_type_idx
  on public.erp_warehouse_tasks (order_id, task_type) where stage_id is null;

create unique index if not exists erp_warehouse_tasks_stage_type_idx
  on public.erp_warehouse_tasks (stage_id, task_type) where stage_id is not null;

-- ── 3. Журнал перемещений пишет и склад ──────────────────────────────────────
--
-- Приёмка подряда — это запись `accept` в `erp_subcontract_moves`: только она
-- приращает `qty_done` этапа (`erp_subcontract_moves_rollup`) и закрывает его.
-- Политика стояла на `order.manage`, которого у кладовщика нет: приёмка
-- упёрлась бы в 42501 — «кнопка есть, действие падает». Гейт карточки склада
-- зеркалит этот предикат значением.
drop policy if exists "erp_subcontract_moves_insert" on public.erp_subcontract_moves;
create policy "erp_subcontract_moves_insert" on public.erp_subcontract_moves
  for insert to authenticated
  with check (
    public.erp_has_permission('order.manage')
    or public.erp_has_permission('warehouse.manage')
  );

-- ── 4. Триггер производства: вставки без ON CONFLICT ─────────────────────────
--
-- Текст взят ПОДЛИННЫЙ действующий (`pg_get_functiondef`), изменены только
-- четыре вставки.
create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid;
  v_code text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select v_order_id, 'material_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'material_receipt'
         and t.stage_id is null);
  end if;

  if v_code = 'sewing' and new.status = 'in_progress' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    select v_order_id, new.item_id, 'marking', 'new'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'marking'
         and t.stage_id is null);
  end if;

  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'fg_receipt', 'awaiting'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'fg_receipt'
           and t.stage_id is null);
    end if;

    if public.erp_can_pack_ship(v_order_id) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'pack_ship', 'awaiting_receipt'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'pack_ship'
           and t.stage_id is null);
    end if;
  end if;

  return new;
end;
$$;

-- ── 5. Возврат от подрядчика заводит приёмку ─────────────────────────────────
--
-- Триггер на `erp_subcontracting`: фаза перешла в `returned` — появляется
-- задача склада при ЭТОМ этапе. Почему сервером, а не клиентом: фазу двигает
-- раздел «Подряд» под `order.manage`, а задачу склада должен увидеть кладовщик;
-- вставлять её из клиента значит требовать от менеджера ещё и права склада.
create or replace function public.erp_subcontract_returned_receipt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item_id uuid;
begin
  if new.phase is not distinct from old.phase then
    return new;
  end if;
  if new.phase <> 'returned' or new.stage_id is null then
    return new;
  end if;

  select s.item_id into v_item_id from erp_item_stages s where s.id = new.stage_id;

  insert into erp_warehouse_tasks (order_id, item_id, stage_id, task_type, status)
  select new.order_id, v_item_id, new.stage_id, 'subcontract_receipt', 'awaiting_receipt'
  where not exists (
    select 1 from erp_warehouse_tasks t
     where t.stage_id = new.stage_id and t.task_type = 'subcontract_receipt');

  return new;
end;
$$;

drop trigger if exists erp_subcontract_returned_receipt_trg on public.erp_subcontracting;
create trigger erp_subcontract_returned_receipt_trg
  after update on public.erp_subcontracting
  for each row execute function public.erp_subcontract_returned_receipt();

-- Триггерная функция вызываема через REST не должна быть: отзыв обходом,
-- как в 20260812160000 (перечисление по именам не переживает следующего имени).
revoke execute on function public.erp_subcontract_returned_receipt() from public, anon;

-- ── 6. Приёмка склада закрывает нужную операцию ──────────────────────────────
--
-- Прежняя версия искала строку подряда по `op_type = 'finished_product'` —
-- то есть у маршрутного подряда не находила НИЧЕГО. Теперь при задаче
-- со `stage_id` закрывается операция ИМЕННО ЭТОГО этапа; ветка по `op_type`
-- сохранена для задач без этапа (заказы, заведённые старой формой).
create or replace function public.erp_warehouse_fg_accepted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;
  if new.task_type not in ('fg_receipt', 'subcontract_receipt') then
    return new;
  end if;

  if new.task_type = 'subcontract_receipt' then
    if new.stage_id is not null then
      update erp_subcontracting
         set phase = 'accepted',
             status = 'received_at_pinhead',
             returned_date = coalesce(returned_date, public.erp_local_date())
       where stage_id = new.stage_id
         and phase not in ('accepted', 'closed');
    else
      update erp_subcontracting
         set phase = 'accepted',
             status = 'received_at_pinhead',
             returned_date = coalesce(returned_date, public.erp_local_date())
       where order_id = new.order_id
         and op_type = 'finished_product'
         and phase not in ('accepted', 'closed');
    end if;
  end if;

  if public.erp_can_pack_ship(new.order_id) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select new.order_id, 'pack_ship', 'awaiting_receipt'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = new.order_id and t.task_type = 'pack_ship'
         and t.stage_id is null);
  end if;

  return new;
end;
$$;
