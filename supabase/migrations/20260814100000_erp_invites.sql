-- Приглашение ссылкой: человек заводится ОДНИМ действием админа.
--
-- ЗАЧЕМ. Прежний порядок был такой: человек регистрируется сам → подтверждает
-- адрес письмом → админ одобряет → админ ставит роль → админ ставит цех. Четыре
-- шага, два из них у разных людей, и один зависит от письма. Письма шлёт
-- встроенный SMTP Supabase (лимит порядка двух в час, помечен «для разработки»,
-- у gmail уходит в спам): из пяти учётных записей проекта самостоятельно
-- регистрировались двое, и застряли ОБА — одобренные, но так и не вошедшие.
--
-- КАК ТЕПЕРЬ. Админ создаёт приглашение с ролью и цехом, получает ссылку
-- и отправляет её человеку сам — мессенджером, голосом, как удобно. Письма
-- не участвуют вовсе. Человек переходит, задаёт пароль и сразу работает.
--
-- Самостоятельная регистрация ОСТАЁТСЯ запасным путём (решение заказчика):
-- без кода человек по-прежнему заводится заявкой с ролью `pending` без прав,
-- и его одобряет админ.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Таблица приглашений
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.erp_invites (
  -- Секрет ссылки. uuid перебору недоступен, поэтому знание кода и есть право
  -- им воспользоваться — отдельного пароля у приглашения нет
  code            uuid primary key default gen_random_uuid(),

  -- Кем человек станет. Роль профиля Order Studio и цеховая роль ERP — разные
  -- словари, приглашение несёт обе, иначе после входа его пришлось бы донастраивать
  profile_role    text not null check (profile_role in (
    'admin', 'director', 'rop', 'manager', 'production', 'designer')),
  employee_role   text not null check (employee_role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head', 'technologist',
    'dtf', 'silkscreen', 'embroidery', 'pending')),
  department_id   uuid references public.erp_departments(id) on delete set null,

  -- Привязка к адресу: null — ссылкой может воспользоваться любой, кому её дали.
  -- Заполнено — только этот адрес, и тогда ссылка бесполезна даже если утекла
  email           text,
  note            text,

  expires_at      timestamptz not null,

  -- Гашение и отзыв. Отзыв — `revoked_at`, а не DELETE: журнал «кто, кого, куда
  -- и когда звал» и есть половина смысла таблицы (правило проекта)
  used_at         timestamptz,
  used_by         uuid,
  revoked_at      timestamptz,

  -- Действующее лицо пишется как uuid: имя рвётся при переименовании
  -- и не различает тёзок (правило проекта)
  created_by      uuid,
  created_at      timestamptz not null default now()
);

comment on table public.erp_invites is
  'Приглашения по ссылке: код несёт роль, цех и срок. Гасится триггером регистрации.';

-- Действующие приглашения — тот список, который открывает админка
create index if not exists erp_invites_open_idx on public.erp_invites (created_at desc)
  where used_at is null and revoked_at is null;

alter table public.erp_invites enable row level security;

-- Политики НА КОМАНДУ, а не `for all` рядом с select (правило проекта).
-- `anon` доступа к таблице не получает вовсе: неавторизованному человеку
-- приглашение показывает функция ниже, и только по точному коду.
drop policy if exists erp_invites_read on public.erp_invites;
create policy erp_invites_read on public.erp_invites
  for select to authenticated using (public.erp_has_permission('staff.invite'));

drop policy if exists erp_invites_insert on public.erp_invites;
create policy erp_invites_insert on public.erp_invites
  for insert to authenticated
  with check (public.erp_has_permission('staff.invite'));

drop policy if exists erp_invites_update on public.erp_invites;
create policy erp_invites_update on public.erp_invites
  for update to authenticated
  using (public.erp_has_permission('staff.invite'))
  with check (public.erp_has_permission('staff.invite'));

drop policy if exists erp_invites_delete on public.erp_invites;
create policy erp_invites_delete on public.erp_invites
  for delete to authenticated using (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Право `staff.invite`
-- ═══════════════════════════════════════════════════════════════════════
-- Приглашение раздаёт права, поэтому гейтится ПРАВОМ, а не ролью учётной
-- записи: роль-исключение означала бы расхождение с клиентом (`isPrivileged`
-- это admin + director + РОП, а `is_admin()` — только admin), и на таком
-- расхождении в проекте уже ловились. По умолчанию — только у руководства;
-- расширяется галочкой в матрице.
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, 'staff.invite', r.role = 'director'
  from (select distinct role from public.erp_role_permissions) r
on conflict (role, permission) do nothing;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Показ приглашения ДО регистрации
-- ═══════════════════════════════════════════════════════════════════════
-- Человек, открывший ссылку, ещё не вошёл, а экран обязан сказать, куда его
-- зовут. Политика для `anon` тут не годится: RLS не видит фильтр запроса, и
-- `for select to anon using (true)` открыл бы ВСЮ таблицу приглашений вместо
-- одной строки. Функция отдаёт только то, что человеку и так скажут при входе,
-- и лишь по точному коду; недействительный код — пустой ответ без объяснения,
-- почему именно (истёк, отозван, использован — не его дело).
create or replace function public.erp_invite_preview(p_code uuid)
returns table (
  profile_role    text,
  employee_role   text,
  department_name text,
  email           text,
  expires_at      timestamptz
)
language sql stable security definer set search_path = public as $$
  select i.profile_role, i.employee_role, d.name, i.email, i.expires_at
    from public.erp_invites i
    left join public.erp_departments d on d.id = i.department_id
   where i.code = p_code
     and i.used_at is null
     and i.revoked_at is null
     and i.expires_at > now();
$$;

-- Вызывает НЕвошедший человек — грант для `anon` здесь намеренный
grant execute on function public.erp_invite_preview(uuid) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Триггер регистрации: гасит код и заводит человека готовым к работе
-- ═══════════════════════════════════════════════════════════════════════
-- Профильная часть взята дословно из 20260814090000 (правило проекта:
-- пересоздавая функцию, берём подлинный текст прежней миграции).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name          text := coalesce(nullif(new.raw_user_meta_data->>'name', ''), new.email);
  v_code          text := nullif(new.raw_user_meta_data->>'invite_code', '');

  -- Значения по умолчанию — путь БЕЗ приглашения: заявка без прав
  v_profile_role  text    := 'manager';
  v_employee_role text    := 'pending';
  v_dept          uuid    := null;
  v_approved      boolean := false;

  v_inv_profile   text;
  v_inv_employee  text;
  v_inv_dept      uuid;
begin
  if v_code is not null then
    begin
      -- Гашение и чтение ОДНИМ атомарным шагом. Двое, открывшие одну ссылку
      -- одновременно, не могут оба получить права: строка достанется первому,
      -- второй увидит ноль строк и пойдёт обычным путём.
      --
      -- `raw_user_meta_data` — это ввод пользователя, доверия к нему ноль:
      -- код проверяется здесь и только здесь, по сроку, отзыву и адресу.
      update public.erp_invites
         set used_at = now(), used_by = new.id
       where code = v_code::uuid
         and used_at is null
         and revoked_at is null
         and expires_at > now()
         and (email is null or lower(email) = lower(new.email))
      returning profile_role, employee_role, department_id
        into v_inv_profile, v_inv_employee, v_inv_dept;
    exception when invalid_text_representation then
      -- Код не uuid. Без этой ветки исключение свалило бы ВСЮ регистрацию:
      -- триггер выполняется внутри вставки в auth.users, и человек получил бы
      -- «Database error saving new user» вместо обычной формы.
      v_inv_profile := null;
    end;

    if v_inv_profile is not null then
      v_profile_role  := v_inv_profile;
      v_employee_role := v_inv_employee;
      v_dept          := v_inv_dept;
      -- Приглашение и ЕСТЬ одобрение: админ выдал его конкретному человеку
      v_approved      := true;
    end if;
  end if;

  insert into public.profiles (id, email, name, role, approved, active)
  values (new.id, new.email, v_name, v_profile_role, v_approved, true)
  on conflict (id) do nothing;

  -- Цеховая роль. Без этой строки `erp_role_of_caller()` выводит роль
  -- из профиля и делает новичка менеджером — одобрение доступа выдавало бы
  -- заодно и права, причём по всей фабрике (ограничение по цеху на человека
  -- без цеха не действует).
  --
  -- Индекс `erp_employees_profile_uniq` ЧАСТИЧНЫЙ (where profile_id is not null),
  -- поэтому предикат в ON CONFLICT обязателен: без него Postgres не находит
  -- целевой индекс и падает с 42P10 ещё при планировании запроса.
  insert into public.erp_employees (full_name, role, profile_id, department_id, active)
  values (v_name, v_employee_role, new.id, v_dept, true)
  on conflict (profile_id) where profile_id is not null do nothing;

  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
