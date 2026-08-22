-- Роль участка без привязки к цеху больше не работает на всей фабрике.
--
-- Было: `erp_can_act_in_dept` (и его клиентское зеркало `canActInDept`)
-- пропускали любого, у кого пуст `erp_employees.department_id`. Довод рядом
-- стоял такой: «что такому пользователю можно, решает матрица — роль `manager`
-- без цеха всё равно не получит „Взять в работу“, потому что этого права нет
-- у роли».
--
-- Для менеджера довод верен. Для ролей участка — нет, и именно они внедряются
-- сейчас:
--   · `worker`, `foreman`, участки нанесения — `stage.take`, `stage.progress`,
--     `stage.complete`, `stage.defect`, `stage.block`;
--   · `purchaser` — `stage.take`, `stage.complete`, `material.receive`,
--     `warehouse.manage`;
--   · `storekeeper` — `stage.block`, `material.receive`, `warehouse.manage`.
-- Матрица их не останавливает. Привязки нет — значит, кладовщик, заведённый
-- без участка, действовал бы в любом цехе фабрики.
--
-- Второй довод — «в цехах, где сотрудников ещё не завели, запрет остановил бы
-- производство» — тоже не действует: он про цех БЕЗ людей, а речь про человека
-- БЕЗ цеха. Незаконченное заведение сотрудника должно сказать о себе, а не
-- молча раздать доступ.
--
-- На боевой базе правка никого не задевает: единственный `worker` привязан
-- к участку, а трое без привязки — два менеджера и директор, то есть ровно
-- те роли, у которых fail-open сохраняется.
--
-- Перечень ролей дословно повторяет `DEPT_BOUND_ROLES` в
-- `src/erp/utils/permissions.ts`; расхождение сторожит
-- `serverPermissions.test.ts`. Клиентский гейт и этот страж идут ОДНИМ
-- коммитом: страж строже интерфейса — «кнопка есть, действие падает»,
-- мягче — дыра.

create or replace function public.erp_can_act_in_dept(p_dept uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select p.role as profile_role,
           (select e.role
              from public.erp_employees e
             where e.profile_id = p.id and e.active is true
             limit 1) as employee_role,
           (select e.department_id
              from public.erp_employees e
             where e.profile_id = p.id and e.active is true
             limit 1) as my_dept
      from public.profiles p
     where p.id = (select auth.uid()) and p.active is true and p.approved is true
  )
  select case
    when (select profile_role from me) in ('admin', 'director', 'rop') then true
    when (select my_dept from me) is null then
      coalesce((select employee_role from me), '') not in (
        'worker', 'foreman', 'dtf', 'silkscreen', 'embroidery', 'dtg',
        'storekeeper', 'purchaser'
      )
    else p_dept is not null and (select my_dept from me) = p_dept
  end;
$$;

comment on function public.erp_can_act_in_dept(uuid) is
  'Зеркало canActInDept. Руководство профиля — везде. Пустая привязка: сквозные роли (менеджер, диспетчер, руководитель производства, технолог) работают везде, роли участка — нигде: у них есть права на этапы, и матрица их не останавливает. Перечень ролей участка совпадает с DEPT_BOUND_ROLES в permissions.ts, сверяет serverPermissions.test.ts.';
