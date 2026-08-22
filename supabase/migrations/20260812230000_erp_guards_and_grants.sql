-- Волна 4: таблицы без стража, лишние гранты, мёртвая функция, политика бакета.
--
-- ВОССТАНОВЛЕНО 22.08 из журнала миграций боевой базы (версия 20260813061353).
-- Файл был применён к проду 13.08 мимо репозитория; текст взят дословно из
-- `supabase_migrations.schema_migrations`. К базе применять не нужно — она уже
-- в этом состоянии.
--
-- ⚠️ Из трёх потерянных миграций эта — единственная, которую НИЧТО не перекрыло
-- позже. Пока файла не было, репозиторий описывал систему, где
-- `erp_warehouse_ops_insert` и `erp_item_prints_*` стоят на `with check (true)`,
-- то есть любой вошедший пишет складские операции и нанесения по всей фабрике.
-- Реплей репозитория на чистое окружение (превью-ветка, восстановление
-- из бэкапа) воспроизводил бы именно её, а сторожевые тесты, читающие
-- ПОСЛЕДНЮЮ репозиторную миграцию (`latestDefining`), сверялись с этим
-- `true` и оставались зелёными. Сторож, подтверждающий отсутствие гейта
-- как норму, хуже отсутствующего.
--
-- Разбор по пунктам:
--   1. Складские операции и нанесения писались без права вовсе.
--   2. `erp_create_order` и `erp_default_queue_position` были исполнимы от PUBLIC:
--      `revoke … from anon` в одиночку не работает — право приходит от PUBLIC
--      (`=X/postgres` в ACL), и `anon` его наследует. Отзывать надо
--      `from public, anon` и следом явно выдавать `authenticated`, иначе
--      доступ теряют сами вызывающие.
--   3. `erp_can_manage_tz()` осталась от гейта ТЗ по `profiles.role`; её заменил
--      `erp_has_permission('tz.manage')`, а функция висела вызываемой через REST.
--   4. У бакета `sku-photos` не было SELECT-политики: публичная раздача идёт
--      мимо RLS, а клиентские `upsert`/`remove`/`list` — через неё.
--   5. `is_admin()` пересоздана в подлинном виде (soft-delete + approved).

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
