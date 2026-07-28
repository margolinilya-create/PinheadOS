-- Волна 2 «Админка», правки 11 и 12: редактируемые справочники + атрибуты цеха.
--
-- Правка 12 просит вынести библиотеки и константы в админку, «чтобы для их изменения
-- не требовалась доработка кода». Заводим одну таблицу на все простые справочники
-- (значение = код + подпись + порядок + активность), а не по таблице на каждый:
-- набор видов фиксирован UI-экраном, добавление нового вида — всё равно правка кода.
--
-- Что НЕ уехало в справочник: статусы этапов, заказов, материалов, склада и подряда.
-- Они зашиты в CHECK-констрейнты и стейт-машины (routes.ts, warehouse/subcontract
-- слайсы, триггер erp_warehouse_task_derive) — «переименовать» их из UI нельзя
-- без рассинхронизации с логикой. В админке они показаны списком только для чтения.

create table if not exists public.erp_dictionaries (
  id uuid primary key default gen_random_uuid(),
  -- block_reason  — причины блокировки этапа (быстрый выбор в «Проблема»)
  -- problem_type  — типы проблем/брака
  -- product_type  — типы изделий (подсказки при создании заказа)
  -- supplier      — поставщики материалов
  kind text not null check (kind in ('block_reason', 'problem_type', 'product_type', 'supplier')),
  code text not null,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  /** Доп. поля вида: для поставщика — контакт/комментарий и т.п. */
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, code)
);

create index if not exists erp_dictionaries_kind_idx
  on public.erp_dictionaries (kind, sort_order) where active;

drop trigger if exists erp_dictionaries_touch on public.erp_dictionaries;
create trigger erp_dictionaries_touch before update on public.erp_dictionaries
  for each row execute function public.erp_set_updated_at();

alter table public.erp_dictionaries enable row level security;

-- Читают все авторизованные (значения нужны цеху при работе), правит руководство.
drop policy if exists erp_dictionaries_read on public.erp_dictionaries;
create policy erp_dictionaries_read on public.erp_dictionaries
  for select to authenticated using (true);
drop policy if exists erp_dictionaries_insert on public.erp_dictionaries;
create policy erp_dictionaries_insert on public.erp_dictionaries
  for insert to authenticated with check (public.is_admin());
drop policy if exists erp_dictionaries_update on public.erp_dictionaries;
create policy erp_dictionaries_update on public.erp_dictionaries
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists erp_dictionaries_delete on public.erp_dictionaries;
create policy erp_dictionaries_delete on public.erp_dictionaries
  for delete to authenticated using (public.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.erp_dictionaries;
exception
  when duplicate_object then null;
end $$;

-- Стартовые значения: цех должен получить рабочий быстрый выбор сразу, а не пустой список.
insert into public.erp_dictionaries (kind, code, name, sort_order) values
  ('block_reason', 'no_material',    'Нет материала',                   10),
  ('block_reason', 'prev_defect',    'Брак предыдущего этапа',          20),
  ('block_reason', 'equipment',      'Сломано оборудование',            30),
  ('block_reason', 'no_worker',      'Некому выполнять',                40),
  ('block_reason', 'client_approval','Ждём согласования с клиентом',    50),
  ('block_reason', 'no_tz',          'Нет макета или ТЗ',               60),
  ('problem_type', 'material_defect','Брак материала',                  10),
  ('problem_type', 'print_defect',   'Брак нанесения',                  20),
  ('problem_type', 'cut_error',      'Ошибка кроя',                     30),
  ('problem_type', 'shortage',       'Недостача количества',            40),
  ('problem_type', 'damage',         'Повреждение изделия',             50),
  ('problem_type', 'other',          'Прочее',                          60),
  ('product_type', 'tshirt',         'Футболка',                        10),
  ('product_type', 'longsleeve',     'Лонгслив',                        20),
  ('product_type', 'hoodie',         'Худи',                            30),
  ('product_type', 'sweatshirt',     'Свитшот',                         40),
  ('product_type', 'shirt',          'Рубашка',                         50),
  ('product_type', 'apron',          'Фартук',                          60),
  ('product_type', 'shopper',        'Шоппер',                          70),
  ('product_type', 'cap',            'Кепка',                           80)
on conflict (kind, code) do nothing;

-- Правка 11: руководитель закрепляется за цехом. Правка 12: нормативный срок этапа.
alter table public.erp_departments
  add column if not exists head_employee_id uuid references public.erp_employees(id) on delete set null,
  add column if not exists norm_days int;

comment on column public.erp_departments.head_employee_id is
  'Руководитель цеха (правка 11): закрепляется в админке, показывается в очереди участка';
comment on column public.erp_departments.norm_days is
  'Нормативный срок этапа в днях (правка 12): подставляется планом завершения при «Взять в работу»';

-- Справочник цехов правит только руководство: до этого политики допускали запись
-- любым авторизованным, но писал в них только seed.
drop policy if exists erp_departments_insert on public.erp_departments;
create policy erp_departments_insert on public.erp_departments
  for insert to authenticated with check (public.is_admin());
drop policy if exists erp_departments_update on public.erp_departments;
create policy erp_departments_update on public.erp_departments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
