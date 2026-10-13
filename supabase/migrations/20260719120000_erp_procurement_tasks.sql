-- Правки ПМ (волна 2), правки 1-2: возврат из закроя создаёт ОТДЕЛЬНУЮ задачу
-- закупщику (не перезаписывая исходную закупку) + классификация причины возврата
-- (брак поставщика vs внутренняя ошибка). Исходные материалы (erp_materials) не трогаются.

create table public.erp_procurement_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid references public.erp_order_items(id) on delete set null,
  source_stage_id uuid references public.erp_item_stages(id) on delete set null,
  -- цех-инициатор возврата (код цеха)
  initiating_dept text,
  material_name text not null,
  -- количество изделий, ушедших на переделку
  rework_qty int,
  -- требуемое количество материала (свободный текст, как erp_materials.qty)
  required_qty text,
  cause_type text not null default 'other'
    check (cause_type in ('supplier_defect','wrong_consumption','damaged_in_production','shortage','other')),
  -- сценарий: замена (брак поставщика) или дозакупка (внутренняя ошибка)
  kind text not null default 'restock' check (kind in ('replacement','restock')),
  reason text,
  supplier text,
  planned_date date,
  responsible text,
  status text not null default 'new'
    check (status in ('new','in_progress','ordered','done','cancelled')),
  -- брак поставщика не считается закупкой компании
  counts_as_purchase boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index erp_procurement_tasks_order_idx on public.erp_procurement_tasks (order_id);
create index erp_procurement_tasks_status_idx on public.erp_procurement_tasks (status);

create trigger erp_procurement_tasks_touch before update on public.erp_procurement_tasks
  for each row execute function public.erp_set_updated_at();

alter table public.erp_procurement_tasks enable row level security;
create policy erp_procurement_tasks_read on public.erp_procurement_tasks
  for select to authenticated using (true);
create policy erp_procurement_tasks_insert on public.erp_procurement_tasks
  for insert to authenticated with check (true);
create policy erp_procurement_tasks_update on public.erp_procurement_tasks
  for update to authenticated using (true) with check (true);
create policy erp_procurement_tasks_delete on public.erp_procurement_tasks
  for delete to authenticated using (public.is_admin());
