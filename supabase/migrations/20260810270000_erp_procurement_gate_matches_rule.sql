-- Закупка: сервер приводится к тому же правилу, что интерфейс.
--
-- ЧТО БЫЛО. `erp_procurement_tasks` INSERT разрешён любому участнику, а UPDATE
-- стоял на `erp_is_manager()` — то есть на `profiles.role in ('admin','director')`.
-- Тот же случай, что у подряда (20260810260000) и у прежней `erp_can_manage_tz()`:
-- функция не знает ни про `erp_employees.role`, ни про матрицу прав.
--
-- Последствие адресное: ЗАКУПЩИК — роль, заведённая ровно для этой работы, —
-- получал 42501 на каждой правке задачи закупки. Экран закупки при этом
-- не гейтится вовсе (ни `useErpAccess`, ни `can()`), поэтому человек видел
-- полный набор полей и упирался в отказ на сохранении. То же у вариантов
-- поставщика (`erp_material_suppliers`).
--
-- ПОЧЕМУ ИМЕННО `erp_is_member()`, а не право из матрицы. Правило проекта
-- записано дословно: «Закупочные поля (артикул, срок, поставщик, ответственный)
-- страж не трогает — их правит снабжение, и правом они не гейтятся ни
-- в интерфейсе, ни на сервере». Приёмка материала — другое дело, она снимает
-- материальный гейт цеха и уже стоит под `material.receive`
-- (`erp_material_guard` + политики `erp_material_receipts`). Разделение
-- сохраняется: РЕШЕНИЕ о приёмке гейтится, ВЕДЕНИЕ закупки — нет.
--
-- Это выравнивание, а не расширение доступа: INSERT в ту же таблицу уже стоял
-- на `erp_is_member()`, и создать задачу мог любой участник. Запрет на UPDATE
-- при разрешённом INSERT не защищал ничего — он лишь мешал доводить начатое.

drop policy if exists erp_procurement_tasks_update on public.erp_procurement_tasks;
create policy erp_procurement_tasks_update on public.erp_procurement_tasks
  for update to authenticated
  using (public.erp_is_member())
  with check (public.erp_is_member());

drop policy if exists erp_material_suppliers_insert on public.erp_material_suppliers;
create policy erp_material_suppliers_insert on public.erp_material_suppliers
  for insert to authenticated
  with check (public.erp_is_member());

drop policy if exists erp_material_suppliers_update on public.erp_material_suppliers;
create policy erp_material_suppliers_update on public.erp_material_suppliers
  for update to authenticated
  using (public.erp_is_member())
  with check (public.erp_is_member());

comment on table public.erp_procurement_tasks is
  'Задачи закупки. Ведение — любой участник ERP (закупочные поля правом не гейтятся ни в интерфейсе, ни на сервере). Приёмка материала — отдельно, под material.receive.';
