-- ВОССТАНОВЛЕНО ИЗ БАЗЫ 20.08. Применена к проду 18.08.2026, в репозиторий
-- не попала. Текст из журнала миграций дословно, шапка добавлена при
-- восстановлении.
--
-- DTG — метод нанесения и свой участок.
-- Метод перечислен в шести местах; здесь серверные три.

alter table public.erp_item_prints
  drop constraint if exists erp_item_prints_method_check;
alter table public.erp_item_prints
  add constraint erp_item_prints_method_check
  check (method in ('embroidery', 'silkscreen', 'dtf', 'dtg', 'heat_transfer', 'other'));

insert into public.erp_departments (code, name, type, sort_order, is_branding, is_production)
select 'dtg', 'Цех DTG', 'dtg', 63, true, true
where not exists (select 1 from public.erp_departments where code = 'dtg');

update public.erp_departments set is_production = true where code = 'dtg';

update public.erp_departments
   set result_fields = (select result_fields from public.erp_departments where code = 'dtf')
 where code = 'dtg' and result_fields is null;

alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head',
    'technologist', 'dtf', 'dtg', 'silkscreen', 'embroidery', 'pending'
  ));

insert into public.erp_role_permissions (role, permission, allowed)
select 'dtg', permission, allowed
  from public.erp_role_permissions
 where role = 'dtf'
on conflict (role, permission) do nothing;
