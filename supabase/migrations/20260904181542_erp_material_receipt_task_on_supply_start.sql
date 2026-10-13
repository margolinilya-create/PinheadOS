-- Б5 обхода 04.09: кладовщику некуда принять ЧАСТИЧНУЮ поставку.
--
-- Складская задача «Приёмка материалов» заводилась только при ЗАКРЫТИИ этапа
-- закупки (`v_code = 'supply' and new.status = 'done'`). Материалы при этом
-- приходят по частям — ткань от первого поставщика сегодня, бирки через
-- неделю, — а закупка закрывается, когда разобраны ВСЕ строки. То есть весь
-- период, пока поставки идут, у кладовщика не было задачи, в которую это
-- записать: единственный законный путь лежал через ЧУЖОЙ экран — «Материал
-- поступил» в очереди цеха. Пилот идёт ровно на складе и закупке.
--
-- На живой базе 04.09: ПЯТЬ активных заказов с закупкой `in_progress`
-- и без задачи приёмки.
--
-- ЗАОДНО ЭТО ЗАКРЫВАЕТ ТУПИК, который открыла бы правка гейта того же дня
-- (`20260904180307`): с ней закупка не закрывается, пока склад не оформил
-- приёмку, а приёмка требовала задачи, которая появлялась только ПОСЛЕ
-- закрытия закупки. Гейт без второго писателя — тупик, а не починка
-- (правило 02.09).
--
-- Условие расширено, а не заменено: `done` остаётся ради заказов, у которых
-- закупка закрывается, минуя `in_progress` (досрочное закрытие с причиной,
-- автозакрытие по материалам «со склада»). Дубля не будет — вставку по-прежнему
-- сторожит `not exists`.
--
-- Текст функции взят ПОДЛИННЫЙ (`20260902084729`) с одной заменой в условии
-- ветки `material_receipt`.
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

  if v_code = 'supply' and new.status in ('in_progress', 'done') then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    select v_order_id, 'material_receipt', 'awaiting'
    where not exists (
      select 1 from erp_warehouse_tasks t
       where t.order_id = v_order_id and t.task_type = 'material_receipt'
         and t.stage_id is null);
  end if;

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
  'Складские задачи по движению этапов. Приёмка материалов заводится, когда закупка ВЗЯТА В РАБОТУ (а не когда закрыта): материалы приходят по частям, и до правки 04.09 кладовщику некуда было записать первую поставку. Задачи готовой продукции делегированы erp_ensure_order_finish_tasks — она же зовётся при закрытии разработки. Маркировка не заводится позициям production_type = samples (решение владельца 02.09).';
