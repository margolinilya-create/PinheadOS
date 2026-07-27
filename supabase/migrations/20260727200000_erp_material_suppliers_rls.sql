-- Аудит по скилам, находка 4: RLS вариантов поставщиков была открыта нараспашку.
--
-- Волна 3 завела erp_material_suppliers с политиками `using (true)` на INSERT/UPDATE/
-- DELETE — скопировано «по образцу», но таблица хранит закупочные цены и условия
-- поставщиков. Любой авторизованный сотрудник мог подменить цену или удалить вариант.
-- Advisor rls_policy_always_true отмечал все три политики.
--
-- Приводим к модели закупки (20260720130000_erp_procurement_rls_roles.sql):
--   select — erp_is_member(): выбранный поставщик виден складу и цеху, как и сам материал;
--   insert/update/delete — erp_is_manager(): варианты ведёт закупка.
-- Это ровно тот доступ, что уже есть у экрана /purchasing (admin/director в роутинге),
-- поэтому рабочий сценарий не ломается — сужается только то, чего в UI и так не было.

drop policy if exists erp_material_suppliers_read on public.erp_material_suppliers;
create policy erp_material_suppliers_read on public.erp_material_suppliers
  for select to authenticated using (public.erp_is_member());

drop policy if exists erp_material_suppliers_insert on public.erp_material_suppliers;
create policy erp_material_suppliers_insert on public.erp_material_suppliers
  for insert to authenticated with check (public.erp_is_manager());

drop policy if exists erp_material_suppliers_update on public.erp_material_suppliers;
create policy erp_material_suppliers_update on public.erp_material_suppliers
  for update to authenticated
  using (public.erp_is_manager()) with check (public.erp_is_manager());

drop policy if exists erp_material_suppliers_delete on public.erp_material_suppliers;
create policy erp_material_suppliers_delete on public.erp_material_suppliers
  for delete to authenticated using (public.erp_is_manager());
