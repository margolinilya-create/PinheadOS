-- ВОССТАНОВЛЕНО 15.08.2026 из боевой базы (`supabase_migrations.schema_migrations`,
-- версия 20260813061353, имя `erp_guards_and_grants`).
--
-- Миграция применена на проде 13.08, её файл в git не попал. Тело ниже —
-- дословно то, что исполнила база.
--
-- Что делает (волна 4 разбора прав):
--   * `erp_item_prints` — INSERT/UPDATE/DELETE переведены с `erp_is_member()`
--     на `order.manage`. До неё любой участник ERP одним PATCH менял зону,
--     технику, размер и цвет нанесения в чужом заказе — то есть само
--     техзадание, по которому работает цех. Клиент в эту таблицу не пишет
--     вовсе (создание идёт транзакцией `erp_create_order`), то есть открытая
--     запись была поверхностью с нулевым легитимным использованием;
--   * `erp_warehouse_ops` — INSERT под `warehouse.manage` либо `order.manage`;
--   * гранты `erp_create_order` и `erp_default_queue_position` отобраны
--     у `public`/`anon` и явно выданы `authenticated` (отзыв только у `anon`
--     не работает: право приходит от PUBLIC и наследуется);
--   * дропнута `erp_can_manage_tz()` — вторая, устаревшая реализация гейта ТЗ
--     (знала только `profiles.role` и не знала `erp_employees.role`).
--     Её последние потребители — политики `erp_tz_assignments`, а эта таблица
--     дропнута 12.08;
--   * бакету `sku-photos` добавлена SELECT-политика: у публичного бакета
--     раздача идёт мимо RLS, но клиентские `upsert`/`list` ходят через неё;
--   * `is_admin()` пересоздана с проверкой `active`/`approved` (мягко
--     отключённый администратор перестаёт быть администратором).

-- Волна 4: таблицы без стража, лишние гранты, мёртвая функция, политика бакета.
-- Обоснование целиком — supabase/migrations/20260812230000_erp_guards_and_grants.sql

drop policy if exists erp_warehouse_ops_insert on public.erp_warehouse_ops;
create policy erp_warehouse_ops_insert on public.erp_warehouse_ops
  for insert to authenticated
  with check (
    public.erp_has_permission('warehouse.manage')
    or public.erp_has_permission('order.manage')
  );

drop policy if exists erp_item_prints_insert on public.erp_item_prints;
create policy erp_item_prints_insert on public.erp_item_prints
  for insert to authenticated
  with check (public.erp_has_permission('order.manage'));

drop policy if exists erp_item_prints_update on public.erp_item_prints;
create policy erp_item_prints_update on public.erp_item_prints
  for update to authenticated
  using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));

drop policy if exists erp_item_prints_delete on public.erp_item_prints;
create policy erp_item_prints_delete on public.erp_item_prints
  for delete to authenticated
  using (public.erp_has_permission('order.manage'));

revoke execute on function public.erp_create_order(jsonb) from public, anon;
grant  execute on function public.erp_create_order(jsonb) to authenticated;

revoke execute on function public.erp_default_queue_position(date) from public, anon;
grant  execute on function public.erp_default_queue_position(date) to authenticated;

drop function if exists public.erp_can_manage_tz();

drop policy if exists sku_photos_read on storage.objects;
create policy sku_photos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sku-photos');

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and active is true
      and approved is true
  );
$$;
