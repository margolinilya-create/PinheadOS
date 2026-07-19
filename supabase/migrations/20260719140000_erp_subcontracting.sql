-- Правки ПМ (волна 2), правка 5: отдельная вкладка «Подряд» — контроль операций,
-- переданных внешним подрядчикам (контрагент, даты передачи/готовности/возврата, задержки).

create table public.erp_subcontracting (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid references public.erp_order_items(id) on delete set null,
  operation text not null,
  contractor text,
  qty int,
  sent_date date,
  planned_date date,
  returned_date date,
  status text not null default 'planned'
    check (status in ('planned','sent','in_progress','returned','delayed','cancelled')),
  delay_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index erp_subcontracting_order_idx on public.erp_subcontracting (order_id);
create index erp_subcontracting_status_idx on public.erp_subcontracting (status);

create trigger erp_subcontracting_touch before update on public.erp_subcontracting
  for each row execute function public.erp_set_updated_at();

alter table public.erp_subcontracting enable row level security;
create policy erp_subcontracting_read on public.erp_subcontracting
  for select to authenticated using (true);
create policy erp_subcontracting_insert on public.erp_subcontracting
  for insert to authenticated with check (true);
create policy erp_subcontracting_update on public.erp_subcontracting
  for update to authenticated using (true) with check (true);
create policy erp_subcontracting_delete on public.erp_subcontracting
  for delete to authenticated using (public.is_admin());
