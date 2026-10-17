-- Order v4, веха 2 единого потока, миграция A (17.10): поля ТЗ в модели заказа.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m2-data-rights.md,
-- «Решения» п. 6 и «Проверка безопасности» п. 6. Формат ТЗ — по пяти образцам
-- (спека 2026-10-16-unified-order-flow-design.md).
--
-- Только сторона Order: таблицы `erp_*` миграция НЕ трогает (ERP заморожен,
-- сторож orderstudio/erpFrozen.test.ts). Всё идемпотентно: колонки — `if not
-- exists`, CHECK — `drop if exists` + `add`, уникальность и политики — по каталогу.
--
-- Служебные колонки шапки (`paid_kind`, `paid_override_reason`, `sent_at`,
-- `launch_*`, `launched_*`) `order_v4_save` НЕ пишет: их ставят RPC переходов,
-- оплаты и запуска (миграция B). Клиент их только читает.

-- ── Шапка заказа ─────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists paid_kind text,
  add column if not exists paid_override_reason text,
  add column if not exists sent_at timestamptz,
  add column if not exists launch_started_at timestamptz,
  add column if not exists launch_by uuid references auth.users(id) on delete set null,
  add column if not exists launched_at timestamptz,
  add column if not exists launched_by uuid references auth.users(id) on delete set null,
  add column if not exists sticker_preview_path text not null default '';

alter table public.orders drop constraint if exists orders_v4_paid_kind_check;
alter table public.orders add constraint orders_v4_paid_kind_check
  check (paid_kind is null or paid_kind in ('prepaid', 'full'));

create index if not exists orders_launch_by_idx on public.orders (launch_by);
create index if not exists orders_launched_by_idx on public.orders (launched_by);

comment on column public.orders.paid_kind is
  'Оплата v4: prepaid — предоплата, full — полностью. Ставит только RPC оплаты (миграция B).';
comment on column public.orders.sticker_preview_path is
  'Превью стикера на упаковку (путь в бакете order-artworks), пусто — нет.';

-- ── Позиция ──────────────────────────────────────────────────────────────

alter table public.order_items
  add column if not exists supplier text not null default '',
  add column if not exists model_description text not null default '',
  add column if not exists extra_processing_note text not null default '',
  add column if not exists client_pattern text not null default '',
  add column if not exists part_colors jsonb not null default '{}'::jsonb,
  add column if not exists tz_comment text not null default '',
  add column if not exists tz_pdf_path text not null default '',
  add column if not exists flat_id text not null default '';

-- Опора составного FK карточек заметок: карточка не может сослаться
-- на позицию ДРУГОГО заказа (п. 6 «Проверки безопасности»)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.order_items'::regclass and conname = 'order_items_id_order_uniq'
  ) then
    alter table public.order_items
      add constraint order_items_id_order_uniq unique (id, order_id);
  end if;
end;
$$;

-- ── Нанесение ────────────────────────────────────────────────────────────

alter table public.order_item_prints
  add column if not exists layout jsonb,
  add column if not exists artwork_path text not null default '',
  add column if not exists offset_mm numeric,
  add column if not exists offset_from text not null default '',
  add column if not exists offset_dir text not null default '',
  add column if not exists effects text[] not null default '{}',
  add column if not exists contractor text not null default '',
  add column if not exists contractor_days integer;

-- Метод «прочее» (П = прочее / подряд) — имя ограничения взято из живой базы 17.10
alter table public.order_item_prints drop constraint if exists order_item_prints_method_check;
alter table public.order_item_prints add constraint order_item_prints_method_check
  check (method in (
    'silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg', 'sublimation', 'patch', 'other'));

alter table public.order_item_prints drop constraint if exists order_item_prints_offset_mm_check;
alter table public.order_item_prints add constraint order_item_prints_offset_mm_check
  check (offset_mm is null or offset_mm >= 0);

alter table public.order_item_prints drop constraint if exists order_item_prints_offset_from_check;
alter table public.order_item_prints add constraint order_item_prints_offset_from_check
  check (offset_from in ('', 'neck_seam', 'top_edge', 'part_seam', 'center', 'other'));

alter table public.order_item_prints drop constraint if exists order_item_prints_offset_dir_check;
alter table public.order_item_prints add constraint order_item_prints_offset_dir_check
  check (offset_dir in ('', 'up', 'down', 'left', 'right'));

alter table public.order_item_prints drop constraint if exists order_item_prints_contractor_days_check;
alter table public.order_item_prints add constraint order_item_prints_contractor_days_check
  check (contractor_days is null or contractor_days > 0);

-- ── Бирки ────────────────────────────────────────────────────────────────

alter table public.order_item_labels
  add column if not exists blank boolean not null default false,
  add column if not exists preview_paths text[] not null default '{}',
  add column if not exists attach_scheme text not null default '',
  add column if not exists attach_image_path text not null default '';

-- ── Карточки заметок ТЗ ──────────────────────────────────────────────────
-- Карточка (картинка/ссылка + подпись) — к заказу целиком (item_id null) или
-- к позиции. Составной FK (MATCH SIMPLE): при item_id null не проверяется,
-- при заданном — позиция обязана быть ЭТОГО заказа.

create table if not exists public.order_notes_cards (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  item_id uuid,
  group_title text not null default '',
  caption text not null default '',
  link text not null default '',
  image_path text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint order_notes_cards_order_id_fkey
    foreign key (order_id) references public.orders(id) on delete cascade,
  constraint order_notes_cards_item_fkey
    foreign key (item_id, order_id) references public.order_items(id, order_id) on delete cascade
);

create index if not exists order_notes_cards_order_id_idx on public.order_notes_cards (order_id);
create index if not exists order_notes_cards_item_idx
  on public.order_notes_cards (item_id, order_id);

alter table public.order_notes_cards enable row level security;

-- Политики НА КОМАНДУ, видимость — через родителя (подзапрос к orders идёт
-- под RLS вызывающего), как у order_items. Идемпотентность — проверкой
-- каталога, а не `drop policy if exists`: таблица новая, удалять нечего,
-- а разрушающий оператор в тексте миграции MCP execute_sql держит до ручного
-- подтверждения — пробный прогон на нём не проходил (17.10).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'order_notes_cards' and policyname = 'order_notes_cards_select') then
    create policy order_notes_cards_select on public.order_notes_cards for select to authenticated
      using (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'order_notes_cards' and policyname = 'order_notes_cards_insert') then
    create policy order_notes_cards_insert on public.order_notes_cards for insert to authenticated
      with check (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'order_notes_cards' and policyname = 'order_notes_cards_update') then
    create policy order_notes_cards_update on public.order_notes_cards for update to authenticated
      using (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4))
      with check (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'order_notes_cards' and policyname = 'order_notes_cards_delete') then
    create policy order_notes_cards_delete on public.order_notes_cards for delete to authenticated
      using (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
  end if;
end;
$$;

-- ── Сохранение заказа целиком: новая редакция ────────────────────────────
-- Подлинный текст прежней редакции взят из живой базы 17.10
-- (pg_get_functiondef) и совпал с 20260928213529_orders_v4.sql. Изменения:
--   · новые поля позиции, нанесений, бирок; `sticker_preview_path` шапки;
--   · карточки заметок `notes_cards` — удалить и вставить заново, как
--     нанесения; позиция карточки — `item_key` (= ключ позиции = её id);
--   · `parent_id` обязан быть виден вызывающему (invoker: под его RLS).
-- По-прежнему НЕ пишет status, created_by, erp_order_id, paid_*, sent_at,
-- launch_*, launched_*, schema_version, order_number.

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
begin
  if (select auth.uid()) is null then
    raise exception 'Нужен вход в систему' using errcode = '42501';
  end if;

  -- Заказ-родитель (образец → тираж, переделка) — только видимый вызывающему
  if v_parent is not null and not exists (select 1 from public.orders where id = v_parent) then
    raise exception using errcode = '42501', message = 'Заказ не найден или недоступен';
  end if;

  if v_id is null then
    insert into public.orders (schema_version, status, created_by, data)
    values (4, 'draft', (select auth.uid()), '{}'::jsonb)
    returning id into v_id;
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
  -- и ссылка карточки сверяется с ИТОГОВЫМ набором позиций этого заказа
  delete from public.order_notes_cards where order_id = v_id;
  v_sub_seq := 0;
  for v_sub in select * from jsonb_array_elements(coalesce(p_order->'notes_cards', '[]'::jsonb)) loop
    v_card_item := nullif(v_sub->>'item_key', '')::uuid;
    if v_card_item is not null and not (v_card_item = any (v_item_ids)) then
      raise exception 'Карточка заметки ссылается на позицию не из этого заказа' using errcode = '22023';
    end if;
    insert into public.order_notes_cards (
      id, order_id, item_id, group_title, caption, link, image_path, sort_order)
    values (
      coalesce(nullif(v_sub->>'key', '')::uuid, gen_random_uuid()), v_id, v_card_item,
      coalesce(v_sub->>'group_title', ''),
      coalesce(v_sub->>'caption', ''),
      coalesce(v_sub->>'link', ''),
      coalesce(v_sub->>'image_path', ''),
      v_sub_seq);
    v_sub_seq := v_sub_seq + 1;
  end loop;

  return jsonb_build_object(
    'id', v_row.id,
    'order_number', v_row.order_number,
    'updated_at', v_row.updated_at);
end;
$$;

revoke execute on function public.order_v4_save(jsonb) from public, anon;
grant execute on function public.order_v4_save(jsonb) to authenticated;
