-- ПРИЁМКА ЗАВОДИТСЯ ПОЗИЦИЕЙ ЗАКУПКИ, А НЕ ЗАПУСКОМ ЭТАПА
-- (правка заказчика 12.09, вторая порция, баг 01).
--
-- Документ: «после создания заказа и заполнения количества в закупке материал
-- сразу появляется на складе как задача „Приёмка материалов", хотя позиция
-- закупки ещё находится в статусе „Не заказано"… Единственный триггер
-- создания задачи „Приёмка материалов" — перевод соответствующей позиции
-- закупки в статус „В пути". До этого момента склад не должен видеть эту
-- приёмку и не должен иметь возможность принять материал».
--
-- ЧТО БЫЛО. `erp_warehouse_task_derive` заводила задачу по переходу ЭТАПА
-- `supply` в `in_progress`/`done` и статуса материалов не читала вовсе
-- (`20260904181542`). То есть задача появлялась в момент «закупка взята
-- в работу» — раньше, чем закупщик вообще что-либо заказал.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ 12.09: из четырёх открытых задач приёмки у трёх
-- материал НЕ в пути — `ordered`, `pending`, и одна задача у заказа, где
-- позиций закупки нет ни одной.
--
-- ЗАДАЧА СТАЛА ПОЗИЦИОННОЙ (решение владельца). «В пути» — статус ОТДЕЛЬНОЙ
-- строки закупки, и у заказа с двумя тканями одна может ехать, а вторая быть
-- ещё не заказанной. Одна задача на заказ показывала бы складу и то,
-- и другое — то есть ровно то, на что жалуется документ, только на уровень
-- ниже. Отсюда `material_id`.
--
-- ПОЧЕМУ НЕ ПРОПАДАЕТ ЧАСТИЧНАЯ ПОСТАВКА, ради которой правка 04.09
-- и двигала задачу на начало закупки: строка приёмки принадлежит позиции,
-- и «пришло ещё 35» пишется в её собственный журнал (`erp_material_receipts`)
-- сколько угодно раз. Тупика «закупка не закроется без приёмки, а приёмки
-- нет» тоже не возникает: закупка закрывается по годным материалам,
-- а материал не может стать годным, не побывав в пути.

alter table public.erp_warehouse_tasks
  add column if not exists material_id uuid
  references public.erp_materials(id) on delete cascade;

comment on column public.erp_warehouse_tasks.material_id is
  'Позиция закупки, которую принимает склад (вид material_receipt). Задача заводится переходом этой позиции в статус in_transit. NULL — задача другого вида либо задача приёмки, заведённая до правки 12.09 по заказу целиком.';

-- Дубля не будет и при повторном переводе статуса туда-обратно. Частичный:
-- у задач других видов `material_id` пуст, а NULL в уникальном индексе
-- не конфликтует сам с собой — legacy-задачи по заказу под него не подпадают.
create unique index if not exists erp_warehouse_tasks_material_idx
  on public.erp_warehouse_tasks (material_id)
  where task_type = 'material_receipt' and material_id is not null;

-- ── Писатель ──────────────────────────────────────────────────────────────
-- ПИСАТЕЛЕЙ ДВА, и второй не «на всякий случай»: строку закупки заводят
-- и формой (INSERT сразу в нужном статусе — так работает предварительная
-- закупка), и правкой статуса. Один только UPDATE-триггер пропустил бы
-- материал, заведённый уже «в пути», и склад не увидел бы его никогда.
create or replace function public.erp_material_receipt_task()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from 'in_transit' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  if new.order_id is null then
    -- Предварительная закупка не привязана к заказу: принимать её на склад
    -- пока некуда, задача появится при привязке (UPDATE придёт сюда снова).
    return new;
  end if;

  insert into erp_warehouse_tasks (order_id, material_id, task_type, status)
  select new.order_id, new.id, 'material_receipt', 'awaiting'
  where not exists (
    select 1 from erp_warehouse_tasks t
     where t.material_id = new.id and t.task_type = 'material_receipt');

  return new;
end $$;

comment on function public.erp_material_receipt_task() is
  'Складская задача «Приёмка материалов» на ПОЗИЦИЮ закупки. Единственный триггер создания — переход позиции в статус in_transit (правка заказчика 12.09, баг 01).';

revoke execute on function public.erp_material_receipt_task() from public, anon, authenticated;

drop trigger if exists erp_material_receipt_task_ai on public.erp_materials;
create trigger erp_material_receipt_task_ai
  after insert on public.erp_materials
  for each row execute function public.erp_material_receipt_task();

drop trigger if exists erp_material_receipt_task_au on public.erp_materials;
create trigger erp_material_receipt_task_au
  after update of status, order_id on public.erp_materials
  for each row execute function public.erp_material_receipt_task();

-- ── Прежний писатель снимается ТЕМ ЖЕ коммитом ────────────────────────────
-- Оставь мы ветку `supply` — у одной величины стало бы два писателя с разными
-- правилами, и задача по-прежнему появлялась бы до первой поставки. Текст
-- функции подлинный (`20260904181542`), снята ровно одна ветка.
create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order_id  uuid;
  v_prod_type text;
  v_code      text;
  v_next      uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id, i.production_type
    into v_order_id, v_prod_type
    from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  -- Приёмка материалов отсюда УШЛА: её заводит `erp_material_receipt_task`
  -- по статусу самой позиции закупки (правка 12.09, баг 01).

  -- Образцу маркировка не заводится (правки 02.09, решение владельца)
  if v_code = 'sewing' and new.status = 'in_progress'
     and v_prod_type is distinct from 'samples' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    select v_order_id, new.item_id, 'marking', 'new'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'marking'
         and t.stage_id is null);
  end if;

  if new.status = 'done' then
    perform public.erp_ensure_order_finish_tasks(v_order_id);

    -- Правка 24.08, п. 3: закрытый этап открывает дорогу подрядным, которые
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

comment on function public.erp_warehouse_task_derive() is
  'Складские задачи по движению этапов. Приёмку материалов больше НЕ заводит: с правки 12.09 её порождает переход позиции закупки в статус in_transit (erp_material_receipt_task). Задачи готовой продукции делегированы erp_ensure_order_finish_tasks — она же зовётся при закрытии разработки. Маркировка не заводится позициям production_type = samples (решение владельца 02.09).';
