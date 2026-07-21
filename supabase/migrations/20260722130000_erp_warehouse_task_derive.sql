-- Оркестрация склада (волна 4): задачи склада авто-создаются по переходам этапов
-- маршрута, а не вручную. Идемпотентно (on conflict do nothing по (order_id, task_type)).
--  - закупка (supply) → done            ⇒ задача приёмки материалов
--  - швейка (sewing)  → in_progress     ⇒ задача выпуска маркировки
--  - все этапы заказа done/skipped      ⇒ задача упаковки и отгрузки
-- security definer + фиксированный search_path — безопасная вставка независимо от RLS
-- вызывающего (образец erp_procurement_task_derive).

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

  -- Последний этап завершён (весь заказ готов) → упаковка и отгрузка
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'pack_ship', 'awaiting_receipt')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;

create trigger erp_warehouse_task_derive_au
  after update on public.erp_item_stages
  for each row execute function public.erp_warehouse_task_derive();
