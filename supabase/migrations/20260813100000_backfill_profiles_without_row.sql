-- ВОССТАНОВЛЕНО 15.08.2026 из боевой базы (`supabase_migrations.schema_migrations`,
-- версия 20260813105811, имя `backfill_profiles_without_row`).
--
-- Разовый бэкфилл, применённый на проде 13.08; файла в git не было.
-- Заводит строку `profiles` тем, у кого есть учётная запись в `auth.users`,
-- но профиль не создался (регистрации до того, как `handle_new_user` стал
-- обязательным путём). Такие люди входили в систему и упирались в пустой
-- экран: `fetchProfile` возвращал `null`, а без строки профиля не работает
-- ни `is_admin()`, ни `erp_is_member()`.
--
-- Роль намеренно `manager` и `approved = false`: доступ выдаёт админ явным
-- одобрением, а не бэкфилл. Идемпотентен (`on conflict do nothing`).

insert into public.profiles (id, email, name, role, approved, active)
select
  u.id,
  u.email,
  coalesce(nullif(u.raw_user_meta_data->>'name', ''), u.email),
  'manager',
  false,
  true
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
