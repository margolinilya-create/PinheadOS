-- Аварийное снятие блокировок (правки заказчика 10.08, волна 1).
--
-- Документ: «Если из-за бага обязательная проверка, блокировка или этап полностью
-- останавливает работу, администратор должен иметь возможность временно отключить
-- именно эту механику и продолжить процесс по обходному сценарию, не ожидая
-- исправления разработчиком».
--
-- ЧТО ЭТО НЕ. Не кнопка «Отключить» в справочниках — та выключает ЗНАЧЕНИЕ
-- подсказки, и заказчик прямо отметил, что она решает другую задачу. И не
-- клиентские feature-флаги (`config/features.ts`): они живут в localStorage одного
-- браузера, а снятая блокировка должна действовать для всех и оставлять след.
--
-- ЧТО МОЖНО СНЯТЬ. Три гейта, каждый из которых способен остановить движение:
--   · `material_gate` — «цех не начинает, пока склад не принял материал».
--     Сегодня это самая нагруженная блокировка: 13 активных заказов с непринятыми
--     материалами держат 31 этап закроя и швейки;
--   · `tz_gate`       — «этап не запускается без ТЗ у позиции»;
--   · `ship_gate`     — «заказ не отгрузить, пока не закрыты все этапы и материалы».
-- Зависимости этапов сюда НЕ входят: «этап ждёт предыдущий» — это сам маршрут,
-- а не проверка, и снимать его глобально нельзя. Для застрявшего маршрута есть
-- точечное действие «Пропустить этап» (миграция 20260810150000).
--
-- ОБЛАСТЬ. `order_id = null` — снято для всей системы; иначе только для этого
-- заказа. Цеховой области нет намеренно: она множит состояния, которые человеку
-- пришлось бы держать в голове, а реальный случай заказчика — «встал один заказ».
--
-- ИСТОРИЯ. Строки не удаляются: возврат проверки — это `restored_at`, а не DELETE.
-- Кто снял, когда, зачем и кто вернул — остаётся видимым.

create table if not exists public.erp_bypasses (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('material_gate', 'tz_gate', 'ship_gate')),
  -- null = вся система; иначе конкретный заказ
  order_id uuid references public.erp_orders(id) on delete cascade,
  reason text not null check (length(btrim(reason)) > 0),
  created_by text,
  created_by_id uuid,
  created_at timestamptz not null default now(),
  -- Заполнены, когда проверку вернули; пока null — снятие действует
  restored_by text,
  restored_by_id uuid,
  restored_at timestamptz
);

-- Активное снятие одного вида на одну область — одно.
-- Два индекса вместо одного с `coalesce`: частичные предикаты читаются глазами,
-- а «глобально» и «по заказу» это разные записи, а не одна с NULL-хвостом.
create unique index if not exists erp_bypasses_active_global_idx
  on public.erp_bypasses (kind)
  where order_id is null and restored_at is null;
create unique index if not exists erp_bypasses_active_order_idx
  on public.erp_bypasses (kind, order_id)
  where order_id is not null and restored_at is null;

create index if not exists erp_bypasses_active_idx
  on public.erp_bypasses (restored_at) where restored_at is null;

alter table public.erp_bypasses enable row level security;

-- Читают ВСЕ участники ERP, а не только администраторы: цех обязан видеть, что
-- задание запустилось со снятой проверкой. Блокировка, снятая молча, — тот же
-- баг, только необъяснимый.
drop policy if exists "erp_bypasses_read" on public.erp_bypasses;
create policy "erp_bypasses_read" on public.erp_bypasses
  for select to authenticated using (public.erp_is_member());

drop policy if exists "erp_bypasses_insert" on public.erp_bypasses;
create policy "erp_bypasses_insert" on public.erp_bypasses
  for insert to authenticated with check (public.erp_has_permission('bypass.manage'));

drop policy if exists "erp_bypasses_update" on public.erp_bypasses;
create policy "erp_bypasses_update" on public.erp_bypasses
  for update to authenticated
  using (public.erp_has_permission('bypass.manage'))
  with check (public.erp_has_permission('bypass.manage'));

-- DELETE не открываем никому: журнал снятий — это то, по чему завтра будут
-- разбирать, почему заказ прошёл мимо проверки.

do $$
begin
  alter publication supabase_realtime add table public.erp_bypasses;
exception when duplicate_object then null;
end $$;

-- Право `bypass.manage` — только у директора.
--
-- Снятие проверки затрагивает всё производство сразу, и это не операционное
-- решение цеха или менеджера. Раздать шире можно галочкой в админке — на то
-- матрица и существует.
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, 'bypass.manage', r.role = 'director'
from (values
  ('director'), ('production_head'), ('dispatcher'), ('manager'), ('technologist'),
  ('foreman'), ('worker'), ('dtf'), ('silkscreen'), ('embroidery'),
  ('purchaser'), ('storekeeper'), ('hr')
) as r(role)
on conflict (role, permission) do nothing;
