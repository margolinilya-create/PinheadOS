-- ОТКАТ E1 (20261019100000_erp_embroidery_one_stage): вышивка снова двумя строками
--
-- Тела — дословно прежние редакции (сторож `rollout1910a.test.ts`):
--   · `erp_stage_guard` — 20260928082955_erp_supply_autoclose.sql;
--   · `erp_stage_completion_block(uuid, int, boolean)` — 20260928182342_erp_pravki_27_09_dorabotki.sql
--     (та же подпись, одна перегрузка: E1 двухаргументную не возвращал, её
--     удалила ещё 20260928182342);
--   · `erp_stage_passthrough`, `erp_item_produced_qty` — 20261005074459_erp_stage_fact_flow.sql.
-- Новые объекты E1 снимаются: триггер `erp_item_stages_dep_gate` и функции
-- `erp_item_stages_embroidery_route_gate`, `erp_embroidery_program_finish`,
-- `erp_embroidery_program_skip`, `erp_embroidery_is_phased` (их больше никто
-- не читает: прежние тела выше о них не знают).
--
-- ПОРЯДОК: сначала откат фронта (интерфейс 19.10 зовёт `program_finish`/
-- `program_skip`), ЗАТЕМ этот файл. ПЕРЕД применением — SELECT одиночных строк
-- вышивки из README выкатки (раздел «Откат»): строки, уже ставшие «Вышивкой»
-- (`result_kind is null`), остаются как есть, а одиночные строки в фазе
-- программы после отката закрываются как прежняя программа — второй строки
-- «Вышивка» у таких позиций нет, её заводят вручную (конструктор маршрута).
-- Применяет владелец в SQL Editor: сухой прогон `begin; … rollback;`, потом
-- применение и `notify pgrst, 'reload schema'`.

begin;

-- ── Страж этапов — прежнее тело ─────────────────────────────────────────
create or replace function public.erp_stage_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_take       boolean;
  v_progress   boolean;
  v_complete   boolean;
  v_block      boolean;
  v_defect     boolean;
  v_priority   boolean;
  v_move       boolean;
  v_moving     boolean;
  v_force      boolean;
  v_any        boolean;
  v_guarded    boolean;
  v_outsourced boolean;
  v_block_change boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  -- Идентичность этапа не меняется никем: граф `depends_on` — массив без
  -- внешнего ключа, и смена id молча рвала бы зависимости маршрута
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'erp_stage_guard: идентификатор и дата создания этапа не меняются'
      using errcode = '42501';
  end if;

  if (new.planned_start is distinct from old.planned_start
      or new.planned_end is distinct from old.planned_end)
     and not public.erp_has_permission('order.manage')
     and not (
       new.status = 'in_progress'
       and old.status is distinct from 'in_progress'
       and new.planned_start is not distinct from old.planned_start
       and public.erp_has_permission('stage.take')
     )
  then
    raise exception 'erp_stage_guard: плановые даты этапа требуют права order.manage'
      using errcode = '42501';
  end if;

  -- Всё, кроме плановых дат (проверены выше) и служебного `updated_at`, —
  -- одним сравнением снимков: новая колонка этапа требует прав на этапы
  -- по умолчанию, а не открыта любому участнику
  v_guarded := (to_jsonb(new) - array['updated_at', 'planned_start', 'planned_end'])
           is distinct from
               (to_jsonb(old) - array['updated_at', 'planned_start', 'planned_end']);

  if not v_guarded then
    return new;
  end if;

  -- АВТОЗАКРЫТИЕ ЗАКУПКИ (правка 27.09, п. 9). Этап `supply` закрывает
  -- триггер `erp_supply_autoclose` в транзакции приёмки — от лица
  -- КЛАДОВЩИКА, который в цех закупки не входит. Метка живёт одну
  -- транзакцию, и пропуск узкий: только переход в `done` у этапа закупки
  -- и ничего, кроме статуса и времени завершения.
  if coalesce(current_setting('erp.supply_autoclose', true), '') = 'on'
     and new.status = 'done' and old.status is distinct from 'done'
     and exists (select 1 from public.erp_departments d
                  where d.id = old.department_id and d.code = 'supply')
     and (to_jsonb(new) - array['updated_at', 'status', 'finished_at'])
         is not distinct from
         (to_jsonb(old) - array['updated_at', 'status', 'finished_at'])
  then
    return new;
  end if;

  if coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on'
     and coalesce(new.executor, 'internal') = 'contractor'
     and (public.erp_has_permission('warehouse.manage')
          or public.erp_has_permission('order.manage'))
  then
    return new;
  end if;

  v_take     := public.erp_has_permission('stage.take');
  v_progress := public.erp_has_permission('stage.progress');
  v_complete := public.erp_has_permission('stage.complete');
  v_block    := public.erp_has_permission('stage.block');
  v_defect   := public.erp_has_permission('stage.defect');
  v_priority := public.erp_has_permission('stage.priority');
  v_move     := public.erp_has_permission('stage.move_department');

  -- Правка 20.09, п. 5: принудительное завершение. Как и перенос между
  -- цехами, оно идёт ПОД МЕТКОЙ — право само по себе не должно молча
  -- разрешать обычные правки этапа мимо остальных проверок.
  v_force := coalesce(current_setting('erp.force_complete', true), '') = 'on'
             and public.erp_has_permission('stage.force_complete');

  v_any      := v_take or v_progress or v_complete or v_block or v_defect
                or v_priority or v_move or v_force;

  v_moving := coalesce(current_setting('erp.moving', true), '') = 'on' and v_move;

  v_outsourced := coalesce(new.executor, 'internal') = 'contractor'
               or coalesce(old.executor, 'internal') = 'contractor';

  v_block_change :=
    (new.status is distinct from old.status
       and (new.status = 'blocked' or old.status = 'blocked'))
    or new.block_reason is distinct from old.block_reason;

  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  if v_outsourced then
    if not (public.erp_has_permission('order.manage')
            or v_moving
            or v_force
            or (v_block and v_block_change)) then
      raise exception 'erp_stage_guard: подрядный этап ведёт менеджер заказа (order.manage)'
        using errcode = '42501';
    end if;
  -- Правка 20.09, п. 5: разбирает последствия обновления директор, а он
  -- не состоит ни в одном цехе. Требование принадлежности цеху сделало бы
  -- действие недоступным ровно тому, кому оно адресовано.
  elsif not v_moving and not v_force
        and not public.erp_can_act_in_dept(old.department_id) then
    raise exception 'erp_stage_guard: задание другого цеха изменить нельзя'
      using errcode = '42501';
  end if;

  if new.queue_position is distinct from old.queue_position and not v_priority then
    raise exception 'erp_stage_guard: изменение приоритета требует права stage.priority'
      using errcode = '42501';
  end if;

  if new.department_id is distinct from old.department_id and not v_move then
    raise exception 'erp_stage_guard: перенос между цехами требует права stage.move_department'
      using errcode = '42501';
  end if;

  if (new.executor is distinct from old.executor
      or new.contractor is distinct from old.contractor
      or new.operation is distinct from old.operation)
     and not (public.erp_has_permission('order.manage') or v_moving) then
    raise exception 'erp_stage_guard: исполнитель этапа требует права order.manage'
      using errcode = '42501';
  end if;

  if new.sort_order is distinct from old.sort_order
     and not (public.erp_has_permission('order.manage') or v_moving) then
    raise exception 'erp_stage_guard: порядок этапов маршрута требует права order.manage'
      using errcode = '42501';
  end if;

  -- Граф маршрута и принадлежность позиции (ревизия 25.08): обе колонки правит
  -- конструктор маршрута (`erp_route_apply`, под order.manage) и перенос между
  -- цехами, который переводит на целевой этап всех зависевших от исходного
  if (new.depends_on is distinct from old.depends_on
      or new.item_id is distinct from old.item_id)
     and not (public.erp_has_permission('order.manage') or v_moving) then
    raise exception 'erp_stage_guard: связи и позиция этапа требуют права order.manage'
      using errcode = '42501';
  end if;

  if (new.cycle is distinct from old.cycle or new.origin is distinct from old.origin)
     and not (public.erp_has_permission('order.manage') or v_moving) then
    raise exception 'erp_stage_guard: цикл и происхождение этапа требуют права order.manage'
      using errcode = '42501';
  end if;

  if coalesce(new.qty_rework, 0) is distinct from coalesce(old.qty_rework, 0)
     and not v_defect then
    raise exception 'erp_stage_guard: оформление брака требует права stage.defect'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if v_outsourced and public.erp_has_permission('order.manage') then
      null;
    elsif new.status = 'in_progress' then
      if not (v_take or v_moving or v_defect) then
        raise exception 'erp_stage_guard: взять задание в работу требует права stage.take'
          using errcode = '42501';
      end if;

    elsif new.status = 'done' then
      -- Правка 20.09, п. 5: `v_force` — третий законный способ закрыть этап,
      -- рядом с обычным завершением и переносом в другой цех.
      if not (v_complete or v_progress or v_moving or v_force) then
        raise exception 'erp_stage_guard: завершение этапа требует права stage.complete'
          using errcode = '42501';
      end if;

    elsif new.status = 'blocked' then
      if not v_block then
        raise exception 'erp_stage_guard: блокировка этапа требует права stage.block'
          using errcode = '42501';
      end if;

    elsif new.status = 'skipped' then
      if not (public.erp_has_permission('order.manage') or v_moving) then
        raise exception 'erp_stage_guard: пропуск этапа требует права order.manage'
          using errcode = '42501';
      end if;

    elsif new.status = 'ready' then
      if not (public.erp_has_permission('order.manage') or v_defect or v_moving) then
        raise exception 'erp_stage_guard: перевод этапа в «готов к работе» требует права order.manage'
          using errcode = '42501';
      end if;

    elsif old.status = 'blocked' then
      if not v_block then
        raise exception 'erp_stage_guard: снятие блокировки требует права stage.block'
          using errcode = '42501';
      end if;

    elsif new.status = 'waiting' then
      if not (v_defect or v_moving) then
        raise exception 'erp_stage_guard: возврат этапа в очередь требует права stage.defect'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if new.qty_done is distinct from old.qty_done
     and not (v_progress or v_complete or v_defect or v_moving
              or (v_outsourced and public.erp_has_permission('order.manage'))) then
    raise exception 'erp_stage_guard: запись результата требует права stage.progress'
      using errcode = '42501';
  end if;

  return new;
end $function$;

revoke execute on function public.erp_stage_guard() from anon, authenticated, public;

-- ── Гейт закрытия — прежнее тело ────────────────────────────────────────
create or replace function public.erp_stage_completion_block(
  p_stage_id uuid,
  p_added_good int default 0,
  p_final boolean default false
)
returns text
language plpgsql
stable
set search_path = public as $$
declare
  v_stage  record;
  v_block  text;
  v_names  text;
  v_unacc  int;
  v_detail text;
begin
  select s.id, s.qty_done, s.result_kind,
         i.id as item_id, i.qty as item_qty, i.order_id,
         d.gate_material_kinds, d.result_fields, d.is_production
    into v_stage
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    left join public.erp_departments d on d.id = s.department_id
   where s.id = p_stage_id;
  if v_stage.id is null then
    return null;
  end if;

  if p_final then
    -- 1. Программа вышивки раньше вышивки (п. 3). Только при ЗАКРЫТИИ:
    --    документ запрещает завершение, а не сдачу части результата
    --    (правка 28.09 — прежде сдача падала на этой ветке целиком)
    v_block := public.erp_stage_program_block(p_stage_id);
    if v_block is not null then
      return v_block;
    end if;

    -- 2. Судьба остатков рулонов (п. 2)
    v_block := public.erp_stage_rolls_fate_block(p_stage_id);
    if v_block is not null then
      return v_block;
    end if;

    -- 3. Не учтённые изделия (п. 7): производственный участок с формой
    --    результата; файловый результат изделий не имеет
    if coalesce(v_stage.is_production, false)
       and jsonb_typeof(v_stage.result_fields) = 'array'
       and jsonb_array_length(v_stage.result_fields) > 0
       and v_stage.result_kind is null
    then
      v_unacc := public.erp_stage_unaccounted(p_stage_id, p_added_good, 0);
      if coalesce(v_unacc, 0) > 0 then
        -- Число и предмет разведены: склонение в SQL не заводится.
        -- Разбивка по размерам — «показывать причину и размерную разбивку»
        -- (правка 28.09); порядок — как у принятого по размерам
        v_detail := public.erp_stage_unaccounted_by_size(p_stage_id);
        return 'Нельзя завершить этап: не учтено изделий — ' || v_unacc
          || coalesce(' (' || v_detail || ')', '')
          || '. Сдайте оставшиеся изделия или укажите окончательный брак.';
      end if;
    end if;
  end if;

  -- 4. Закупка (подлинное условие 20260904180307). Только у участка
  --    с материальным гейтом и только когда запись реально добирает тираж:
  --    частичная сдача при неприехавшем материале законна
  if coalesce(cardinality(v_stage.gate_material_kinds), 0) = 0 then
    return null;
  end if;
  if coalesce(v_stage.qty_done, 0) + coalesce(p_added_good, 0) < v_stage.item_qty then
    return null;
  end if;
  -- Снятие действует, пока проверку не вернули; глобальное (order_id
  -- is null) — на все заказы, узкое — на свой
  if exists (
    select 1 from public.erp_bypasses b
     where b.kind = 'material_gate'
       and b.restored_at is null
       and (b.order_id is null or b.order_id = v_stage.order_id)
  ) then
    return null;
  end if;
  -- Дословное зеркало `routes.materialPending`: со склада и «не требуется»
  -- годны без приёмки, пришедшее закупочное — только после неё
  select string_agg(m.name, ', ' order by m.name)
    into v_names
    from public.erp_materials m
   where m.order_id = v_stage.order_id
     and (m.item_id is null or m.item_id = v_stage.item_id)
     and coalesce(m.status, '') not in ('reserved', 'not_needed')
     and (coalesce(m.status, '') <> 'received'
          or coalesce(m.accept_status, '') not in ('accepted_full', 'accepted_partial'));
  if v_names is null then
    return null;
  end if;
  return 'Закупка не завершена: ' || v_names
    || '. Этап можно закрыть, когда материалы придут и склад их примет.';
end $$;

comment on function public.erp_stage_completion_block(uuid, int, boolean) is
  'Почему этап нельзя закрыть, или NULL: при p_final — программа вышивки (п. 3), судьба остатков рулонов (п. 2), не учтённые изделия с разбивкой по размерам (п. 7); закупка. Правки 27.09 и 28.09.';
revoke execute on function public.erp_stage_completion_block(uuid, int, boolean) from public, anon;
grant execute on function public.erp_stage_completion_block(uuid, int, boolean) to authenticated;

-- ── Прозрачность этапа и выпуск позиции — прежние тела ──────────────────
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

-- ── Новые объекты E1 ─────────────────────────────────────────────────────
drop trigger if exists erp_item_stages_dep_gate on public.erp_item_stages;
drop function if exists public.erp_item_stages_embroidery_route_gate();
drop function if exists public.erp_embroidery_program_finish(uuid);
drop function if exists public.erp_embroidery_program_skip(uuid, text);
drop function if exists public.erp_embroidery_is_phased(uuid);

-- Проверка: новых функций нет, гейт закрытия — одна перегрузка
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('erp_embroidery_is_phased', 'erp_embroidery_program_finish',
                                  'erp_embroidery_program_skip', 'erp_item_stages_embroidery_route_gate')) then
    raise exception 'ROLLBACK_E1: функции E1 остались';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'erp_stage_completion_block') <> 1 then
    raise exception 'ROLLBACK_E1: перегрузок erp_stage_completion_block не одна';
  end if;
  raise notice 'ROLLBACK_E1_OK';
end $$;

commit;

notify pgrst, 'reload schema';
