-- Новый сотрудник заводится БЕЗ ПРАВ, а не менеджером.
--
-- Было: `handle_new_user` создавал профиль с role='manager', и всё. Строки
-- в `erp_employees` не появлялось, поэтому `erp_role_of_caller()` уходил
-- в запасной путь «роль профиля → цеховая роль» и отдавал 'manager', а это
-- пять прав: order.manage, tz.manage, stage.block, stage.priority,
-- stage.move_department. То есть одна галочка «Подтвердить» в админке выдавала
-- правку любого заказа, работу с ТЗ и перенос этапов между цехами.
--
-- Хуже того, ограничение «только свой цех» на такого человека не действовало
-- вовсе: `erp_can_act_in_dept()` и его клиентское зеркало `canActInDept`
-- на пустой `department_id` отвечают «можно везде» (fail-open — он нужен
-- менеджеру и снабжению, у которых цеха нет). Права менеджера — по всей фабрике.
--
-- Стало: триггер заводит и строку сотрудника с ролью `pending` — единственной
-- ролью, у которой в матрице НЕТ НИ ОДНОГО права. Человек входит, видит
-- производство на чтение и не может ничего изменить, пока администратор
-- не назначит ему цех и настоящую цеховую роль в той же строке админки.
--
-- Почему не роль `production` (то есть `worker`): у рабочего шесть прав,
-- включая `stage.complete`, и без цеха они действуют во ВСЕХ цехах — новичок
-- мог бы закрывать чужие этапы. Для производства это хуже менеджера, а не лучше.
--
-- Почему не `hr` (у неё тоже ноль прав): подпись «HR» — это должность, и все
-- новички показывались бы кадровиками. Роль обязана называть своё состояние.
--
-- Существующих сотрудников миграция НЕ ТРОГАЕТ: правило действует со следующей
-- регистрации, у заведённых ролей и цехов уже назначены.

-- ── 1. Роль в CHECK ──────────────────────────────────────────────────────────
alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery',
    -- Заведён, должность не назначена: только просмотр
    'pending'
  ));

-- ── 2. Строки матрицы: все права явно запрещены ──────────────────────────────
-- `erp_has_permission` на отсутствующую строку и так отвечает «нельзя»
-- (coalesce(..., false)), но колонка матрицы в админке строится по строкам —
-- без них роль выглядела бы там пустым местом.
insert into public.erp_role_permissions (role, permission, allowed)
select 'pending', p.permission, false
  from (select distinct permission from public.erp_role_permissions) p
on conflict (role, permission) do nothing;

-- ── 3. Триггер регистрации ───────────────────────────────────────────────────
-- Текст профильной части взят дословно из 20260722215558, чтобы пересоздание
-- функции не потеряло её правил (правило проекта).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
begin
  insert into public.profiles (id, email, name, role, approved, active)
  values (
    new.id,
    new.email,
    v_name,
    'manager',
    false,   -- НЕ подтверждён: erp_is_member()=false, доступа нет до одобрения админом
    true
  )
  on conflict (id) do nothing;

  -- Цеховая роль без прав. Пока её нет, `erp_role_of_caller()` выводит роль
  -- из профиля и делает новичка менеджером — одобрение доступа выдавало бы
  -- заодно и права.
  --
  -- Индекс `erp_employees_profile_uniq` ЧАСТИЧНЫЙ (where profile_id is not null),
  -- поэтому предикат в ON CONFLICT обязателен: без него Postgres не находит
  -- целевой индекс и падает с 42P10 ещё при планировании запроса.
  insert into public.erp_employees (full_name, role, profile_id, active)
  values (v_name, 'pending', new.id, true)
  on conflict (profile_id) where profile_id is not null do nothing;

  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
