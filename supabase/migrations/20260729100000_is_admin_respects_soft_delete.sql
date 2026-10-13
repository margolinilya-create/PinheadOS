-- is_admin() и erp_can_manage_tz() обязаны уважать soft-delete.
--
-- Проблема. Обе функции проверяли ТОЛЬКО `role`, не глядя на `active`/`approved`:
--
--   select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
--
-- Для сравнения, ERP-контур сделан правильно — `erp_is_member()` и `erp_is_manager()`
-- проверяют оба флага. То есть производство было закрыто, а весь Order Studio нет:
-- через is_admin() гейтятся политики `profiles_*`, `app_config_*`, `catalog_config_*`,
-- `erp_departments_*`, `erp_dictionaries_*`, `erp_role_permissions_*` и удаление
-- вложений в Storage.
--
-- Чем это грозило. Документированный способ увольнения — soft-delete `active=false`
-- (CLAUDE.md: «Удаление пользователя: soft-delete, не hard delete») — не трогает
-- `auth.users`, поэтому refresh-токен уволенного продолжает выдавать валидный JWT.
-- С ним бывший сотрудник правил цены и каталоги, читал и удалял заказы Order Studio,
-- а `insert into profiles (..., role='admin', approved=true, active=true)` проходил
-- политикой `profiles_insert` — то есть он заводил себе новый рабочий профиль
-- и возвращал полный доступ, включая ERP. Персистентный бэкдор после увольнения.
--
-- Проверено перед применением: оба существующих профиля active+approved, поэтому
-- ужесточение никого не отрезает.
--
-- Чего эта миграция НЕ делает: не отзывает уже выданные refresh-токены. Отключение
-- пользователя должно сопровождаться `auth.admin.signOut(user_id)`, иначе живой токен
-- переживёт любую правку RLS — это отдельная правка в админке.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active is true
      and approved is true
  );
$$;

-- Та же дыра: право управлять ТЗ переживало отключение пользователя.
create or replace function public.erp_can_manage_tz()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'director', 'rop', 'manager')
      and active is true
      and approved is true
  );
$$;
