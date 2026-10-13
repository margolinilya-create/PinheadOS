-- Поля подрядного этапа терялись при ПЕРВОМ сохранении маршрута.
--
-- ЧТО СЛОМАЛОСЬ. `erp_route_apply` связывала шаг payload с этапом по
-- `stage_id`. У этапа, который создаётся ЭТИМ ЖЕ вызовом, идентификатора
-- в payload нет вовсе — клиент шлёт `null`, — поэтому `left join lateral`
-- отдавал NULL, и плановые даты передачи и возврата, ответственный,
-- «что передаём» и комментарий уезжали в спутника пустыми. Работало это
-- только со ВТОРОГО сохранения, когда у шага уже появился `stage_id`.
--
-- Найдено проверкой на боевой схеме (транзакция с откатом): этап подряда
-- создался, спутник создался, операция и подрядчик на месте — а пять полей
-- из девяти пусты. Сторож `subcontractCompanion` проверял, что оба писателя
-- ПРИНИМАЮТ эти поля, и был зелёным: принимать — не значит записать.
--
-- ЧИНИТСЯ СВЯЗЫВАНИЕМ ПО ПОЗИЦИИ. `v_ids` заполняется проходом 1 в том же
-- порядке, в каком пришли шаги, поэтому `v_ids[e.ord] = s.id` работает
-- одинаково для новых и для существующих этапов — тем же приёмом, которым
-- в этой же функции разрешаются `depends_on` (там индексы массива).
--
-- Текст функции — ПОДЛИННЫЙ, из действующего определения; изменены ровно
-- два `left join lateral`.

create or replace function public.erp_route_apply(p_item_id uuid, p_steps jsonb)
returns setof public.erp_item_stages
language plpgsql
set search_path to 'public'
as $$
declare
  v_step      jsonb;
  v_ids       uuid[] := '{}';
  v_id        uuid;
  v_keep      uuid[] := '{}';
  v_depends   uuid[];
  v_queue     numeric;
  v_idx       int := 0;
  v_order_id  uuid;
  v_qty       int;
begin
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_route_apply: правка маршрута требует права order.manage'
      using errcode = '42501';
  end if;

  select i.order_id, i.qty into v_order_id, v_qty
    from public.erp_order_items i where i.id = p_item_id;
  if v_order_id is null then
    raise exception 'erp_route_apply: позиция не найдена' using errcode = 'P0002';
  end if;

  -- Приоритет новых этапов берём у соседей позиции: этап, попавший в очередь
  -- цеха с пустым queue_position, встал бы в её конец независимо от срока
  select coalesce(min(queue_position), public.erp_default_queue_position(
           (select o.due_date from public.erp_orders o where o.id = v_order_id)))
    into v_queue
    from public.erp_item_stages where item_id = p_item_id;

  -- ПРОХОД 1: вставляем новые и обновляем существующие, собирая их id по порядку.
  -- depends_on проставляем во втором проходе — этап может зависеть от другого
  -- НОВОГО этапа, которого в первый момент ещё нет.
  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    if (v_step->>'stage_id') is null then
      insert into public.erp_item_stages
        (item_id, department_id, sort_order, depends_on, queue_position,
         executor, contractor, operation)
      values
        (p_item_id,
         (v_step->>'department_id')::uuid,
         (v_step->>'sort_order')::int,
         '{}',
         v_queue,
         coalesce(v_step->>'executor', 'internal'),
         v_step->>'contractor',
         v_step->>'operation')
      returning id into v_id;
    else
      v_id := (v_step->>'stage_id')::uuid;
      update public.erp_item_stages
         set department_id = (v_step->>'department_id')::uuid,
             sort_order    = (v_step->>'sort_order')::int,
             executor      = coalesce(v_step->>'executor', 'internal'),
             contractor    = v_step->>'contractor',
             operation     = v_step->>'operation'
       where id = v_id and item_id = p_item_id;
      if not found then
        raise exception 'erp_route_apply: этап % не принадлежит позиции', v_id
          using errcode = '22023';
      end if;
    end if;
    v_ids := v_ids || v_id;
    v_keep := v_keep || v_id;
  end loop;

  -- ПРОХОД 2: зависимости. В payload это ИНДЕКСЫ массива — тот же приём,
  -- что в erp_create_order и erp_experimental_add_tasks: у нового этапа
  -- идентификатора на момент сборки payload ещё нет.
  v_idx := 0;
  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    select coalesce(array_agg(v_ids[(d.i)::int + 1]), '{}')
      into v_depends
      from jsonb_array_elements_text(coalesce(v_step->'depends_on', '[]'::jsonb)) as d(i)
     where v_ids[(d.i)::int + 1] is not null;

    update public.erp_item_stages
       set depends_on = coalesce(v_depends, '{}')
     where id = v_ids[v_idx];
  end loop;

  -- Спутники подряда у этапов, переставших быть подрядными, убираем ЯВНО:
  -- внешний ключ объявлен `on delete set null`, и каскад оставил бы строку
  -- подряда без этапа — то самое состояние, из-за которого раздел жил
  -- собственной жизнью.
  delete from public.erp_subcontracting sc
   where sc.stage_id = any (v_keep)
     and not exists (
       select 1 from public.erp_item_stages s
        where s.id = sc.stage_id and s.executor = 'contractor');

  -- Удаляем этапы, выпавшие из маршрута. Условие «без факта» повторяет
  -- RLS-политику: страж и гейт интерфейса обязаны совпадать значением.
  delete from public.erp_subcontracting
   where stage_id in (
     select id from public.erp_item_stages
      where item_id = p_item_id and not (id = any (v_keep)));

  delete from public.erp_item_stages
   where item_id = p_item_id
     and not (id = any (v_keep))
     and status in ('waiting', 'ready')
     and coalesce(qty_done, 0) = 0
     and coalesce(qty_rework, 0) = 0
     and started_at is null;

  -- Карточка подрядчика у каждого подрядного этапа. Имя подрядчика при правке
  -- маршрута ОБНОВЛЯЕТСЯ, а сроки, количества и оплата — нет: их ведёт раздел
  -- «Подряд», и правка маршрута не должна стирать факт передачи.
  insert into public.erp_subcontracting
    (order_id, item_id, stage_id, operation, contractor, qty, material_source,
     send_plan_date, planned_date, responsible, materials_note, comment)
  select v_order_id, p_item_id, s.id,
         coalesce(nullif(btrim(coalesce(s.operation, '')), ''), d.name),
         s.contractor,
         coalesce((st.step->>'qty')::int, v_qty),
         'pinhead',
         (st.step->>'send_plan_date')::date,
         (st.step->>'planned_date')::date,
         st.step->>'responsible',
         st.step->>'materials_note',
         st.step->>'comment'
    from public.erp_item_stages s
    join public.erp_departments d on d.id = s.department_id
    left join lateral (
      -- Шаг ищется ПО ПОЗИЦИИ в массиве, а не по `stage_id`: у только что
      -- заведённого этапа его в payload нет вовсе (клиент шлёт `null`), и
      -- соединение по нему давало NULL — поля документа 20.08 молча терялись
      -- при ПЕРВОМ сохранении подрядного шага. `v_ids` заполнен проходом 1
      -- в том же порядке, в каком шаги пришли.
      select e.value as step
        from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
             with ordinality as e(value, ord)
       where v_ids[e.ord] = s.id
       limit 1
    ) st on true
   where s.item_id = p_item_id
     and s.executor = 'contractor'
     and not exists (
       select 1 from public.erp_subcontracting sc where sc.stage_id = s.id);

  update public.erp_subcontracting sc
     set contractor     = s.contractor,
         operation      = coalesce(nullif(btrim(coalesce(s.operation, '')), ''), sc.operation),
         qty            = coalesce((st.step->>'qty')::int, sc.qty),
         send_plan_date = coalesce((st.step->>'send_plan_date')::date, sc.send_plan_date),
         planned_date   = coalesce((st.step->>'planned_date')::date, sc.planned_date),
         responsible    = coalesce(st.step->>'responsible', sc.responsible),
         materials_note = coalesce(st.step->>'materials_note', sc.materials_note),
         comment        = coalesce(st.step->>'comment', sc.comment)
    from public.erp_item_stages s
    left join lateral (
      -- Шаг ищется ПО ПОЗИЦИИ в массиве, а не по `stage_id`: у только что
      -- заведённого этапа его в payload нет вовсе (клиент шлёт `null`), и
      -- соединение по нему давало NULL — поля документа 20.08 молча терялись
      -- при ПЕРВОМ сохранении подрядного шага. `v_ids` заполнен проходом 1
      -- в том же порядке, в каком шаги пришли.
      select e.value as step
        from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
             with ordinality as e(value, ord)
       where v_ids[e.ord] = s.id
       limit 1
    ) st on true
   where sc.stage_id = s.id
     and s.item_id = p_item_id
     and s.executor = 'contractor';

  return query
    select * from public.erp_item_stages
     where item_id = p_item_id
     order by sort_order;
end $$;

comment on function public.erp_route_apply(uuid, jsonb) is
  'Правка маршрута позиции одной транзакцией. Шаг payload сопоставляется этапу ПО ПОЗИЦИИ в массиве: у нового этапа stage_id в payload нет, и связывание по нему теряло поля подрядного этапа.';
