-- Правки заказчика 30.08, п. 6 — частичная отгрузка со склада.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «На складе можно зафиксировать фактическую передачу
-- клиенту с признаком „Частичная отгрузка", но после сохранения заказ пропадает
-- из склада и при этом не завершается… При сохранении частичной отгрузки
-- не завершать заказ и не убирать его из активного склада… оставить карточку
-- заказа на складе со статусом „Частично отгружено" и показывать количество,
-- которое осталось отгрузить… Завершать складскую отгрузку и убирать заказ
-- из активного склада только после того, как клиенту передано всё количество».
--
-- ── Почему заказ пропадал ────────────────────────────────────────────────────
--
-- Механики частичной отгрузки не было вовсе: колонки `qty_shipped` в схеме
-- не существовало, а `shipOrder` одним патчем писал `shipped_status='shipped'`
-- И архивный `status` (`done_on_time`/`done_late`/`done_early`). Экран склада
-- при этом фильтрует по `o.status = 'active'` — как только статус переставал
-- быть активным, из таблицы исчезали ВСЕ задачи заказа, включая недоделанные.
-- Значение `partial` в CHECK жило с самой первой миграции и не записывалось
-- никем.
--
-- ── Устройство: журнал приращений + агрегат ──────────────────────────────────
--
-- Дословно тот же приём, что у приёмки материалов (`erp_material_receipts` +
-- `erp_material_receipts_rollup` + `erp_material_accept`), потому что это та же
-- задача: величина накапливается частями, её надо объяснить, и повтор отправки
-- не должен её удвоить.
--
-- Разрез — ПО ПОЗИЦИЯМ (решение заказчика): заказ из футболок и худи
-- отгружается по частям не «на 40 штук», а «все футболки и половина худи»,
-- и остаток по заказу целиком на такой вопрос не отвечает.

-- ── 1. Агрегат у позиции ─────────────────────────────────────────────────────

alter table public.erp_order_items
  add column if not exists qty_shipped numeric not null default 0;

comment on column public.erp_order_items.qty_shipped is
  'Сколько единиц позиции передано клиенту. Ведёт ТОЛЬКО триггер erp_order_shipments_rollup — клиент колонку читает. Прямая запись с клиента означала бы второго писателя, и одна отгрузка затирала бы другую.';

-- ── 2. Журнал отгрузок ───────────────────────────────────────────────────────

create table if not exists public.erp_order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  item_id uuid not null references public.erp_order_items(id) on delete cascade,
  qty numeric not null check (qty > 0),
  note text,
  shipped_on date not null default public.erp_local_date(),
  author text,
  author_id uuid,
  created_at timestamptz not null default now(),
  -- Ключ идемпотентности: повтор отправки (оборвался ответ, человек нажал
  -- второй раз) не должен удвоить отгруженное. Частичный уникальный индекс —
  -- у строк, заведённых без ключа, NULL, и он их не трогает.
  client_key uuid
);

create unique index if not exists erp_order_shipments_client_key_idx
  on public.erp_order_shipments (client_key) where client_key is not null;

create index if not exists erp_order_shipments_order_idx
  on public.erp_order_shipments (order_id, shipped_on desc);

-- Индекс по позиции нужен ПО ДЕЛУ, а не ради советника: rollup на каждой
-- вставке считает `sum(qty) where item_id = …`, то есть это самый частый
-- запрос к таблице. Он же покрывает внешний ключ.
create index if not exists erp_order_shipments_item_idx
  on public.erp_order_shipments (item_id);

comment on table public.erp_order_shipments is
  'Журнал фактических передач клиенту (правка 30.08, п. 6). Строка = сколько единиц позиции отдано в этот раз. Агрегат erp_order_items.qty_shipped и erp_orders.shipped_status ведёт триггер.';

alter table public.erp_order_shipments enable row level security;

drop policy if exists "erp_order_shipments_read" on public.erp_order_shipments;
create policy "erp_order_shipments_read" on public.erp_order_shipments
  for select to authenticated using (public.erp_is_member());

-- Пишет тот, кто ведёт складские задачи: отгрузка — движение товара, и своего
-- права под неё не заводим (то же решение, что у журнала приёмки материалов).
drop policy if exists "erp_order_shipments_insert" on public.erp_order_shipments;
create policy "erp_order_shipments_insert" on public.erp_order_shipments
  for insert to authenticated
  with check (public.erp_has_permission('warehouse.manage'));

-- Ошибку склада правят строкой журнала, а не второй строкой с минусом:
-- «отгружено −5» никто не читает как «ошиблись».
drop policy if exists "erp_order_shipments_update" on public.erp_order_shipments;
create policy "erp_order_shipments_update" on public.erp_order_shipments
  for update to authenticated
  using (public.erp_has_permission('warehouse.manage'))
  with check (public.erp_has_permission('warehouse.manage'));

drop policy if exists "erp_order_shipments_delete" on public.erp_order_shipments;
create policy "erp_order_shipments_delete" on public.erp_order_shipments
  for delete to authenticated
  using (public.erp_has_permission('warehouse.manage'));

-- ── 3. Rollup: единственный писатель агрегатов ───────────────────────────────

create or replace function public.erp_order_shipments_rollup()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_item  uuid := coalesce(new.item_id, old.item_id);
  v_total numeric;
  v_done  numeric;
begin
  /**
   * МЕТКА ТРАНЗАКЦИИ ВОКРУГ ПРАВКИ ПОЗИЦИИ.
   *
   * Найдено проверкой прав на живой базе, и это ровно тот класс отказа,
   * который в проекте уже разбирали на подряде: право проверяется ПО ВСЕЙ
   * ЦЕПОЧКЕ, а не в одной точке. Кладовщик вправе писать журнал отгрузок
   * (`warehouse.manage`), но этот триггер приращает
   * `erp_order_items.qty_shipped`, а `erp_order_item_guard` требует
   * `order.manage` — которого у него нет. Без метки страж отклонял
   * СОБСТВЕННУЮ транзакцию отгрузки: «42501: правка позиции заказа требует
   * права order.manage» на каждой попытке склада отгрузить заказ.
   *
   * `security definer` здесь не спасает: страж смотрит `auth.uid()`, а он
   * у вызывающего не пуст.
   *
   * Пропуск узкий, как и у подряда: метка ставится и снимается ТОЛЬКО здесь,
   * вокруг своего update, а страж принимает её лишь у того, кто вправе
   * писать журнал (`warehouse.manage`) — то есть у того же, кого пускает
   * RLS `erp_order_shipments_insert`.
   */
  perform set_config('erp.shipment_rollup', 'on', true);
  update public.erp_order_items i
     set qty_shipped = coalesce(
           (select sum(s.qty) from public.erp_order_shipments s where s.item_id = v_item), 0)
   where i.id = v_item;
  perform set_config('erp.shipment_rollup', 'off', true);

  -- Статус заказа — ВЫВОДИТСЯ из сумм, а не выбирается рядом с ними.
  -- Селект «Частично отгружено» рядом с количествами был бы разрешением
  -- соврать: ровно тот дефект, из-за которого правился подряд 20.08.
  select coalesce(sum(i.qty), 0), coalesce(sum(i.qty_shipped), 0)
    into v_total, v_done
    from public.erp_order_items i
   where i.order_id = v_order;

  update public.erp_orders o
     set shipped_status = case
           when v_done <= 0 then 'not_shipped'
           when v_total > 0 and v_done >= v_total then 'shipped'
           else 'partial'
         end
   where o.id = v_order;

  return null;
end $$;

revoke execute on function public.erp_order_shipments_rollup()
  from public, anon, authenticated;

comment on function public.erp_order_shipments_rollup() is
  'Единственный писатель erp_order_items.qty_shipped и erp_orders.shipped_status: сумма журнала отгрузок против тиража позиций.';

drop trigger if exists erp_order_shipments_rollup_trg on public.erp_order_shipments;
create trigger erp_order_shipments_rollup_trg
  after insert or update or delete on public.erp_order_shipments
  for each row execute function public.erp_order_shipments_rollup();

-- ── 3.1. Страж позиции пропускает СВОЙ rollup ────────────────────────────────
--
-- НАЙДЕНО ПРОВЕРКОЙ ПРАВ НА ЖИВОЙ БАЗЕ, от лица настоящего кладовщика
-- (`set local role authenticated`). Без этой ветки склад не мог отгрузить
-- НИЧЕГО: журнал он вставляет по праву `warehouse.manage`, а rollup правит
-- `erp_order_items.qty_shipped` — и `erp_order_item_guard`, требующий
-- `order.manage`, отклонял собственную транзакцию отгрузки с 42501.
--
-- Тот же класс отказа уже разбирался на приёмке подряда (правило проекта
-- «право проверяется ПО ВСЕЙ ЦЕПОЧКЕ, а не в одной точке»), и лечится тем же
-- приёмом — узкой меткой транзакции. Метку ставит и снимает сам rollup вокруг
-- своего update; страж принимает её только у того, кто вправе писать журнал,
-- то есть у того же, кого пускает RLS `erp_order_shipments_insert`.
--
-- Текст взят из действующего определения функции и дополнен одной веткой.
create or replace function public.erp_order_item_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  -- Приращение `qty_shipped` из журнала отгрузок: см. комментарий выше
  if coalesce(current_setting('erp.shipment_rollup', true), '') = 'on'
     and public.erp_has_permission('warehouse.manage')
  then
    return new;
  end if;
  if not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_item_guard: правка позиции заказа требует права order.manage'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function public.erp_order_item_guard() is
  'Страж правки позиции заказа: order.manage. Исключение — приращение qty_shipped внутри erp_order_shipments_rollup под меткой erp.shipment_rollup (правка 30.08, п. 6).';

-- ── 4. Действие отгрузки одной транзакцией ───────────────────────────────────
--
-- Журнал, агрегаты и (при полной отгрузке) архивный статус заказа — одним
-- вызовом. Пачка независимых UPDATE с общим откатом интерфейса откатывала бы
-- поверх уже закоммиченного: правило проекта, записанное после разбора 05.08.
--
-- `security invoker`: RLS журнала и заказа проверяются от лица вызывающего.
-- Обход прав здесь не нужен — отгружает тот, у кого `warehouse.manage`.
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
      end if;
    end loop;
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
  'Фактическая передача клиенту по позициям одной транзакцией (правка 30.08, п. 6). Архивный статус заказа и закрытие задачи pack_ship — только при полной отгрузке; частичная оставляет заказ активным и на складе.';

-- ── 5. Бэкфилл уже отгруженных ───────────────────────────────────────────────
--
-- Заказы, отгруженные до этой правки, не имеют ни одной строки журнала,
-- и `qty_shipped` у них остался бы нулём — то есть «Частично отгружено»
-- у полностью закрытого заказа. Сумма журнала для них не восстановима
-- (никто её не вёл), поэтому агрегат проставляется по факту `shipped_status`,
-- а журнал остаётся пустым: выдумывать строки с датами, которых не было,
-- хуже, чем не иметь истории.
update public.erp_order_items i
   set qty_shipped = i.qty
  from public.erp_orders o
 where o.id = i.order_id
   and o.shipped_status = 'shipped'
   and i.qty_shipped = 0;
