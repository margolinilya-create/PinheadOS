-- ПЕРЕДАЁТСЯ ФАКТ, А НЕ ПЛАН (правка заказчика 05.10, пп. 1–3)
--
-- ЧТО БЫЛО. «Покроили 102 изделия, пошили 100. После принудительного
-- завершения в ВТО доступно 150, а в маршруте закройка и пошив показывают
-- 150/150». Закрытый предшественник считался сданным НЕ МЕНЬШЕ ТИРАЖА —
-- `greatest(qty_done, тираж)` в `erp_stage_input_qty` и его клиентских
-- зеркалах (`stageFactQty`, `stageQtyProgress`). Недовыпуск при закрытии
-- исчезал: принудительное завершение количества не трогало, но следующий
-- цех видел план.
--
-- ЧТО ТЕПЕРЬ. Выход этапа — его `qty_done`, и только он. Исключение одно —
-- ПРОЗРАЧНЫЙ этап, который изделий не выпускает и потому передаёт дальше
-- то, что получил сам:
--   · пропущенный (`skipped`);
--   · непроизводственного участка (закупка, логистика, склад — признак
--     `erp_departments.is_production` в данных, а не список кодов);
--   · с файловым результатом (`result_kind`, программа вышивки);
--   · СТАРЫЙ: закрытый до этой правки с нулём и без единого отчёта
--     (решение владельца 05.10: «пропускать вход»; на бою 36 таких
--     производственных этапов). Признак ставится ОДИН РАЗ здесь и держится,
--     пока этап закрыт с нулём, — новый закрытый с нулём (принудительно, без
--     сдачи) прозрачным не становится: принудительное завершение «не
--     добавляет изделия до плана».
--
-- Признак ХРАНИТСЯ (`erp_item_stages.qty_passthrough`) и ведётся триггером:
-- клиент читает его строкой этапа и не ходит за участком и отчётами,
-- а значит, формула одна на обеих сторонах (зеркало — `utils/stageInput`).
--
-- Потолок сдачи — ВХОД ЭТАПА («цех не может сдать больше, чем получил»),
-- кроме участков с `allows_over_plan` (закрой) и служебных меток переноса
-- и подряда, которые закрывают этап по тиражу.
--
-- «Не учтено» = вход − сдано − брак, когда все предшественники закрыты;
-- пока предшественник в работе — по-прежнему от большего из тиража и входа
-- (вход ещё растёт, и закрывать этап по нему рано).
--
-- Отгрузка (`erp_ship_order`) — не больше выпущенного по позиции
-- (`erp_item_produced_qty`), заказ закрыт, когда отгружен весь выпуск
-- закрытого маршрута.

-- ── Признак прозрачного этапа ────────────────────────────────────────────
alter table public.erp_item_stages
  add column if not exists qty_passthrough boolean not null default false;

comment on column public.erp_item_stages.qty_passthrough is
  'Этап изделий не выпускает и передаёт дальше свой вход: пропущенный, непроизводственный участок, файловый результат, старый закрытый с нулём (правка 05.10). Ведёт триггер erp_stage_passthrough; зеркало — utils/stageInput.isPassthrough.';

create or replace function public.erp_stage_passthrough()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prod boolean;
begin
  select d.is_production into v_prod
    from public.erp_departments d where d.id = new.department_id;

  new.qty_passthrough :=
       new.status = 'skipped'
    or not coalesce(v_prod, false)
    or new.result_kind is not null
    -- Старый признак держится, пока этап закрыт с нулём: вернули в работу
    -- или сдали факт — этап становится обычным
    or (tg_op = 'UPDATE'
        and old.qty_passthrough
        and new.status = 'done'
        and coalesce(new.qty_done, 0) = 0);
  return new;
end $$;

revoke execute on function public.erp_stage_passthrough() from public, anon, authenticated;

-- Разовая разметка существующих этапов — ДО триггера признака: «старое
-- закрытие с нулём» триггер сам не ставит (только держит), и пересчёт
-- снял бы метку, которую эта разметка и ставит
update public.erp_item_stages s
   set qty_passthrough = true
  from public.erp_item_stages s2
  left join public.erp_departments d on d.id = s2.department_id
 where s.id = s2.id
   and (s2.status = 'skipped'
        or not coalesce(d.is_production, false)
        or s2.result_kind is not null
        or (s2.status = 'done'
            and coalesce(s2.qty_done, 0) = 0
            and not exists (select 1 from public.erp_stage_reports r where r.stage_id = s2.id)))
   and not s.qty_passthrough;

create or replace trigger erp_item_stages_passthrough
  before insert or update on public.erp_item_stages
  for each row execute function public.erp_stage_passthrough();

-- ── Выход и вход этапа ───────────────────────────────────────────────────
create or replace function public.erp_stage_input_qty_d(p_stage_id uuid, p_depth int)
returns int
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total int;
  v_deps  uuid[];
  v_min   int;
  v_out   int;
  p       record;
begin
  select greatest(coalesce(i.qty, 0), 0), s.depends_on
    into v_total, v_deps
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
  if v_total is null then
    return null;
  end if;
  -- Первый этап маршрута — тираж позиции. Петля в графе (кривые данные) —
  -- тоже тираж: fail-open, заниженный вход запретил бы сдать сделанное
  if v_deps is null or cardinality(v_deps) = 0 or p_depth > 32 then
    return v_total;
  end if;

  for p in
    select s.id, s.status, s.qty_done, s.qty_passthrough
      from public.erp_item_stages s
     where s.id = any (v_deps)
  loop
    if p.status = 'skipped' or p.qty_passthrough then
      v_out := public.erp_stage_input_qty_d(p.id, p_depth + 1);
    else
      v_out := greatest(coalesce(p.qty_done, 0), 0);
    end if;
    v_min := least(coalesce(v_min, v_out), v_out);
  end loop;

  -- Зависимости есть, а этапов нет — тираж (как у клиента)
  return coalesce(v_min, v_total);
end $$;

revoke execute on function public.erp_stage_input_qty_d(uuid, int) from public, anon, authenticated;

create or replace function public.erp_stage_input_qty(p_stage_id uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.erp_stage_input_qty_d(p_stage_id, 0)
$$;

comment on function public.erp_stage_input_qty(uuid) is
  'Сколько единиц пришло на вход этапа: минимум по выходам предшественников; выход — qty_done, у прозрачного (qty_passthrough, skipped) — его собственный вход; без предшественников — тираж позиции (правка 05.10). Зеркало клиентского utils/stageInput.stageInputQty.';

-- Закрыта для REST (решение 15.09, сторож stageInputQtyRevoked.test.ts):
-- вызывают её только definer-функции и триггер потолка
revoke execute on function public.erp_stage_input_qty(uuid) from public, anon, authenticated;

-- Выход этапа (для отгрузки и склада готовой продукции)
create or replace function public.erp_stage_output_qty(p_stage_id uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when s.status = 'skipped' or s.qty_passthrough
             then public.erp_stage_input_qty_d(s.id, 0)
           else greatest(coalesce(s.qty_done, 0), 0)
         end
    from public.erp_item_stages s
   where s.id = p_stage_id
$$;

revoke execute on function public.erp_stage_output_qty(uuid) from public, anon, authenticated;

-- ВЫПУЩЕНО ПО ПОЗИЦИИ: минимум выходов терминальных этапов маршрута
-- (на которые никто не ссылается). Образцы и файловые этапы не считаются.
-- Маршрута нет — тираж (fail-open: позиция без этапов отгружается как раньше)
create or replace function public.erp_item_produced_qty(p_item_id uuid)
returns int
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Число про позицию — только участнику ERP (функция definer и открыта
  -- вошедшим: её зовёт invoker-отгрузка)
  if not public.erp_is_member() then
    return null;
  end if;
  return coalesce(
    (select min(public.erp_stage_output_qty(s.id))
       from public.erp_item_stages s
      where s.item_id = p_item_id
        and coalesce(s.origin, 'production') = 'production'
        and s.result_kind is null
        and not exists (
          select 1 from public.erp_item_stages n
           where n.item_id = p_item_id and s.id = any (n.depends_on))),
    (select greatest(coalesce(i.qty, 0), 0) from public.erp_order_items i where i.id = p_item_id));
end $$;

comment on function public.erp_item_produced_qty(uuid) is
  'Сколько изделий позиции выпущено: минимум выходов терминальных этапов маршрута (правка 05.10, п. 1). Предел отгрузки и приёмки склада готовой продукции. Зеркало — utils/stageInput.itemProducedQty.';

revoke execute on function public.erp_item_produced_qty(uuid) from public, anon;
grant execute on function public.erp_item_produced_qty(uuid) to authenticated;

-- Закрыт ли производственный маршрут позиции целиком
create or replace function public.erp_item_production_closed(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not exists (
    select 1 from public.erp_item_stages s
      left join public.erp_departments d on d.id = s.department_id
     where s.item_id = p_item_id
       and coalesce(s.origin, 'production') = 'production'
       and coalesce(d.is_production, false)
       and s.status not in ('done', 'skipped'))
$$;

revoke execute on function public.erp_item_production_closed(uuid) from public, anon;
grant execute on function public.erp_item_production_closed(uuid) to authenticated;

-- ── Не учтено: от входа, когда предшественники закрыты ───────────────────
create or replace function public.erp_stage_unaccounted(
  p_stage_id uuid,
  p_added_good int default 0,
  p_added_defect int default 0
)
returns int
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_qty    int;
  v_done   int;
  v_input  int;
  v_deps   uuid[];
  v_open   boolean;
  v_ceil   int;
begin
  if not public.erp_is_member() then
    return null;
  end if;
  select greatest(coalesce(i.qty, 0), 0), greatest(coalesce(s.qty_done, 0), 0), s.depends_on
    into v_qty, v_done, v_deps
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
  if v_qty is null then
    return null;
  end if;
  v_input := coalesce(public.erp_stage_input_qty(p_stage_id), v_qty);
  -- Предшественник в работе — вход ещё растёт: закрывать по нему рано
  v_open := exists (
    select 1 from public.erp_item_stages p
     where p.id = any (coalesce(v_deps, '{}'))
       and p.status not in ('done', 'skipped'));
  v_ceil := case when v_open then greatest(v_qty, v_input) else v_input end;
  return v_ceil
       - (v_done + coalesce(p_added_good, 0))
       - (public.erp_stage_defect_reported(p_stage_id) + coalesce(p_added_defect, 0));
end $$;

comment on function public.erp_stage_unaccounted(uuid, int, int) is
  'Сколько изделий на этапе ещё не учтено: принято − сдано годных − брак, а пока предшественник в работе — от большего из тиража и принятого (правка 05.10). ≤ 0 — этап можно закрыть. Одна формула с клиентским utils/stageRemaining.stageUnaccounted.';

revoke execute on function public.erp_stage_unaccounted(uuid, int, int) from public, anon;
grant execute on function public.erp_stage_unaccounted(uuid, int, int) to authenticated;

-- ── Потолок факта: вход этапа ────────────────────────────────────────────
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
begin
  if new.qty_done < 0 then new.qty_done := 0; end if;
  if new.qty_rework < 0 then new.qty_rework := 0; end if;

  -- ПОТОЛОК ФАКТА — ВХОД ЭТАПА (правка 05.10): «цех не может сдать больше,
  -- чем получил». Тираж потолком больше не служит. Служебные переходы
  -- (перенос между цехами, приёмка подряда) закрывают этап по тиражу —
  -- у них прежний потолок, большее из тиража и входа.
  if tg_op = 'UPDATE' and new.qty_done > coalesce(old.qty_done, 0) then
    select d.allows_over_plan into v_over_plan
      from erp_departments d where d.id = new.department_id;

    -- Прозрачный этап (склад, закупка) изделий не выпускает: его число
    -- дальше не передаётся, и потолок ему не нужен — иначе прежний бандл,
    -- закрывающий склад тиражом, упёрся бы в отказ
    if not coalesce(v_over_plan, false) and not new.qty_passthrough then
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

comment on function public.erp_clamp_stage_qty() is
  'Нормализация счётчиков этапа: не ниже нуля, факт не выше переданного с предыдущего этапа (правка 05.10), кроме allows_over_plan (закрой) и служебных меток erp.moving / erp.subcontract_rollup (там — большее из тиража и входа). Здесь же инвариант finished_at.';

-- ── Отгрузка — не больше выпущенного ─────────────────────────────────────
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
