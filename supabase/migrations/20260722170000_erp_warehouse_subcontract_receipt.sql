-- Правки ПМ 4.2.1 (подряд — обязательная приёмка готовой продукции складом).
-- Новый тип складской задачи subcontract_receipt («Приёмка продукции от подрядчика»):
--   статусы awaiting_receipt → accepted. Создаётся клиентом (subcontractingSlice) при переходе
--   готового изделия в shipped_by_contractor; после подтверждения склад переводит op в
--   received_at_pinhead и заводит pack_ship (warehouseSlice) — оркестрация в сторе, не в триггере.
-- Плюс гейт в erp_warehouse_task_derive: pack_ship не создаётся, пока не принято готовое изделие
--   от подрядчика (иначе упаковка/отгрузка уходили бы раньше складской приёмки).

alter table public.erp_warehouse_tasks
  drop constraint if exists erp_warehouse_tasks_task_type_check;
alter table public.erp_warehouse_tasks
  add constraint erp_warehouse_tasks_task_type_check
  check (task_type in ('material_receipt','marking','pack_ship','subcontract_receipt'));

create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_code text;
begin
  -- реагируем только на смену статуса
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  -- Закупка закрыта → материалы прибыли, нужна приёмка складом
  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (v_order_id, 'material_receipt', 'awaiting')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Швейка взята в работу → склад выпускает маркировку
  if v_code = 'sewing' and new.status = 'in_progress' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    values (v_order_id, new.item_id, 'marking', 'new')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Последний этап завершён (весь заказ готов) → упаковка и отгрузка,
  -- но НЕ пока не принято готовое изделие от подрядчика (правка 4.2.1).
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    )
    and not exists (
      select 1 from erp_subcontracting sc
      where sc.order_id = v_order_id
        and sc.op_type = 'finished_product'
        and sc.status <> 'received_at_pinhead'
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'pack_ship', 'awaiting_receipt')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;
