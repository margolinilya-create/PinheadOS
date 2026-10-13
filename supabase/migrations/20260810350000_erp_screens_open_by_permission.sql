-- Разделы «Операции» открываются ПРАВОМ, а не типом учётной записи.
--
-- ЧТО БЫЛО. Экраны «Закупка», «Склад», «Подряд» и «Эксперим. цех» были закрыты
-- проверкой `['admin','director'].includes(user.role)` — ролью УЧЁТНОЙ ЗАПИСИ,
-- причём двумя независимыми списками: в маршруте (`ErpApp.jsx`) и в меню
-- (`Sidebar.jsx`).
--
-- Права, заведённые 10.08 под конкретных людей, оказались НЕДОСТИЖИМЫ:
-- кладовщик получил `warehouse.manage`, но не видел пункта «Склад» и не мог
-- открыть адрес; технолог — то же с образцами; закупщик — с закупкой. Матрица
-- говорила «можно», интерфейс — «раздела нет». Это то же декоративное право,
-- только этажом выше: не «право ничего не выключает», а «до экрана не дойти».
--
-- ПРАВИЛО, которое теперь действует (`erp/utils/screenAccess.ts`, один список
-- на маршрут и на меню): раздел видит тот, кто может там РАБОТАТЬ, плюс
-- менеджер заказа — ему нужно видеть, где стоит его заказ. Экраны это умеют:
-- без права они остаются на чтение.
--
--   /purchasing     — material.receive  либо order.manage
--   /warehouse      — warehouse.manage  либо order.manage
--   /subcontracting — order.manage
--   /experimental   — experimental.manage либо order.manage
--
-- Админка остаётся за учётной записью: это настройка системы, а не работа.
--
-- ЧТО МЕНЯЕТ ЭТА МИГРАЦИЯ. Сервер закупки приводится к той же аудитории, что
-- и экран. Раньше он стоял на `erp_is_member()` — то есть был открыт ШИРЕ
-- экрана, которого эти люди даже не видели. Обоснование той правки («экран
-- не гейтится») опиралось на гейт внутри экрана и пропускало гейт маршрута.
--
-- Записанное решение «закупочные поля правом не гейтятся» сохраняется: оно
-- про ПОЛЯ внутри раздела (артикул, срок, поставщик, ответственный), а не про
-- доступ в сам раздел. Внутри экрана поля по-прежнему свободны.

drop policy if exists erp_procurement_tasks_insert on public.erp_procurement_tasks;
create policy erp_procurement_tasks_insert on public.erp_procurement_tasks
  for insert to authenticated
  with check (public.erp_has_permission('material.receive')
              or public.erp_has_permission('order.manage'));

drop policy if exists erp_procurement_tasks_update on public.erp_procurement_tasks;
create policy erp_procurement_tasks_update on public.erp_procurement_tasks
  for update to authenticated
  using (public.erp_has_permission('material.receive')
         or public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('material.receive')
              or public.erp_has_permission('order.manage'));

drop policy if exists erp_material_suppliers_insert on public.erp_material_suppliers;
create policy erp_material_suppliers_insert on public.erp_material_suppliers
  for insert to authenticated
  with check (public.erp_has_permission('material.receive')
              or public.erp_has_permission('order.manage'));

drop policy if exists erp_material_suppliers_update on public.erp_material_suppliers;
create policy erp_material_suppliers_update on public.erp_material_suppliers
  for update to authenticated
  using (public.erp_has_permission('material.receive')
         or public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('material.receive')
              or public.erp_has_permission('order.manage'));

-- Удаление варианта поставщика стояло на роли профиля: правку содержимого
-- строки открыли, а удаление — нет. Приводим к тому же правилу.
drop policy if exists erp_material_suppliers_delete on public.erp_material_suppliers;
create policy erp_material_suppliers_delete on public.erp_material_suppliers
  for delete to authenticated
  using (public.erp_has_permission('material.receive')
         or public.erp_has_permission('order.manage'));

comment on table public.erp_procurement_tasks is
  'Задачи закупки. Доступ — та же аудитория, что у экрана «Закупка» (material.receive либо order.manage). Отдельные ПОЛЯ внутри экрана правом по-прежнему не гейтятся: записанное решение относится к полям, а не к доступу в раздел.';
