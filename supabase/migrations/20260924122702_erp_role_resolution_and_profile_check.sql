-- Резолюция роли: дизайнер остаётся дизайнером, неизвестная роль запрещена,
-- у `profiles.role` появляется CHECK (код-ревью 23.09, находки 2, 3, 4).
--
-- Все три правки — про одну величину, поэтому идут вместе: по отдельности
-- каждая либо бессмысленна, либо опасна.

-- ── 1. Профильный `designer` резолвится в цехового `designer` (находка 2) ──
--
-- До сих пор он приводился к `worker`, и довод записан в `CLAUDE.md`:
-- совпадение имени в двух перечнях не делает роли одной величиной. Довод
-- верен как утверждение о РАЗНЫХ перечнях, но следствие вышло обратным
-- замыслу. У цеховой роли `designer` права `files.manage`, `sku.view`,
-- `sku.edit`; у `worker` — работа на этапах, которой дизайнер всё равно
-- не сделает: он не привязан к участку, и `canActInDept` его останавливает.
-- Итог: человек получал бесполезные права и терял `files.manage` — ровно то
-- единственное, ради чего роль заведена правкой 14.09.
--
-- На бою такой человек есть: из двух профилей `designer` активная строка
-- в `erp_employees` заведена у одного. Решение владельца 24.09.
--
-- ── 2. Неизвестная роль профиля даёт `pending`, а не пустоту (находка 4) ──
--
-- Клиентский `resolveErpRole` возвращал `worker` там, где сервер возвращал
-- NULL, — то есть интерфейс рисовал кнопки цеха, а сервер отвечал 42501.
-- Обе стороны теперь дают `pending`: это роль «новичок до назначения
-- должности», и прав у неё нет ни в `DEFAULT_PERMISSIONS`, ни в матрице
-- на бою (18 строк, ноль разрешённых). Зеркало стало дословным, а ответ
-- «нельзя» — одинаковым с обеих сторон.
--
-- ОТСУТСТВИЕ ПРОФИЛЯ — ЭТО НЕ «НЕИЗВЕСТНАЯ РОЛЬ», и различие сохранено явно.
-- Если профиля нет, он не активен или не одобрен, `me` пуст, и функция
-- возвращает NULL, как и раньше. Свести оба случая к `pending` было бы
-- ошибкой: выдай админ роли `pending` любое право — его получил бы
-- неодобренный пользователь, то есть человек за первой стеной доступа.

create or replace function public.erp_role_of_caller()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    -- Профиля нет, он отключён или не одобрен: роли нет вовсе
    when (select profile_role from me) is null then null
    when (select profile_role from me) in ('admin', 'director') then 'director'
    when (select employee_role from me) is not null then (select employee_role from me)
    else (select case (select profile_role from me)
       when 'rop' then 'dispatcher'
       when 'manager' then 'manager'
       when 'production' then 'worker'
       when 'designer' then 'designer'
       else 'pending'
     end)
  end;
$function$;

-- ── 3. CHECK на `profiles.role` (находка 3) ──
--
-- У `erp_invites.profile_role` ограничение есть (те же шесть значений),
-- у `erp_invites.employee_role` и `erp_employees.role` — тоже (пятнадцать).
-- У самой колонки, куда значение в итоге попадает, не было ни одного.
--
-- Штатный путь защищён: роль проставляет триггер из приглашения. Но последней
-- линии не было вовсе — правка через SQL, новая профильная роль, заведённая
-- только в приглашениях, или ручное вмешательство клали в колонку что угодно,
-- а расхождение клиента и сервера (находка 4) превращало это в тихий отказ.
--
-- Проверено перед добавлением: на бою значения только `manager` (11),
-- `admin` (3) и `designer` (2) — то есть существующие строки ограничение
-- проходят, и добавление не упадёт. NULL ограничением не запрещён: CHECK
-- пропускает его по правилам SQL, а обязательность роли — отдельный вопрос,
-- который эта миграция не решает.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'director', 'rop', 'manager', 'production', 'designer'));
