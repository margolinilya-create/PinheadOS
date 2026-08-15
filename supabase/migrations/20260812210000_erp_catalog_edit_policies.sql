-- ВОССТАНОВЛЕНО 15.08.2026 из боевой базы (`supabase_migrations.schema_migrations`,
-- версия 20260813061338, имя `erp_catalog_edit_policies`).
--
-- Миграция применена на проде 13.08, её файл в git не попал. Тело ниже —
-- дословно то, что исполнила база.
--
-- Что делает: переводит запись в `erp_dictionaries` и `erp_departments`
-- с `is_admin()` на право матрицы `catalog.edit`. До неё вкладки «Справочники»
-- и «Цеха» открывались правом `catalog.edit` (директор и руководитель
-- производства), а политики спрашивали `is_admin()` = только `profiles.role
-- = 'admin'`. Право было декоративным ровно в том смысле, который проект
-- уже разбирал: правка молча не сохранялась — RLS запрещает через `USING`,
-- то есть отдаёт «0 строк», а не 42501, и клиент показывал успех.

-- Справочники и цеха: политика спрашивает ПРАВО МАТРИЦЫ, а не роль профиля.
-- Обоснование целиком — supabase/migrations/20260812210000_erp_catalog_edit_policies.sql
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
