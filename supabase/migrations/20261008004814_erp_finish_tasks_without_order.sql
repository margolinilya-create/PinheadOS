-- РАЗРАБОТКА БЕЗ ЗАКАЗА ЗАКРЫВАЕТСЯ (ошибка с боя 01.10 и 06.10)
--
-- «Разработка не обновлена: null value in column "order_id" of relation
-- "erp_warehouse_tasks"» — технолог закрывала разработку, не привязанную
-- к заказу (`erp_experimental.order_id is null`), и закрытие откатывалось.
-- Триггер `erp_dev_warehouse_gate_release` зовёт эту функцию с `new.order_id`,
-- а она с NULL проходила обе проверки: «нет открытых этапов заказа NULL» —
-- истина, и в склад шла задача `fg_receipt` без заказа.
--
-- Готовой продукции без заказа не бывает — складу принимать нечего.
-- Ранний выход здесь, а не в триггере, закрывает всех вызывающих сразу.
-- Остальное — дословно боевое тело.

create or replace function public.erp_ensure_order_finish_tasks(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_order_id is null then
    return;
  end if;

  -- Разработка образца ещё идёт: готовой продукции у заказа нет, и складу
  -- её отдаст только «Завершить разработку»
  if public.erp_order_has_open_dev(p_order_id) then
    return;
  end if;

  if not exists (
    select 1 from erp_item_stages s
    join erp_order_items i on i.id = s.item_id
    where i.order_id = p_order_id and s.status not in ('done','skipped')
  ) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select p_order_id, 'fg_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = p_order_id and t.task_type = 'fg_receipt'
         and t.stage_id is null);
  end if;

  -- erp_can_pack_ship уже требует принятой приёмки ГП, поэтому задача
  -- заводится сразу «На упаковке»: ждать здесь нечего
  if public.erp_can_pack_ship(p_order_id) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select p_order_id, 'pack_ship', 'packing'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = p_order_id and t.task_type = 'pack_ship'
         and t.stage_id is null);
  end if;
end $function$;
