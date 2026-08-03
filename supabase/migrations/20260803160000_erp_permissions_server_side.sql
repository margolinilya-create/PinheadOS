-- Матрица прав начинает действовать НА СЕРВЕРЕ (аудит 29.07, волна 4 — первый шаг).
--
-- Находка аудита: `erp_role_permissions` не применялась нигде, кроме React. Ни одна
-- RLS-политика на неё не ссылалась, и все права были декоративными для любого, кто
-- умеет позвать REST напрямую. Волна 3 (план производства) добавила туда же
-- `plan.manage` и `plan.fact` — то есть «кто вправе менять утверждённый план»
-- держалось на кнопке в интерфейсе. Закрываем это на таблицах плана.
--
-- Почему именно сейчас: в проде два профиля, оба admin, `erp_employees` пуста.
-- Ужесточение никого не запирает, а после того как заведут цеха — уже запрёт,
-- и вводить его придётся с риском остановить смену.
--
-- Чего эта миграция НЕ делает: не трогает `erp_item_stages`. Там одна UPDATE-операция
-- несёт шесть разных прав (взять, записать результат, завершить, заблокировать, брак,
-- приоритет), и разделять их надо по изменившимся колонкам — отдельный страж со своим
-- разбором. Делать это заодно значит рисковать остановкой цеха ради чистоты коммита.

-- ── 1. Цеховая роль вызывающего ──
-- Зеркало `resolveErpRole` из src/erp/utils/permissions.ts. Расхождение этих двух
-- реализаций означало бы «в интерфейсе можно, на сервере нельзя» — худший вид отказа,
-- поэтому правило одно и то же и записано здесь дословно:
--   admin/director профиля → всегда 'director' (руководство не теряет доступ из-за
--   того, что кому-то проставили цеховую роль «сотрудник цеха»);
--   иначе роль из erp_employees; иначе таблица соответствия ролей Order Studio.
create or replace function public.erp_role_of_caller()
returns text language sql stable security definer set search_path = public as $$
  with me as (
    select p.role as profile_role,
           (select e.role
              from public.erp_employees e
             where e.profile_id = p.id and e.active is true
             limit 1) as employee_role
      from public.profiles p
     where p.id = (select auth.uid()) and p.active is true and p.approved is true
  )
  select case
    when (select profile_role from me) in ('admin', 'director') then 'director'
    when (select employee_role from me) is not null then (select employee_role from me)
    else coalesce(
      (select case (select profile_role from me)
         when 'rop' then 'dispatcher'
         when 'manager' then 'manager'
         when 'production' then 'worker'
         when 'designer' then 'worker'
       end),
      -- Профиля нет или он не активен: роли нет вовсе, а не «рабочий».
      -- Иначе неодобренный пользователь получил бы права рядового сотрудника цеха.
      null)
  end;
$$;
grant execute on function public.erp_role_of_caller() to authenticated;

-- ── 2. Есть ли у вызывающего право ──
-- Отсутствие строки в матрице = запрет. На клиенте в этом случае работает
-- DEFAULT_PERMISSIONS, но там это защита от неудачной загрузки матрицы; на сервере
-- таблица засеяна миграциями целиком, и «права нет в таблице» означает ровно запрет.
--
-- Функция вызываема через REST, и advisor на это ругается — так и оставляем, по той же
-- причине, что у `erp_is_member()`: предикаты RLS исполняются от лица вызывающего,
-- и отзыв EXECUTE сломал бы сами политики. Утечки нет: функция отвечает только
-- про самого вызывающего.
create or replace function public.erp_has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select rp.allowed
      from public.erp_role_permissions rp
     where rp.role = public.erp_role_of_caller()
       and rp.permission = perm
  ), false);
$$;
grant execute on function public.erp_has_permission(text) to authenticated;

-- ── 3. План производства: кто вправе его менять ──
-- Ставить и снимать задачи может только plan.manage. Обновлять — ещё и plan.fact,
-- но лишь свои колонки: разделение проверяет триггер ниже, потому что RLS работает
-- на уровне строки и «какие поля изменились» не различает.
drop policy if exists erp_calendar_slots_insert on public.erp_calendar_slots;
create policy erp_calendar_slots_insert on public.erp_calendar_slots
  for insert to authenticated
  with check (public.erp_has_permission('plan.manage'));

drop policy if exists erp_calendar_slots_update on public.erp_calendar_slots;
create policy erp_calendar_slots_update on public.erp_calendar_slots
  for update to authenticated
  using (public.erp_has_permission('plan.manage') or public.erp_has_permission('plan.fact'))
  with check (public.erp_has_permission('plan.manage') or public.erp_has_permission('plan.fact'));

-- ── 4. Страж колонок: цех вносит факт, но не переписывает план ──
-- Требование заказчика дословно: ответственный за цех не меняет утверждённый план,
-- плановое количество, приоритет, дату выполнения и очерёдность. Без этого стража
-- право `plan.fact` давало бы UPDATE на всю строку.
create or replace function public.erp_calendar_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Запроса без JWT здесь не бывает: политики объявлены `to authenticated`, и анониму
  -- до строки не дойти. Пустой `auth.uid()` означает service_role — он и так минует
  -- RLS, страж не должен запирать починку через SQL и будущие серверные задачи.
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.erp_has_permission('plan.manage') then
    return new;
  end if;

  -- Остальным (plan.fact) разрешены только поля факта и проблемы.
  if new.department_id is distinct from old.department_id
     or new.stage_id      is distinct from old.stage_id
     or new.work_date     is distinct from old.work_date
     or new.qty_planned   is distinct from old.qty_planned
     or new.priority      is distinct from old.priority
     or new.sort_order    is distinct from old.sort_order
     or new.comment       is distinct from old.comment
     or new.created_by    is distinct from old.created_by
  then
    raise exception 'erp_calendar_guard: изменение плана требует права plan.manage'
      using errcode = '42501';
  end if;

  -- Снять задачу из плана — тоже решение руководителя, а не цеха.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    raise exception 'erp_calendar_guard: снятие задачи из плана требует права plan.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists erp_calendar_slots_guard on public.erp_calendar_slots;
create trigger erp_calendar_slots_guard before update on public.erp_calendar_slots
  for each row execute function public.erp_calendar_guard();

-- ── 5. Переписка по задаче плана ──
-- Писать может тот, кто вообще участвует в планировании: постановщик или цех.
drop policy if exists erp_plan_comments_insert on public.erp_plan_comments;
create policy erp_plan_comments_insert on public.erp_plan_comments
  for insert to authenticated
  with check (
    public.erp_has_permission('plan.manage') or public.erp_has_permission('plan.fact')
  );
