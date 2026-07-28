-- Аудит по скилам, находка 7: 13 внешних ключей без покрывающего индекса.
--
-- Advisor `unindexed_foreign_keys`. Без индекса каждая проверка ссылочной целостности
-- (и каждый каскад при удалении) идёт seq scan по дочерней таблице, а джойны
-- «родитель → дети» не могут пойти по индексу.
--
-- Горячие места сейчас: erp_stage_events.stage_id (история этапа открывается в каждом
-- задании), erp_procurement_tasks.source_stage_id (гейт закупки считается на каждый
-- рендер очереди), erp_materials.item_id, order_audit.order_id.
--
-- Таблицы пока маленькие (443 этапа, 130 событий) — именно поэтому создание индексов
-- стоит миллисекунды и делается без CONCURRENTLY.

create index if not exists erp_calendar_slots_stage_idx
  on public.erp_calendar_slots (stage_id);
create index if not exists erp_departments_head_idx
  on public.erp_departments (head_employee_id);
create index if not exists erp_materials_item_idx
  on public.erp_materials (item_id);
create index if not exists erp_orders_created_by_idx
  on public.erp_orders (created_by);
create index if not exists erp_procurement_tasks_item_idx
  on public.erp_procurement_tasks (item_id);
create index if not exists erp_procurement_tasks_source_stage_idx
  on public.erp_procurement_tasks (source_stage_id);
create index if not exists erp_stage_events_stage_idx
  on public.erp_stage_events (stage_id);
create index if not exists erp_subcontracting_item_idx
  on public.erp_subcontracting (item_id);
create index if not exists erp_tz_assignments_department_idx
  on public.erp_tz_assignments (department_id);
create index if not exists erp_warehouse_ops_material_idx
  on public.erp_warehouse_ops (material_id);
create index if not exists erp_warehouse_tasks_item_idx
  on public.erp_warehouse_tasks (item_id);
create index if not exists order_audit_order_idx
  on public.order_audit (order_id);
create index if not exists orders_created_by_idx
  on public.orders (created_by);
