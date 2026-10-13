-- Волна 1 «Ядро диспетчера», ядро правки 11: матрица прав ролей.
--
-- Зачем сейчас: правка 3 требует «разграничивать права на изменение приоритетов и
-- завершение операций», а в коде было только `isAdmin = role in (admin, director)`.
-- Таблица засеяна рабочими дефолтами — система работает и без редактора в админке
-- (редактор — следующая волна вместе с правками 11/12).
--
-- Словарь ролей — единый, по erp_employees.role (EmployeeRole в src/erp/types.ts).
-- Роль профиля Order Studio (admin/director/rop/...) приводится к нему на клиенте
-- (src/erp/utils/permissions.ts), чтобы не держать две несогласованные матрицы.
--
-- Матрица отвечает на вопрос «что этой роли вообще можно». Ограничение «только свой цех»
-- проверяется отдельно (привязка erp_employees.department_id) и матрицей не отменяется.

create table if not exists public.erp_role_permissions (
  role text not null,
  permission text not null,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, permission)
);

drop trigger if exists erp_role_permissions_touch on public.erp_role_permissions;
create trigger erp_role_permissions_touch before update on public.erp_role_permissions
  for each row execute function public.erp_set_updated_at();

alter table public.erp_role_permissions enable row level security;

-- Читают все авторизованные (клиент грузит матрицу при входе), правит только admin/director.
drop policy if exists erp_role_permissions_read on public.erp_role_permissions;
create policy erp_role_permissions_read on public.erp_role_permissions
  for select to authenticated using (true);
drop policy if exists erp_role_permissions_insert on public.erp_role_permissions;
create policy erp_role_permissions_insert on public.erp_role_permissions
  for insert to authenticated with check (public.is_admin());
drop policy if exists erp_role_permissions_update on public.erp_role_permissions;
create policy erp_role_permissions_update on public.erp_role_permissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists erp_role_permissions_delete on public.erp_role_permissions;
create policy erp_role_permissions_delete on public.erp_role_permissions
  for delete to authenticated using (public.is_admin());

-- Seed: полная решётка роль × право, чтобы будущий редактор в админке правил готовые строки.
--   stage.take            — взять задание в работу (закрепить за собой)
--   stage.progress        — записать фактически выполненное количество
--   stage.complete        — завершить этап
--   stage.block           — сообщить о проблеме / снять блокировку
--   stage.defect          — оформить брак / переделку
--   stage.priority        — менять приоритет заданий в очереди
--   stage.move_department — переносить задание между цехами на канбане
--   order.manage          — создавать и редактировать заказы
--   catalog.edit          — редактировать справочники
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, p.permission,
  case r.role
    when 'director' then true
    when 'dispatcher' then p.permission <> 'catalog.edit'
    when 'foreman' then p.permission in (
      'stage.take','stage.progress','stage.complete','stage.block','stage.defect','stage.priority')
    when 'worker' then p.permission in (
      'stage.take','stage.progress','stage.complete','stage.block','stage.defect')
    when 'manager' then p.permission in ('stage.block','stage.priority','order.manage')
    when 'purchaser' then p.permission = 'stage.block'
    when 'storekeeper' then p.permission = 'stage.block'
    else false
  end
from (values
  ('director'),('dispatcher'),('manager'),('foreman'),
  ('worker'),('purchaser'),('storekeeper'),('hr')
) as r(role)
cross join (values
  ('stage.take'),('stage.progress'),('stage.complete'),('stage.block'),('stage.defect'),
  ('stage.priority'),('stage.move_department'),('order.manage'),('catalog.edit')
) as p(permission)
on conflict (role, permission) do nothing;

-- Realtime: смена прав в админке долетает до открытых вкладок без перезагрузки.
do $$
begin
  alter publication supabase_realtime add table public.erp_role_permissions;
exception
  when duplicate_object then null;
end $$;
