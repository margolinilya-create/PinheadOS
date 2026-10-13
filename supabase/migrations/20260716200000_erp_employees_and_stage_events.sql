-- Блок улучшений: сотрудники (P1.1) + аудит смены статусов этапов.
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-16.

create table public.erp_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null default 'worker'
    check (role in ('worker','foreman','dispatcher','purchaser','storekeeper','hr','manager','director')),
  department_id uuid references public.erp_departments(id),
  extra_department_ids uuid[] not null default '{}',
  profile_id uuid references public.profiles(id),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index erp_employees_dept_idx on public.erp_employees (department_id) where active;
create trigger erp_employees_touch before update on public.erp_employees
  for each row execute function public.erp_set_updated_at();
alter table public.erp_employees enable row level security;
create policy erp_employees_read on public.erp_employees
  for select to authenticated using (true);
create policy erp_employees_write on public.erp_employees
  for insert to authenticated with check (public.is_admin());
create policy erp_employees_update on public.erp_employees
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy erp_employees_delete on public.erp_employees
  for delete to authenticated using (public.is_admin());

create table public.erp_stage_events (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.erp_item_stages(id) on delete cascade,
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  actor text,
  from_status text,
  to_status text not null,
  qty_done int,
  qty_rework int,
  comment text,
  created_at timestamptz not null default now()
);
create index erp_stage_events_order_idx on public.erp_stage_events (order_id, created_at desc);
alter table public.erp_stage_events enable row level security;
create policy erp_stage_events_read on public.erp_stage_events
  for select to authenticated using (true);
create policy erp_stage_events_insert on public.erp_stage_events
  for insert to authenticated with check (true);
