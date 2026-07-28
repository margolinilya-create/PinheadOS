-- Волна 4: технические задания в PDF для производственных цехов.
--
-- До сих пор ТЗ существовало только как структурные поля заказа (размерная сетка,
-- нанесения, упаковка — TzBlock). Заказчик просит загружать готовый PDF, назначать
-- один файл сразу нескольким цехам и требовать ТЗ до создания заказа.
--
-- Модель:
--   erp_tz_documents   — сам файл. «Личность» документа — group_id, версии внутри группы.
--   erp_tz_assignments — какому цеху какой документ читать. Ссылается на group_id,
--                        А НЕ на конкретную версию: замена файла создаёт версию N+1,
--                        и все связанные цеха автоматически видят актуальную —
--                        ровно то, что требует заказчик («заменил файл — обновилось у всех»).
--
-- Общее ТЗ заказа — документ с item_id is null; на этап его можно назначить так же,
-- как файл позиции (в назначении хранится group_id, откуда документ — неважно).

create table if not exists public.erp_tz_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  /** null = общее ТЗ заказа (годится любой позиции), иначе ТЗ конкретной позиции */
  item_id uuid references public.erp_order_items(id) on delete cascade,
  /** «Личность» документа сквозь версии: назначения ссылаются сюда */
  group_id uuid not null,
  version int not null default 1,
  /** Актуальная версия группы. Ровно одна — partial unique index ниже */
  is_current boolean not null default true,
  file_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  note text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);

create index if not exists erp_tz_documents_order_idx on public.erp_tz_documents (order_id);
create index if not exists erp_tz_documents_item_idx on public.erp_tz_documents (item_id);
create unique index if not exists erp_tz_documents_current_idx
  on public.erp_tz_documents (group_id) where is_current;

create table if not exists public.erp_tz_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid not null references public.erp_order_items(id) on delete cascade,
  department_id uuid not null references public.erp_departments(id) on delete cascade,
  group_id uuid not null,
  assigned_by text,
  created_at timestamptz not null default now(),
  -- Одному этапу (позиция × цех) — одно ТЗ. Переназначение = update этой строки.
  unique (item_id, department_id)
);

create index if not exists erp_tz_assignments_order_idx on public.erp_tz_assignments (order_id);
create index if not exists erp_tz_assignments_group_idx on public.erp_tz_assignments (group_id);

-- Требовать ли ТЗ у заказа. Новые заказы — да (гейт на создании и на этапе).
-- Заказы, заведённые ДО внедрения, — нет: иначе гейт мгновенно застопорит живое
-- производство, где PDF-ТЗ никогда не загружали. Менеджер включает требование вручную,
-- когда догрузит файлы во вкладке «ТЗ».
alter table public.erp_orders
  add column if not exists tz_required boolean not null default true;

update public.erp_orders set tz_required = false where tz_required;

-- Кто ведёт ТЗ: загружает, заменяет версию, назначает цехам.
-- Отдельная функция, а не erp_is_manager(): у той семантика «admin/director» и она уже
-- используется закупкой/подрядом — расширять её значит молча раздать чужие права.
-- Просмотр и скачивание ТЗ правом не гейтятся: их видят все авторизованные (цех должен
-- открыть задание и прочитать ТЗ).
create or replace function public.erp_can_manage_tz()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'director', 'rop', 'manager')
  );
$$;

grant execute on function public.erp_can_manage_tz() to authenticated;

alter table public.erp_tz_documents enable row level security;
alter table public.erp_tz_assignments enable row level security;

drop policy if exists erp_tz_documents_read on public.erp_tz_documents;
create policy erp_tz_documents_read on public.erp_tz_documents
  for select to authenticated using (true);
drop policy if exists erp_tz_documents_insert on public.erp_tz_documents;
create policy erp_tz_documents_insert on public.erp_tz_documents
  for insert to authenticated with check (public.erp_can_manage_tz());
-- UPDATE обязателен, в отличие от erp_order_attachments: замена файла снимает
-- is_current со старой версии.
drop policy if exists erp_tz_documents_update on public.erp_tz_documents;
create policy erp_tz_documents_update on public.erp_tz_documents
  for update to authenticated
  using (public.erp_can_manage_tz()) with check (public.erp_can_manage_tz());
drop policy if exists erp_tz_documents_delete on public.erp_tz_documents;
create policy erp_tz_documents_delete on public.erp_tz_documents
  for delete to authenticated using (public.is_admin());

drop policy if exists erp_tz_assignments_read on public.erp_tz_assignments;
create policy erp_tz_assignments_read on public.erp_tz_assignments
  for select to authenticated using (true);
drop policy if exists erp_tz_assignments_insert on public.erp_tz_assignments;
create policy erp_tz_assignments_insert on public.erp_tz_assignments
  for insert to authenticated with check (public.erp_can_manage_tz());
drop policy if exists erp_tz_assignments_update on public.erp_tz_assignments;
create policy erp_tz_assignments_update on public.erp_tz_assignments
  for update to authenticated
  using (public.erp_can_manage_tz()) with check (public.erp_can_manage_tz());
drop policy if exists erp_tz_assignments_delete on public.erp_tz_assignments;
create policy erp_tz_assignments_delete on public.erp_tz_assignments
  for delete to authenticated using (public.erp_can_manage_tz());

do $$
begin
  alter publication supabase_realtime add table public.erp_tz_documents;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.erp_tz_assignments;
exception
  when duplicate_object then null;
end $$;

-- Право tz.manage в матрице (волна 2): гейтит UI, RLS выше — вторая линия.
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, 'tz.manage', r.role in ('director', 'dispatcher', 'manager')
from (values
  ('director'),('dispatcher'),('manager'),('foreman'),
  ('worker'),('purchaser'),('storekeeper'),('hr')
) as r(role)
on conflict (role, permission) do nothing;

-- RPC создания заказа: секция tz в payload.
-- Заказ, позиции, этапы, документы ТЗ и назначения вставляются ОДНОЙ транзакцией —
-- требование «создать заказ без ТЗ невозможно» иначе нарушается при сбое дозагрузки
-- (заказ уже есть, ТЗ нет). Файлы клиент кладёт в бакет ДО вызова RPC и передаёт готовые
-- пути; назначения адресуются парой «индекс позиции в payload + id цеха», поэтому
-- сопоставление «этап формы → строка БД» здесь не нужно вовсе.
--
-- База — версия из 20260727120000_erp_stage_queue_and_customer.sql; добавлены
-- tz_required, накопление v_item_ids и блок tz в конце.
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
  v_item_ids uuid[] := '{}';
  v_print jsonb;
  v_stage jsonb;
  v_stage_id uuid;
  v_stage_ids uuid[];
  v_depends uuid[];
  v_mat jsonb;
  v_doc jsonb;
  v_asg jsonb;
  v_idx int;
begin
  if v_order is null or coalesce(v_order->>'title', '') = '' then
    raise exception 'erp_create_order: order.title is required';
  end if;

  v_due := (v_order->>'due_date')::date;
  v_queue_pos := public.erp_default_queue_position(v_due);

  insert into erp_orders
    (bitrix_id, title, customer, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, stickers, stickers_note, no_chestny_znak,
     status, created_by, tz_required)
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
     nullif(v_order->>'created_by', '')::uuid,
     coalesce((v_order->>'tz_required')::boolean, true))
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

    -- Позиции нумеруются в порядке payload — по этому индексу адресуются назначения ТЗ
    v_item_ids := v_item_ids || v_item_id;

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

  -- ТЗ: документы (файлы уже в бакете) и назначения на этапы.
  -- item_index = null → общее ТЗ заказа.
  for v_doc in
    select * from jsonb_array_elements(coalesce(payload#>'{tz,documents}', '[]'::jsonb))
  loop
    v_idx := (v_doc->>'item_index')::int;
    insert into erp_tz_documents
      (order_id, item_id, group_id, version, is_current,
       file_path, file_name, mime_type, size_bytes, note, uploaded_by)
    values
      (v_order_id,
       case when v_idx is null then null else v_item_ids[v_idx + 1] end,
       (v_doc->>'group_id')::uuid,
       1, true,
       v_doc->>'file_path',
       v_doc->>'file_name',
       v_doc->>'mime_type',
       (v_doc->>'size_bytes')::bigint,
       v_doc->>'note',
       v_doc->>'uploaded_by');
  end loop;

  for v_asg in
    select * from jsonb_array_elements(coalesce(payload#>'{tz,assignments}', '[]'::jsonb))
  loop
    v_idx := (v_asg->>'item_index')::int;
    if v_idx is null or v_item_ids[v_idx + 1] is null then
      raise exception 'erp_create_order: tz assignment references unknown item_index %', v_idx;
    end if;
    insert into erp_tz_assignments
      (order_id, item_id, department_id, group_id, assigned_by)
    values
      (v_order_id,
       v_item_ids[v_idx + 1],
       (v_asg->>'department_id')::uuid,
       (v_asg->>'group_id')::uuid,
       v_asg->>'assigned_by')
    on conflict (item_id, department_id) do update
      set group_id = excluded.group_id;
  end loop;

  return v_order_id;
end $$;

grant execute on function public.erp_create_order(jsonb) to authenticated;
