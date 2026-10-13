-- ERP Фаза 1: ядро производственного планирования.
-- Применено к pinhead-os-v2 (glhwbktsokphgksdvcxj) 2026-07-16 через MCP apply_migration.
-- Модель из docs/erp/spreadsheet-analysis.md (разбор таблицы менеджера).
-- Всё с префиксом erp_ — отделено от таблиц Order Studio (orders, app_config...).

create or replace function public.erp_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Цеха / участки (справочник + мощности из листа 8_Мощности)
create table public.erp_departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null,
  sort_order int not null default 0,
  is_branding boolean not null default false,
  capacity_per_day numeric,
  target_load_per_day numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Производственные заказы (№ сделки Bitrix — вручную)
create table public.erp_orders (
  id uuid primary key default gen_random_uuid(),
  bitrix_id text,
  title text not null,
  manager text,
  launch_date date,
  due_date date,
  buffer_days int not null default 0,
  priority int not null default 0,
  status text not null default 'active'
    check (status in ('active','done_on_time','done_late','done_early','cancelled')),
  shipped_status text not null default 'not_shipped'
    check (shipped_status in ('not_shipped','partial','shipped')),
  delivered_at date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index erp_orders_due_idx on public.erp_orders (due_date) where status = 'active';
create index erp_orders_status_idx on public.erp_orders (status);

-- Позиции заказа (вид изделия × цвет/вариант)
create table public.erp_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  product_type text not null,
  variant text,
  qty int not null check (qty > 0),
  production_type text not null default 'sewing'
    check (production_type in
      ('no_product','ready_garment','cut','sewing','samples','outsource')),
  branding_methods text[] not null default '{}',
  branding_on text default 'cut'
    check (branding_on in ('cut','finished')),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index erp_order_items_order_idx on public.erp_order_items (order_id);

-- Этапы позиции (позиция × цех) — ядро прозрачности.
-- ready вычисляется: все depends_on done + материалы received.
create table public.erp_item_stages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.erp_order_items(id) on delete cascade,
  department_id uuid not null references public.erp_departments(id),
  depends_on uuid[] not null default '{}',
  status text not null default 'waiting'
    check (status in ('waiting','ready','in_progress','done','skipped','blocked')),
  qty_done int not null default 0,
  qty_rework int not null default 0,
  planned_start date,
  planned_end date,
  started_at timestamptz,
  finished_at timestamptz,
  assignee text,
  block_reason text,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, department_id)
);
create index erp_item_stages_item_idx on public.erp_item_stages (item_id);
create index erp_item_stages_dept_status_idx on public.erp_item_stages (department_id, status);

-- Материалы (ткань / фурнитура / бирки) — гейт для закроя
create table public.erp_materials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid references public.erp_order_items(id) on delete cascade,
  kind text not null
    check (kind in ('fabric','hardware','labels','packaging','other')),
  name text not null,
  source text not null default 'purchase'
    check (source in ('purchase','stock','client','none')),
  qty text,
  status text not null default 'pending'
    check (status in ('pending','ordered','in_transit','received','partial','not_needed')),
  eta_date date,
  received_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index erp_materials_order_idx on public.erp_materials (order_id);
create index erp_materials_status_idx on public.erp_materials (status);

-- Календарь цеха (раскладка по дням)
create table public.erp_calendar_slots (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.erp_departments(id),
  stage_id uuid references public.erp_item_stages(id) on delete cascade,
  work_date date not null,
  qty_planned int not null default 0,
  qty_done int,
  assignee text,
  status text not null default 'planned'
    check (status in ('planned','confirmed','done','moved','cancelled')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index erp_calendar_dept_date_idx on public.erp_calendar_slots (department_id, work_date);

-- updated_at триггеры
create trigger erp_departments_touch before update on public.erp_departments
  for each row execute function public.erp_set_updated_at();
create trigger erp_orders_touch before update on public.erp_orders
  for each row execute function public.erp_set_updated_at();
create trigger erp_order_items_touch before update on public.erp_order_items
  for each row execute function public.erp_set_updated_at();
create trigger erp_item_stages_touch before update on public.erp_item_stages
  for each row execute function public.erp_set_updated_at();
create trigger erp_materials_touch before update on public.erp_materials
  for each row execute function public.erp_set_updated_at();
create trigger erp_calendar_slots_touch before update on public.erp_calendar_slots
  for each row execute function public.erp_set_updated_at();

-- RLS: читают/пишут все авторизованные («любой в цехе» — решение discovery),
-- удаление — только admin/director (is_admin()).
alter table public.erp_departments enable row level security;
alter table public.erp_orders enable row level security;
alter table public.erp_order_items enable row level security;
alter table public.erp_item_stages enable row level security;
alter table public.erp_materials enable row level security;
alter table public.erp_calendar_slots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['erp_departments','erp_orders','erp_order_items',
                           'erp_item_stages','erp_materials','erp_calendar_slots']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      t || '_delete', t);
  end loop;
end $$;

-- Seed: цеха (коды = src/erp/data/departments.ts) + мощности из 8_Мощности
insert into public.erp_departments
  (code, name, type, sort_order, is_branding, capacity_per_day, target_load_per_day) values
  ('supply',       'Закупка',                 'supply',       10, false, null, null),
  ('logistics',    'Логистика',               'logistics',    20, false, null, null),
  ('experimental', 'Экспериментальный цех',   'experimental', 30, false, null, null),
  ('warehouse',    'Склад',                   'warehouse',    40, false, null, null),
  ('cutting',      'Закройный цех',           'cutting',      50, false, 800, 650),
  ('silkscreen',   'Цех шелкографии',         'silkscreen',   60, true,  2000, 1700),
  ('dtf',          'Цех ДТФ',                 'dtf',          61, true,  500, 400),
  ('embroidery',   'Цех вышивки',             'embroidery',   62, true,  300, 250),
  ('sewing',       'Швейный цех',             'sewing',       70, false, 500, 400),
  ('vto',          'ВТО цех',                 'vto',          80, false, null, null),
  ('warehouse_fg', 'Склад готовой продукции', 'warehouse_fg', 90, false, null, null);
