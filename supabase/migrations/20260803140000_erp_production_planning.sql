-- Правки менеджера, волна 3: недельное и ежедневное планирование производства.
--
-- Руководитель производства вручную раскладывает этапы из общего канбана по цехам
-- и дням, ответственный за цех ежедневно вносит факт. Система план НЕ составляет —
-- она даёт инструмент раскладки и показывает отклонения.
--
-- Сущность не заводим: `erp_calendar_slots` (день × этап × план/факт) существует
-- с первой миграции 20260716140000 и не используется НИ ОДНОЙ строкой кода —
-- ровно та форма, что нужна. Расширяем её недостающими полями.
--
-- Чего эта миграция НЕ делает: не возвращает `capacity_per_day` цехам. Мощности
-- были удалены осознанно (20260716170000, «план сроков вписывается вручную»),
-- и их возврат — спор с прежним решением заказчика. Плановая загрузка считается
-- в штуках из самих слотов; строка «доступная мощность» появится, если норматив
-- заведут отдельно.

-- ── 1. Факт, брак и причина отклонения ──
alter table public.erp_calendar_slots
  add column if not exists qty_defect int not null default 0,
  add column if not exists fact_comment text,
  add column if not exists deviation_reason text,
  add column if not exists fact_by text,
  add column if not exists fact_at timestamptz,
  add column if not exists created_by text;

-- ── 2. Очерёдность и приоритет внутри дня ──
-- numeric, как `erp_item_stages.queue_position`: вставка между соседями считается
-- серединой, без перенумерации всей колонки.
alter table public.erp_calendar_slots
  add column if not exists sort_order numeric not null default 1000,
  add column if not exists priority int not null default 0;

-- ── 3. Проблема по задаче дня ──
-- Тип берётся из справочника `erp_dictionaries` (kind='problem_type') — тем же
-- списком, что мастер брака. Сама блокировка этапа остаётся на
-- `erp_item_stages.status='blocked'`: вторая машина состояний рядом с первой
-- разошлась бы с ней на первом же граничном случае.
alter table public.erp_calendar_slots
  add column if not exists problem_type text,
  add column if not exists problem_note text,
  add column if not exists problem_affects_due boolean not null default false,
  add column if not exists problem_needs_help boolean not null default false,
  add column if not exists problem_can_continue boolean not null default true;

-- Одна задача на этап в один день: две строки на ту же дату означали бы два разных
-- плана на одну работу, и «сколько сегодня надо» перестало бы иметь ответ.
--
-- Отсюда же способ убрать задачу из плана: не DELETE, а `status='cancelled'`
-- (DELETE на этой таблице и так только у админа). Снятая задача остаётся в истории
-- вместе с уже внесённым фактом, а повторная постановка на ту же дату проходит
-- upsert-ом по этому индексу — без него вторая попытка падала бы на 23505.
create unique index if not exists erp_calendar_stage_date_idx
  on public.erp_calendar_slots (stage_id, work_date) where stage_id is not null;

create index if not exists erp_calendar_date_idx
  on public.erp_calendar_slots (work_date);

drop trigger if exists erp_calendar_slots_touch on public.erp_calendar_slots;
create trigger erp_calendar_slots_touch before update on public.erp_calendar_slots
  for each row execute function public.erp_set_updated_at();

comment on column public.erp_calendar_slots.comment is
  'Комментарий руководителя производства при постановке задачи (последовательность, приоритет, особенности).';
comment on column public.erp_calendar_slots.fact_comment is
  'Комментарий ответственного за цех при внесении факта.';
comment on column public.erp_calendar_slots.sort_order is
  'Очерёдность внутри дня. numeric — вставка между соседями считается серединой (как queue_position).';

-- ── 4. Переписка по задаче дня ──
-- Отдельная таблица, а не поле: менеджер просит видеть на карточке количество
-- сообщений, автора последнего и признак нового. Прочтения на сервере НЕ храним —
-- это отдельная таблица на пользователя × задачу; «новое» считается от отметки
-- последнего открытия в localStorage. Дёшево и достаточно для смены.
create table if not exists public.erp_plan_comments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.erp_calendar_slots(id) on delete cascade,
  author text not null,
  side text not null check (side in ('manager', 'shop')),
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists erp_plan_comments_slot_idx
  on public.erp_plan_comments (slot_id, created_at);

alter table public.erp_plan_comments enable row level security;

drop policy if exists erp_plan_comments_read on public.erp_plan_comments;
create policy erp_plan_comments_read on public.erp_plan_comments
  for select to authenticated using (public.erp_is_member());
drop policy if exists erp_plan_comments_insert on public.erp_plan_comments;
create policy erp_plan_comments_insert on public.erp_plan_comments
  for insert to authenticated with check (public.erp_is_member());
drop policy if exists erp_plan_comments_update on public.erp_plan_comments;
create policy erp_plan_comments_update on public.erp_plan_comments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists erp_plan_comments_delete on public.erp_plan_comments;
create policy erp_plan_comments_delete on public.erp_plan_comments
  for delete to authenticated using (public.is_admin());

-- ── 5. Роль «Руководитель производства» ──
-- Отдельная роль, а не «диспетчер»: в матрице прав она отвечает за план, а
-- диспетчер — за текущую диспетчеризацию. Смешать их значило бы, что снятая
-- у одного галочка отключает работу другого.
alter table public.erp_employees drop constraint if exists erp_employees_role_check;
alter table public.erp_employees add constraint erp_employees_role_check
  check (role in (
    'worker','foreman','dispatcher','purchaser','storekeeper','hr','manager','director',
    'production_head'
  ));

-- ── 6. Права планирования ──
--   plan.manage — ставить и менять план (даты, количество, приоритет, очерёдность)
--   plan.fact   — вносить факт, брак, комментарий и проблему по своей задаче
-- Ответственный за цех план НЕ меняет: у него только plan.fact, и «свой ли цех»
-- проверяется отдельно привязкой erp_employees (canActIn).
insert into public.erp_role_permissions (role, permission, allowed)
select r.role, p.permission,
  case p.permission
    when 'plan.manage' then r.role in ('director', 'production_head')
    else r.role in ('director', 'production_head', 'dispatcher', 'foreman', 'worker')
  end
from (values
  ('director'),('production_head'),('dispatcher'),('manager'),('foreman'),
  ('worker'),('purchaser'),('storekeeper'),('hr')
) as r(role)
cross join (values ('plan.manage'), ('plan.fact')) as p(permission)
on conflict (role, permission) do nothing;

-- Новая роль должна получить и все прежние права руководителя производства:
-- без этого она видит план, но не может ни взять задание, ни перенести его.
insert into public.erp_role_permissions (role, permission, allowed)
select 'production_head', p.permission, p.permission <> 'catalog.edit'
from (values
  ('stage.take'),('stage.progress'),('stage.complete'),('stage.block'),('stage.defect'),
  ('stage.priority'),('stage.move_department'),('order.manage'),('tz.manage'),
  ('material.receive'),('catalog.edit')
) as p(permission)
on conflict (role, permission) do nothing;

-- Realtime: факт из цеха долетает до открытого плана руководителя без перезагрузки —
-- ровно то, что требование называет «видит изменения в реальном времени».
do $$ begin
  alter publication supabase_realtime add table public.erp_calendar_slots;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.erp_plan_comments;
exception when duplicate_object then null; end $$;
