-- Волна 3: превью заказа (drop-zone/Ctrl+V как в kontora24).
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

insert into storage.buckets (id, name, public)
values ('erp-attachments', 'erp-attachments', true)
on conflict (id) do nothing;

create policy erp_att_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'erp-attachments');
create policy erp_att_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'erp-attachments' and public.is_admin());

create table public.erp_order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  file_path text not null,
  file_name text,
  kind text not null default 'preview' check (kind in ('preview','attachment')),
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index erp_order_attachments_order_idx on public.erp_order_attachments (order_id);
alter table public.erp_order_attachments enable row level security;
create policy erp_order_attachments_read on public.erp_order_attachments
  for select to authenticated using (true);
create policy erp_order_attachments_insert on public.erp_order_attachments
  for insert to authenticated with check (true);
create policy erp_order_attachments_delete on public.erp_order_attachments
  for delete to authenticated using (public.is_admin());
