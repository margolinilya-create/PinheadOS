-- Order v4, срез 1 (сессия 75): заказ продаж в `orders`, позиции, нанесения, бирки.
--
-- Заказ v4 живёт в `public.orders`, потому что на неё уже ссылается
-- `erp_orders.tz_order_id` (миграция 20260818203459). Таблицы `erp_*` миграция
-- НЕ трогает (решение владельца 28.09: «ERP не трогать»).
--
-- `schema_version`: 3 — прежние заказы визарда (`data` JSONB), 4 — Order v4.
-- Старый список (`useOrdersStore`) читает только 3: неизвестный ему статус v4
-- показывался бы «Черновиком», и смена статуса там его перезаписала бы.
--
-- Цена v4 пишется в `price_total`, а НЕ в `total_sum`: триггер
-- `log_order_changes` пишет в `order_audit` каждую смену `total_sum`, и
-- автосохранение залило бы журнал строкой на каждое нажатие.

alter table public.orders
  add column if not exists schema_version smallint not null default 3,
  add column if not exists kind text,
  add column if not exists parent_id uuid references public.orders(id) on delete set null,
  add column if not exists title text,
  add column if not exists customer text,
  add column if not exists contact text,
  add column if not exists manager_name text,
  add column if not exists due_date date,
  add column if not exists delivery_method text,
  add column if not exists delivery_address text,
  add column if not exists packaging text,
  add column if not exists packaging_note text,
  add column if not exists packaging_width_mm integer,
  add column if not exists packaging_height_mm integer,
  add column if not exists stickers text,
  add column if not exists stickers_note text,
  add column if not exists no_chestny_znak boolean not null default false,
  add column if not exists urgent boolean not null default false,
  add column if not exists discount_mode text,
  add column if not exists discount_value numeric,
  add column if not exists price_total numeric,
  add column if not exists price_margin_pct numeric,
  add column if not exists paid_at timestamptz,
  add column if not exists tz_ready_at timestamptz,
  add column if not exists tech_checked_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.orders
  add constraint orders_schema_version_check check (schema_version in (3, 4)),
  add constraint orders_v4_status_check check (
    schema_version <> 4 or status in (
      'draft', 'price_review', 'quoted', 'ready_to_launch',
      'production', 'done', 'cancel_requested', 'archived')),
  add constraint orders_v4_kind_check check (kind is null or kind in ('run', 'sample', 'dev', 'rework')),
  add constraint orders_v4_delivery_check check (
    delivery_method is null or delivery_method in ('', 'pickup', 'courier', 'carrier')),
  add constraint orders_v4_discount_check check (
    discount_mode is null or (discount_mode in ('pct', 'sum') and coalesce(discount_value, 0) >= 0));

comment on column public.orders.schema_version is
  '3 — заказ визарда Order Studio (data JSONB), 4 — Order v4 (колонки + order_items).';
comment on column public.orders.price_total is
  'Итог Order v4 (priceOrder). Не total_sum: его смены пишет в order_audit триггер log_order_changes.';

create index if not exists orders_schema_version_created_idx
  on public.orders (schema_version, created_at desc);
create index if not exists orders_parent_id_idx on public.orders (parent_id) where parent_id is not null;

-- ── Позиции ──────────────────────────────────────────────────────────────

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sort_order integer not null default 0,
  kind text not null default 'sku' check (kind in ('sku', 'blank', 'customer', 'dev')),
  sku_code text not null default '',
  -- Карточка модели ERP — ссылка без FK: зависимость на таблицу ERP не вешаем
  sku_card_id uuid,
  product_type text not null default '',
  fit text not null default '',
  fabric_code text not null default '',
  client_fabric boolean not null default false,
  main_fabric text not null default '',
  color_supplier text not null default '',
  trim_material text not null default '',
  cutting_note text not null default '',
  sewing_note text not null default '',
  labels_note text not null default '',
  packaging text not null default 'inherit',
  packaging_size text not null default '',
  sticker_place text not null default '',
  marking_place text not null default '',
  packaging_note text not null default '',
  packaging_width_mm integer,
  packaging_height_mm integer,
  -- Сетка цвет × размер: {sizes: [...], rows: [{color, sizes: {S: 10}}]} — как у ERP
  size_grid jsonb not null default '{"sizes": [], "rows": []}'::jsonb,
  extras text[] not null default '{}',
  blank_source text check (blank_source is null or blank_source in ('stock', 'third_party')),
  blank_price numeric check (blank_price is null or blank_price >= 0),
  brief text not null default '',
  manual_unit_price numeric check (manual_unit_price is null or manual_unit_price >= 0),
  -- Снимок цены на момент сохранения (список, КП); источник правды — расчёт
  price_unit numeric,
  price_total numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);

create table public.order_item_prints (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.order_items(id) on delete cascade,
  sort_order integer not null default 0,
  method text not null check (method in (
    'silkscreen', 'embroidery', 'dtf', 'heat_transfer', 'dtg', 'sublimation', 'patch')),
  zone text not null default '',
  sizes text[] not null default '{}',
  width_mm integer check (width_mm is null or width_mm > 0),
  height_mm integer check (height_mm is null or height_mm > 0),
  offset_note text not null default '',
  pantone text[] not null default '{}',
  special text not null default '',
  garment_kind text not null default '',
  print_on text not null default 'finished' check (print_on in ('cut', 'finished')),
  comment text not null default '',
  colors integer not null default 1 check (colors >= 1),
  textile text not null default 'white' check (textile in ('white', 'color')),
  fill numeric not null default 1 check (fill > 0 and fill <= 1),
  artwork_url text not null default '',
  applied_at timestamptz
);

create index order_item_prints_item_id_idx on public.order_item_prints (item_id);

create table public.order_item_labels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.order_items(id) on delete cascade,
  sort_order integer not null default 0,
  label_type text not null default '',
  place text not null default '',
  size text not null default '',
  comment text not null default '',
  variant_id text not null default ''
);

create index order_item_labels_item_id_idx on public.order_item_labels (item_id);

-- ── RLS: видимость через родителя ───────────────────────────────────────
-- Подзапрос к `orders` идёт под RLS вызывающего, поэтому «свои» наследуются
-- ровно такими, какие они у заказа, — второй реализации правила нет.

alter table public.order_items enable row level security;
alter table public.order_item_prints enable row level security;
alter table public.order_item_labels enable row level security;

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
create policy order_items_update on public.order_items for update to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id))
  with check (exists (select 1 from public.orders o where o.id = order_id and o.schema_version = 4));
create policy order_items_delete on public.order_items for delete to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy order_item_prints_select on public.order_item_prints for select to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_prints_insert on public.order_item_prints for insert to authenticated
  with check (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_prints_update on public.order_item_prints for update to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id))
  with check (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_prints_delete on public.order_item_prints for delete to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id));

create policy order_item_labels_select on public.order_item_labels for select to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_labels_insert on public.order_item_labels for insert to authenticated
  with check (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_labels_update on public.order_item_labels for update to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id))
  with check (exists (select 1 from public.order_items i where i.id = item_id));
create policy order_item_labels_delete on public.order_item_labels for delete to authenticated
  using (exists (select 1 from public.order_items i where i.id = item_id));

-- ── Сохранение заказа целиком ───────────────────────────────────────────
-- security invoker: работает RLS вызывающего. Последняя запись побеждает (v4 §6).
-- Статус не меняет: переходы — отдельные действия следующих срезов.

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
