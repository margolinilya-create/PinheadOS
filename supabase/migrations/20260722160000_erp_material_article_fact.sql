-- Правки ПМ 4.1.3 (склад — авто-заполнение плана при приёмке).
-- План приёмки (материал/цвет/артикул/кол-во) заводит закупщик и он read-only для склада;
-- склад вносит только факт. Добавляем недостающие поля:
--   article    — артикул планового материала (цвет уже есть колонкой color);
--   fact_*      — фактически поступивший материал/цвет/артикул (для сравнения план↔факт,
--                 заполняет кладовщик; пересорт/расхождение). Кол-во факт — уже qty_received.
-- Все колонки nullable/аддитивные.

alter table public.erp_materials
  add column article text,
  add column fact_name text,
  add column fact_color text,
  add column fact_article text;

-- RPC erp_create_order: добавляем article и qty_expected в insert материалов
-- (color уже персистился). База — версия из erp_create_order_subcontract; логика без изменений.
create or replace function public.erp_create_order(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order jsonb := payload->'order';
  v_order_id uuid;
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

  insert into erp_orders
    (bitrix_id, title, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, stickers, stickers_note, no_chestny_znak,
     status, created_by)
  values
    (v_order->>'bitrix_id',
     v_order->>'title',
     v_order->>'manager',
     (v_order->>'launch_date')::date,
     (v_order->>'due_date')::date,
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

      insert into erp_item_stages (item_id, department_id, sort_order, depends_on)
      values
        (v_item_id,
         (v_stage->>'department_id')::uuid,
         coalesce((v_stage->>'sort_order')::int, 0),
         coalesce(v_depends, '{}'))
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
