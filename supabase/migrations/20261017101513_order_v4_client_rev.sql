-- Order v4, веха 3 единого потока, миграция D (17.10): ревизия клиента
-- и защита от конкурентной правки.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m3-workplace.md, задача 1.
--
-- Что закрывает:
--   1. Устаревшая вкладка. `order_v4_save` пишет позицию ЦЕЛИКОМ: чего нет
--      в аргументе, то становится пустым (`coalesce(…, '')`). Клиент, открытый
--      до выкладки, не знает полей, которые добавила следующая веха, и первым
--      же автосохранением стёр бы их у позиции. Теперь клиент шлёт
--      `client_rev`; меньше 3 (или нет вовсе) — `P0001` «Вышло обновление —
--      обновите страницу, правка не сохранена». Проверка — в ОБЕИХ функциях:
--      `order_v4_save` открыта authenticated и зовётся напрямую в обход обёртки.
--      Это защита совместимости, а не права: подделка ревизии даёт только
--      порчу своего же черновика, права по-прежнему держат RLS и стражи.
--   2. Правка из двух вкладок. Сохраняется весь заказ, последняя запись
--      побеждала молча. Теперь `order_v4_save_full` принимает
--      `expected_updated_at` — `updated_at`, который клиент получил при чтении
--      или прошлом сохранении. Для существующего заказа строка берётся
--      `for update` (вторая вкладка ждёт первую, а не читает старое), и при
--      расхождении — `P0001` «Заказ изменён в другой вкладке — обновите
--      страницу». Ключа нет (новый заказ, прямой вызов) — проверки нет.
--      Строка, которую вызывающий не видит или не может править, `for update`
--      не возвращает: проверка пропускается, и отказ даёт сама `order_v4_save`
--      (42501 «Заказ не найден или недоступен» / страж «правка закрыта») —
--      существование чужого заказа по тексту ошибки не угадать.
--
-- Тексты функций — с боя (pg_get_functiondef, 17.10; тело `order_v4_save`
-- совпадает с миграцией A 20261017053703 по md5 prosrc, `order_v4_save_full`
-- — с 20261016182953). Изменения: строка проверки `client_rev` в начале обеих
-- и проверка `expected_updated_at` в обёртке. Security invoker, как было.
-- Таблицы `erp_*` миграция не трогает.
--
-- ВЫКАТКА: применять ПОСЛЕ мерджа и выкладки клиента вехи 3 — клиент вехи 2
-- `client_rev` не шлёт, и с этой миграцией его сохранение откажет. Лишний
-- ключ (`client_rev`, `expected_updated_at`) старый сервер игнорирует, так
-- что клиент вехи 3 можно выкладывать раньше миграции.
-- ОТКАТ ФРОНТА НА ВЕХУ 2 ⇒ СНАЧАЛА откатить эту миграцию (прежние тела обеих
-- функций с теми же revoke/grant), затем фронт. Правило «откат = выключить
-- флаг» к этой миграции не применяется.

create or replace function public.order_v4_save(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := nullif(p_order->>'id', '')::uuid;
  v_parent uuid := nullif(p_order->>'parent_id', '')::uuid;
  v_row public.orders%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
  v_seq integer := 0;
  v_sub jsonb;
  v_sub_seq integer;
  v_card_item uuid;
  v_old_parent uuid;
  v_path text;
  c_bad_path constant text := 'Путь файла не принадлежит заказу';
begin
  -- Ревизия клиента (миграция D): клиент до вехи 3 не знает новых полей
  -- позиции и стёр бы их пустыми значениями — правка не сохраняется
  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
    raise exception using errcode = 'P0001',
      message = 'Вышло обновление — обновите страницу, правка не сохранена';
  end if;

  if (select auth.uid()) is null then
    raise exception 'Нужен вход в систему' using errcode = '42501';
  end if;

  -- Заказ-родитель (образец → тираж, переделка) — только видимый вызывающему.
  -- Проверяется при смене: прежний родитель мог стать невидимым, и это
  -- не повод запрещать сохранение остального заказа
  if v_id is not null then
    select parent_id into v_old_parent from public.orders where id = v_id and schema_version = 4;
  end if;
  if v_parent is not null and v_parent = v_id then
    raise exception using errcode = '42501', message = 'Заказ не найден или недоступен';
  end if;
  if v_parent is not null
     and (v_id is null or v_parent is distinct from v_old_parent)
     and not exists (select 1 from public.orders where id = v_parent) then
    raise exception using errcode = '42501', message = 'Заказ не найден или недоступен';
  end if;

  if v_id is null then
    insert into public.orders (schema_version, status, created_by, data)
    values (4, 'draft', (select auth.uid()), '{}'::jsonb)
    returning id into v_id;
  end if;

  -- Пути проверяются, когда id заказа уже известен (у нового — после вставки)
  v_path := coalesce(p_order->>'sticker_preview_path', '');
  if v_path <> '' and not public.order_artwork_path_ok(v_id, v_path) then
    raise exception using errcode = '22023', message = c_bad_path;
  end if;

  update public.orders set
    kind             = coalesce(nullif(p_order->>'kind', ''), 'run'),
    parent_id        = v_parent,
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
    sticker_preview_path = coalesce(p_order->>'sticker_preview_path', ''),
    no_chestny_znak  = coalesce((p_order->>'no_chestny_znak')::boolean, false),
    urgent           = coalesce((p_order->>'urgent')::boolean, false),
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

    v_path := coalesce(v_item->>'tz_pdf_path', '');
    if v_path <> '' and not public.order_artwork_path_ok(v_id, v_path) then
      raise exception using errcode = '22023', message = c_bad_path;
    end if;

    insert into public.order_items as it (
      id, order_id, sort_order, kind, sku_code, sku_card_id, product_type, fit,
      fabric_code, client_fabric, main_fabric, color_supplier, trim_material,
      cutting_note, sewing_note, labels_note, packaging, packaging_size,
      sticker_place, marking_place, packaging_note, packaging_width_mm,
      packaging_height_mm, size_grid, extras, blank_source, blank_price, brief,
      manual_unit_price, price_unit, price_total,
      supplier, model_description, extra_processing_note, client_pattern,
      part_colors, tz_comment, tz_pdf_path, flat_id, updated_at)
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
      coalesce(v_item->>'supplier', ''),
      coalesce(v_item->>'model_description', ''),
      coalesce(v_item->>'extra_processing_note', ''),
      coalesce(v_item->>'client_pattern', ''),
      coalesce(nullif(v_item->'part_colors', 'null'::jsonb), '{}'::jsonb),
      coalesce(v_item->>'tz_comment', ''),
      coalesce(v_item->>'tz_pdf_path', ''),
      coalesce(v_item->>'flat_id', ''),
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
      price_total = excluded.price_total,
      supplier = excluded.supplier, model_description = excluded.model_description,
      extra_processing_note = excluded.extra_processing_note,
      client_pattern = excluded.client_pattern, part_colors = excluded.part_colors,
      tz_comment = excluded.tz_comment, tz_pdf_path = excluded.tz_pdf_path,
      flat_id = excluded.flat_id, updated_at = excluded.updated_at
    -- Чужой id (позиция другого заказа) не переписывается
    where it.order_id = v_id;

    if not exists (select 1 from public.order_items where id = v_item_id and order_id = v_id) then
      raise exception 'Позиция принадлежит другому заказу' using errcode = '42501';
    end if;

    delete from public.order_item_prints where item_id = v_item_id;
    v_sub_seq := 0;
    for v_sub in select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb)) loop
      v_path := coalesce(v_sub->>'artwork_path', '');
      if v_path <> '' and not public.order_artwork_path_ok(v_id, v_path) then
        raise exception using errcode = '22023', message = c_bad_path;
      end if;
      insert into public.order_item_prints (
        id, item_id, sort_order, method, zone, sizes, width_mm, height_mm, offset_note,
        pantone, special, garment_kind, print_on, comment, colors, textile, fill,
        artwork_url, applied_at,
        layout, artwork_path, offset_mm, offset_from, offset_dir, effects,
        contractor, contractor_days)
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
        nullif(v_sub->>'applied_at', '')::timestamptz,
        nullif(v_sub->'layout', 'null'::jsonb),
        coalesce(v_sub->>'artwork_path', ''),
        nullif(v_sub->>'offset_mm', '')::numeric,
        coalesce(v_sub->>'offset_from', ''),
        coalesce(v_sub->>'offset_dir', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_sub->'effects', '[]'::jsonb))), '{}'),
        coalesce(v_sub->>'contractor', ''),
        nullif(v_sub->>'contractor_days', '')::integer);
      v_sub_seq := v_sub_seq + 1;
    end loop;

    delete from public.order_item_labels where item_id = v_item_id;
    v_sub_seq := 0;
    for v_sub in select * from jsonb_array_elements(coalesce(v_item->'labels', '[]'::jsonb)) loop
      v_path := coalesce(v_sub->>'attach_image_path', '');
      if (v_path <> '' and not public.order_artwork_path_ok(v_id, v_path))
         or exists (
           select 1 from jsonb_array_elements_text(coalesce(v_sub->'preview_paths', '[]'::jsonb)) as e(path)
            where not public.order_artwork_path_ok(v_id, e.path)) then
        raise exception using errcode = '22023', message = c_bad_path;
      end if;
      insert into public.order_item_labels (
        id, item_id, sort_order, label_type, place, size, comment, variant_id,
        blank, preview_paths, attach_scheme, attach_image_path)
      values (
        coalesce(nullif(v_sub->>'key', '')::uuid, gen_random_uuid()), v_item_id, v_sub_seq,
        coalesce(v_sub->>'label_type', ''),
        coalesce(v_sub->>'place', ''),
        coalesce(v_sub->>'size', ''),
        coalesce(v_sub->>'comment', ''),
        coalesce(v_sub->>'variant_id', ''),
        coalesce((v_sub->>'blank')::boolean, false),
        coalesce(array(select jsonb_array_elements_text(coalesce(v_sub->'preview_paths', '[]'::jsonb))), '{}'),
        coalesce(v_sub->>'attach_scheme', ''),
        coalesce(v_sub->>'attach_image_path', ''));
      v_sub_seq := v_sub_seq + 1;
    end loop;

    v_seq := v_seq + 1;
  end loop;

  delete from public.order_items where order_id = v_id and not (id = any (v_item_ids));

  -- Карточки заметок — после позиций: каскад удалённых позиций уже прошёл,
  -- и ссылка карточки сверяется с ИТОГОВЫМ набором позиций этого заказа.
  -- Нет ключа `notes_cards` (клиент до вехи 2) — карточки не трогаются
  if p_order ? 'notes_cards' then
    delete from public.order_notes_cards where order_id = v_id;
    v_sub_seq := 0;
    for v_sub in select * from jsonb_array_elements(coalesce(p_order->'notes_cards', '[]'::jsonb)) loop
      v_card_item := nullif(v_sub->>'item_key', '')::uuid;
      if v_card_item is not null and not (v_card_item = any (v_item_ids)) then
        raise exception 'Карточка заметки ссылается на позицию не из этого заказа' using errcode = '22023';
      end if;
      v_path := coalesce(v_sub->>'image_path', '');
      if v_path <> '' and not public.order_artwork_path_ok(v_id, v_path) then
        raise exception using errcode = '22023', message = c_bad_path;
      end if;
      insert into public.order_notes_cards (
        id, order_id, item_id, group_title, caption, link, image_path, sort_order)
      values (
        coalesce(nullif(v_sub->>'key', '')::uuid, gen_random_uuid()), v_id, v_card_item,
        coalesce(v_sub->>'group_title', ''),
        coalesce(v_sub->>'caption', ''),
        coalesce(v_sub->>'link', ''),
        v_path,
        v_sub_seq);
      v_sub_seq := v_sub_seq + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'order_number', v_row.order_number,
    'updated_at', v_row.updated_at);
end;
$$;

revoke execute on function public.order_v4_save(jsonb) from public, anon;
grant execute on function public.order_v4_save(jsonb) to authenticated;

-- Обёртка: заказ и дни срочности одной транзакцией (16.10) + ревизия клиента
-- и проверка конкурентной правки (17.10).
create or replace function public.order_v4_save_full(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_saved jsonb;
  v_id uuid;
  v_expected timestamptz;
  v_current timestamptz;
begin
  if coalesce((p_order->>'client_rev')::int, 0) < 3 then
    raise exception using errcode = 'P0001',
      message = 'Вышло обновление — обновите страницу, правка не сохранена';
  end if;

  -- Конкурентная правка: строка существующего заказа берётся FOR UPDATE —
  -- параллельное сохранение из второй вкладки ждёт и видит уже новый updated_at
  v_id := nullif(p_order->>'id', '')::uuid;
  v_expected := nullif(p_order->>'expected_updated_at', '')::timestamptz;
  if v_id is not null and v_expected is not null then
    select updated_at into v_current
      from public.orders
     where id = v_id and schema_version = 4
       for update;
    if found and v_current is distinct from v_expected then
      raise exception using errcode = 'P0001',
        message = 'Заказ изменён в другой вкладке — обновите страницу';
    end if;
  end if;

  v_saved := public.order_v4_save(p_order);
  if jsonb_typeof(p_order->'urgent_days') = 'number' then
    perform public.order_v4_set_urgent_days(
      (v_saved->>'id')::uuid,
      (p_order->>'urgent_days')::smallint
    );
  end if;
  return v_saved;
end;
$$;

revoke execute on function public.order_v4_save_full(jsonb) from public, anon;
grant execute on function public.order_v4_save_full(jsonb) to authenticated;
