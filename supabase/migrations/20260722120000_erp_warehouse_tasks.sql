-- Правки ПМ (волна 4), склад: задачи склада с жизненным циклом (а не просто лог).
-- Заказ проходит склад несколько раз: приёмка материалов → выпуск маркировки →
-- упаковка и отгрузка. Каждая — отдельная задача со своим статусом; история операций
-- по-прежнему в erp_warehouse_ops. Задачи авто-создаются триггером по переходам маршрута
-- (см. 20260722130000_erp_warehouse_task_derive.sql).

create table public.erp_warehouse_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid references public.erp_order_items(id) on delete set null,
  task_type text not null check (task_type in ('material_receipt','marking','pack_ship')),
  -- статусы по типу:
  --  material_receipt: awaiting → accepted
  --  marking:          new → in_progress → issued
  --  pack_ship:        awaiting_receipt → accepted → packing → packed → ready_to_ship → shipped
  status text not null,
  marking_type text,
  deadline date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index erp_warehouse_tasks_order_idx on public.erp_warehouse_tasks (order_id);
-- Одна задача каждого типа на заказ (идемпотентность авто-создания через on conflict).
create unique index erp_warehouse_tasks_order_type_idx
  on public.erp_warehouse_tasks (order_id, task_type);

create trigger erp_warehouse_tasks_touch before update on public.erp_warehouse_tasks
  for each row execute function public.erp_set_updated_at();

alter table public.erp_warehouse_tasks enable row level security;
create policy erp_warehouse_tasks_read on public.erp_warehouse_tasks
  for select to authenticated using (true);
create policy erp_warehouse_tasks_insert on public.erp_warehouse_tasks
  for insert to authenticated with check (true);
create policy erp_warehouse_tasks_update on public.erp_warehouse_tasks
  for update to authenticated using (true) with check (true);
create policy erp_warehouse_tasks_delete on public.erp_warehouse_tasks
  for delete to authenticated using (public.is_admin());

-- Realtime: точечные подписки realtimeSlice получают postgres_changes по задачам склада.
alter publication supabase_realtime add table public.erp_warehouse_tasks;

-- Бэкфилл для непрерывности: активные заказы, у которых закупка уже закрыта,
-- получают задачу приёмки; полностью готовые — задачу упаковки/отгрузки.
insert into public.erp_warehouse_tasks (order_id, task_type, status)
select o.id, 'material_receipt',
  case when exists (
    select 1 from public.erp_materials m
     where m.order_id = o.id and m.status = 'received'
       and (m.accept_status is null
            or m.accept_status not in ('accepted_full','accepted_partial'))
  ) then 'awaiting' else 'accepted' end
from public.erp_orders o
where o.status = 'active'
  and exists (select 1 from public.erp_materials m where m.order_id = o.id)
  and exists (
    select 1 from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    join public.erp_departments d on d.id = s.department_id
    where i.order_id = o.id and d.code = 'supply' and s.status in ('done','skipped')
  )
on conflict (order_id, task_type) do nothing;

insert into public.erp_warehouse_tasks (order_id, task_type, status)
select o.id, 'pack_ship', 'awaiting_receipt'
from public.erp_orders o
where o.status = 'active'
  and exists (
    select 1 from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    where i.order_id = o.id
  )
  and not exists (
    select 1 from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    where i.order_id = o.id and s.status not in ('done','skipped')
  )
on conflict (order_id, task_type) do nothing;
