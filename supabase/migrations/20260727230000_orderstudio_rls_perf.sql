-- Аудит по скилам, находки 5 и 6: RLS Order Studio.
--
-- 1) `auth_rls_initplan` (13 политик): `auth.uid()`/`auth.role()` вызывались для КАЖДОЙ
--    строки. Обёртка `(select auth.uid())` превращает вызов в InitPlan — считается один
--    раз на запрос. Предикат не меняется.
-- 2) `multiple_permissive_policies` (40 предупреждений): на таблице жила политика
--    `FOR ALL` рядом с политикой `FOR SELECT`, и на каждый SELECT Postgres проверял обе.
--    Разводим по командам и объединяем перекрывающиеся предикаты через OR — множество
--    доступных строк то же самое, число проверок меньше.
-- 3) `TO public` → `TO authenticated`. Анониму все эти предикаты и так возвращали false
--    (`auth.uid()` = null), но политика на роль `anon` продолжала проверяться и удваивала
--    предупреждения. Доступ не меняется.
--
-- Предикаты вынесены НЕ в функции, а инлайном: тот же аудит отдельно отмечает, что
-- `SECURITY DEFINER`-функции в открытой схеме вызываемы через REST, и плодить их ради
-- краткости не стоит. Существующую `is_admin()` продолжаем использовать как есть.
--
-- ERP-таблицы (`erp_*`) уже написаны по командам — их не трогаем.

-- ── profiles ───────────────────────────────────────────────────────────────
-- Было: ALL is_admin() + SELECT (auth.uid() = id). На SELECT проверялись обе.
drop policy if exists admin_all_profiles on public.profiles;
drop policy if exists own_profile on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or public.is_admin());
create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- ── orders ─────────────────────────────────────────────────────────────────
-- Было: две политики FOR ALL (руководство видит всё; менеджер — свои). Обе
-- проверялись на каждую из 4 команд × 2 роли = 20 предупреждений. Смысл прежний:
-- «руководство ИЛИ свой заказ менеджера».
drop policy if exists admins_see_all on public.orders;
drop policy if exists manager_own_orders on public.orders;

create policy orders_select on public.orders
  for select to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = (select auth.uid())
               and p.role in ('admin', 'director', 'rop'))
    or ((select auth.uid()) = created_by
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role = 'manager'))
  );
create policy orders_insert on public.orders
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
             where p.id = (select auth.uid())
               and p.role in ('admin', 'director', 'rop'))
    or ((select auth.uid()) = created_by
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role = 'manager'))
  );
create policy orders_update on public.orders
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = (select auth.uid())
               and p.role in ('admin', 'director', 'rop'))
    or ((select auth.uid()) = created_by
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role = 'manager'))
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = (select auth.uid())
               and p.role in ('admin', 'director', 'rop'))
    or ((select auth.uid()) = created_by
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role = 'manager'))
  );
create policy orders_delete on public.orders
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = (select auth.uid())
               and p.role in ('admin', 'director', 'rop'))
    or ((select auth.uid()) = created_by
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role = 'manager'))
  );

-- ── order_comments ─────────────────────────────────────────────────────────
-- Дублей не было — только вынос auth.role() в InitPlan.
drop policy if exists "Авторизованные видят комментарии" on public.order_comments;
drop policy if exists "Авторизованные добавляют коммент" on public.order_comments;

create policy order_comments_select on public.order_comments
  for select to authenticated using ((select auth.role()) = 'authenticated');
create policy order_comments_insert on public.order_comments
  for insert to authenticated with check ((select auth.role()) = 'authenticated');

-- ── order_audit ────────────────────────────────────────────────────────────
-- Было: ALL false (запрет прямых записей) + SELECT для руководства.
-- Аудит пишется триггером (security definer), поэтому запрет записи сохраняем.
drop policy if exists audit_no_direct_writes on public.order_audit;
drop policy if exists audit_read_admins on public.order_audit;

create policy order_audit_select on public.order_audit
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and p.role in ('admin', 'director', 'rop')));
create policy order_audit_insert on public.order_audit
  for insert to authenticated with check (false);
create policy order_audit_update on public.order_audit
  for update to authenticated using (false) with check (false);
create policy order_audit_delete on public.order_audit
  for delete to authenticated using (false);

-- ── catalog_config ─────────────────────────────────────────────────────────
-- Было: SELECT с ценовым гардом + ALL для админов. Гард сохраняем дословно:
-- ключ 'prices' виден только руководству, остальные ключи — всем авторизованным.
drop policy if exists catalog_read_with_price_guard on public.catalog_config;
drop policy if exists catalog_write_admins on public.catalog_config;

create policy catalog_config_select on public.catalog_config
  for select to authenticated
  using (
    case
      when key = 'prices' then exists (select 1 from public.profiles p
                                        where p.id = (select auth.uid())
                                          and p.role in ('admin', 'director', 'rop'))
      else (select auth.role()) = 'authenticated'
    end
  );
create policy catalog_config_insert on public.catalog_config
  for insert to authenticated
  with check (exists (select 1 from public.profiles p
                       where p.id = (select auth.uid())
                         and p.role in ('admin', 'director')));
create policy catalog_config_update on public.catalog_config
  for update to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and p.role in ('admin', 'director')))
  with check (exists (select 1 from public.profiles p
                       where p.id = (select auth.uid())
                         and p.role in ('admin', 'director')));
create policy catalog_config_delete on public.catalog_config
  for delete to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and p.role in ('admin', 'director')));

-- ── app_config ─────────────────────────────────────────────────────────────
drop policy if exists app_config_read_authenticated on public.app_config;
drop policy if exists app_config_write_admins on public.app_config;

create policy app_config_select on public.app_config
  for select to authenticated using ((select auth.role()) = 'authenticated');
create policy app_config_insert on public.app_config
  for insert to authenticated
  with check (exists (select 1 from public.profiles p
                       where p.id = (select auth.uid())
                         and p.role in ('admin', 'director')));
create policy app_config_update on public.app_config
  for update to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and p.role in ('admin', 'director')))
  with check (exists (select 1 from public.profiles p
                       where p.id = (select auth.uid())
                         and p.role in ('admin', 'director')));
create policy app_config_delete on public.app_config
  for delete to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and p.role in ('admin', 'director')));

-- ── order_templates ────────────────────────────────────────────────────────
-- Дублей не было — только InitPlan.
drop policy if exists "Менеджер видит свои шаблоны" on public.order_templates;
drop policy if exists "Менеджер создаёт шаблоны" on public.order_templates;
drop policy if exists "Менеджер удаляет свои шаблоны" on public.order_templates;

create policy order_templates_select on public.order_templates
  for select to authenticated using ((select auth.uid()) = created_by);
create policy order_templates_insert on public.order_templates
  for insert to authenticated with check ((select auth.uid()) = created_by);
create policy order_templates_delete on public.order_templates
  for delete to authenticated using ((select auth.uid()) = created_by);
