-- Участок DTG (правки заказчика 20.08).
--
-- Документ называет DTG дважды: среди основных этапов маршрута («Закрой,
-- Шелкография, DTF, Вышивка, DTG, Швейка, ВТО, Подряд, Склад») и среди
-- представлений экспериментального цеха («Шелкография · DTF · Вышивка · DTG»).
-- В ERP такого участка не было ВООБЩЕ: справочник цехов знал шелкографию,
-- ДТФ и вышивку, а DTG жил только в прайсе Order Studio — то есть цена
-- за прямую печать считалась, а производить её было негде.
--
-- ПЕРЕЧИСЛЕНИЕ РАСШИРЯЕТСЯ ВО ВСЕХ МЕСТАХ СРАЗУ. Правило проекта записано
-- кровью: `mixed` завели у `erp_subcontracting`, забыли в `erp_order_items` —
-- и заказ со смешанными материалами не создавался вовсе (23514 на вставке
-- позиции). Здесь мест пять:
--   1. сам цех в `erp_departments`;
--   2. CHECK метода нанесения `erp_item_prints.method` — иначе позиция с DTG
--      не вставится, причём уже после создания заказа-родителя;
--   3. CHECK роли сотрудника `erp_employees.role` — участок это ещё и роль
--      команды (так заведены dtf/silkscreen/embroidery правками 10.08);
--   4. CHECK роли в приглашении `erp_invites.employee_role` — иначе позвать
--      человека на этот участок нельзя;
--   5. строки матрицы `erp_role_permissions` для новой роли — роль без строк
--      даёт ПУСТУЮ КОЛОНКУ в админке, а не «права по умолчанию».
-- Клиентская половина (BrandingMethod, EmployeeRole, DEPARTMENTS, BRANDING_DEPT,
-- DEFAULT_PERMISSIONS) правится тем же коммитом.

-- ── 1. Цех ───────────────────────────────────────────────────────────────────
--
-- `is_production` — у участка есть очередь, он виден в канбане и требует ТЗ.
-- `is_branding` — параллельная ветка нанесения в маршруте.
-- `sort_order` 63 — сразу за вышивкой (60 шелкография, 61 ДТФ, 62 вышивка).
insert into public.erp_departments (code, name, type, sort_order, is_branding, active, is_production)
values ('dtg', 'Цех DTG', 'dtg', 63, true, true, true)
on conflict (code) do nothing;

-- ── 2. Метод нанесения позиции ───────────────────────────────────────────────
alter table public.erp_item_prints
  drop constraint if exists erp_item_prints_method_check;
alter table public.erp_item_prints
  add constraint erp_item_prints_method_check
  check (method in ('embroidery', 'silkscreen', 'dtf', 'dtg', 'heat_transfer', 'other'));

-- ── 3. Роль сотрудника ───────────────────────────────────────────────────────
alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head',
    'technologist', 'dtf', 'silkscreen', 'embroidery', 'dtg'
  ));

-- ── 4. Роль в приглашении ────────────────────────────────────────────────────
alter table public.erp_invites drop constraint if exists erp_invites_employee_role_check;
alter table public.erp_invites add constraint erp_invites_employee_role_check
  check (employee_role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'dtg', 'pending'));

-- ── 5. Права новой роли ──────────────────────────────────────────────────────
--
-- Разрешено ровно то же, что у dtf/silkscreen/embroidery (20260810130000):
-- участки нанесения по правам равны сотруднику цеха, различает их привязка
-- к цеху. Строки заводятся на ВСЕ права, а не только на разрешённые: колонка
-- матрицы в админке строится по строкам, и отсутствующее право там не
-- «выключено», а невидимо.
--
-- Список прав берётся ИЗ САМОЙ ТАБЛИЦЫ, а не перечисляется здесь: правило
-- «перечисление по именам не переживает следующего имени» уже стоило проекту
-- висящего предупреждения адвизора (20260812160000). Право, заведённое после
-- этой миграции, попадёт новой роли своим сидом — как и всем остальным.
insert into public.erp_role_permissions (role, permission, allowed)
select 'dtg', p.permission, p.permission = any (array[
  'stage.take', 'stage.progress', 'stage.complete', 'stage.block',
  'stage.defect', 'plan.fact'
])
from (select distinct permission from public.erp_role_permissions) as p
on conflict (role, permission) do nothing;

-- ── 6. Операция маршрута ─────────────────────────────────────────────────────
--
-- Библиотека подрядных операций: DTG можно отдать наружу так же, как ДТФ.
insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'route_operation', 'dtg', 'DTG', 45, true
where not exists (
  select 1 from public.erp_dictionaries d
   where d.kind = 'route_operation' and d.code = 'dtg');
