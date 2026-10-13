-- Четыре политики чтения стояли `USING (true)` — читал любой авторизованный.
--
-- Проблема. Регистрация в системе открыта: `AuthScreen` → `signUp`, а триггер
-- `handle_new_user` заводит профиль с `approved=false`. Такой человек не член ERP
-- (`erp_is_member()` = false), и всё остальное для него закрыто — но эти четыре
-- таблицы отдавались ему целиком:
--
--   erp_tz_documents      file_path, file_name, order_id, note  ← самое дорогое
--   erp_tz_assignments    какому цеху какое ТЗ назначено
--   erp_dictionaries      справочники организации
--   erp_role_permissions  матрица прав — карта того, кто что может
--
-- Чем это грозило. `erp_tz_documents.file_path` ведёт в бакет `erp-attachments`,
-- который public-read: имея путь, ТЗ-PDF скачивается без авторизации — с раскладкой,
-- тиражом, заказчиком и макетами. Достаточно зарегистрироваться и не быть одобренным.
-- Матрица прав и справочники — меньший риск (разведка оргструктуры), но тот же дефект.
--
-- Проверено: записи (INSERT/UPDATE/DELETE) во всех четырёх таблицах уже гейтятся
-- корректно — `is_admin()` либо `erp_can_manage_tz()`. Дырой было только чтение.
--
-- Стиль соответствует остальным политикам раздела (`erp_departments_read` и др.):
-- политика на команду, предикат — `erp_is_member()`.

drop policy if exists "erp_tz_documents_read" on public.erp_tz_documents;
create policy "erp_tz_documents_read" on public.erp_tz_documents
  for select to authenticated using (erp_is_member());

drop policy if exists "erp_tz_assignments_read" on public.erp_tz_assignments;
create policy "erp_tz_assignments_read" on public.erp_tz_assignments
  for select to authenticated using (erp_is_member());

drop policy if exists "erp_dictionaries_read" on public.erp_dictionaries;
create policy "erp_dictionaries_read" on public.erp_dictionaries
  for select to authenticated using (erp_is_member());

-- Матрица прав грузится при старте раздела: erp_is_member() здесь достаточно —
-- неодобренному она всё равно не нужна, а у члена ERP она читается как прежде.
drop policy if exists "erp_role_permissions_read" on public.erp_role_permissions;
create policy "erp_role_permissions_read" on public.erp_role_permissions
  for select to authenticated using (erp_is_member());
