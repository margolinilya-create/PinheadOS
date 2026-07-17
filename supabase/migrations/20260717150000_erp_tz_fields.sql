-- Поля ТЗ в производственном заказе (docs/erp/tz-format-analysis.md).
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

alter table public.erp_orders
  add column packaging text not null default 'none'
    check (packaging in ('none','bopp','zip','other')),
  add column packaging_note text,
  add column stickers text not null default 'none'
    check (stickers in ('none','blank','other')),
  add column stickers_note text,
  add column no_chestny_znak boolean not null default false;

alter table public.erp_order_items
  add column size_grid jsonb;

create table public.erp_item_prints (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.erp_order_items(id) on delete cascade,
  seq int not null default 1,
  method text not null
    check (method in ('embroidery','silkscreen','dtf','heat_transfer','other')),
  fabric text,
  zone text,
  width_mm int,
  height_mm int,
  offset_note text,
  pantone text,
  special text,
  comment text,
  created_at timestamptz not null default now()
);
create index erp_item_prints_item_idx on public.erp_item_prints (item_id, seq);
alter table public.erp_item_prints enable row level security;
create policy erp_item_prints_read on public.erp_item_prints
  for select to authenticated using (true);
create policy erp_item_prints_insert on public.erp_item_prints
  for insert to authenticated with check (true);
create policy erp_item_prints_update on public.erp_item_prints
  for update to authenticated using (true) with check (true);
create policy erp_item_prints_delete on public.erp_item_prints
  for delete to authenticated using (true);

alter table public.erp_materials
  add column role text
    check (role in ('main','trim','lining','hardware','labels','packaging','other')),
  add column color text,
  add column supplier text;

-- erp_log_order_changes() расширен полями packaging/stickers/no_chestny_znak
-- (полный текст функции — в apply_migration erp_tz_fields).
