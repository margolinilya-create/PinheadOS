-- Волна 1 «Ядро диспетчера», правки 3/5/9: приоритет задания в очереди цеха + клиент заказа.
--
-- 1) erp_item_stages.queue_position — порядок задания в очереди своего цеха.
--    numeric (не int): перенос drag-and-drop вставляет карточку СЕРЕДИНОЙ между соседями
--    ((prev+next)/2) — один UPDATE на перенос, без массовой перенумерации очереди.
--    Базовое значение = epoch срока клиента: пока приоритет вручную не трогали, порядок
--    очереди совпадает с прежним (по due_date), а между соседними днями остаётся
--    86400 «единиц» — запас для ручных вставок.
-- 2) erp_orders.customer — клиент заказа. Требуется странице производственного задания
--    (правка 5) и фильтру по клиенту (правка 9); раньше был только title/manager.

-- Единый источник базовой позиции: бэкфилл, RPC создания заказа и код клиента.
create or replace function public.erp_default_queue_position(p_due date)
returns numeric
language sql
stable
set search_path = public
as $$
  -- Без срока — в хвост очереди (условный «через год»)
  select extract(epoch from (coalesce(p_due, current_date + 365))::timestamp)::numeric
$$;

grant execute on function public.erp_default_queue_position(date) to authenticated;

alter table public.erp_item_stages
  add column if not exists queue_position numeric;

create index if not exists erp_item_stages_dept_queue_idx
  on public.erp_item_stages (department_id, queue_position);

alter table public.erp_orders
  add column if not exists customer text;

-- Бэкфилл: существующие этапы получают позицию по сроку своего заказа.
update public.erp_item_stages s
   set queue_position = public.erp_default_queue_position(o.due_date)
  from public.erp_order_items i
  join public.erp_orders o on o.id = i.order_id
 where i.id = s.item_id
   and s.queue_position is null;

-- История заказа: клиент — такое же аудируемое поле, как менеджер и срок.
-- База — версия из 20260718100000_erp_stage_plan_audit.sql, добавлен 'customer'.
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
    'title','customer','manager','bitrix_id','launch_date','due_date','buffer_days',
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

-- RPC создания заказа: персист customer + базовая позиция очереди у создаваемых этапов.
-- База — версия из 20260722160000_erp_material_article_fact.sql; остальная логика не менялась.
create or replace function public.erp_create_order(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order jsonb := payload->'order';
  v_order_id uuid;
  v_due date;
  v_queue_pos numeric;
  v_item jsonb;
  v_item_id uuid;
  v_print jsonb;
  v_stage jsonb;
  v_stage_id uuid;
  v_stage_ids uuid[];
  v_depends uuid[];
  v_mat jsonb;
begin
  if v_order is null or coalesce(v_order->>'title', '') = '' then
    raise exception 'erp_create_order: order.title is required';
  end if;

  v_due := (v_order->>'due_date')::date;
  v_queue_pos := public.erp_default_queue_position(v_due);

  insert into erp_orders
    (bitrix_id, title, customer, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, stickers, stickers_note, no_chestny_znak,
     status, created_by)
  values
    (v_order->>'bitrix_id',
     v_order->>'title',
     v_order->>'customer',
     v_order->>'manager',
     (v_order->>'launch_date')::date,
     v_due,
     coalesce((v_order->>'buffer_days')::int, 0),
     v_order->>'notes',
     coalesce(v_order->>'packaging', 'none'),
     v_order->>'packaging_note',
     coalesce(v_order->>'stickers', 'none'),
     v_order->>'stickers_note',
     coalesce((v_order->>'no_chestny_znak')::boolean, false),
     coalesce(v_order->>'status', 'active'),
     nullif(v_order->>'created_by', '')::uuid)
  returning id into v_order_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into erp_order_items
      (order_id, product_type, variant, qty, production_type,
       branding_methods, branding_on, notes, size_grid, sort_order,
       subcontract_kind, material_source)
    values
      (v_order_id,
       v_item->>'product_type',
       v_item->>'variant',
       (v_item->>'qty')::int,
       coalesce(v_item->>'production_type', 'sewing'),
       coalesce(
         (select array_agg(t.x)
            from jsonb_array_elements_text(
              case when jsonb_typeof(v_item->'branding_methods') = 'array'
                   then v_item->'branding_methods' else '[]'::jsonb end) as t(x)),
         '{}'),
       coalesce(v_item->>'branding_on', 'cut'),
       v_item->>'notes',
       case when jsonb_typeof(v_item->'size_grid') = 'array'
            then v_item->'size_grid' end,
       coalesce((v_item->>'sort_order')::int, 0),
       v_item->>'subcontract_kind',
       v_item->>'material_source')
    returning id into v_item_id;

    for v_print in
      select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb))
    loop
      insert into erp_item_prints
        (item_id, seq, method, fabric, zone, width_mm, height_mm,
         offset_note, pantone, comment)
      values
        (v_item_id,
         coalesce((v_print->>'seq')::int, 1),
         v_print->>'method',
         v_print->>'fabric',
         v_print->>'zone',
         (v_print->>'width_mm')::int,
         (v_print->>'height_mm')::int,
         v_print->>'offset_note',
         v_print->>'pantone',
         v_print->>'comment');
    end loop;

    v_stage_ids := '{}';
    for v_stage in
      select * from jsonb_array_elements(coalesce(v_item->'stages', '[]'::jsonb))
    loop
      select coalesce(array_agg(v_stage_ids[(d.idx)::int + 1]), '{}')
        into v_depends
        from jsonb_array_elements_text(coalesce(v_stage->'depends_on', '[]'::jsonb)) as d(idx)
       where v_stage_ids[(d.idx)::int + 1] is not null;

      insert into erp_item_stages (item_id, department_id, sort_order, depends_on, queue_position)
      values
        (v_item_id,
         (v_stage->>'department_id')::uuid,
         coalesce((v_stage->>'sort_order')::int, 0),
         coalesce(v_depends, '{}'),
         v_queue_pos)
      returning id into v_stage_id;

      v_stage_ids := v_stage_ids || v_stage_id;
    end loop;
  end loop;

  for v_mat in
    select * from jsonb_array_elements(coalesce(payload->'materials', '[]'::jsonb))
  loop
    insert into erp_materials
      (order_id, kind, name, source, qty, status, eta_date, notes,
       role, color, article, supplier, qty_expected)
    values
      (v_order_id,
       coalesce(v_mat->>'kind', 'other'),
       v_mat->>'name',
       coalesce(v_mat->>'source', 'purchase'),
       v_mat->>'qty',
       coalesce(v_mat->>'status', 'pending'),
       (v_mat->>'eta_date')::date,
       v_mat->>'notes',
       v_mat->>'role',
       v_mat->>'color',
       v_mat->>'article',
       v_mat->>'supplier',
       (v_mat->>'qty_expected')::numeric);
  end loop;

  return v_order_id;
end $$;

grant execute on function public.erp_create_order(jsonb) to authenticated;
