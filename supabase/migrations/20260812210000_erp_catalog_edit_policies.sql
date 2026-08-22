-- Справочники и цеха: политика спрашивает ПРАВО МАТРИЦЫ, а не роль профиля.
--
-- ВОССТАНОВЛЕНО 22.08 из журнала миграций боевой базы (версия 20260813061338).
-- Файл был применён к проду 13.08 мимо репозитория; текст взят дословно из
-- `supabase_migrations.schema_migrations`. К базе применять не нужно — она уже
-- в этом состоянии.
--
-- Почему. Вкладки «Справочники» и «Цеха» в админке гейтятся правом матрицы
-- `catalog.edit`, а RLS обеих таблиц стояла на `is_admin()` — то есть на роли
-- ПРОФИЛЯ. Право есть и у руководителя производства (`production_head`),
-- админом он не является: кнопка в интерфейсе была, а правка молча не
-- сохранялась. Это ровно тот запрещённый в проекте исход «кнопка есть,
-- действие падает», только в худшем виде — RLS на UPDATE запрещает через
-- `USING`, то есть отдаёт «0 строк», а не ошибку, и человек не видит даже отказа.
--
-- Через `erp_departments` правятся материальный гейт (`gate_material_kinds`)
-- и схема отчёта участка (`result_fields`) — это решения производства,
-- и держать их за ролью учётной записи неправильно по существу, а не только
-- по совпадению гейтов.

drop policy if exists erp_dictionaries_insert on public.erp_dictionaries;
create policy erp_dictionaries_insert on public.erp_dictionaries
  for insert to authenticated
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_dictionaries_update on public.erp_dictionaries;
create policy erp_dictionaries_update on public.erp_dictionaries
  for update to authenticated
  using (public.erp_has_permission('catalog.edit'))
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_dictionaries_delete on public.erp_dictionaries;
create policy erp_dictionaries_delete on public.erp_dictionaries
  for delete to authenticated
  using (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_departments_insert on public.erp_departments;
create policy erp_departments_insert on public.erp_departments
  for insert to authenticated
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_departments_update on public.erp_departments;
create policy erp_departments_update on public.erp_departments
  for update to authenticated
  using (public.erp_has_permission('catalog.edit'))
  with check (public.erp_has_permission('catalog.edit'));

drop policy if exists erp_departments_delete on public.erp_departments;
create policy erp_departments_delete on public.erp_departments
  for delete to authenticated
  using (public.erp_has_permission('catalog.edit'));

comment on table public.erp_dictionaries is
  'Справочники админки. Запись — под правом матрицы catalog.edit (не is_admin()): им же гейтится вкладка в интерфейсе, иначе право декоративно, а правка молча не сохраняется.';

comment on table public.erp_departments is
  'Участки производства. Запись — под правом матрицы catalog.edit: через эту таблицу правятся материальный гейт (gate_material_kinds) и схема отчёта участка (result_fields), это решения производства.';
