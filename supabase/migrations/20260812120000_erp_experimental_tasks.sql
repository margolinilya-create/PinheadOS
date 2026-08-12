-- Экспериментальный цех: задачи вместо фаз (ТЗ заказчика 12.08).
--
-- ═══ Зачем ═══
--
-- Текущая модель — жёсткая линейная цепочка из пяти фаз:
--   Построение лекал → Проработка → Примерка → Возврат конструктору → Готов к серии
--
-- Заказчик называет это «главной логической ошибкой»: разработка не линейна.
-- Лекала и подбор материала идут ПАРАЛЛЕЛЬНО, подбор материала может не
-- требоваться вовсе, нанесение появляется только если оно нужно, а «возврат
-- конструктору» — это РЕЗУЛЬТАТ примерки, а не отдельный этап. Циклов
-- «проработка → примерка → доработка → проработка» может быть сколько угодно,
-- и ограничивать их заранее нельзя.
--
-- ═══ Модель ═══
--
-- Разработка = одна карточка + НАБОР НЕОБХОДИМЫХ ЗАДАЧ. Задачи параллельны,
-- необязательны, могут зависеть друг от друга и повторяться циклами.
--
-- ── Почему отдельная таблица, а не `erp_item_stages` ──
--
-- Три независимых препятствия, каждого достаточно:
--
-- 1. `erp_item_stages.department_id` — NOT NULL. «Лекала», «подбор материала»,
--    «примерка» цехами не являются. Псевдо-цеха для них потекли бы во ВСЕ
--    экраны, которые читают цеха из данных (вкладки очереди, колонки канбана,
--    загрузка, план) — ровно то, от чего избавлялись, убирая ОТК.
-- 2. `erp_stage_guard` гейтит смену статуса правами `stage.*` И принадлежностью
--    цеху. Конструктор с `experimental.manage`, но без `stage.take`, не смог бы
--    отметить свои лекала готовыми — получил бы 42501.
-- 3. `erp_warehouse_task_derive` открывает приёмку ГП по условию «нет этапов
--    вне done/skipped». Задачи разработки как этапы заморозили бы отгрузку
--    заказа навсегда.
--
-- ── Почему не переименование `erp_experimental_ops` ──
--
-- Технически rename был бы идеален, но порядок выкладки в проекте —
-- миграция → прод → фронтенд. В окне между ними СТАРЫЙ фронт читает
-- `from('erp_experimental_ops')` и пишет `insert { phase: 'patterns' }`.
-- Новая таблица даёт окно совместимости: обе живут, старые колонки остаются
-- мёртвыми, уборка — отдельным коммитом ПОСЛЕ выкладки экрана.
--
-- ── Что НЕ трогаем ──
--
-- `technologist` НЕ переименовывается в `developer`, хотя заказчик называет
-- эту роль «проработчик». Правило проекта: коды не переименовываются под новые
-- названия, названия живут в подписях. Колонка остаётся, подпись меняется
-- в интерфейсе.
--
-- Гейт отгрузки и приёмка ГП по этапам образца НЕ ослабляются. Соблазн есть:
-- заброшенный цикл разработки оставит открытый этап и остановит отгрузку
-- всего заказа. Но открытый этап и означает незакрытую работу, а ослабленный
-- гейт отпустил бы образец недоделанным. Заброшенный цикл закрывается
-- действием «Пропустить этап» (`skipped`, под `order.manage`, с причиной) —
-- оно для этого и заведено.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Поля разработки
-- ═══════════════════════════════════════════════════════════════════════

alter table public.erp_experimental
  -- Позиция заказа. Чинит эвристику `items[0]` в экране: передача в цех
  -- становится рутиной (ДТФ, шелкография, вышивка — отдельные задачи),
  -- и «у образца позиция, как правило, одна» перестаёт быть приемлемым —
  -- этап уехал бы на чужую позицию вместе со складскими задачами её заказа.
  add column if not exists item_id uuid references public.erp_order_items(id) on delete cascade,
  -- Исход разработки (ТЗ п.9): это ФИНАЛЬНЫЙ СТАТУС, а не очередной этап
  add column if not exists outcome text,
  add column if not exists outcome_comment text,
  add column if not exists closed_at timestamptz,
  -- Шапка карточки (ТЗ п.13)
  add column if not exists owner text,
  add column if not exists dev_type text,
  add column if not exists priority int not null default 0,
  add column if not exists due_date date,
  add column if not exists comment text;

alter table public.erp_experimental
  drop constraint if exists erp_experimental_outcome_check;
alter table public.erp_experimental
  add constraint erp_experimental_outcome_check
  check (outcome is null or outcome in (
    'ready_for_serial', 'needs_rework', 'moved_to_production', 'cancelled', 'other'));

comment on column public.erp_experimental.item_id is
  'Позиция заказа, к которой относится разработка. Заменяет эвристику items[0] на экране: передача задачи в цех создаёт этап именно этой позиции.';
comment on column public.erp_experimental.outcome is
  'Исход разработки (ТЗ п.9). NULL — ещё идёт. Заменяет phase: состояние «что происходит сейчас» ВЫЧИСЛЯЕТСЯ из задач, хранится только финальное решение.';

-- Уникального индекса на `item_id` НЕТ намеренно: у одной позиции может быть
-- несколько разработок подряд (первая закрыта, вторая начата). На боевой базе
-- такой случай уже есть — два заказа `a483ffd9` с разными разработками.

create index if not exists erp_experimental_item_idx
  on public.erp_experimental (item_id) where item_id is not null;
create index if not exists erp_experimental_open_idx
  on public.erp_experimental (outcome) where outcome is null;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Задачи разработки
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.erp_experimental_tasks (
  id              uuid primary key default gen_random_uuid(),
  experimental_id uuid not null references public.erp_experimental(id) on delete cascade,
  -- Тип из справочника `experimental_task_type`; свободный ввод разрешён —
  -- справочник это подсказка, а не ограничение (правило проекта)
  task_type       text not null,
  title           text,
  responsible     text,
  due_date        date,
  status          text not null default 'todo',
  blocked_reason  text,
  -- Зависимости на задачи ТОЙ ЖЕ разработки. Массив, а не таблица связей:
  -- задач у разработки единицы, клиент читает граф целиком, запросов
  -- «кто зависит от X» на сервере нет. Тот же приём, что `erp_item_stages.depends_on`
  depends_on      uuid[] not null default '{}',
  -- Номер круга. Цикл «примерка → доработка → повторная примерка» — это НОВАЯ
  -- строка, а не счётчик: у каждого круга свои ответственный, срок, комментарий
  -- и результат, и счётчик затирал бы историю «что просили на втором круге».
  -- Прецедент в схеме: `erp_item_stages.cycle`
  cycle           int not null default 0,
  sort_order      int not null default 0,
  qty             int,
  comment         text,
  result          text,
  -- Заполнены, только когда задача передана в цех
  department_id   uuid references public.erp_departments(id),
  stage_id        uuid references public.erp_item_stages(id) on delete set null,
  done_on         date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.erp_experimental_tasks
  drop constraint if exists erp_experimental_tasks_status_check;
alter table public.erp_experimental_tasks
  add constraint erp_experimental_tasks_status_check
  check (status in ('todo', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled'));

create index if not exists erp_experimental_tasks_dev_idx
  on public.erp_experimental_tasks (experimental_id, sort_order);
create index if not exists erp_experimental_tasks_open_idx
  on public.erp_experimental_tasks (status) where status not in ('done', 'cancelled');
create unique index if not exists erp_experimental_tasks_stage_key
  on public.erp_experimental_tasks (stage_id) where stage_id is not null;

comment on table public.erp_experimental_tasks is
  'Задачи разработки: параллельные, необязательные, с зависимостями и циклами. Заменяет линейные фазы erp_experimental.phase. Задача, ушедшая в цех, несёт stage_id — её статус ведёт ТРИГГЕР, клиент такую строку только читает.';
comment on column public.erp_experimental_tasks.cycle is
  'Номер круга доработки. Повторная примерка — НОВАЯ строка с cycle+1, а не счётчик на старой: у каждого круга своя история.';
comment on column public.erp_experimental_tasks.department_id is
  'Дублируется рядом со stage_id намеренно: у stage_id стоит on delete set null, и без этой колонки удаление этапа стирало бы память о том, куда передавали.';

-- `updated_at` ведёт тот же триггер, что у остальных таблиц раздела
drop trigger if exists erp_experimental_tasks_touch on public.erp_experimental_tasks;
create trigger erp_experimental_tasks_touch
  before update on public.erp_experimental_tasks
  for each row execute function public.erp_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. RLS — то же право, что у самой разработки
-- ═══════════════════════════════════════════════════════════════════════

alter table public.erp_experimental_tasks enable row level security;

drop policy if exists erp_experimental_tasks_read on public.erp_experimental_tasks;
create policy erp_experimental_tasks_read on public.erp_experimental_tasks
  for select to authenticated using (public.erp_is_member());

drop policy if exists erp_experimental_tasks_insert on public.erp_experimental_tasks;
create policy erp_experimental_tasks_insert on public.erp_experimental_tasks
  for insert to authenticated
  with check (public.erp_has_permission('experimental.manage'));

drop policy if exists erp_experimental_tasks_update on public.erp_experimental_tasks;
create policy erp_experimental_tasks_update on public.erp_experimental_tasks
  for update to authenticated
  using (public.erp_has_permission('experimental.manage'))
  with check (public.erp_has_permission('experimental.manage'));

drop policy if exists erp_experimental_tasks_delete on public.erp_experimental_tasks;
create policy erp_experimental_tasks_delete on public.erp_experimental_tasks
  for delete to authenticated using (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Пачка задач одной транзакцией
-- ═══════════════════════════════════════════════════════════════════════
--
-- Зависимости внутри пачки задаются ИНДЕКСАМИ элементов массива — ровно так же,
-- как этапы в `erp_create_order`. Иначе клиенту пришлось бы вставлять задачи
-- по одной и связывать вторым запросом, а это «действие из нескольких записей
-- без транзакции», которое проект уже осудил.
--
-- Какие задачи создать и как их связать, решает КЛИЕНТ и остаётся единственным
-- источником этого решения (правило проекта). Сервер отвечает за атомарность
-- и за номер круга: «следующий свободный» зависит от того, что уже в базе,
-- а не от того, что видел клиент минуту назад.

create or replace function public.erp_experimental_add_tasks(
  p_experimental_id uuid,
  p_tasks jsonb
)
returns setof public.erp_experimental_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_task    jsonb;
  v_ids     uuid[] := '{}';
  v_idx     int := 0;
  v_sort    int;
  v_cycle   int;
  v_dep     jsonb;
  v_deps    uuid[];
  v_new_id  uuid;
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'erp_experimental_add_tasks: ожидается массив задач'
      using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) into v_sort
    from public.erp_experimental_tasks where experimental_id = p_experimental_id;

  -- Первый проход: вставляем строки, запоминая их id по индексу в массиве
  for v_task in select * from jsonb_array_elements(p_tasks)
  loop
    v_idx := v_idx + 1;
    v_sort := v_sort + 10;

    -- Круг считается по ТИПУ задачи: вторая примерка получает cycle=1,
    -- а первая задача другого типа остаётся на нуле
    select coalesce(max(cycle), -1) + 1 into v_cycle
      from public.erp_experimental_tasks
     where experimental_id = p_experimental_id
       and task_type = (v_task->>'task_type');

    insert into public.erp_experimental_tasks (
      experimental_id, task_type, title, responsible, due_date,
      status, comment, qty, cycle, sort_order
    ) values (
      p_experimental_id,
      v_task->>'task_type',
      nullif(v_task->>'title', ''),
      nullif(v_task->>'responsible', ''),
      nullif(v_task->>'due_date', '')::date,
      coalesce(nullif(v_task->>'status', ''), 'todo'),
      nullif(v_task->>'comment', ''),
      nullif(v_task->>'qty', '')::int,
      v_cycle,
      v_sort
    )
    returning id into v_new_id;

    v_ids := v_ids || v_new_id;
  end loop;

  -- Второй проход: индексы → id. Отдельным проходом, потому что задача может
  -- зависеть только от предыдущих, но проверять это в первом проходе значило бы
  -- запретить любой порядок, кроме топологического.
  v_idx := 0;
  for v_task in select * from jsonb_array_elements(p_tasks)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_task->'depends_on') = 'array' then
      v_deps := '{}';
      for v_dep in select * from jsonb_array_elements(v_task->'depends_on')
      loop
        -- Индекс вне массива молча пропускаем: осиротевшая зависимость хуже,
        -- чем её отсутствие — она держала бы задачу закрытой навсегда
        if (v_dep::text)::int + 1 between 1 and array_length(v_ids, 1) then
          v_deps := v_deps || v_ids[(v_dep::text)::int + 1];
        end if;
      end loop;
      if array_length(v_deps, 1) > 0 then
        update public.erp_experimental_tasks
           set depends_on = v_deps where id = v_ids[v_idx];
      end if;
    end if;
  end loop;

  return query
    select * from public.erp_experimental_tasks
     where id = any(v_ids) order by sort_order;
end $$;

revoke execute on function public.erp_experimental_add_tasks(uuid, jsonb) from public, anon;
grant execute on function public.erp_experimental_add_tasks(uuid, jsonb) to authenticated;

comment on function public.erp_experimental_add_tasks(uuid, jsonb) is
  'Пачка задач разработки одной транзакцией. depends_on внутри пачки — ИНДЕКСЫ элементов массива (как этапы в erp_create_order). Номер круга считает сервер по типу задачи.';

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Передача задачи в цех
-- ═══════════════════════════════════════════════════════════════════════
--
-- Тело перенесено из `erp_experimental_send_to_dept` (20260810230000)
-- ПОДЛИННЫМ текстом, изменено ровно одно: `item_id` берётся из разработки,
-- а не приходит параметром, и той же транзакцией проставляется `stage_id`
-- у задачи. Прежде это были два запроса подряд из клиента — «действие
-- из нескольких записей без транзакции».

create or replace function public.erp_experimental_task_send(
  p_task_id uuid,
  p_department_id uuid,
  p_planned_end date default null,
  p_qty int default null
)
returns public.erp_experimental_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_item   uuid;
  v_cycle  int;
  v_sort   int;
  v_stage  uuid;
  v_row    public.erp_experimental_tasks;
begin
  select e.item_id into v_item
    from public.erp_experimental_tasks t
    join public.erp_experimental e on e.id = t.experimental_id
   where t.id = p_task_id;

  if v_item is null then
    raise exception 'erp_experimental_task_send: у разработки не указана позиция заказа'
      using errcode = '22023';
  end if;

  select coalesce(max(cycle), -1) + 1 into v_cycle
    from public.erp_item_stages
   where item_id = v_item and department_id = p_department_id;

  select coalesce(max(sort_order), 0) + 10 into v_sort
    from public.erp_item_stages where item_id = v_item;

  -- `depends_on` пустой намеренно: образец идёт вне очереди основного маршрута,
  -- его отправляет технолог решением, а не последовательность этапов. Статус
  -- сразу `ready` — цех видит работу в очереди и берёт её обычной кнопкой.
  insert into public.erp_item_stages
    (item_id, department_id, cycle, origin, depends_on, status, sort_order, planned_end)
  values
    (v_item, p_department_id, v_cycle, 'experimental', '{}', 'ready', v_sort, p_planned_end)
  returning id into v_stage;

  update public.erp_experimental_tasks
     set stage_id = v_stage,
         department_id = p_department_id,
         qty = coalesce(p_qty, qty),
         due_date = coalesce(p_planned_end, due_date),
         status = 'waiting'
   where id = p_task_id
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.erp_experimental_task_send(uuid, uuid, date, int) from public, anon;
grant execute on function public.erp_experimental_task_send(uuid, uuid, date, int) to authenticated;

comment on function public.erp_experimental_task_send(uuid, uuid, date, int) is
  'Передача задачи разработки в цех: этап с origin=experimental в следующем свободном цикле + привязка stage_id у задачи, ОДНОЙ транзакцией. Цех видит работу в своей очереди как любую другую.';

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Возврат из цеха: зеркало статуса этапа
-- ═══════════════════════════════════════════════════════════════════════
--
-- ПОЧЕМУ ТРИГГЕР, А НЕ КЛИЕНТ. Цех закрывает этап у себя, в своей очереди;
-- карточку разработки он не открывает и открывать не должен. Без триггера
-- связи не будет ВООБЩЕ — ровно сегодняшний дефект: `completeExperimentalOp`
-- помечает передачу возвращённой, а этап не трогает, и наоборот.
--
-- ПОЧЕМУ ЭТО НЕ «ВТОРАЯ РЕАЛИЗАЦИЯ МАРШРУТА». Правило проекта запрещает
-- дублировать на сервере РАСЧЁТ маршрута — обход `depends_on`, решение «какие
-- этапы затронуты». Здесь ничего не считается: зеркалится статус ОДНОЙ строки
-- в ОДНУ строку. Готовность следующих задач по-прежнему считает клиент.
-- Прямой прецедент того же жанра — `erp_warehouse_task_derive`.
--
-- ОБРАТНОЕ НАПРАВЛЕНИЕ НЕ ДЕЛАЕТСЯ. Задачу с непустым `stage_id` клиент
-- только ЧИТАЕТ: иначе технолог менял бы статус чужого этапа мимо
-- `erp_stage_guard`, и у колонки стало бы два писателя.

create or replace function public.erp_experimental_task_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.erp_experimental_tasks t
     set status = case new.status
           when 'done'        then 'done'
           when 'in_progress' then 'in_progress'
           when 'blocked'     then 'blocked'
           when 'skipped'     then 'cancelled'
           else 'waiting'
         end,
         blocked_reason = case when new.status = 'blocked'
                               then new.block_reason else null end,
         done_on = case when new.status = 'done'
                        then public.erp_local_date() else null end
   where t.stage_id = new.id;
  return new;
end $$;

revoke execute on function public.erp_experimental_task_sync() from public, anon;

drop trigger if exists erp_experimental_task_sync on public.erp_item_stages;
create trigger erp_experimental_task_sync
  after update of status on public.erp_item_stages
  for each row
  when (new.origin = 'experimental' and new.status is distinct from old.status)
  execute function public.erp_experimental_task_sync();

comment on function public.erp_experimental_task_sync() is
  'Зеркалит статус этапа образца в задачу разработки. Считает НИЧЕГО: одна строка в одну строку, обхода зависимостей нет. Без него цех закрывает этап, а карточка разработки об этом не узнаёт.';

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Перенос данных
-- ═══════════════════════════════════════════════════════════════════════
--
-- Идемпотентно: повторный прогон миграций не продублирует задачи.

-- ── item_id по позиции заказа ──
-- Проверено ПЕРЕД применением: у всех девяти разработок заказ ровно
-- с одной позицией, поэтому эвристика здесь верна (для будущего она и чинится).
update public.erp_experimental e
   set item_id = (
     select oi.id from public.erp_order_items oi
      where oi.order_id = e.order_id order by oi.sort_order, oi.id limit 1)
 where e.item_id is null;

-- ── phase → ОДНА задача, отражающая факт ──
-- Не сочиняем пятиступенчатый план, от которого заказчик отказывается:
-- переносим «что делают сейчас». Остальное технолог добавит сам — это
-- и есть новая модель.
insert into public.erp_experimental_tasks
  (experimental_id, task_type, title, status, comment, sort_order)
select e.id,
       case e.phase
         when 'patterns'               then 'patterns'
         when 'development'            then 'sample'
         when 'final_fitting'          then 'fitting'
         when 'returned_to_constructor' then 'rework'
         else 'other'
       end,
       case e.phase
         when 'patterns'               then 'Лекала'
         when 'development'            then 'Проработка образца'
         when 'final_fitting'          then 'Примерка'
         when 'returned_to_constructor' then 'Доработка лекал'
         else 'Задача разработки'
       end,
       'in_progress',
       e.constructor_return_comment,
       10
  from public.erp_experimental e
 where e.phase <> 'done'
   and not exists (
     select 1 from public.erp_experimental_tasks t where t.experimental_id = e.id);

-- ── final_outcome → outcome ──
-- Прежняя подпись уезжает в комментарий: смысл различий («нужна переклейка»,
-- «нужна правка лекал») не теряется, но перестаёт быть отдельным статусом.
update public.erp_experimental e
   set outcome = case e.final_outcome
         when 'approved'            then 'ready_for_serial'
         when 'ready_for_serial'    then 'ready_for_serial'
         when 'needs_rework'        then 'needs_rework'
         when 'needs_rebranding'    then 'needs_rework'
         when 'needs_pattern_change' then 'needs_rework'
         when 'cancelled'           then 'cancelled'
         else 'ready_for_serial'
       end,
       outcome_comment = coalesce(e.outcome_comment, e.final_outcome),
       closed_at = coalesce(e.closed_at, e.updated_at)
 where e.phase = 'done' and e.outcome is null;

-- ── erp_experimental_ops → задачи ──
insert into public.erp_experimental_tasks
  (experimental_id, task_type, title, responsible, due_date, status,
   comment, qty, stage_id, done_on, sort_order)
select o.experimental_id,
       case
         when o.kind = 'to_sewing' then 'sewing_sample'
         when o.branding_method in ('dtf', 'heat_transfer') then 'dtf'
         when o.branding_method = 'silkscreen' then 'silkscreen'
         when o.branding_method = 'embroidery' then 'embroidery'
         else 'other'
       end,
       coalesce(nullif(o.operation, ''),
                nullif(concat_ws(' · ', o.branding_method, o.zone, o.size_mm, o.colors), ''),
                'Передача в цех'),
       o.responsible, o.planned_date,
       case o.status when 'returned' then 'done' else 'waiting' end,
       o.comment, o.qty, o.stage_id, o.returned_at,
       100 + row_number() over (partition by o.experimental_id order by o.created_at) * 10
  from public.erp_experimental_ops o
 where not exists (
   select 1 from public.erp_experimental_tasks t
    where t.experimental_id = o.experimental_id
      and t.sort_order >= 100
 );

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Realtime и пакет оболочки
-- ═══════════════════════════════════════════════════════════════════════
--
-- Публикуем: цех закрывает этап, триггер обновляет задачу — и открытая
-- карточка разработки обязана это увидеть. Правило проекта: подписка
-- и обработчик ставятся ВМЕСТЕ, расхождение сторожит realtimeCoverage.test.

alter publication supabase_realtime add table public.erp_experimental_tasks;

-- `erp_bootstrap` отдаёт И задачи, И старые операции: между этой миграцией
-- и выкладкой экрана работает СТАРЫЙ фронт, и убрать `ops` сейчас — значит
-- сломать ему разработку. Уборка — отдельным коммитом после выкладки.
