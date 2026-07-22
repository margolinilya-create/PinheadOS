-- Security hardening (аудит 2026-07-22): настоящая авторизация в RLS + гигиена.
-- Закрывает: открытый доступ любого authenticated к ERP (#1/#3) и обход approved/active (#2),
-- часть целостности (qty_done clamp, total_sum>=0), advisor-гигиену (search_path, execute).
-- Только УЖЕСТОЧЕНИЕ. delete остаётся admin-only; procurement/subcontracting-management — manager.
-- Применено к pinhead-os-v2 (glhwbktsokphgksdvcxj) через MCP apply_migration.

-- 1) Предикат членства: доступ к ERP только у активного + подтверждённого профиля.
create or replace function public.erp_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active is true and approved is true
  );
$$;
grant execute on function public.erp_is_member() to authenticated;

-- 2) Менеджер (admin/director): тоже требует active+approved; пин search_path; definer.
create or replace function public.erp_is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active is true and approved is true
      and role in ('admin','director')
  );
$$;
grant execute on function public.erp_is_manager() to authenticated;

-- 3) Ужесточаем RLS erp_*: was using(true)/with check(true) -> erp_is_member().
do $$
declare t text;
begin
  foreach t in array array[
    'erp_calendar_slots','erp_departments','erp_employees','erp_experimental',
    'erp_experimental_ops','erp_item_prints','erp_item_stages','erp_materials',
    'erp_order_attachments','erp_order_audit','erp_order_comments','erp_order_items',
    'erp_orders','erp_procurement_tasks','erp_stage_events','erp_subcontracting',
    'erp_warehouse_ops','erp_warehouse_tasks'
  ] loop
    execute format('alter policy %I on public.%I using (public.erp_is_member())', t||'_read', t);
  end loop;

  foreach t in array array[
    'erp_calendar_slots','erp_departments','erp_experimental','erp_experimental_ops',
    'erp_item_prints','erp_item_stages','erp_materials','erp_order_attachments',
    'erp_order_comments','erp_order_items','erp_orders','erp_procurement_tasks',
    'erp_stage_events','erp_warehouse_ops','erp_warehouse_tasks'
  ] loop
    execute format('alter policy %I on public.%I with check (public.erp_is_member())', t||'_insert', t);
  end loop;

  foreach t in array array[
    'erp_calendar_slots','erp_departments','erp_experimental','erp_experimental_ops',
    'erp_item_prints','erp_item_stages','erp_materials','erp_order_items',
    'erp_orders','erp_warehouse_tasks'
  ] loop
    execute format('alter policy %I on public.%I using (public.erp_is_member()) with check (public.erp_is_member())', t||'_update', t);
  end loop;

  -- erp_item_prints_delete был using(true) — единственный delete не admin-only
  alter policy erp_item_prints_delete on public.erp_item_prints using (public.erp_is_member());
end $$;

-- 4) Целостность количеств: клампим qty_done в [0, item.qty], qty_rework — не отрицательный.
create or replace function public.erp_clamp_stage_qty()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_qty int;
begin
  select qty into v_qty from public.erp_order_items where id = new.item_id;
  if v_qty is not null then
    if new.qty_done < 0 then new.qty_done := 0; end if;
    if new.qty_done > v_qty then new.qty_done := v_qty; end if;
  end if;
  if new.qty_rework < 0 then new.qty_rework := 0; end if;
  return new;
end $$;
drop trigger if exists erp_item_stages_clamp_qty on public.erp_item_stages;
create trigger erp_item_stages_clamp_qty
  before insert or update on public.erp_item_stages
  for each row execute function public.erp_clamp_stage_qty();

-- 5) Legacy orders: сумма не отрицательна (текущие данные чисты — валидируем сразу).
alter table public.orders drop constraint if exists orders_total_sum_nonneg;
alter table public.orders add constraint orders_total_sum_nonneg check (total_sum >= 0);

-- 6) Гигиена (advisor): пин search_path + revoke execute на триггер-функциях (не RPC).
do $$
declare fn text;
begin
  foreach fn in array array[
    'erp_set_updated_at','erp_procurement_task_derive','erp_warehouse_task_derive',
    'erp_log_order_changes','erp_log_stage_plan_changes','erp_clamp_stage_qty'
  ] loop
    begin
      execute format('alter function public.%I() set search_path = public', fn);
      execute format('revoke execute on function public.%I() from public, anon, authenticated', fn);
    exception when undefined_function then
      raise notice 'skip %(): not found', fn;
    end;
  end loop;
end $$;
