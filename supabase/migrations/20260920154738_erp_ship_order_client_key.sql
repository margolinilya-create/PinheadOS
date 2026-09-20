-- ОТГРУЗКА ЗАКАЗА ИЗ НЕСКОЛЬКИХ ПОЗИЦИЙ ПАДАЛА ЦЕЛИКОМ (правка заказчика
-- 20.09, п. 1).
--
-- Что было. Уникальный индекс `erp_order_shipments_client_key_idx` стоял
-- на ОДНОЙ колонке `client_key`, а `erp_ship_order` пишет журнал СТРОКОЙ
-- НА КАЖДУЮ ПОЗИЦИЮ — и все строки одной попытки несут один и тот же
-- `p_client_key`. То есть ключ идемпотентности попытки был объявлен ключом
-- строки журнала. На заказе из одной позиции это совпадает, и правка 30.08
-- прошла проверку; на второй позиции вторая вставка падала
-- `23505 duplicate key value violates unique constraint
-- "erp_order_shipments_client_key_idx"`, и транзакция откатывалась целиком.
--
-- Отсюда же то, что видел склад: «Отгружено 0 из 90 шт.» после нажатия.
-- Заказ 63634 «Одноклассники сентябрь» — три позиции по 30 шт: худи, кепка,
-- джоггеры. Ни одной строки в журнале, `qty_shipped = 0`.
--
-- ПОЧЕМУ ЭТО ДОЖИЛО ДО БОЯ. Все сценарии отгрузки в `useErpStore.test.ts`
-- построены на ОДНОЙ позиции, а RPC в них замокан: проверялось, что стор
-- зовёт функцию с нужными аргументами, а не что база принимает результат.
-- Мок не может отказать так, как отказывает уникальный индекс.

-- 1. Ключ строки журнала — ПОПЫТКА И ПОЗИЦИЯ, а не попытка.
--    `nulls not distinct`: если позиция в строке почему-то не названа,
--    вторая такая же строка той же попытки — всё равно дубль, а не новая
--    отгрузка. По умолчанию Postgres считал бы два NULL разными.
drop index if exists public.erp_order_shipments_client_key_idx;

create unique index if not exists erp_order_shipments_client_key_idx
  on public.erp_order_shipments (client_key, item_id) nulls not distinct
  where client_key is not null;

comment on index public.erp_order_shipments_client_key_idx is
  'Идемпотентность отгрузки: одна попытка (client_key) пишет ОДНУ строку на позицию. Уникальность по одному client_key ломала отгрузку заказа из нескольких позиций (правка 20.09, п. 1).';

-- 2. Дубль определяет САМ INSERT, а не предварительная проверка.
--
--    `select exists(...)` перед вставкой — это две операции там, где нужна
--    одна: между ними помещаются два параллельных вызова, оба проходят
--    проверку, и второй падает 23505. Тот же дефект уже чинили у приёмки
--    материалов (20260916191916), приёмом `on conflict … do nothing`;
--    здесь он не был применён.
--
--    Сигнатура не меняется, поэтому `create or replace` — без `drop`:
--    перегрузки не возникает, и PostgREST выбирать не из чего.
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
  v_line    jsonb;
  v_dup     boolean := false;
  v_asked   int := 0;   -- сколько строк попытка просила записать
  v_written int := 0;   -- сколько их записалось на самом деле
  v_rows    int;
  v_total   numeric;
  v_done    numeric;
  v_sent    numeric := 0;
  v_status  text;
  v_due     date;
  v_left    int;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if coalesce((v_line ->> 'qty')::numeric, 0) > 0 then
      v_asked := v_asked + 1;

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
      )
      on conflict (client_key, item_id) where client_key is not null
      do nothing;

      -- Посчитать вставленное можно только здесь: `on conflict do nothing`
      -- отличает повтор от записи молча, и без ROW_COUNT повторная попытка
      -- насчитала бы отгруженным то, чего не записала.
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_written := v_written + 1;
        v_sent := v_sent + (v_line ->> 'qty')::numeric;
      end if;
    end if;
  end loop;

  -- Повтор той же попытки: просили записать строки, не записалось ни одной.
  -- Состояние заказа ниже всё равно приводится к ожидаемому — повтор
  -- оставляет систему там же, где её оставила первая удачная попытка.
  v_dup := v_asked > 0 and v_written = 0;

  -- СОБЫТИЕ ИСТОРИИ — ТОЛЬКО ЗА РЕАЛЬНО ЗАПИСАННОЕ. Пиши мы его по факту
  -- вызова, повтор нажатия плодил бы в истории склада отгрузки, за которыми
  -- не стоит ни одного изделия.
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
  'Отгрузка заказа одной транзакцией: журнал, счётчики, статус, задача склада. Повтор отсекает сам INSERT (on conflict по паре client_key+item_id), а не предварительная проверка: заказ из нескольких позиций пишет несколько строк одной попытки (правка 20.09, п. 1). Заказ без срока закрывается статусом done — отсутствие срока это «неизвестно», а не «вовремя» (аудит 02.09.2026).';
