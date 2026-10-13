-- Правки ПМ (волна 3), правка 2: склад сопровождает заказ весь цикл — история всех
-- складских операций (приёмки, повторные приёмки после дозакупки, частичные поставки,
-- упаковка, отгрузка, выпуск маркировок). Каждая операция — отдельная строка.

create table public.erp_warehouse_ops (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  material_id uuid references public.erp_materials(id) on delete set null,
  op_type text not null
    check (op_type in ('material_receipt','rework_receipt','partial_receipt','packaging','shipment','marking')),
  qty numeric,
  note text,
  actor text,
  created_at timestamptz not null default now()
);

create index erp_warehouse_ops_order_idx on public.erp_warehouse_ops (order_id);

alter table public.erp_warehouse_ops enable row level security;
create policy erp_warehouse_ops_read on public.erp_warehouse_ops
  for select to authenticated using (true);
create policy erp_warehouse_ops_insert on public.erp_warehouse_ops
  for insert to authenticated with check (true);
create policy erp_warehouse_ops_delete on public.erp_warehouse_ops
  for delete to authenticated using (public.is_admin());
