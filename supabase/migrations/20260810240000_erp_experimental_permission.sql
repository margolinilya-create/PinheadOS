-- Право вести экспериментальный цех (правки заказчика 10.08, волна 3.6).
--
-- Нашлось живой проверкой, а не рассуждением: `erp_experimental_send_to_dept`
-- падала на 42501. Политика вставки этапов открыта только `order.manage`
-- и `stage.move_department`, а у технолога — того самого человека, который
-- ведёт разработку, — нет ни одного из них. То есть главная функция раздела
-- была недоступна главному её пользователю.
--
-- ПОЧЕМУ НОВОЕ ПРАВО, А НЕ ЧУЖОЕ. `order.manage` — власть над маршрутом ЛЮБОГО
-- заказа; выдать её технологу ради образцов значит отдать ему и сроки, и
-- пропуск этапов на всём производстве. `stage.move_department` — перенос между
-- цехами, другое действие. Здесь нужен ровно один смысл: «ведёт разработку
-- образцов», и он ничем существующим не выражается.
--
-- Право не декоративное — оно выключает конкретную кнопку («Передать образец
-- в цех»); это проверяет `permissionsCoverage.test.ts`, который не пропустит
-- право без применения.
--
-- ПО УМОЛЧАНИЮ — технолог и директор. Не руководитель производства: образцы
-- ведёт технолог, а разработка — не производственный поток.

insert into public.erp_role_permissions (role, permission, allowed)
select r.role, 'experimental.manage', r.role in ('technologist', 'director')
from (values
  ('director'), ('production_head'), ('dispatcher'), ('manager'), ('technologist'),
  ('foreman'), ('worker'), ('dtf'), ('silkscreen'), ('embroidery'),
  ('purchaser'), ('storekeeper'), ('hr')
) as r(role)
on conflict (role, permission) do nothing;

-- Появление этапа образца открывается тем же правом. Ветка отдельная и узкая:
-- она пускает ТОЛЬКО `origin = 'experimental'` — технолог не должен получить
-- возможность заводить произвольные производственные этапы.
drop policy if exists erp_item_stages_insert on public.erp_item_stages;
create policy erp_item_stages_insert on public.erp_item_stages
  for insert to authenticated
  with check (
    public.erp_has_permission('order.manage')
    or public.erp_has_permission('stage.move_department')
    or (origin = 'experimental' and public.erp_has_permission('experimental.manage'))
  );
