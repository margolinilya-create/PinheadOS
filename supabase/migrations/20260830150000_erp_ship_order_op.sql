-- ФАКТ ОТГРУЗКИ ВИДЕН НА СКЛАДЕ (правка заказчика 30.08, п. 6).
--
-- Документ: «Зафиксировать факт отгрузки и количество, которое фактически
-- передано клиенту». Журнал `erp_order_shipments` это и делает — но его
-- НИКТО НЕ ЧИТАЕТ: карточка склада показывает историю из
-- `erp_warehouse_ops`, а отгрузка туда не писала. Величины (остаток,
-- «Отгружено N из M») считаются из агрегатов, то есть отвечают на «сколько
-- осталось», и ни одна поверхность не отвечала на «что и когда отдали».
-- Зафиксированный факт, которого не видно, — ровно то же, что незаписанный.
--
-- ПОЧЕМУ НЕ ВТОРАЯ ЛЕНТА. Блок «История операций» в карточке уже рисует
-- `WAREHOUSE_OP_LABELS[op.op_type]`, а вид `shipment` («Отгрузка») заведён
-- в CHECK с первой волны склада и до сих пор не использовался ни разу.
-- Своя лента рядом была бы вторым местом для одной и той же истории.
--
-- ОДНА СТРОКА НА ОТГРУЗКУ, А НЕ НА ПОЗИЦИЮ: у `erp_warehouse_ops` нет
-- `item_id`, и разложить строку по позициям некуда. Событие здесь —
-- «передали клиенту столько-то», а разрез по позициям виден рядом,
-- в остатках каждой строки.
--
-- ПОВТОР ТОЙ ЖЕ ПОПЫТКИ ИСТОРИЮ НЕ УДВАИВАЕТ: вставка стоит внутри
-- `if not v_dup`, рядом с журналом. Иначе оборванный ответ и повторный тап
-- давали бы две «Отгрузки» на одно физическое действие — то же, от чего
-- журнал защищён ключом идемпотентности.

create or replace function public.erp_ship_order(
  p_order_id   uuid,
  p_lines      jsonb,
  p_note       text default null,
  p_actor      text default null,
  p_client_key uuid default null
)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_line   jsonb;
  v_dup    boolean := false;
  v_total  numeric;
  v_done   numeric;
  v_sent   numeric := 0;
  v_status text;
  v_due    date;
  v_left   int;
begin
  if p_client_key is not null then
    select exists (
      select 1 from public.erp_order_shipments where client_key = p_client_key
    ) into v_dup;
  end if;

  -- Повтор той же попытки не пишет журнал второй раз, но состояние заказа
  -- всё равно приводится к ожидаемому: повтор оставляет систему там же,
  -- где её оставила первая удачная попытка.
  if not v_dup then
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
    loop
      if coalesce((v_line ->> 'qty')::numeric, 0) > 0 then
        insert into public.erp_order_shipments
          (order_id, item_id, qty, note, author, author_id, client_key)
        values (
          p_order_id,
          (v_line ->> 'item_id')::uuid,
          (v_line ->> 'qty')::numeric,
          nullif(btrim(coalesce(p_note, '')), ''),
          nullif(btrim(coalesce(p_actor, '')), ''),
          (select auth.uid()),
          p_client_key
        );
        v_sent := v_sent + (v_line ->> 'qty')::numeric;
      end if;
    end loop;

    -- Событие для истории склада — там, где человек его ищет
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
  end if;

  select coalesce(sum(i.qty), 0), coalesce(sum(i.qty_shipped), 0)
    into v_total, v_done
    from public.erp_order_items i
   where i.order_id = p_order_id;

  -- ЗАКАЗ УХОДИТ В АРХИВ ТОЛЬКО ПРИ ПОЛНОЙ ОТГРУЗКЕ. Это и есть суть правки:
  -- прежний `shipOrder` ставил архивный статус всегда, и склад терял заказ
  -- вместе с остатком.
  if v_total > 0 and v_done >= v_total then
    select o.due_date into v_due from public.erp_orders o where o.id = p_order_id;
    v_left := case when v_due is null then null
                   else (v_due - public.erp_local_date()) end;
    v_status := case
      when v_left is null or v_left = 0 then 'done_on_time'
      when v_left < 0 then 'done_late'
      else 'done_early'
    end;
    update public.erp_orders
       set status = v_status,
           shipped_at = coalesce(shipped_at, now()),
           shipped_by = (select auth.uid())
     where id = p_order_id;

    -- Задача склада закрывается ТЕМ ЖЕ действием: отдельным запросом она
    -- осталась бы открытой при обрыве связи, и заказ повис бы — не на складе
    -- и не в архиве.
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

grant execute on function public.erp_ship_order(uuid, jsonb, text, text, uuid)
  to authenticated;

comment on function public.erp_ship_order(uuid, jsonb, text, text, uuid) is
  'Отгрузка одной транзакцией: журнал позиций, событие истории склада (shipment), архивный статус и закрытие задачи — только при полной передаче (правка 30.08, п. 6).';
