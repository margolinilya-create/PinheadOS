-- Онбординг: новый signup получает PENDING-профиль (approved=false, active=true).
-- Раньше client-upsert профиля падал по RLS → у регистранта не было профиля вовсе.
-- Теперь: профиль создаётся серверным триггером (обходит RLS как SECURITY DEFINER),
-- но erp_is_member()=false до одобрения → доступа к данным нет; админ видит и одобряет.
-- Применено к pinhead-os-v2 (glhwbktsokphgksdvcxj) через MCP apply_migration.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, approved, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), new.email),
    'manager',
    false,   -- НЕ подтверждён: erp_is_member()=false, доступа нет до одобрения админом
    true
  )
  on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
