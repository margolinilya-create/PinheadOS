-- Конструктор маршрута: сохранение одной транзакцией (правки заказчика 16.08).
--
-- «Маршрут не должен быть жёстко зафиксирован системой: необходимо позволить
-- добавлять этап, удалять этап, менять порядок, выбирать наш / подрядный
-- исполнитель, добавлять несколько подрядных этапов, возвращать изделие после
-- подрядчика обратно в наши цеха».
--
-- РАЗДЕЛЕНИЕ ОТВЕТСТВЕННОСТИ — правило проекта, и оно здесь соблюдено буквально:
-- какие этапы и как связаны, решает КЛИЕНТ (`utils/routeDraft.linearize`),
-- и остаётся единственным источником этого решения. Сервер отвечает только
-- за атомарность: вставка, обновление, пересчёт зависимостей и удаление
-- выпавших этапов — это правка нескольких строк, и `Promise.all` из отдельных
-- запросов означал бы откат интерфейса поверх уже закоммиченного (ровно тем
-- когда-то болел возврат брака).
--
-- `depends_on` приходит ИНДЕКСАМИ массива, а не идентификаторами: у нового
-- этапа их ещё нет, и он может зависеть от другого нового. Тот же приём —
-- в `erp_create_order` и `erp_experimental_add_tasks`.
--
-- УДАЛЕНИЕ ПОВТОРЯЕТ RLS-ПОЛИТИКУ ЗНАЧЕНИЕМ: «без факта и не начат». Мягче —
-- функция стёрла бы работу, которую политика защищает; строже — конструктор
-- не убрал бы этап, который интерфейс предлагает убрать.
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
begin
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_route_apply: правка маршрута требует права order.manage'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.erp_order_items where id = p_item_id) then
    raise exception 'erp_route_apply: позиция не найдена' using errcode = 'P0002';
  end if;

  -- Приоритет новых этапов берём у соседей позиции: этап, попавший в очередь
  -- цеха с пустым queue_position, встал бы в её конец независимо от срока
  select coalesce(min(queue_position), public.erp_default_queue_position(
           (select o.due_date from public.erp_orders o
             join public.erp_order_items i on i.order_id = o.id
            where i.id = p_item_id)))
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

  return query
    select * from public.erp_item_stages
     where item_id = p_item_id
     order by sort_order;
end $$;

grant execute on function public.erp_route_apply(uuid, jsonb) to authenticated;

comment on function public.erp_route_apply(uuid, jsonb) is
  'Сохранение маршрута позиции одной транзакцией: вставка новых этапов, обновление существующих, пересчёт depends_on по индексам, удаление выпавших без факта. Маршрут считает КЛИЕНТ (utils/routeDraft) — сервер отвечает за атомарность.';
