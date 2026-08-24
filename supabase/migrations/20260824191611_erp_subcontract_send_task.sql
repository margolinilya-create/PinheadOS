-- Выход к подрядчику — через складскую ПЕРЕДАЧУ. Правка заказчика 24.08, п. 3.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Если в одном маршруте заказ несколько раз уходит
-- к внешнему подрядчику и возвращается обратно, каждый новый выход
-- к подрядчику должен проходить через складскую передачу… Система не должна
-- переводить заказ из нашего цеха напрямую в следующий этап "Подряд"…
-- Заказ не может получить статус "У подрядчика", пока склад не зафиксировал
-- фактическую передачу».
--
-- ЧТО УЖЕ БЫЛО. Возврат через складскую приёмку сделан 20.08 дословно так, как
-- просит документ (`subcontract_receipt`), и все требуемые к хранению величины
-- есть: переданное, принятое, брак, объём в работе, подрядчик, следующий этап
-- маршрута. Недоставало ровно ЗЕРКАЛЬНОЙ половины — передачи.
--
-- ЧЕМ ЭТО БЫЛО ДО ПРАВКИ. Фазу `at_contractor` ставил МЕНЕДЖЕР кнопкой
-- «Передать в работу» в разделе «Подряд». То есть заказ получал статус
-- «У подрядчика» без единого касания склада — ровно то, что документ
-- запрещает прямым текстом.
--
-- ── Кто заводит задачу и когда ───────────────────────────────────────────────
--
-- Задача передачи нужна ровно тогда, когда подрядный этап ГОТОВ принять
-- работу: все его предшественники закрыты. Это не хранимое состояние —
-- «готов к работе» в проекте вычисляется, — поэтому момент ловится там же,
-- где он наступает: при закрытии предыдущего этапа.
--
-- Писателей ДВА, и оба зовут ОДНУ функцию `erp_ensure_subcontract_send`:
-- триггер закрытия этапа (обычный случай) и триггер вставки этапа (подрядный
-- этап без зависимостей — первый в маршруте). Две копии условия разошлись бы
-- молча: обе «работают», просто заводят задачу в разных случаях.
--
-- ПОДРЯДНОСТЬ ЧИТАЕТСЯ ПО `executor = 'contractor'`, НИКОГДА по коду участка:
-- этапы, заведённые до 21.08, стоят на реальном цехе (`dtf`, `sewing`)
-- с этим признаком, и отбор по коду их бы не увидел.

-- ── 1. Новый тип складской задачи ────────────────────────────────────────────
alter table public.erp_warehouse_tasks
  drop constraint if exists erp_warehouse_tasks_task_type_check;
alter table public.erp_warehouse_tasks
  add constraint erp_warehouse_tasks_task_type_check
  check (task_type in ('material_receipt', 'marking', 'fg_receipt', 'pack_ship',
                       'subcontract_receipt', 'subcontract_send'));

-- ── 2. Заведение задачи передачи ─────────────────────────────────────────────
--
-- `security definer`: задачу порождает закрытие этапа ЦЕХОМ, а вставка
-- в `erp_warehouse_tasks` гейтится `warehouse.manage`/`order.manage`, которых
-- у рабочего нет. С `invoker` цех получал бы 42501 на закрытии собственного
-- этапа — то есть правка сломала бы производство ради складского учёта.
create or replace function public.erp_ensure_subcontract_send(p_stage uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_stage record;
  v_order_id uuid;
begin
  select s.id, s.item_id, s.department_id, s.status, s.executor, s.depends_on
    into v_stage
    from erp_item_stages s where s.id = p_stage;
  if not found then return; end if;

  -- Только подрядный и только ещё не закрытый: у закрытого передавать нечего
  if coalesce(v_stage.executor, 'internal') <> 'contractor' then return; end if;
  if v_stage.status in ('done', 'skipped') then return; end if;

  -- Все предшественники закрыты — этап готов принять работу
  if exists (
    select 1 from erp_item_stages p
     where p.id = any (v_stage.depends_on)
       and p.status not in ('done', 'skipped')
  ) then
    return;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = v_stage.item_id;
  if v_order_id is null then return; end if;

  -- `where not exists`, а не `on conflict`: индекс уникальности задач при этапе
  -- ЧАСТИЧНЫЙ (`where stage_id is not null`), и голый ON CONFLICT его не выведет —
  -- это 42P10 при каждом срабатывании. Правило проекта, на котором уже ловились
  -- дважды: с планом и с возвратом подряда.
  insert into erp_warehouse_tasks (order_id, item_id, stage_id, task_type, status)
  select v_order_id, v_stage.item_id, v_stage.id, 'subcontract_send', 'awaiting'
  where not exists (
    select 1 from erp_warehouse_tasks t
     where t.stage_id = v_stage.id and t.task_type = 'subcontract_send');
end $$;

revoke execute on function public.erp_ensure_subcontract_send(uuid) from public, anon;
grant execute on function public.erp_ensure_subcontract_send(uuid) to authenticated;

comment on function public.erp_ensure_subcontract_send(uuid) is
  'Заводит задачу склада «Передача подрядчику» для готового подрядного этапа (п. 3). Единственный писатель этой задачи; зовут её оба триггера.';

-- ── 3. Писатель первый: закрылся предыдущий этап ─────────────────────────────
--
-- Текст взят ПОДЛИННЫЙ действующий (`pg_get_functiondef` сверен с базой 24.08),
-- добавлена одна ветка в конце.
create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order_id uuid;
  v_code text;
  v_next uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select v_order_id, 'material_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'material_receipt'
         and t.stage_id is null);
  end if;

  if v_code = 'sewing' and new.status = 'in_progress' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    select v_order_id, new.item_id, 'marking', 'new'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'marking'
         and t.stage_id is null);
  end if;

  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'fg_receipt', 'awaiting'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'fg_receipt'
           and t.stage_id is null);
    end if;

    -- erp_can_pack_ship уже требует принятой приёмки ГП, поэтому задача
    -- заводится сразу «На упаковке»: ждать здесь нечего
    if public.erp_can_pack_ship(v_order_id) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      select v_order_id, 'pack_ship', 'packing'
      where not exists (
        select 1 from erp_warehouse_tasks t
         where t.order_id = v_order_id and t.task_type = 'pack_ship'
           and t.stage_id is null);
    end if;

    -- ПРАВКА 24.08, П. 3: закрытый этап открывает дорогу подрядным, которые
    -- его ждали, — и каждый такой выход идёт через складскую передачу.
    -- Перебираем ВСЕХ зависящих: у позиции бывает несколько подрядных этапов.
    for v_next in
      select s.id from erp_item_stages s
       where s.item_id = new.item_id
         and new.id = any (s.depends_on)
    loop
      perform public.erp_ensure_subcontract_send(v_next);
    end loop;
  end if;

  return new;
end $$;

-- ── 4. Писатель второй: подрядный этап без зависимостей ──────────────────────
--
-- Первый шаг маршрута ждать нечего, и закрытия предыдущего этапа не случится
-- НИКОГДА. Без этой ветки такой заказ встал бы молча: подрядный этап открыт,
-- задачи склада нет, «У подрядчика» недостижимо.
create or replace function public.erp_subcontract_send_on_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.executor, 'internal') = 'contractor'
     and coalesce(array_length(new.depends_on, 1), 0) = 0 then
    perform public.erp_ensure_subcontract_send(new.id);
  end if;
  return new;
end $$;

revoke execute on function public.erp_subcontract_send_on_insert() from public, anon, authenticated;

drop trigger if exists erp_subcontract_send_on_insert on public.erp_item_stages;
create trigger erp_subcontract_send_on_insert
  after insert on public.erp_item_stages
  for each row execute function public.erp_subcontract_send_on_insert();

comment on function public.erp_subcontract_send_on_insert() is
  'Подрядный этап без зависимостей — задача передачи заводится сразу: закрытия предыдущего этапа не будет никогда (п. 3).';

-- ── 5. Догоняем уже открытые подрядные этапы ─────────────────────────────────
--
-- Без этого правка действовала бы только на будущие заказы, а те, что стоят
-- у подрядчика сейчас, остались бы без задачи передачи — то есть требование
-- «каждый выход через склад» не выполнялось бы ровно там, где оно уже нужно.
do $$
declare v_id uuid;
begin
  for v_id in
    select s.id from public.erp_item_stages s
     where coalesce(s.executor, 'internal') = 'contractor'
       and s.status not in ('done', 'skipped')
  loop
    perform public.erp_ensure_subcontract_send(v_id);
  end loop;
end $$;
