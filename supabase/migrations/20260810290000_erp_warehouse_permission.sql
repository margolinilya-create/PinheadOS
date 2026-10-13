-- Право «Вести склад» и перенос между цехами менеджеру (решения заказчика 10.08).
--
-- ── 1. Зачем новое право ──
--
-- Складские задачи (приёмка материалов, маркировка, приёмка готовой продукции,
-- упаковка и отгрузка) принимали запись от ЛЮБОГО участника ERP: политика стояла
-- на `erp_is_member()`, стража по колонкам у таблицы нет. Значит швея или
-- печатник мог отметить продукцию принятой — а это теперь открывает упаковку —
-- и перевести упаковку в «отгружено».
--
-- Закрыть существующим правом было нечем. У кладовщика их два: `material.receive`
-- и `stage.block`. Приёмка материалов под `material.receive` подходит, а
-- маркировка и упаковка — нет: это не приёмка, и расширение права означало бы,
-- что его название перестало совпадать со смыслом. Заказчик выбрал отдельное
-- право (вариант A из docs/erp/permissions-matrix.md).
--
-- Кому: директор, руководитель производства, кладовщик, закупщик. Диспетчеру
-- НЕ даём — он распоряжается очередью цехов, а не физическим движением товара.
--
-- ── 2. Перенос между цехами менеджеру ──
--
-- Решение заказчика: заказ ведёт менеджер сопровождения, и перекидывать задание
-- между участками он должен уметь сам. Право `stage.move_department` включается
-- ему в матрице. Замечание, ради которого это записано: перенос меняет загрузку
-- производства, то есть менеджер теперь влияет на неё без ведома диспетчера.
-- Отменяется снятием галочки в админке.
--
-- ── 3. Почему INSERT гейтится ДВУМЯ правами ──
--
-- Само создание задачи безобидно, но строку можно вставить СРАЗУ в терминальном
-- статусе — и тогда гейт на UPDATE обходится вставкой. Поэтому INSERT тоже под
-- правом. Второе право в условии обязательно: подряд «под ключ» заводит задачу
-- упаковки из клиента (у такого заказа нет этапов, и триггер не сработает
-- никогда), а делает это менеджер заказа — у него `order.manage`, а не
-- `warehouse.manage`. Без второй ветки сдача подряда «под ключ» падала бы 42501.
--
-- Триггеры (`erp_warehouse_task_derive`, `erp_warehouse_fg_accepted`) —
-- SECURITY DEFINER, они минуют RLS и на это условие не смотрят.

-- ── Право в матрице ──

insert into public.erp_role_permissions (role, permission, allowed)
select r.role, 'warehouse.manage',
       r.role in ('director', 'production_head', 'storekeeper', 'purchaser')
  from (values
    ('worker'), ('foreman'), ('dispatcher'), ('purchaser'), ('storekeeper'), ('hr'),
    ('manager'), ('director'), ('production_head'),
    ('technologist'), ('dtf'), ('silkscreen'), ('embroidery')
  ) as r(role)
on conflict (role, permission) do nothing;

-- ── Перенос между цехами менеджеру ──

update public.erp_role_permissions
   set allowed = true
 where role = 'manager' and permission = 'stage.move_department';

-- ── Гейт складских задач ──

drop policy if exists erp_warehouse_tasks_insert on public.erp_warehouse_tasks;
create policy erp_warehouse_tasks_insert on public.erp_warehouse_tasks
  for insert to authenticated
  with check (
    public.erp_has_permission('warehouse.manage')
    or public.erp_has_permission('order.manage')
  );

drop policy if exists erp_warehouse_tasks_update on public.erp_warehouse_tasks;
create policy erp_warehouse_tasks_update on public.erp_warehouse_tasks
  for update to authenticated
  using (public.erp_has_permission('warehouse.manage'))
  with check (public.erp_has_permission('warehouse.manage'));

comment on table public.erp_warehouse_tasks is
  'Задачи склада. Движение задачи — под warehouse.manage (директор, РП, кладовщик, закупщик). Создание — warehouse.manage ИЛИ order.manage: подряд «под ключ» заводит упаковку из клиента, там этапов нет и триггер не сработает.';
