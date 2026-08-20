-- DTG: хвосты, которых не хватило (правки заказчика 20.08).
--
-- ЧТО ВЫЯСНИЛОСЬ ПРИ СВЕРКЕ С БАЗОЙ. Участок DTG уже заведён — миграцией
-- 20260818203338, применённой к проду 18.08 (в репозиторий она не попала,
-- восстановлена рядом). Там же метод нанесения в CHECK `erp_item_prints`,
-- роль `dtg` в CHECK `erp_employees` и её строки в матрице прав, скопированные
-- у `dtf`.
--
-- Не закрыты два места из тех, где перечисление обязано быть расширено:
--   · CHECK `erp_invites.employee_role` — без него позвать человека НА ЭТОТ
--     УЧАСТОК нельзя вовсе: приглашение падает 23514 в момент выписки ссылки,
--     то есть роль в системе есть, а нанять на неё некого;
--   · библиотека операций маршрута — DTG можно отдать наружу так же, как ДТФ.
--
-- Клиентская половина (BrandingMethod, EmployeeRole, справочник цехов,
-- BRANDING_DEPT, DEFAULT_PERMISSIONS, колонка матрицы в админке) правится
-- тем же коммитом: на 20.08 её не было ни в одном месте, хотя сервер
-- про DTG знал уже два дня.

-- ── Роль в приглашении ───────────────────────────────────────────────────────
--
-- Список взят из ДЕЙСТВУЮЩЕГО CHECK `erp_employees.role` (20260818203338),
-- а не из миграции приглашений: она старше на четыре дня и про `dtg` не знает.
alter table public.erp_invites drop constraint if exists erp_invites_employee_role_check;
alter table public.erp_invites add constraint erp_invites_employee_role_check
  check (employee_role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head',
    'technologist', 'dtf', 'dtg', 'silkscreen', 'embroidery', 'pending'));

-- ── Операция маршрута ────────────────────────────────────────────────────────
insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'route_operation', 'dtg', 'DTG', 45, true
where not exists (
  select 1 from public.erp_dictionaries d
   where d.kind = 'route_operation' and d.code = 'dtg');
