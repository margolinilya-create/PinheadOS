-- Две находки ревью безопасности к 20261005074459_erp_stage_fact_flow:
-- 1. потолок факта читал `new.qty_passthrough`, который вызывающий может
--    прислать сам в том же UPDATE (триггер признака срабатывает позже по
--    имени) — теперь прозрачность выводится из `is_production` участка;
-- 2. отгрузка проверяла остаток без блокировки — две параллельные попытки
--    могли вместе превысить выпущенное; позиция берётся под транзакционную advisory-блокировку.

create or replace function public.erp_clamp_stage_qty()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_over_plan boolean;
  v_cap       int;
  v_service   boolean;
  v_prod      boolean;
begin
  if new.qty_done < 0 then new.qty_done := 0; end if;
  if new.qty_rework < 0 then new.qty_rework := 0; end if;

  -- ПОТОЛОК ФАКТА — ВХОД ЭТАПА (правка 05.10): «цех не может сдать больше,
  -- чем получил». Тираж потолком больше не служит. Служебные переходы
  -- (перенос между цехами, приёмка подряда) закрывают этап по тиражу —
  -- у них прежний потолок, большее из тиража и входа.
  if tg_op = 'UPDATE' and new.qty_done > coalesce(old.qty_done, 0) then
    select d.allows_over_plan, coalesce(d.is_production, false)
      into v_over_plan, v_prod
      from erp_departments d where d.id = new.department_id;

    -- Прозрачный этап (склад, закупка) изделий не выпускает: его число
    -- дальше не передаётся, и потолок ему не нужен — иначе прежний бандл,
    -- закрывающий склад тиражом, упёрся бы в отказ
    -- Прозрачность для потолка выводится из ДАННЫХ участка, а не из
    -- `new.qty_passthrough`: его присылает вызывающий, а пересчитывает
    -- триггер, срабатывающий позже этого (порядок по имени) — иначе
    -- `qty_passthrough = true` в том же UPDATE снимал бы потолок
    -- (ревью безопасности 05.10)
    if not coalesce(v_over_plan, false) and coalesce(v_prod, true) and new.status <> 'skipped' then
      v_service := coalesce(current_setting('erp.moving', true), '') = 'on'
                or coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on';
      v_cap := public.erp_stage_input_qty(new.id);
      if v_service then
        select greatest(coalesce(i.qty, 0), v_cap)
          into v_cap
          from erp_order_items i where i.id = new.item_id;
      end if;
      if new.qty_done > v_cap then
        raise exception
          'Больше % шт на этом этапе сдать нельзя: столько передано с предыдущего этапа', v_cap
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.status = 'done' and new.finished_at is null then
    new.finished_at := now();
  elsif new.status in ('waiting', 'ready', 'in_progress', 'blocked')
        and new.finished_at is not null then
    new.finished_at := null;
  end if;

  return new;
end $$;

create or replace function public.erp_ship_order(
  p_order_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_actor text default null,
  p_client_key uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_line    jsonb;
  v_dup     boolean := false;
  v_asked   int := 0;
  v_written int := 0;
  v_rows    int;
  v_total   numeric;
  v_done    numeric;
  v_sent    numeric := 0;
  v_status  text;
  v_due     date;
  v_left    int;
  v_item    uuid;
  v_avail   numeric;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if coalesce((v_line ->> 'qty')::numeric, 0) > 0 then
      v_asked := v_asked + 1;
      v_item := (v_line ->> 'item_id')::uuid;

      -- Позиция под замком до конца транзакции: две параллельные отгрузки
      -- иначе обе видели бы один и тот же остаток и вместе превысили
      -- выпущенное (ревью безопасности 05.10). Advisory, а не `for update`:
      -- функция идёт от лица кладовщика, а `for update` требует права
      -- UPDATE на позицию по RLS
      perform pg_advisory_xact_lock(hashtextextended('erp_ship_order:' || v_item::text, 0));

      -- Повтор той же попытки проверку не проходит: строка уже записана
      if p_client_key is null or not exists (
        select 1 from public.erp_order_shipments sh
         where sh.client_key = p_client_key and sh.item_id = v_item)
      then
        -- ПРЕДЕЛ — ВЫПУЩЕННОЕ (правка 05.10, п. 1): «отгрузить можно не
        -- больше фактического остатка». Тираж пределом не служит
        select public.erp_item_produced_qty(v_item) - coalesce(sum(sh.qty), 0)
          into v_avail
          from public.erp_order_shipments sh
         where sh.item_id = v_item;
        if (v_line ->> 'qty')::numeric > coalesce(v_avail, 0) then
          raise exception 'Отгрузить можно не больше выпущенного: доступно % шт',
            greatest(coalesce(v_avail, 0), 0)
            using errcode = '22023';
        end if;
      end if;

      insert into public.erp_order_shipments
        (order_id, item_id, qty, note, author, author_id, client_key)
      values (
        p_order_id,
        v_item,
        (v_line ->> 'qty')::numeric,
        nullif(btrim(coalesce(p_note, '')), ''),
        nullif(btrim(coalesce(p_actor, '')), ''),
        (select auth.uid()),
        p_client_key
      )
      on conflict (client_key, item_id) where client_key is not null
      do nothing;

      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_written := v_written + 1;
        v_sent := v_sent + (v_line ->> 'qty')::numeric;
      end if;
    end if;
  end loop;

  v_dup := v_asked > 0 and v_written = 0;

  if v_sent > 0 then
    insert into public.erp_warehouse_ops (order_id, op_type, qty, note, actor)
    values (
      p_order_id,
      'shipment',
      v_sent,
      nullif(btrim(coalesce(p_note, '')), ''),
      nullif(btrim(coalesce(p_actor, '')), '')
    );
  end if;

  -- ЦЕЛЬ ОТГРУЗКИ ПОЗИЦИИ: пока производство идёт — тираж; когда маршрут
  -- закрыт — выпущенное (недовыпуск не держит заказ на складе вечно)
  select coalesce(sum(case when public.erp_item_production_closed(i.id)
                           then least(i.qty, public.erp_item_produced_qty(i.id))
                           else i.qty end), 0),
         coalesce(sum(i.qty_shipped), 0)
    into v_total, v_done
    from public.erp_order_items i
   where i.order_id = p_order_id;

  if v_total > 0 and v_done >= v_total then
    select o.due_date into v_due from public.erp_orders o where o.id = p_order_id;
    v_left := case when v_due is null then null
                   else (v_due - public.erp_local_date()) end;
    v_status := case
      when v_left is null then 'done'
      when v_left = 0 then 'done_on_time'
      when v_left < 0 then 'done_late'
      else 'done_early'
    end;
    update public.erp_orders
       set status = v_status,
           shipped_at = coalesce(shipped_at, now()),
           shipped_by = (select auth.uid())
     where id = p_order_id;

    update public.erp_warehouse_tasks
       set status = 'shipped'
     where order_id = p_order_id and task_type = 'pack_ship' and stage_id is null
       and status <> 'shipped';
  end if;

  return jsonb_build_object(
    'duplicate', v_dup,
    'qty_total', v_total,
    'qty_shipped', v_done,
    'complete', v_total > 0 and v_done >= v_total
  );
end $$;
