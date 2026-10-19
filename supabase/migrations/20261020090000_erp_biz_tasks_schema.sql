-- Правки 19.10, п. 7 — «Бизнес-задачи» к заказам. Миграция T1: СХЕМА.
--
-- ЧТО ЭТО. Поручение сотруднику по заказу — доставка, закупка, другое —
-- с ответственным, сроком, статусом, наблюдателями, чек-листом, результатом,
-- своим диалогом, файлами и историей. Здесь только таблицы, ограничения,
-- RLS и привязки к существующим таблицам; писатели (RPC) — миграция T2
-- `20261020100000_erp_biz_tasks_rpc`, диалог и напоминания — там же.
--
-- КЛИЕНТ ТОЛЬКО ЧИТАЕТ. У новых таблиц ровно одна политика — SELECT для
-- `erp_is_member()` (решение владельца Р1: видимость как у заказа и чата
-- сделки); у личной отметки «видел» — только своя строка. Политик записи
-- нет вовсе, а у authenticated сняты INSERT/UPDATE/DELETE: единственный
-- вход — `security definer` RPC, и событие истории с уведомлениями ложится
-- той же транзакцией, что и само изменение. Это «гейт живёт у писателя» —
-- тот же приём, что у переписки и уведомлений.
--
-- ДИАЛОГ — тред существующего чата с якорем `task_id` и `order_id = null`:
-- тред задачи не попадает ни в один поиск треда сделки (`erp_chat_thread_
-- order_uniq` не меняется), заказ находится через `erp_biz_tasks`.
--
-- ФАЙЛЫ — `erp_order_attachments`, вид `biz_task`, колонка `biz_task_id`.
-- ИМЯ НЕ `task_id`: эта колонка у вложений уже есть с 24.08 и ссылается
-- на задачу РАЗРАБОТКИ (`erp_experimental_tasks`). Прямую вставку файла
-- задачи запирает restrictive-политика — пишет только RPC задачи.
--
-- МЕНЕДЖЕР ЗАКАЗА (решение Р3) — `erp_orders.manager_id` → профиль. Ставит
-- его подлинный запуск из «Оформления заказа» (автор заказа v4) — внутри
-- `erp_create_order`, а вручную — `order.manage` в карточке (страж заказа
-- сравнивает снимки строки, и новая колонка охраняется по умолчанию).
-- Ссылка `on delete set null` на таблицу со стражем требует ветки «родитель
-- удалён» — она добавлена (сторож `guardSetNull.test.ts`).
--
-- ПРИМЕНЕНИЕ — владелец в SQL Editor: сухой прогон (`begin; … rollback;`),
-- затем применение и `notify pgrst, 'reload schema'`.

-- ── Задача ────────────────────────────────────────────────────────────────
create table if not exists public.erp_biz_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  title text not null,
  kind text not null,
  description text,
  assignee_id uuid not null references public.profiles(id),
  creator_id uuid not null references public.profiles(id),
  due_at timestamptz not null,
  status text not null default 'new',
  review_required boolean not null default false,
  pause_reason text,
  cancel_reason text,
  return_reason text,
  result_text text,
  result_message_id uuid references public.erp_chat_messages(id) on delete set null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  client_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_biz_tasks_title_check
    check (char_length(btrim(title)) between 1 and 200),
  constraint erp_biz_tasks_kind_check
    check (kind in ('delivery', 'purchase', 'other')),
  constraint erp_biz_tasks_status_check
    check (status in ('new', 'in_progress', 'paused', 'review', 'done', 'cancelled')),
  constraint erp_biz_tasks_description_check
    check (description is null or char_length(description) <= 10000),
  constraint erp_biz_tasks_texts_check
    check (coalesce(char_length(pause_reason), 0) <= 2000
       and coalesce(char_length(cancel_reason), 0) <= 2000
       and coalesce(char_length(return_reason), 0) <= 2000
       and coalesce(char_length(result_text), 0) <= 10000)
);

create index if not exists erp_biz_tasks_order_idx on public.erp_biz_tasks (order_id);
create index if not exists erp_biz_tasks_assignee_idx on public.erp_biz_tasks (assignee_id, status);
create index if not exists erp_biz_tasks_creator_idx on public.erp_biz_tasks (creator_id, status);
create index if not exists erp_biz_tasks_due_idx on public.erp_biz_tasks (status, due_at);
create index if not exists erp_biz_tasks_result_message_idx
  on public.erp_biz_tasks (result_message_id) where result_message_id is not null;

-- `updated_at` — версия строки для `p_expected_updated_at` писателей
-- («Задача изменена — обновите карточку»); ставит общий триггер ERP
drop trigger if exists erp_biz_tasks_touch on public.erp_biz_tasks;
create trigger erp_biz_tasks_touch before update on public.erp_biz_tasks
  for each row execute function public.erp_set_updated_at();

comment on table public.erp_biz_tasks is
  'Бизнес-задача к заказу (правки 19.10, п. 7): поручение сотруднику — доставка, закупка, другое. Клиент только читает; пишут RPC erp_biz_task_* (событие и уведомления одной транзакцией). Удаления нет — только отмена с причиной.';

-- ── Наблюдатели ───────────────────────────────────────────────────────────
create table if not exists public.erp_biz_task_watchers (
  task_id uuid not null references public.erp_biz_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists erp_biz_task_watchers_user_idx on public.erp_biz_task_watchers (user_id);

-- ── Чек-лист ──────────────────────────────────────────────────────────────
create table if not exists public.erp_biz_task_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.erp_biz_tasks(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  sort int not null default 0,
  done_by uuid references public.profiles(id) on delete set null,
  done_at timestamptz,
  constraint erp_biz_task_checklist_text_check
    check (char_length(btrim(text)) between 1 and 500)
);

create index if not exists erp_biz_task_checklist_task_idx
  on public.erp_biz_task_checklist (task_id, sort);

-- ── История ───────────────────────────────────────────────────────────────
create table if not exists public.erp_biz_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.erp_biz_tasks(id) on delete cascade,
  kind text not null,
  actor uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  at timestamptz not null default now(),
  constraint erp_biz_task_events_kind_check
    check (kind in ('created', 'started', 'paused', 'resumed', 'submitted', 'accepted',
                    'returned', 'completed', 'cancelled', 'reopened', 'assignee_changed',
                    'due_changed', 'watchers_changed', 'edited', 'result_changed',
                    'checklist_changed', 'due_soon', 'overdue'))
);

create index if not exists erp_biz_task_events_task_idx on public.erp_biz_task_events (task_id, at);

-- Напоминание о сроке — одно на задачу, вид и срок: два прогона напоминаний
-- подряд дают одну строку (`on conflict do nothing`), а перенос срока —
-- новый ключ и новое право на напоминание
create unique index if not exists erp_biz_task_events_due_uniq
  on public.erp_biz_task_events (task_id, kind, due_at)
  where kind in ('due_soon', 'overdue');

-- ── Отметка «видел» ───────────────────────────────────────────────────────
-- Факт прочтения хранится отдельно от статуса: открытие карточки не означает
-- «Взять в работу» (документ, «Статусы и действия»)
create table if not exists public.erp_biz_task_seen (
  task_id uuid not null references public.erp_biz_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists erp_biz_task_seen_user_idx on public.erp_biz_task_seen (user_id);

-- ── RLS: только чтение ────────────────────────────────────────────────────
alter table public.erp_biz_tasks enable row level security;
alter table public.erp_biz_task_watchers enable row level security;
alter table public.erp_biz_task_checklist enable row level security;
alter table public.erp_biz_task_events enable row level security;
alter table public.erp_biz_task_seen enable row level security;

create policy erp_biz_tasks_read on public.erp_biz_tasks
  for select to authenticated using ((select public.erp_is_member()));
create policy erp_biz_task_watchers_read on public.erp_biz_task_watchers
  for select to authenticated using ((select public.erp_is_member()));
create policy erp_biz_task_checklist_read on public.erp_biz_task_checklist
  for select to authenticated using ((select public.erp_is_member()));
create policy erp_biz_task_events_read on public.erp_biz_task_events
  for select to authenticated using ((select public.erp_is_member()));
-- Отметка «видел» — ЛИЧНАЯ (ревизия безопасности B1): каждый читает только
-- свою. Иначе любой участник ERP видел бы, кто и когда открывал какие задачи.
-- Постановщику и manage факт «ответственный открыл задачу» отдаёт писатель
-- `erp_biz_task_seen_by(p_id)` с проверкой участия (миграция T2)
create policy erp_biz_task_seen_read on public.erp_biz_task_seen
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.erp_biz_tasks from public, anon;
revoke all on table public.erp_biz_task_watchers from public, anon;
revoke all on table public.erp_biz_task_checklist from public, anon;
revoke all on table public.erp_biz_task_events from public, anon;
revoke all on table public.erp_biz_task_seen from public, anon;
revoke insert, update, delete, truncate on table public.erp_biz_tasks from authenticated;
revoke insert, update, delete, truncate on table public.erp_biz_task_watchers from authenticated;
revoke insert, update, delete, truncate on table public.erp_biz_task_checklist from authenticated;
revoke insert, update, delete, truncate on table public.erp_biz_task_events from authenticated;
revoke insert, update, delete, truncate on table public.erp_biz_task_seen from authenticated;
grant select on table public.erp_biz_tasks to authenticated;
grant select on table public.erp_biz_task_watchers to authenticated;
grant select on table public.erp_biz_task_checklist to authenticated;
grant select on table public.erp_biz_task_events to authenticated;
grant select on table public.erp_biz_task_seen to authenticated;

-- ── Тред задачи ───────────────────────────────────────────────────────────
alter table public.erp_chat_threads
  add column if not exists task_id uuid references public.erp_biz_tasks(id) on delete cascade;

-- РОВНО ОДИН якорь: сделка, разработка или задача. У треда задачи `order_id`
-- пуст — иначе он попал бы в поиск треда сделки и в счётчики её чата
alter table public.erp_chat_threads
  drop constraint if exists erp_chat_thread_anchor;
alter table public.erp_chat_threads
  add constraint erp_chat_thread_anchor check (
    (order_id is not null)::int + (experimental_id is not null)::int
    + (task_id is not null)::int = 1);

-- «Один диалог на задачу» — ограничение базы, а не соглашение кода
create unique index if not exists erp_chat_thread_task_uniq
  on public.erp_chat_threads (task_id) where task_id is not null;

-- ── Файлы задачи ──────────────────────────────────────────────────────────
alter table public.erp_order_attachments
  add column if not exists biz_task_id uuid
    references public.erp_biz_tasks(id) on delete cascade;

create index if not exists erp_att_biz_task_idx
  on public.erp_order_attachments (biz_task_id) where biz_task_id is not null;

comment on column public.erp_order_attachments.biz_task_id is
  'Бизнес-задача, к которой приложен файл (правки 19.10, п. 7). Не task_id: та колонка — задача разработки (24.08). Пишет только RPC задачи.';

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;

alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'print', 'label', 'note',
                  'dev_pattern', 'dev_passport', 'dev_photo', 'dev_task',
                  'stage_result', 'production',
                  'chat',
                  -- Файл бизнес-задачи: описание, обсуждение, результат.
                  -- В сводную DELETE-политику не входит — как и файл чата
                  'biz_task'));

-- RESTRICTIVE: пермиссивная `erp_order_attachments_insert` (`with check
-- (true)`) по-прежнему пускает обычные вложения, а эта отсекает файл задачи
-- при ЛЮБОЙ прямой вставке. Писатель — `security definer` RPC задачи
-- (владелец таблицы RLS не проходит), он проверяет участника и путь объекта
drop policy if exists erp_order_attachments_no_biz_task on public.erp_order_attachments;
create policy erp_order_attachments_no_biz_task on public.erp_order_attachments
  as restrictive
  for insert to authenticated
  with check (kind <> 'biz_task' and biz_task_id is null);

-- Страж вложений (`erp_attachment_guard`, 24.09) не пересоздаётся: он
-- сравнивает снимки строки минус `kind`, поэтому `biz_task_id` неизменен
-- по умолчанию, а перекладывать между папками разрешено только `attachment`
-- и `production` — файл задачи в папку сделки не уедет. Каскадное удаление
-- задачи — DELETE, а не UPDATE, и стража не задевает.

-- ── Уведомления задачи ────────────────────────────────────────────────────
alter table public.erp_notifications
  add column if not exists task_id uuid
    references public.erp_biz_tasks(id) on delete cascade;
alter table public.erp_notifications
  add column if not exists task_event_id bigint
    references public.erp_biz_task_events(id) on delete cascade;

-- Одно событие — одно уведомление человеку, сколько бы ролей у него ни было
-- (постановщик = менеджер заказа = наблюдатель). Ограничение базы, а не кода
create unique index if not exists erp_notifications_task_event_uniq
  on public.erp_notifications (user_id, task_event_id) where task_event_id is not null;
create index if not exists erp_notifications_task_idx
  on public.erp_notifications (task_id) where task_id is not null;

alter table public.erp_notifications
  drop constraint if exists erp_notifications_kind_check;
alter table public.erp_notifications
  add constraint erp_notifications_kind_check
  check (kind in ('chat_mention', 'chat_reply', 'chat_message',
                  'task_assigned', 'task_unassigned', 'task_status', 'task_review',
                  'task_returned', 'task_due_soon', 'task_overdue', 'task_mention'));

-- Страж уведомления (`erp_notification_guard`) сравнивает снимки минус
-- `read_at`: новые колонки защищены по умолчанию, пересоздавать его не нужно

-- ── Realtime: «звонок» в существующем канале ─────────────────────────────
-- Подписаны ровно задача и её события. Наблюдатели и чек-лист меняются
-- только вместе с событием задачи, отметка «видел» — личная
alter publication supabase_realtime add table public.erp_biz_tasks, public.erp_biz_task_events;

-- ── Право «Управлять бизнес-задачами» (решение Р2) ───────────────────────
-- По должности ERP: директор (к нему же приводятся admin и director профиля),
-- руководитель производства, менеджер. Диспетчеру — нет: он распоряжается
-- очередью цехов. Строки `admin` в матрице не бывает — это роль профиля,
-- `erp_role_of_caller()` приводит её к `director`
insert into public.erp_role_permissions (role, permission, allowed) values
  ('director', 'biz_task.manage', true),
  ('production_head', 'biz_task.manage', true),
  ('manager', 'biz_task.manage', true)
on conflict (role, permission) do nothing;

-- ── Менеджер заказа (решение Р3) ─────────────────────────────────────────
alter table public.erp_orders
  add column if not exists manager_id uuid references public.profiles(id) on delete set null;

create index if not exists erp_orders_manager_idx
  on public.erp_orders (manager_id) where manager_id is not null;

comment on column public.erp_orders.manager_id is
  'Менеджер заказа — профиль (правки 19.10, п. 7, Р3). Ставит подлинный запуск из «Оформления заказа» (автор заказа v4) либо order.manage в карточке. Пусто — менеджер не наблюдатель задач и не получатель уведомлений. Текстовое manager — подпись из формы, другое поле.';

-- Страж заказа: пересоздан ДОСЛОВНО по `20260924122634_erp_order_guard_
-- exceptions` плюс ветка INSERT (ревизия безопасности 19.10, ниже) и ветка
-- «родитель удалён». Удаление профиля обнуляет
-- `manager_id` UPDATE-ом строки заказа от имени удаляющего, и без ветки это
-- падало бы 42501 у того, у кого нет `order.manage`: ошибка про заказ в ответ
-- на удаление профиля. Ветка пропускает ровно этот случай — ссылка ушла
-- в NULL, профиля больше нет, и больше в строке не изменилось ничего.
create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ship boolean;
  v_rest boolean;
begin
  -- Пустой `auth.uid()` — это service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  -- ── INSERT: менеджер заказа (ревизия безопасности 19.10) ──
  -- Прямую вставку `erp_orders` старая политика открывает любому участнику
  -- ERP, и без этой ветки он назначал бы себя (или кого угодно) менеджером:
  -- наблюдателем бизнес-задач заказа и получателем их уведомлений. Пустой
  -- менеджер — прежнее поведение вставки, страж её не трогает.
  if tg_op = 'INSERT' then
    if new.manager_id is null then
      return new;
    end if;

    -- Подлинный запуск: ровно то значение, которое вычисляет
    -- `erp_create_order` (автор заказа v4, который вызывающий сейчас
    -- запускает своей свежей меткой, заказа ERP у него ещё нет). Совпадение
    -- сверяется здесь заново, а не меткой сессии: подставить чужое значение
    -- нельзя, а своё подлинное — то же, что поставила бы функция. Автор v4
    -- не обязан иметь карточку ERP — карточку проверяет ветка ниже
    if exists (
      select 1
        from public.orders v
       where v.id = new.tz_order_id
         and v.schema_version = 4
         and v.status = 'ready_to_launch'
         and v.erp_order_id is null
         and v.launch_by = (select auth.uid())
         and v.launch_started_at > now() - interval '10 minutes'
         and v.created_by = new.manager_id
    ) then
      return new;
    end if;

    if not public.erp_has_permission('order.manage') then
      raise exception 'erp_order_guard: менеджера заказа назначает право order.manage'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
        from public.erp_employees e
        join public.profiles p on p.id = e.profile_id
       where e.profile_id = new.manager_id
         and e.active and p.active is true and p.approved is true
    ) then
      raise exception 'erp_order_guard: менеджером заказа можно назначить только сотрудника ERP'
        using errcode = '22023';
    end if;

    return new;
  end if;

  -- Родитель удалён: `manager_id` уходит в NULL каскадом `on delete set null`
  -- (удаление профиля), это не правка заказа
  if new.manager_id is null and old.manager_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.manager_id)
     and (to_jsonb(new) - 'manager_id' - 'updated_at') = (to_jsonb(old) - 'manager_id' - 'updated_at') then
    return new;
  end if;

  -- ── Отгрузка и закрытие заказа ──
  -- Единственная ветка, которую ведёт не менеджер: склад отгружает и закрывает
  v_ship :=
       new.status          is distinct from old.status
    or new.shipped_status  is distinct from old.shipped_status
    or new.shipped_at      is distinct from old.shipped_at
    or new.shipped_by      is distinct from old.shipped_by;

  -- Всё остальное — одним сравнением снимков, без перечисления колонок
  -- (24.09): новая колонка, в том числе `manager_id`, охраняется по умолчанию
  v_rest := (to_jsonb(new) - 'status' - 'shipped_status' - 'shipped_at'
              - 'shipped_by' - 'updated_at')
        is distinct from
            (to_jsonb(old) - 'status' - 'shipped_status' - 'shipped_at'
              - 'shipped_by' - 'updated_at');

  if v_rest and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  -- Менеджер заказа — только СОТРУДНИК ERP (Р3): активная карточка
  -- `erp_employees` у активного одобренного профиля — то же множество, что
  -- список карточки (`erp_chat_directory`, `role` не пустой). Без проверки
  -- `order.manage` прямым PATCH ставил бы любой профиль, и тот становился бы
  -- наблюдателем бизнес-задач заказа и получателем их уведомлений.
  -- Проверяется только СМЕНА: прежнее значение (в том числе автор заказа v4
  -- из подлинного запуска) правку других полей не запирает.
  if new.manager_id is not null
     and new.manager_id is distinct from old.manager_id
     and not exists (
       select 1
         from public.erp_employees e
         join public.profiles p on p.id = e.profile_id
        where e.profile_id = new.manager_id
          and e.active and p.active is true and p.approved is true
     ) then
    raise exception 'erp_order_guard: менеджером заказа можно назначить только сотрудника ERP'
      using errcode = '22023';
  end if;

  if v_ship
     and not (public.erp_has_permission('warehouse.manage')
              or public.erp_has_permission('order.manage')) then
    raise exception 'erp_order_guard: отгрузка и закрытие заказа требуют права warehouse.manage или order.manage'
      using errcode = '42501';
  end if;

  return new;
end $function$;

revoke execute on function public.erp_order_guard() from public, anon, authenticated;

-- Страж стоял на UPDATE (`20260803280000_erp_order_guard`); теперь и на
-- INSERT — ради ветки менеджера заказа выше. Имя триггера прежнее
create or replace trigger erp_orders_guard
  before insert or update on public.erp_orders
  for each row execute function public.erp_order_guard();

-- ── Создание заказа ставит менеджера при подлинном запуске ───────────────
--
-- Функция пересоздана ЦЕЛИКОМ по тексту `20260907203932_erp_garment_source`
-- (последняя редакция: `latestDefining('erp_create_order')`). Добавлено ровно
-- одно: переменная `v_manager_id`, её выбор и колонка `manager_id` в INSERT
-- заказа (сторож `bizTasksSchema.test.ts` сверяет, что каждая прежняя строка
-- осталась на месте и в том же порядке).
--
-- ПОДЛИННЫЙ ЗАПУСК — это заказ v4, который ВЫЗЫВАЮЩИЙ прямо сейчас запускает:
-- `ready_to_launch`, метка запуска его и свежая (10 минут — тот же срок,
-- что у чужой метки в `order_v4_launch_check`), заказа ERP у него ещё нет.
-- Из присланного тела `manager_id` не читается никогда: подставной
-- `tz_order_id` чужого заказа или заказ, заведённый в ERP руками, дают NULL.
-- Функция — invoker: строку `orders` она видит только при праве её читать,
-- и отсутствие права тоже даёт NULL, а не ошибку.

create or replace function public.erp_create_order(payload jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_order jsonb := payload->'order';
  v_order_id uuid;
  v_due date;
  v_queue_pos numeric;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
  v_print jsonb;
  v_print_id uuid;
  v_label jsonb;
  v_label_id uuid;
  v_note jsonb;
  v_note_id uuid;
  v_note_ids uuid[] := '{}';
  v_stage jsonb;
  v_stage_id uuid;
  v_stage_ids uuid[];
  v_depends uuid[];
  v_mat jsonb;
  v_mat_id uuid;
  v_mat_ids uuid[] := '{}';
  v_doc jsonb;
  v_att jsonb;
  v_idx int;
  -- Файлы подрядного этапа: этап адресуется парой «позиция:этап»
  v_stage_all uuid[] := '{}';
  v_stage_keys text[] := '{}';
  -- Макеты нанесений и бирок — тем же приёмом, парой «позиция:номер»
  v_print_all uuid[] := '{}';
  v_print_keys text[] := '{}';
  v_label_all uuid[] := '{}';
  v_label_keys text[] := '{}';
  v_item_idx int := 0;
  v_st_idx int;
  v_pr_idx int;
  v_lb_idx int;
  v_at int;
  v_ap int;
  v_al int;
  v_nt_idx int := 0;
  -- Менеджер заказа (правки 19.10, п. 7, Р3): только при подлинном запуске
  v_manager_id uuid;
begin
  if v_order is null or coalesce(v_order->>'title', '') = '' then
    raise exception 'erp_create_order: order.title is required';
  end if;

  v_due := (v_order->>'due_date')::date;
  v_queue_pos := public.erp_default_queue_position(v_due);

  -- Подлинный запуск из «Оформления заказа»: вызывающий сейчас запускает
  -- этот заказ v4 (свежая своя метка, заказа ERP ещё нет). Иначе — NULL
  select v.created_by
    into v_manager_id
    from public.orders v
   where v.id = nullif(v_order->>'tz_order_id', '')::uuid
     and v.schema_version = 4
     and v.status = 'ready_to_launch'
     and v.erp_order_id is null
     and v.launch_by = (select auth.uid())
     and v.launch_started_at > now() - interval '10 minutes';

  insert into erp_orders
    (bitrix_id, title, customer, manager, launch_date, due_date, buffer_days, notes,
     packaging, packaging_note, packaging_width_mm, packaging_height_mm,
     stickers, stickers_note, no_chestny_znak,
     status, created_by, tz_required, tz_order_id, tz_number, purchase_required, manager_id)
  values
    (v_order->>'bitrix_id',
     v_order->>'title',
     v_order->>'customer',
     v_order->>'manager',
     (v_order->>'launch_date')::date,
     v_due,
     coalesce((v_order->>'buffer_days')::int, 0),
     v_order->>'notes',
     coalesce(v_order->>'packaging', 'none'),
     v_order->>'packaging_note',
     (v_order->>'packaging_width_mm')::int,
     (v_order->>'packaging_height_mm')::int,
     coalesce(v_order->>'stickers', 'none'),
     v_order->>'stickers_note',
     coalesce((v_order->>'no_chestny_znak')::boolean, false),
     coalesce(v_order->>'status', 'active'),
     nullif(v_order->>'created_by', '')::uuid,
     coalesce((v_order->>'tz_required')::boolean, true),
     nullif(v_order->>'tz_order_id', '')::uuid,
     v_order->>'tz_number',
     coalesce((v_order->>'purchase_required')::boolean, true),
     v_manager_id)
  returning id into v_order_id;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    insert into erp_order_items
      (order_id, product_type, variant, qty, production_type,
       branding_methods, branding_on, notes, size_grid, sort_order,
       subcontract_kind, material_source,
       fit, main_fabric, trim_material, cutting_note, sewing_note, labels_note,
       packaging, packaging_size, sticker_place, marking_place, packaging_note,
       packaging_width_mm, packaging_height_mm, garment_source)
    values
      (v_order_id,
       v_item->>'product_type',
       v_item->>'variant',
       (v_item->>'qty')::int,
       coalesce(v_item->>'production_type', 'sewing'),
       coalesce(
         (select array_agg(t.x)
            from jsonb_array_elements_text(
              case when jsonb_typeof(v_item->'branding_methods') = 'array'
                   then v_item->'branding_methods' else '[]'::jsonb end) as t(x)),
         '{}'),
       coalesce(v_item->>'branding_on', 'cut'),
       v_item->>'notes',
       case when jsonb_typeof(v_item->'size_grid') = 'array'
            then v_item->'size_grid' end,
       coalesce((v_item->>'sort_order')::int, 0),
       v_item->>'subcontract_kind',
       v_item->>'material_source',
       v_item->>'fit',
       v_item->>'main_fabric',
       v_item->>'trim_material',
       v_item->>'cutting_note',
       v_item->>'sewing_note',
       v_item->>'labels_note',
       coalesce(v_item->>'packaging', 'inherit'),
       v_item->>'packaging_size',
       v_item->>'sticker_place',
       v_item->>'marking_place',
       v_item->>'packaging_note',
       (v_item->>'packaging_width_mm')::int,
       (v_item->>'packaging_height_mm')::int,
       v_item->>'garment_source')
    returning id into v_item_id;

    v_item_ids := v_item_ids || v_item_id;

    v_pr_idx := 0;
    for v_print in
      select * from jsonb_array_elements(coalesce(v_item->'prints', '[]'::jsonb))
    loop
      insert into erp_item_prints
        (item_id, seq, method, fabric, zone, width_mm, height_mm,
         offset_note, pantone, comment, special, garment_kind)
      values
        (v_item_id,
         coalesce((v_print->>'seq')::int, 1),
         v_print->>'method',
         v_print->>'fabric',
         v_print->>'zone',
         (v_print->>'width_mm')::int,
         (v_print->>'height_mm')::int,
         v_print->>'offset_note',
         v_print->>'pantone',
         v_print->>'comment',
         v_print->>'special',
         v_print->>'garment_kind')
      returning id into v_print_id;

      v_print_all := v_print_all || v_print_id;
      v_print_keys := v_print_keys || (v_item_idx::text || ':' || v_pr_idx::text);
      v_pr_idx := v_pr_idx + 1;
    end loop;

    -- Бирки позиции (п. 5.3). Одно текстовое поле `labels_note` осталось
    -- в схеме: его несут заведённые заказы, и переносить свободный текст
    -- в поля может только человек
    v_lb_idx := 0;
    for v_label in
      select * from jsonb_array_elements(coalesce(v_item->'labels', '[]'::jsonb))
    loop
      insert into erp_item_labels
        (item_id, seq, label_type, place, size, comment)
      values
        (v_item_id,
         coalesce((v_label->>'seq')::int, v_lb_idx + 1),
         v_label->>'label_type',
         v_label->>'place',
         v_label->>'size',
         v_label->>'comment')
      returning id into v_label_id;

      v_label_all := v_label_all || v_label_id;
      v_label_keys := v_label_keys || (v_item_idx::text || ':' || v_lb_idx::text);
      v_lb_idx := v_lb_idx + 1;
    end loop;

    v_stage_ids := '{}';
    v_st_idx := 0;
    for v_stage in
      select * from jsonb_array_elements(coalesce(v_item->'stages', '[]'::jsonb))
    loop
      select coalesce(array_agg(v_stage_ids[(d.idx)::int + 1]), '{}')
        into v_depends
        from jsonb_array_elements_text(coalesce(v_stage->'depends_on', '[]'::jsonb)) as d(idx)
       where v_stage_ids[(d.idx)::int + 1] is not null;

      insert into erp_item_stages
        (item_id, department_id, sort_order, depends_on, queue_position,
         executor, contractor, operation)
      values
        (v_item_id,
         (v_stage->>'department_id')::uuid,
         coalesce((v_stage->>'sort_order')::int, 0),
         coalesce(v_depends, '{}'),
         v_queue_pos,
         coalesce(v_stage->>'executor', 'internal'),
         v_stage->>'contractor',
         v_stage->>'operation')
      returning id into v_stage_id;

      if coalesce(v_stage->>'executor', 'internal') = 'contractor' then
        insert into erp_subcontracting
          (order_id, item_id, stage_id, operation, contractor, qty, material_source,
           send_plan_date, planned_date, responsible, materials_note, comment)
        select v_order_id, v_item_id, v_stage_id,
               coalesce(nullif(btrim(coalesce(v_stage->>'operation', '')), ''), d.name),
               v_stage->>'contractor',
               coalesce((v_stage->>'qty')::int, (v_item->>'qty')::int, 0),
               coalesce(v_item->>'material_source', 'pinhead'),
               (v_stage->>'send_plan_date')::date,
               (v_stage->>'planned_date')::date,
               v_stage->>'responsible',
               v_stage->>'materials_note',
               v_stage->>'comment'
          from erp_departments d
         where d.id = (v_stage->>'department_id')::uuid;
      end if;

      v_stage_ids := v_stage_ids || v_stage_id;
      v_stage_all := v_stage_all || v_stage_id;
      v_stage_keys := v_stage_keys || (v_item_idx::text || ':' || v_st_idx::text);
      v_st_idx := v_st_idx + 1;
    end loop;

    v_item_idx := v_item_idx + 1;
  end loop;

  v_mat_ids := '{}';
  for v_mat in
    select * from jsonb_array_elements(coalesce(payload->'materials', '[]'::jsonb))
  loop
    insert into erp_materials
      (order_id, item_id, kind, name, source, qty, status, eta_date, notes,
       role, color, article, supplier, qty_expected, unit, manager_note)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_mat->'item_index') = 'number'
         then v_item_ids[(v_mat->>'item_index')::int + 1]
       end,
       coalesce(v_mat->>'kind', 'other'),
       v_mat->>'name',
       coalesce(v_mat->>'source', 'purchase'),
       v_mat->>'qty',
       coalesce(v_mat->>'status', 'pending'),
       (v_mat->>'eta_date')::date,
       v_mat->>'notes',
       v_mat->>'role',
       v_mat->>'color',
       v_mat->>'article',
       v_mat->>'supplier',
       (v_mat->>'qty_expected')::numeric,
       v_mat->>'unit',
       v_mat->>'manager_note')
    returning id into v_mat_id;

    v_mat_ids := v_mat_ids || v_mat_id;
  end loop;

  for v_doc in
    select * from jsonb_array_elements(coalesce(payload#>'{tz,documents}', '[]'::jsonb))
  loop
    v_idx := (v_doc->>'item_index')::int;
    insert into erp_tz_documents
      (order_id, item_id, group_id, version, is_current,
       file_path, file_name, mime_type, size_bytes, note, uploaded_by)
    values
      (v_order_id,
       case when v_idx is null then null else v_item_ids[v_idx + 1] end,
       (v_doc->>'group_id')::uuid,
       1, true,
       v_doc->>'file_path',
       v_doc->>'file_name',
       v_doc->>'mime_type',
       (v_doc->>'size_bytes')::bigint,
       v_doc->>'note',
       v_doc->>'uploaded_by');
  end loop;

  -- Заметки к заказу (правка 22.08, п. 5.8): то, что нельзя разложить
  -- по структурным полям. Принадлежат ЗАКАЗУ, а не позиции; порядок хранится,
  -- потому что документ требует уметь его менять
  v_nt_idx := 0;
  for v_note in
    select * from jsonb_array_elements(coalesce(payload->'notes', '[]'::jsonb))
  loop
    insert into erp_order_notes (order_id, seq, text, author)
    values
      (v_order_id,
       coalesce((v_note->>'seq')::int, v_nt_idx + 1),
       v_note->>'text',
       v_note->>'author')
    returning id into v_note_id;

    v_note_ids := v_note_ids || v_note_id;
    v_nt_idx := v_nt_idx + 1;
  end loop;

  for v_att in
    select * from jsonb_array_elements(coalesce(payload->'attachments', '[]'::jsonb))
  loop
    v_at := case
      when jsonb_typeof(v_att->'stage_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_stage_keys,
             (v_att->>'item_index') || ':' || (v_att->>'stage_index'))
    end;
    -- Отсутствие ключа читается как «файл не нанесения», а не как ошибка:
    -- секцию шлют и старые сборки клиента
    v_ap := case
      when jsonb_typeof(v_att->'print_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_print_keys,
             (v_att->>'item_index') || ':' || (v_att->>'print_index'))
    end;
    v_al := case
      when jsonb_typeof(v_att->'label_index') = 'number'
       and jsonb_typeof(v_att->'item_index') = 'number'
      then array_position(v_label_keys,
             (v_att->>'item_index') || ':' || (v_att->>'label_index'))
    end;

    insert into erp_order_attachments
      (order_id, item_id, material_id, stage_id, print_id, label_id, note_id,
       file_path, file_name, kind, uploaded_by)
    values
      (v_order_id,
       case
         when jsonb_typeof(v_att->'item_index') = 'number'
         then v_item_ids[(v_att->>'item_index')::int + 1]
       end,
       case
         when jsonb_typeof(v_att->'material_index') = 'number'
         then v_mat_ids[(v_att->>'material_index')::int + 1]
       end,
       case when v_at is not null then v_stage_all[v_at] end,
       case when v_ap is not null then v_print_all[v_ap] end,
       case when v_al is not null then v_label_all[v_al] end,
       -- Заметка адресуется НОМЕРОМ: заметки заказа общие, разводить их
       -- по позициям не нужно (в отличие от нанесений)
       case
         when jsonb_typeof(v_att->'note_index') = 'number'
         then v_note_ids[(v_att->>'note_index')::int + 1]
       end,
       v_att->>'file_path',
       v_att->>'file_name',
       coalesce(v_att->>'kind', 'attachment'),
       v_att->>'uploaded_by');
  end loop;

  return v_order_id;
end $$;

revoke execute on function public.erp_create_order(jsonb) from public, anon;
grant execute on function public.erp_create_order(jsonb) to authenticated;

notify pgrst, 'reload schema';
