-- НЕ ПРИМЕНЕНА (13.10): order_v4_save пишет urgent_days (правка CRM 13.10, п. 6).
-- Применить владельцу через Supabase SQL editor или `supabase db push`: инструмент
-- агента требует ручного подтверждения на любой текст с удалением строк, а тело
-- функции его содержит (пересборка позиций заказа), и вызов истекал по таймауту.
-- После применения — запись в APPLIED.json.
--
-- Пока не применена, клиент работает: столбец есть (20261013114103), функция
-- пишет только флажок `urgent`, а клиент читает его как 5 дней (orderUrgentDays);
-- выбор 10 и 15 дней в «Заказах v4» до применения после перезагрузки станет 5.
--
-- Текст — подлинный из базы (pg_get_functiondef 13.10, сверен
-- с 20260928213529_orders_v4.sql), меняется только блок `urgent`.

create or replace function public.order_v4_save(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := nullif(p_order->>'id', '')::uuid;
  v_row public.orders%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
  v_seq integer := 0;
  v_sub jsonb;
  v_sub_seq integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Нужен вход в систему' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.orders (schema_version, status, created_by, data)
    values (4, 'draft', (select auth.uid()), '{}'::jsonb)
    returning id into v_id;
  end if;

  update public.orders set
    kind             = coalesce(nullif(p_order->>'kind', ''), 'run'),
    parent_id        = nullif(p_order->>'parent_id', '')::uuid,
    bitrix_deal      = nullif(p_order->>'bitrix_id', ''),
    title            = coalesce(p_order->>'title', ''),
    customer         = coalesce(p_order->>'customer', ''),
    contact          = coalesce(p_order->>'contact', ''),
    manager_name     = coalesce(p_order->>'manager', ''),
    due_date         = nullif(p_order->>'due_date', '')::date,
    delivery_method  = coalesce(p_order->>'delivery_method', ''),
    delivery_address = coalesce(p_order->>'delivery_address', ''),
    packaging        = coalesce(p_order->>'packaging', 'none'),
    packaging_note   = coalesce(p_order->>'packaging_note', ''),
    packaging_width_mm  = nullif(p_order->>'packaging_width_mm', '')::integer,
    packaging_height_mm = nullif(p_order->>'packaging_height_mm', '')::integer,
    stickers         = coalesce(p_order->>'stickers', 'none'),
    stickers_note    = coalesce(p_order->>'stickers_note', ''),
    no_chestny_znak  = coalesce((p_order->>'no_chestny_znak')::boolean, false),
    -- Срочный пошив по дням (правка CRM 13.10). Старый клиент шлёт только
    -- флажок: он читается как 5 дней; флажок остаётся = «дней больше нуля»
    urgent_days      = case
                         when nullif(p_order->>'urgent_days', '') is not null
                           then (p_order->>'urgent_days')::smallint
                         when coalesce((p_order->>'urgent')::boolean, false) then 5
                         else 0
                       end,
    urgent           = coalesce(nullif(p_order->>'urgent_days', '')::smallint > 0,
                                (p_order->>'urgent')::boolean, false),
    discount_mode    = nullif(p_order->'discount'->>'mode', ''),
    discount_value   = nullif(p_order->'discount'->>'value', '')::numeric,
    price_total      = nullif(p_order->>'price_total', '')::numeric,
    price_margin_pct = nullif(p_order->>'price_margin_pct', '')::numeric,
    updated_at       = now()
  where id = v_id and schema_version = 4
  returning * into v_row;

  if not found then
    raise exception 'Заказ не найден или недоступен' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_order->'items', '[]'::jsonb)) loop
    v_item_id := coalesce(nullif(v_item->>'key', '')::uuid, gen_random_uuid());
    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.order_items as it (
      id, order_id, sort_order, kind, sku_code, sku_card_id, product_type, fit,
      fabric_code, client_fabric, main_fabric, color_supplier, trim_material,
      cutting_note, sewing_note, labels_note, packaging, packaging_size,
      sticker_place, marking_place, packaging_note, packaging_width_mm,
      packaging_height_mm, size_grid, extras, blank_source, blank_price, brief,
      manual_unit_price, price_unit, price_total, updated_at)
    values (
      v_item_id, v_id, v_seq,
      coalesce(nullif(v_item->>'kind', ''), 'sku'),
      coalesce(v_item->>'sku_code', ''),
      nullif(v_item->>'sku_card_id', '')::uuid,
      coalesce(v_item->>'product_type', ''),
      coalesce(v_item->>'fit', ''),
      coalesce(v_item->>'fabric_code', ''),
      coalesce((v_item->>'client_fabric')::boolean, false),
      coalesce(v_item->>'main_fabric', ''),
      coalesce(v_item->>'color_supplier', ''),
      coalesce(v_item->>'trim_material', ''),
      coalesce(v_item->>'cutting_note', ''),
      coalesce(v_item->>'sewing_note', ''),
      coalesce(v_item->>'labels_note', ''),
      coalesce(nullif(v_item->>'packaging', ''), 'inherit'),
      coalesce(v_item->>'packaging_size', ''),
      coalesce(v_item->>'sticker_place', ''),
      coalesce(v_item->>'marking_place', ''),
      coalesce(v_item->>'packaging_note', ''),
      nullif(v_item->>'packaging_width_mm', '')::integer,
      nullif(v_item->>'packaging_height_mm', '')::integer,
      coalesce(v_item->'size_grid', '{"sizes": [], "rows": []}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'extras', '[]'::jsonb))), '{}'),
      nullif(v_item->>'blank_source', ''),
      nullif(v_item->>'blank_price', '')::numeric,
      coalesce(v_item->>'brief', ''),
      nullif(v_item->>'manual_unit_price', '')::numeric,
      nullif(v_item->>'price_unit', '')::numeric,
      nullif(v_item->>'price_total', '')::numeric,
      now())
    on conflict (id) do update set
      sort_order = excluded.sort_order, kind = excluded.kind, sku_code = excluded.sku_code,
      sku_card_id = excluded.sku_card_id, product_type = excluded.product_type, fit = excluded.fit,
      fabric_code = excluded.fabric_code, client_fabric = excluded.client_fabric,
      main_fabric = excluded.main_fabric, color_supplier = excluded.color_supplier,
      trim_material = excluded.trim_material, cutting_note = excluded.cutting_note,
      sewing_note = excluded.sewing_note, labels_note = excluded.labels_note,
      packaging = excluded.packaging, packaging_size = excluded.packaging_size,
      sticker_place = excluded.sticker_place, marking_place = excluded.marking_place,
      packaging_note = excluded.packaging_note, packaging_width_mm = excluded.packaging_width_mm,
      packaging_height_mm = excluded.packaging_height_mm, size_grid = excluded.size_grid,
      extras = excluded.extras, blank_source = excluded.blank_source,
      blank_price = excluded.blank_price, brief = excluded.brief,
      manual_unit_price = excluded.manual_unit_price, price_unit = excluded.price_unit,
      price_total = excluded.price_total, updated_at = excluded.updated_at
    -- Чужой id (позиция другого заказа) не переписывается
    where it.order_id = v_id;

    if not exists (select 1 from public.order_items where id = v_item_id and order_id = v_id) then
      raise exception 'Позиция принадлежит другому заказу' using errcode = '42501';
    end if;

    delete from public.order_item_prints where item_id = v_item_id;
    v_sub_seq := 0;
    for v_sub in select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb)) loop
      insert into public.order_item_prints (
        id, item_id, sort_order, method, zone, sizes, width_mm, height_mm, offset_note,
        pantone, special, garment_kind, print_on, comment, colors, textile, fill,
        artwork_url, applied_at)
      values (
        coalesce(nullif(v_sub->>'key', '')::uuid, gen_random_uuid()), v_item_id, v_sub_seq,
        v_sub->>'method',
        coalesce(v_sub->>'zone', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_sub->'sizes', '[]'::jsonb))), '{}'),
        nullif(v_sub->>'width_mm', '')::integer,
        nullif(v_sub->>'height_mm', '')::integer,
        coalesce(v_sub->>'offset_note', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_sub->'pantone', '[]'::jsonb))), '{}'),
        coalesce(v_sub->>'special', ''),
        coalesce(v_sub->>'garment_kind', ''),
        coalesce(nullif(v_sub->>'on', ''), 'finished'),
        coalesce(v_sub->>'comment', ''),
        greatest(coalesce(nullif(v_sub->>'colors', '')::integer, 1), 1),
        coalesce(nullif(v_sub->>'textile', ''), 'white'),
        coalesce(nullif(v_sub->>'fill', '')::numeric, 1),
        coalesce(v_sub->>'artwork_url', ''),
        nullif(v_sub->>'applied_at', '')::timestamptz);
      v_sub_seq := v_sub_seq + 1;
    end loop;

    delete from public.order_item_labels where item_id = v_item_id;
    v_sub_seq := 0;
    for v_sub in select * from jsonb_array_elements(coalesce(v_item->'labels', '[]'::jsonb)) loop
      insert into public.order_item_labels (
        id, item_id, sort_order, label_type, place, size, comment, variant_id)
      values (
        coalesce(nullif(v_sub->>'key', '')::uuid, gen_random_uuid()), v_item_id, v_sub_seq,
        coalesce(v_sub->>'label_type', ''),
        coalesce(v_sub->>'place', ''),
        coalesce(v_sub->>'size', ''),
        coalesce(v_sub->>'comment', ''),
        coalesce(v_sub->>'variant_id', ''));
      v_sub_seq := v_sub_seq + 1;
    end loop;

    v_seq := v_seq + 1;
  end loop;

  delete from public.order_items where order_id = v_id and not (id = any (v_item_ids));

  return jsonb_build_object(
    'id', v_row.id,
    'order_number', v_row.order_number,
    'updated_at', v_row.updated_at);
end;
$$;

revoke execute on function public.order_v4_save(jsonb) from public, anon;
grant execute on function public.order_v4_save(jsonb) to authenticated;
