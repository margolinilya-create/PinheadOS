-- DTG убран из ERP (правки заказчика 07.09, п. 17).
--
-- «Полностью убрать DTG из ERP: удалить раздел из меню, убрать DTG из цехов,
-- этапов и маршрутов производства. В заказах этап DTG не создавать».
--
-- ЧТО ЕСТЬ НА БОЕВОЙ БАЗЕ (проверено до правки): участок активен, на него
-- ссылаются ДВА ЗАКРЫТЫХ этапа тестовых заказов, есть ОДНО нанесение
-- `method='dtg'` и ОДНА задача разработки `task_type='dtg'`; сотрудников
-- с ролью `dtg` и приглашений на неё — ноль.
--
-- ОТСЮДА ГРАНИЦА ПРАВКИ. Снимается всё, что ВЫБИРАЕТСЯ заново; остаётся всё,
-- что уже заведено и должно читаться:
--   * цех ДЕАКТИВИРУЕТСЯ, а не удаляется — на него ссылаются два этапа,
--     и DELETE упёрся бы во внешний ключ. Тот же приём, что у ОТК 10.08;
--     из меню участок уходит сам (группа «Цеха» фильтрует по `active`);
--   * `erp_item_prints.method` CHECK НЕ ТРОГАЕМ: значение несёт заведённое
--     нанесение, а из выбора метод убран на клиенте
--     (`BRANDING_METHOD_CHOICES`) и этапа больше не создаёт
--     (`BRANDING_DEPT.dtg = null`);
--   * роль `dtg` снимается из обоих CHECK — носителей нет ни одного;
--   * строки матрицы прав роли удаляются: роли больше не существует;
--   * значение справочника операций ОТКЛЮЧАЕТСЯ (`active = false`), а не
--     удаляется — правило раздела: «значения отключаются, а не удаляются».

update public.erp_departments set active = false where code = 'dtg';

comment on column public.erp_departments.active is
  'Участок в работе. false — снят (ОТК 10.08, DTG 07.09): из меню, очередей и конструктора маршрута уходит, история заказов остаётся читаемой.';

delete from public.erp_role_permissions where role = 'dtg';

alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees
  add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'pending'
  ));

alter table public.erp_invites drop constraint if exists erp_invites_employee_role_check;
alter table public.erp_invites
  add constraint erp_invites_employee_role_check
  check (employee_role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'pending'
  ));

update public.erp_dictionaries set active = false
 where kind = 'route_operation' and code = 'dtg';
