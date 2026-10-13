-- Склад: «Упаковка и отгрузка» — ТРИ статуса и ДВА действия (правка заказчика
-- 23.08, п. 4).
--
-- ЧТО БЫЛО. У задачи `pack_ship` шесть статусов:
--   awaiting_receipt → accepted → packing → packed → ready_to_ship → shipped
-- и пять кнопок под них. Заказчик: «в карточке должны быть только два
-- последовательных рабочих действия — "Упаковано" и "Отгрузить"; не добавлять
-- промежуточные кнопки вроде "Начать упаковку" и отдельные карточки на каждый
-- переход».
--
-- ПОЧЕМУ ЭТО НЕ ПОТЕРЯ СОСТОЯНИЙ, А СНЯТИЕ МЁРТВЫХ. Задача заводится обоими
-- писателями только под условием `erp_can_pack_ship(order_id)`, а та требует
-- `fg_receipt.status = 'accepted'` — то есть задача РОЖДАЕТСЯ уже принятой.
-- Статусы `awaiting_receipt` и `accepted` недостижимы по построению, и кнопки
-- «Принять на упаковку» / «На упаковку» под ними повторяли работу отдельной
-- задачи «Приёмка ГП». Это и есть жалоба «несколько почти одинаковых экранов
-- одного заказа».
--
-- `packed` и `ready_to_ship` означали одно и то же событие («упаковали»)
-- и схлопываются в `ready_to_ship` — тот, который читает интерфейс отгрузки.
--
-- ИТОГО: packing («На упаковке») → ready_to_ship («Готово к отгрузке»)
--        → shipped («Отгружено»).
--
-- CHECK на `erp_warehouse_tasks.status` нет вовсе (миграция 20260722120000
-- завела колонку без него: статусы у типов задач разные), поэтому схема
-- не правится — правятся ПИСАТЕЛИ и существующие строки.

-- 1. Данные. На 23.08 все шесть строк pack_ship на проде в `shipped`,
--    то есть бэкфилл ничего не трогает. Он всё равно полный: миграция
--    описывает правило, а не сегодняшний снимок, и реплей на другое
--    окружение обязан давать ту же систему.
update public.erp_warehouse_tasks
   set status = 'packing'
 where task_type = 'pack_ship'
   and status in ('awaiting_receipt', 'accepted');

update public.erp_warehouse_tasks
   set status = 'ready_to_ship'
 where task_type = 'pack_ship'
   and status = 'packed';

-- 2. Писатель первый: закрытие последнего этапа маршрута.
--    Текст взят из ДЕЙСТВУЮЩЕГО определения (`pg_get_functiondef`), а не
--    из прежней миграции: правило проекта про подлинный текст. Отличие
--    ровно одно — стартовый статус pack_ship.
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

    -- `erp_can_pack_ship` уже требует принятой приёмки ГП, поэтому задача
    -- заводится сразу «На упаковке»: ждать здесь нечего
    if public.erp_can_pack_ship(v_order_id) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'pack_ship', 'packing'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'pack_ship'
           and t.stage_id is null);
    end if;
  end if;

  return new;
end;
$$;

-- 3. Писатель второй: приёмка ГП (и приёмка подряда). Тот же текст,
--    то же единственное отличие. ОБА писателя правятся одним файлом —
--    забытый второй вернул бы мёртвый статус молча, и заметили бы это
--    на складе, а не в тестах.
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
    select new.order_id, 'pack_ship', 'packing'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = new.order_id and t.task_type = 'pack_ship'
         and t.stage_id is null);
  end if;

  return new;
end;
$$;

comment on table public.erp_warehouse_tasks is
  'Задачи склада. Статусы по типу: material_receipt awaiting→accepted; '
  'marking new→in_progress→issued; fg_receipt/subcontract_receipt '
  'awaiting→accepted; pack_ship packing→ready_to_ship→shipped '
  '(правка 23.08: три статуса и два действия вместо шести и пяти).';
