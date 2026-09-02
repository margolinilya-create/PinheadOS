-- Заказ, отгруженный без срока сдачи, больше не объявляется сданным вовремя.
-- Аудит 02.09.2026.
--
-- ЧТО БЫЛО. `erp_ship_order` при полной отгрузке считает запас до срока:
--
--     v_left := case when v_due is null then null else (v_due - erp_local_date()) end;
--     v_status := case
--       when v_left is null or v_left = 0 then 'done_on_time'   -- ← вот здесь
--       when v_left < 0 then 'done_late'
--       else 'done_early'
--     end;
--
-- Две разные величины склеены в одну ветку через `or`: «сдали ровно в срок»
-- и «срока не было вовсе». Второе — это НЕИЗВЕСТНО, а не ВОВРЕМЯ.
--
-- ЦЕНА. На проде 02.09 таких заказов ШЕСТЬ из десяти закрытых: `done_on_time`
-- при `due_date is null`. То есть отчётность «сдано в срок» построена больше
-- чем наполовину на отсутствующих данных, и никакой экран этого не показывает —
-- статус выглядит обычным. Смежная величина: срок стоит лишь у 6 из 28
-- активных заказов, так что случай не редкий и сам не рассосётся.
--
-- ЭТО НАРУШЕНИЕ СОБСТВЕННОГО ПРАВИЛА ПРОЕКТА. `utils/format.percentOf` отдаёт
-- `null` при нуле в знаменателе именно потому, что «ноль в знаменателе — это
-- „неизвестно", а не „готово"»: прежняя реализация рисовала пустую неделю
-- закрытой на 100 %. Здесь ровно тот же дефект, только на сервере и в статусе
-- заказа, где он заметен ещё меньше.
--
-- ПОЧЕМУ НОВЫЙ СТАТУС, А НЕ ЗАПРЕТ ОТГРУЗКИ БЕЗ СРОКА. Отгрузку запрещать
-- нельзя: заказ физически уехал, и склад обязан это записать. Значит нужен
-- статус, честно говорящий «сдан, срок не задавали». Обязательность срока
-- закрывает случай на входе (`validateOrderForm`), а этот статус — те заказы,
-- что уже в работе, и те, что заведены мимо формы.
--
-- ПОЧЕМУ `done`, А НЕ ЧЕТВЁРТОЕ `done_*`. Все фильтры проекта различают заказы
-- по `status = 'active'` / `status <> 'active'` (`orderHelpers`, архивная
-- выборка `ordersSlice`), а не перечислением архивных значений — поэтому новое
-- значение попадает в архив и мимо активных счётчиков само, без правки
-- фильтров. Проверено по всем точкам сравнения статуса перед написанием.

-- ── 1. Новое значение статуса ────────────────────────────────────────────────
alter table public.erp_orders
  drop constraint if exists erp_orders_status_check;
alter table public.erp_orders
  add constraint erp_orders_status_check
  check (status in ('active', 'done', 'done_on_time', 'done_late',
                    'done_early', 'cancelled'));

-- ── 2. Разведение двух веток ─────────────────────────────────────────────────
--
-- Текст взят ПОДЛИННЫЙ действующий (`pg_get_functiondef` сверен с базой
-- 02.09.2026), изменена ровно одна ветка `case`. Заголовок приведён к виду
-- миграций проекта: `pg_get_functiondef` печатает его заглавными и с
-- `$function$`, а `latestDefining` в сторожевых тестах ищет строчный
-- `create or replace function public.<имя>(` и разбирает тело между `$$` —
-- скопированный дословно вывод увёл бы сторожей на предыдущую миграцию.
create or replace function public.erp_ship_order(
  p_order_id uuid,
  p_lines jsonb,
  p_note text default null::text,
  p_actor text default null::text,
  p_client_key uuid default null::uuid
)
returns jsonb
language plpgsql set search_path = public as $$
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

  -- ЗАКАЗ УХОДИТ В АРХИВ ТОЛЬКО ПРИ ПОЛНОЙ ОТГРУЗКЕ. Это и есть суть правки
  -- 30.08: прежний `shipOrder` ставил архивный статус всегда, и склад терял
  -- заказ вместе с остатком.
  if v_total > 0 and v_done >= v_total then
    select o.due_date into v_due from public.erp_orders o where o.id = p_order_id;
    v_left := case when v_due is null then null
                   else (v_due - public.erp_local_date()) end;
    -- ОТСУТСТВИЕ СРОКА — ОТДЕЛЬНАЯ ВЕТКА, И СТОИТ ОНА ПЕРВОЙ. Пока она была
    -- склеена с `v_left = 0`, сравнить оказывалось не с чем, а ответ выдавался
    -- утвердительный.
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

comment on function public.erp_ship_order(uuid, jsonb, text, text, uuid) is
  'Отгрузка заказа одной транзакцией: журнал, счётчики, статус, задача склада. Заказ без срока закрывается статусом done («Сдан»), а не done_on_time — отсутствие срока это «неизвестно», а не «вовремя» (аудит 02.09.2026).';

-- ── 3. Разбор уже накопленного ───────────────────────────────────────────────
--
-- Правка кода не чинит заведённые данные: шесть заказов останутся помеченными
-- «сдан вовремя» без единого срока, и отчёт продолжит их считать. Перевод
-- узкий и обратимый — трогаются ТОЛЬКО строки, у которых срока нет вовсе,
-- то есть ровно те, где прежняя ветка не могла дать осмысленного ответа.
-- Заказы со сроком не трогаются: там `done_on_time` заслужен.
update public.erp_orders
   set status = 'done'
 where status = 'done_on_time'
   and due_date is null;
