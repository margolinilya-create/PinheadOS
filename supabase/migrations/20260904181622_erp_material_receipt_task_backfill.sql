-- Бэкфилл к `20260904181542`: триггер ловит ПЕРЕХОД, а закупка этих заказов
-- уже стоит в `in_progress` — нового перехода не будет, и задача не завелась бы
-- никогда.
--
-- Здесь бэкфилл НУЖЕН, в отличие от 30.08 и 02.09, где его сознательно
-- не делали: там склад заказов не ждал, а тут без задачи кладовщику некуда
-- записать поставку, и с 04.09 закупка без приёмки не закрывается вовсе.
--
-- Затронуто на момент применения: 5 активных заказов.
insert into public.erp_warehouse_tasks (order_id, task_type, status)
select distinct i.order_id, 'material_receipt', 'awaiting'
  from public.erp_item_stages s
  join public.erp_order_items i on i.id = s.item_id
  join public.erp_orders o on o.id = i.order_id
  join public.erp_departments d on d.id = s.department_id
 where d.code = 'supply'
   and s.status = 'in_progress'
   and o.status = 'active'
   and not exists (
     select 1 from public.erp_warehouse_tasks t
      where t.order_id = i.order_id
        and t.task_type = 'material_receipt'
        and t.stage_id is null);
