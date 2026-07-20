-- Правки ПМ (волна 3), правка 6: передачи из экспериментального цеха в общий швейный цех
-- или на нанесения. По завершении (returned) заказ авто-возвращается на фазу «Проработка».

create table public.erp_experimental_ops (
  id uuid primary key default gen_random_uuid(),
  experimental_id uuid not null references public.erp_experimental(id) on delete cascade,
  kind text not null check (kind in ('to_sewing','to_branding')),
  operation text,               -- что сделать (для to_sewing)
  qty int,
  responsible text,
  planned_date date,
  comment text,
  status text not null default 'sent'
    check (status in ('sent','in_progress','returned','cancelled')),
  returned_at date,
  -- поля нанесения (для to_branding)
  branding_method text,
  mockup text,
  zone text,
  size_mm text,
  colors text,
  created_at timestamptz not null default now()
);

create index erp_experimental_ops_exp_idx on public.erp_experimental_ops (experimental_id);

alter table public.erp_experimental_ops enable row level security;
create policy erp_experimental_ops_read on public.erp_experimental_ops
  for select to authenticated using (true);
create policy erp_experimental_ops_insert on public.erp_experimental_ops
  for insert to authenticated with check (true);
create policy erp_experimental_ops_update on public.erp_experimental_ops
  for update to authenticated using (true) with check (true);
create policy erp_experimental_ops_delete on public.erp_experimental_ops
  for delete to authenticated using (public.is_admin());
