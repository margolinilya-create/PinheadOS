-- Order v4, веха 4 единого потока, миграция F (17.10): МС на стороне ТЗ.
--
-- План: docs/superpowers/plans/2026-10-17-order-flow-m4-admin.md, задача 0.
--
-- Что закрывает: менеджером сопровождения (`sales_is_ms()`, миграция B
-- 20261017062110) считался профиль, чья строка в ERP имеет должность
-- `manager`. Должность в ERP — вопрос «что человек делает на фабрике», её
-- правят в ERP, а ERP заморожен (веха 1). Решение владельца: МС — явный
-- признак `profiles.is_ms` на стороне ТЗ, его ставит руководство продаж
-- на экране «Сотрудники продаж» рядом с признаком «Ведёт заказы» (`is_sales`).
-- МС без признака продавца тоже входит в раздел ТЗ: видит заказы в работе
-- (политика `orders_select` миграции B — через `sales_is_ms()`), своих
-- не заводит (`orders_insert` его не пускает).
--
-- Что меняется:
--   · `profiles.is_ms boolean not null default false`;
--   · `sales_is_ms()` — новая редакция: активный, одобренный, `is_ms`.
--     Строки ERP больше не читает. Политики `orders_*`, Storage `order-artworks`
--     и RPC `order_v4_transition` / `_launch_check` / `_set_payment` зовут эту
--     функцию — их не пересоздаём;
--   · RPC `sales_set_staff(uuid, text, boolean)` — признак по виду:
--     'sales' → `is_sales`, 'ms' → `is_ms` (статические ветки, иначе 22023;
--     у вида нет умолчания). Отмечает admin, director, rop — активный
--     и одобренный профиль (иначе 42501);
--   · `sales_set_staff(uuid, boolean)` — тонкая обёртка с видом 'sales'
--     для вкладок, открытых до выкладки фронта (уходит в вехе 5);
--   · `sales_staff_list()` — пересоздана (`drop` + `create`: сменился состав
--     колонок): роль, `is_sales`, `is_ms`; видит admin, director, rop;
--   · страж `profiles_sales_guard`: исключения — `is_sales` и `is_ms`;
--     ранний выход только если не изменился ни один из двух признаков,
--     INSERT пропускается, если оба не `true`.
--
-- ВЫКАТКА: до мерджа вехи 4. После применения МС нет ни одного — запуск
-- в производство (`order_v4_launch_check`, переход в `production`) доступен
-- только admin/director, пока руководство не отметит МС. Отметить можно
-- в той же транзакции, что и миграция (служебный доступ страж пропускает):
--   update public.profiles set is_ms = true where id in ('…');
-- Признак `is_ms` у тех же людей, что сегодня МС по ERP (выборка ДО применения):
--   select p.id from public.profiles p join public.erp_employees e on e.profile_id = p.id
--    where e.active and e.role = 'manager';
--
-- Откат: новая миграция с прежней редакцией `sales_is_ms()` (миграция B),
-- стража и RPC из миграции E (20261017093841), `drop function
-- public.sales_set_staff(uuid, text, boolean)`; колонку можно оставить.

-- ── 1. Признак ───────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists is_ms boolean not null default false;

comment on column public.profiles.is_ms is
  'Менеджер сопровождения (МС): запускает заказы v4 в производство. Ставит руководство продаж через sales_set_staff (миграция 20261017142210)';

-- ── 2. Кто МС ────────────────────────────────────────────────────────────

-- МС: активный и одобренный профиль с признаком `is_ms`. Должность в ERP
-- не смотрим: права продаж и права цеха — разные вопросы
create or replace function public.sales_is_ms()
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
       and p.is_ms is true);
$$;

revoke execute on function public.sales_is_ms() from public, anon;
grant execute on function public.sales_is_ms() to authenticated;

-- ── 3. Страж признаков ───────────────────────────────────────────────────
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
  -- Исключения: is_sales и is_ms. Всё остальное страж не смотрит
  if tg_op = 'UPDATE'
     and new.is_sales is not distinct from old.is_sales
     and new.is_ms is not distinct from old.is_ms then
    return new;
  end if;
  if tg_op = 'INSERT' and new.is_sales is not true and new.is_ms is not true then
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
    message = 'Признаки «Ведёт заказы» и «МС» меняет руководство продаж в разделе «Сотрудники продаж»';
end;
$$;

revoke execute on function public.profiles_sales_guard() from public, anon, authenticated;

drop trigger if exists profiles_sales_guard on public.profiles;
create trigger profiles_sales_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_sales_guard();

-- ── 4. Отметить сотрудника продаж ────────────────────────────────────────
-- Прежняя сигнатура (миграция E) — ПЕРВОЙ: вкладки, открытые до выкладки
-- фронта, ставят «Ведёт заказы»; права и проверки — у трёхаргументной (тело
-- plpgsql разбирается при вызове, порядок объявления ему не важен). Порядок
-- держит сторож контракта RPC (`erp/utils/rpcContract.test.ts`): он берёт
-- ПОСЛЕДНЮЮ сигнатуру имени, а клиент зовёт трёхаргументную. До вехи 5
create or replace function public.sales_set_staff(p_profile uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sales_set_staff(p_profile, 'sales'::text, p_on);
end;
$$;

revoke execute on function public.sales_set_staff(uuid, boolean) from public, anon;
grant execute on function public.sales_set_staff(uuid, boolean) to authenticated;

create or replace function public.sales_set_staff(p_profile uuid, p_kind text, p_on boolean)
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
       and p.role in ('admin', 'director', 'rop')) then
    raise exception using errcode = '42501',
      message = 'Отмечать сотрудников продаж может администратор, директор или РОП';
  end if;
  if p_profile is null or p_on is null then
    raise exception using errcode = '22023', message = 'Не указан профиль или признак';
  end if;

  -- Вид признака — статическими ветками, без склейки имени колонки
  if p_kind = 'sales' then
    perform set_config('sales.rpc', 'on', true);
    update public.profiles set is_sales = p_on where id = p_profile;
    get diagnostics v_rows = row_count;
    perform set_config('sales.rpc', 'off', true);
  elsif p_kind = 'ms' then
    perform set_config('sales.rpc', 'on', true);
    update public.profiles set is_ms = p_on where id = p_profile;
    get diagnostics v_rows = row_count;
    perform set_config('sales.rpc', 'off', true);
  else
    raise exception using errcode = '22023', message = 'Неизвестный признак: ожидается sales или ms';
  end if;

  if v_rows = 0 then
    raise exception using errcode = 'P0002', message = 'Профиль не найден';
  end if;
end;
$$;

revoke execute on function public.sales_set_staff(uuid, text, boolean) from public, anon;
grant execute on function public.sales_set_staff(uuid, text, boolean) to authenticated;

-- ── 5. Список для «Сотрудников продаж» ───────────────────────────────────
-- Состав колонок сменился — `create or replace` его не меняет, отсюда drop

drop function if exists public.sales_staff_list();

create or replace function public.sales_staff_list()
returns table (
  id uuid,
  name text,
  email text,
  role text,
  active boolean,
  approved boolean,
  is_sales boolean,
  is_ms boolean
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
       and p.role in ('admin', 'director', 'rop')) then
    raise exception using errcode = '42501',
      message = 'Список сотрудников продаж видит администратор, директор или РОП';
  end if;

  return query
    select p.id, p.name, p.email, p.role, p.active, p.approved, p.is_sales, p.is_ms
      from public.profiles p
     order by p.active desc, p.name, p.email;
end;
$$;

revoke execute on function public.sales_staff_list() from public, anon;
grant execute on function public.sales_staff_list() to authenticated;

notify pgrst, 'reload schema';
