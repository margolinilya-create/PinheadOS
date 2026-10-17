-- Order v4, веха 3 единого потока, миграция E (17.10): признак «Менеджер продаж».
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m3-workplace.md, задача 0.
--
-- Что закрывает: продавцом (`sales_is_seller()`, миграция B 20261017062110)
-- считался ЛЮБОЙ активный одобренный профиль `manager`. На бою 17.10 таких
-- десять, и у всех десяти в ERP роль `production_head` — начальники цехов
-- заводили и правили заказы продаж. Решение владельца: продавец — явный
-- признак `profiles.is_sales`, его ставит admin или director.
--
-- Что меняется:
--   · `profiles.is_sales boolean not null default false`;
--   · `sales_is_seller()` — новая редакция: активный, одобренный, `is_sales`
--     (роль профиля больше не смотрим). Политики `orders_*` и Storage
--     `order-artworks` зовут эту функцию — их не пересоздаём;
--   · RPC `sales_set_staff(uuid, boolean)` — единственный клиентский путь
--     поменять признак, только admin/director (иначе 42501);
--   · RPC `sales_staff_list()` — список профилей для админки продавцов:
--     политика `profiles_select` на бою пускает к чужим строкам только
--     `is_admin()`, директор иначе видел бы один свой профиль;
--   · страж `profiles_sales_guard` (BEFORE INSERT OR UPDATE): исключение
--     ровно одно — `is_sales`. Меняется только внутри `sales_set_staff`
--     (метка `sales.rpc` + `current_user not in ('authenticated', 'anon')`, как у
--     `order_v4_guard`) или служебным доступом (SQL Editor, service_role,
--     миграции). Остальные колонки `profiles` страж не смотрит: одобрение,
--     роль, `active` админ правит как раньше (политика `profiles_update` —
--     `is_admin()`).
--     Почему страж охраняет одну колонку: остальные колонки `profiles` уже
--     закрыты политикой `profiles_update = is_admin()`, а `is_sales` ставит
--     и директор — политикой этого не выразить, нужен свой RPC-путь.
--
-- На бою 17.10 (SELECT pg_policies / pg_trigger): у `profiles` четыре политики
-- на команду — select (свой или `is_admin()`), insert/update/delete
-- (`is_admin()`); пользовательских триггеров нет. Новый профиль заводит
-- `handle_new_user` (definer, триггер `on_auth_user_created` на auth.users)
-- без `is_sales` — умолчание false, страж пропускает.
--
-- ВЫКАТКА: после применения продавцов НЕТ ни одного — авторы заказов теряют
-- доступ к своим заказам (v3 и v4), пока владелец не отметит продавцов.
-- До мерджа вехи 3 (админки ещё нет) — одним SQL в той же транзакции, что
-- и миграция (служебный доступ страж пропускает):
--   update public.profiles set is_sales = true where id in ('…', '…');
--
-- Откат: новая миграция с прежней редакцией `sales_is_seller()` (роль
-- manager), `drop trigger profiles_sales_guard on public.profiles`,
-- `drop function` RPC этого файла; колонку можно оставить.

-- ── 1. Признак ───────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists is_sales boolean not null default false;

comment on column public.profiles.is_sales is
  'Менеджер продаж: заводит заказы v4. Ставит admin/director через sales_set_staff (миграция 20261017093841)';

-- ── 2. Кто продавец ──────────────────────────────────────────────────────

-- Менеджер продаж (автор заказа): активный и одобренный профиль с признаком
-- `is_sales`. Роль профиля и должность в ERP не смотрим: права продаж
-- и права цеха — разные вопросы
create or replace function public.sales_is_seller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.is_sales is true);
$$;

revoke execute on function public.sales_is_seller() from public, anon;
grant execute on function public.sales_is_seller() to authenticated;

-- ── 3. Страж признака ────────────────────────────────────────────────────
-- invoker: внутри definer-RPC `current_user` — владелец функции, у клиента —
-- `authenticated` или `anon`. Даже если метка `sales.rpc` окажется выставленной
-- в транзакции клиента, вне definer роль клиентская — страж не верит.

create or replace function public.profiles_sales_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rpc boolean := coalesce(current_setting('sales.rpc', true), '') = 'on'
                   and current_user not in ('authenticated', 'anon');
begin
  -- Исключение ровно одно: is_sales. Всё остальное страж не смотрит
  if tg_op = 'UPDATE' and new.is_sales is not distinct from old.is_sales then
    return new;
  end if;
  if tg_op = 'INSERT' and new.is_sales is not true then
    return new;
  end if;

  if v_rpc then
    return new;
  end if;

  -- Служебный доступ (SQL Editor, service_role, миграции): роль запроса
  -- и текущая роль не клиентские
  if coalesce((select auth.role()), '') not in ('authenticated', 'anon')
     and current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  raise exception using errcode = '42501',
    message = 'Признак «Менеджер продаж» меняет администратор или директор в разделе «Менеджеры продаж»';
end;
$$;

revoke execute on function public.profiles_sales_guard() from public, anon, authenticated;

drop trigger if exists profiles_sales_guard on public.profiles;
create trigger profiles_sales_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_sales_guard();

-- ── 4. Отметить продавца ─────────────────────────────────────────────────

create or replace function public.sales_set_staff(p_profile uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows bigint;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role in ('admin', 'director')) then
    raise exception using errcode = '42501',
      message = 'Отмечать менеджеров продаж может администратор или директор';
  end if;
  if p_profile is null or p_on is null then
    raise exception using errcode = '22023', message = 'Не указан профиль или признак';
  end if;

  perform set_config('sales.rpc', 'on', true);
  update public.profiles set is_sales = p_on where id = p_profile;
  get diagnostics v_rows = row_count;
  perform set_config('sales.rpc', 'off', true);

  if v_rows = 0 then
    raise exception using errcode = 'P0002', message = 'Профиль не найден';
  end if;
end;
$$;

revoke execute on function public.sales_set_staff(uuid, boolean) from public, anon;
grant execute on function public.sales_set_staff(uuid, boolean) to authenticated;

-- ── 5. Список для админки продавцов ──────────────────────────────────────

create or replace function public.sales_staff_list()
returns table (
  id uuid,
  name text,
  email text,
  role text,
  active boolean,
  approved boolean,
  is_sales boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.active is true and p.approved is true
       and p.role in ('admin', 'director')) then
    raise exception using errcode = '42501',
      message = 'Список менеджеров продаж видит администратор или директор';
  end if;

  return query
    select p.id, p.name, p.email, p.role, p.active, p.approved, p.is_sales
      from public.profiles p
     order by p.active desc, p.name, p.email;
end;
$$;

revoke execute on function public.sales_staff_list() from public, anon;
grant execute on function public.sales_staff_list() to authenticated;
