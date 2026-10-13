-- Волна 2 (перенос kontora24): audit изменений полей заказа + комментарии.
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

create table public.erp_order_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index erp_order_audit_order_idx on public.erp_order_audit (order_id, changed_at desc);
alter table public.erp_order_audit enable row level security;
create policy erp_order_audit_read on public.erp_order_audit
  for select to authenticated using (true);

create or replace function public.erp_log_order_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  f text;
  old_v text;
  new_v text;
begin
  select coalesce(p.name, p.email, 'система') into actor
    from public.profiles p where p.id = auth.uid();
  foreach f in array array[
    'title','manager','bitrix_id','launch_date','due_date','buffer_days',
    'priority','status','shipped_status','delivered_at','notes'
  ] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into old_v, new_v using old, new;
    if old_v is distinct from new_v then
      insert into public.erp_order_audit (order_id, field_name, old_value, new_value, changed_by)
      values (new.id, f, old_v, new_v, actor);
    end if;
  end loop;
  return new;
end $$;

create trigger erp_orders_audit
  after update on public.erp_orders
  for each row execute function public.erp_log_order_changes();

create table public.erp_order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  author text not null,
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index erp_order_comments_order_idx on public.erp_order_comments (order_id, created_at);
alter table public.erp_order_comments enable row level security;
create policy erp_order_comments_read on public.erp_order_comments
  for select to authenticated using (true);
create policy erp_order_comments_insert on public.erp_order_comments
  for insert to authenticated with check (true);
create policy erp_order_comments_delete on public.erp_order_comments
  for delete to authenticated using (public.is_admin());

alter publication supabase_realtime add table public.erp_order_comments;
alter publication supabase_realtime add table public.erp_item_stages;
