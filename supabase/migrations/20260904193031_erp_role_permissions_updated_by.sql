-- §5 обхода 04.09: правка матрицы прав не оставляла НИКАКОГО следа.
--
-- `erp_role_permissions` хранила `updated_at`, но не хранила автора: кто и когда
-- снял у роли право, узнать было негде. Это единственная настройка раздела,
-- которая молча отключает людям работу — и единственная, у которой не было
-- ни отката, ни подписи.
--
-- ПОЛНОЙ ИСТОРИИ ЗДЕСЬ НЕТ И НЕ ПОДРАЗУМЕВАЕТСЯ: строка одна на пару
-- «роль × право», значит видно ПОСЛЕДНЕГО писателя каждой пары. Отдельная
-- таблица журнала — это уже другая работа; половина ответа лучше, чем ничего,
-- но выдавать её за журнал нельзя, и на экране так и подписано.
--
-- Автора ставит ТРИГГЕР из `auth.uid()`, а не клиент: вопрос «кто снял
-- галочку» — про личность, а не про поле формы, и присланное значение
-- доверия не заслуживает. Пустой `auth.uid()` — это service_role (сиды
-- миграций), и такие строки остаются без подписи: выдуманный автор хуже
-- пустоты.

alter table public.erp_role_permissions
  add column if not exists updated_by uuid;

comment on column public.erp_role_permissions.updated_by is
  'Кто последним менял это право. Ставит триггер из auth.uid(): клиент прислал бы что угодно, а вопрос «кто снял галочку» — про личность, а не про поле формы. Полной истории здесь нет и не подразумевается: строка одна на пару роль×право.';

create or replace function public.erp_role_permission_touch()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  -- Пустой `auth.uid()` — это service_role (сиды миграций): его не подписываем,
  -- и `updated_by` остаётся null, что честнее выдуманного автора
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists erp_role_permission_touch_trg on public.erp_role_permissions;
create trigger erp_role_permission_touch_trg
  before insert or update on public.erp_role_permissions
  for each row execute function public.erp_role_permission_touch();
