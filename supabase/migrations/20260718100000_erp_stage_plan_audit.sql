-- BUG-01 (QA-прогон): план-даты этапов не попадали в историю карточки заказа.
-- 1) Новый триггер: erp_item_stages.planned_start/planned_end → erp_order_audit.
-- 2) Фикс erp_log_order_changes: fallback «система» не срабатывал —
--    select into при пустой выборке оставляет null (аддитивный CREATE OR REPLACE).
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

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
  select coalesce(p.name, p.email) into actor
    from public.profiles p where p.id = auth.uid();
  actor := coalesce(actor, 'система');
  foreach f in array array[
    'title','manager','bitrix_id','launch_date','due_date','buffer_days',
    'priority','status','shipped_status','delivered_at','notes',
    'packaging','packaging_note','stickers','stickers_note','no_chestny_znak'
  ] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into old_v, new_v using old, new;
    if old_v is distinct from new_v then
      insert into public.erp_order_audit (order_id, field_name, old_value, new_value, changed_by)
      values (new.id, f, old_v, new_v, actor);
    end if;
  end loop;
  return new;
end $$;

-- Плановые даты этапа → история заказа (field_name: planned_start / planned_end)
create or replace function public.erp_log_stage_plan_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  ord uuid;
begin
  if new.planned_start is not distinct from old.planned_start
     and new.planned_end is not distinct from old.planned_end then
    return new;
  end if;
  select coalesce(p.name, p.email) into actor
    from public.profiles p where p.id = auth.uid();
  actor := coalesce(actor, 'система');
  select order_id into ord from public.erp_order_items where id = new.item_id;
  if ord is null then
    return new;
  end if;
  if new.planned_start is distinct from old.planned_start then
    insert into public.erp_order_audit (order_id, field_name, old_value, new_value, changed_by)
    values (ord, 'planned_start', old.planned_start::text, new.planned_start::text, actor);
  end if;
  if new.planned_end is distinct from old.planned_end then
    insert into public.erp_order_audit (order_id, field_name, old_value, new_value, changed_by)
    values (ord, 'planned_end', old.planned_end::text, new.planned_end::text, actor);
  end if;
  return new;
end $$;

drop trigger if exists erp_stages_plan_audit on public.erp_item_stages;
create trigger erp_stages_plan_audit
  after update of planned_start, planned_end on public.erp_item_stages
  for each row execute function public.erp_log_stage_plan_changes();
