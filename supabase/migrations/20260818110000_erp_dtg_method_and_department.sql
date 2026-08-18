-- DTG — метод нанесения и свой участок (решение заказчика).
--
-- ЗАЧЕМ. В визарде ТЗ техника DTG (прямая печать по готовому изделию) есть
-- с самого начала, а в производственной модели такого метода не было вовсе:
-- вышивка, шелкография, ДТФ, термоперенос и «прочее». Пока ТЗ и производство
-- жили порознь, расхождение никого не задевало; с мостом «ТЗ → производство»
-- позиция с DTG уехала бы в «прочее», у которого цеха НЕТ (`BRANDING_DEPT`
-- отдаёт null), — то есть прошла бы маршрут вообще без этапа печати. Никто
-- не увидел бы задания, и обнаружилось бы это на сдаче.
--
-- МЕТОД ПЕРЕЧИСЛЕН В ШЕСТИ МЕСТАХ, и пропуск любого не роняет ничего — он даёт
-- молча неработающую половину (то же, что было с единицами измерения
-- в справочниках). Здесь серверные три, клиентские три — в том же коммите:
--   1. этот CHECK у `erp_item_prints.method`;
--   2. строка участка в `erp_departments` (+ `is_production`, `result_fields`);
--   3. цеховая роль `dtg` в CHECK `erp_employees.role` и в матрице прав;
--   4. `BrandingMethod` и подпись метода;
--   5. `BRANDING_DEPT` (метод → цех) в `utils/routes.ts`;
--   6. справочник цехов клиента (`data/departments.ts`).
-- Сторож — `erp/utils/brandingMethods.test.ts`.

-- ── 1. Метод нанесения ───────────────────────────────────────────────────────
alter table public.erp_item_prints
  drop constraint if exists erp_item_prints_method_check;
alter table public.erp_item_prints
  add constraint erp_item_prints_method_check
  check (method in ('embroidery', 'silkscreen', 'dtf', 'dtg', 'heat_transfer', 'other'));

-- ── 2. Участок ───────────────────────────────────────────────────────────────
--
-- Отдельный участок, а не «тот же цех, что ДТФ» (как у термопереноса): DTG
-- печатает по готовому изделию другой машиной, у него своя очередь и своя
-- загрузка. `is_production` — иначе цех не появится ни в меню, ни в канбане,
-- ни в очередях, ни в гейте ТЗ: все общие поверхности читают этот признак
-- из данных.
insert into public.erp_departments (code, name, type, sort_order, is_branding, is_production)
select 'dtg', 'Цех DTG', 'dtg', 63, true, true
where not exists (select 1 from public.erp_departments where code = 'dtg');

-- Отдельным UPDATE — не ради вставки (она уже проставила признак), а ради базы,
-- где строка цеха могла появиться раньше и без него: `insert … where not exists`
-- в такой базе не сделает ничего, и участок остался бы невидимым для всех
-- поверхностей, читающих `is_production`.
update public.erp_departments set is_production = true where code = 'dtg';

-- Схема отчёта участка — из данных (правило проекта), по образцу ДТФ.
-- Пусто означало бы «отчёт не требуется», и цех не смог бы сдать работу
-- теми же полями, что соседние участки нанесения.
update public.erp_departments
   set result_fields = (select result_fields from public.erp_departments where code = 'dtf')
 where code = 'dtg' and result_fields is null;

-- ── 3. Цеховая роль ──────────────────────────────────────────────────────────
--
-- По правам участки нанесения не различаются между собой (различает их
-- привязка сотрудника к цеху), поэтому права DTG — КОПИЯ прав ДТФ, а не свой
-- список: список пришлось бы дополнять при каждом новом праве, и роль тихо
-- отставала бы от соседних.
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
