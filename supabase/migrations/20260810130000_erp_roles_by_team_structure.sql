-- Роли под фактическую структуру производства (правки заказчика 10.08, волна 1).
--
-- Документ перечисляет команду так: МС (менеджер сопровождения) · Мастер цеха
-- (отвечает сразу за закрой и швейку) · ДТФ · Шелкография · Вышивка ·
-- Руководитель производства · Технолог · Закупщик · Кладовщик.
--
-- ЧТО МЕНЯЕМ И ЧТО НЕТ. Коды существующих ролей остаются: `manager`, `foreman`,
-- `production_head`, `purchaser`, `storekeeper` уже значат ровно то, что просит
-- заказчик, а код зашит в этот CHECK, в матрицу `erp_role_permissions`, в
-- `erp_role_of_caller()` и в сторожевые тесты — переименование стоило бы дорого
-- и не дало бы ничего. Изменились подписи в интерфейсе (`EMPLOYEE_ROLE_LABELS`).
--
-- Добавляются четыре новые роли:
--   · `technologist` — отвечает за экспериментальный цех и разработку образцов;
--   · `dtf`, `silkscreen`, `embroidery` — участки нанесения. По правам они
--     не различаются между собой (и совпадают с `worker`): различает их привязка
--     сотрудника к цеху. Заведены отдельными ролями, потому что заказчик назвал
--     их самостоятельными ролями команды.
--
-- `erp_role_of_caller()` не трогаем намеренно: она отдаёт `erp_employees.role`
-- как есть, перечисление ролей живёт только здесь, в констрейнте.

alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees add constraint erp_employees_role_check
  check (role in (
    'worker', 'foreman', 'dispatcher', 'purchaser', 'storekeeper', 'hr',
    'manager', 'director', 'production_head',
    'technologist', 'dtf', 'silkscreen', 'embroidery'
  ));

-- Стартовые права новых ролей (решение заказчика 10.08).
--
-- Участки — ровно то же, что у сотрудника цеха: взять задание, записать результат,
-- завершить, сообщить о проблеме, оформить брак, внести факт по плану.
-- Технолог — то же плюс приоритет очереди (он ведёт свой цех) и ведение ТЗ:
-- по образцу именно он задаёт техническое задание.
--
-- Полную матрицу «видит / редактирует / запускает / завершает / администрирует»
-- заказчик просил пройти отдельным блоком — здесь только рабочий минимум,
-- чтобы человек с новой ролью мог начать работать, а не смотреть на пустой экран.
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, p.permission, p.permission = any (
  case r.role
    when 'technologist' then array[
      'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect',
      'stage.priority', 'plan.fact', 'tz.manage'
    ]
    else array[
      'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect',
      'plan.fact'
    ]
  end
)
from (values ('technologist'), ('dtf'), ('silkscreen'), ('embroidery')) as r(role)
cross join (values
  ('stage.take'), ('stage.progress'), ('stage.complete'), ('stage.block'),
  ('stage.defect'), ('stage.priority'), ('stage.move_department'), ('order.manage'),
  ('tz.manage'), ('material.receive'), ('plan.manage'), ('plan.fact'), ('catalog.edit')
) as p(permission)
on conflict (role, permission) do nothing;
