-- Приёмка подряда СКЛАДОМ падала с 42501 (найдено проверкой прав от лица роли).
--
-- ЧТО ПРОИСХОДИЛО. Кладовщик подтверждает приёмку → клиент пишет строку
-- журнала `erp_subcontract_moves` (RLS её пропускает: политика расширена до
-- `warehouse.manage`) → триггер `erp_subcontract_moves_rollup` приращает
-- `qty_done` подрядного этапа → и вот тут `erp_stage_guard` отклоняет всё
-- целиком: у роли `storekeeper` нет НИ ОДНОГО права `stage.*`, поэтому страж
-- падает на самой первой проверке — «изменение задания требует прав на этапы».
--
-- То есть центральный сценарий документа 20.08 («после возврата склад
-- принимает, и следующий этап активируется автоматически») не работал вовсе.
-- Это ровно тот вид дефекта, о котором в CLAUDE.md сказано: право закрывает
-- одну дверь из трёх. RLS журнала расширили, а страж этапа — нет.
--
-- ПОЧЕМУ НЕ ДАТЬ КЛАДОВЩИКУ `stage.progress`. Это право означает «цех
-- записывает результат этапа», и выдача его складу открыла бы запись
-- результата ЛЮБОГО производственного этапа. Приёмка подряда — не работа
-- цеха, а движение товара.
--
-- РЕШЕНИЕ — МЕТКА ТРАНЗАКЦИИ, тем же приёмом, что `erp.moving` у переноса
-- между цехами. Пропуск действует ТОЛЬКО внутри самого rollup, только для
-- подрядного этапа и только тому, кто вправе писать журнал. Пропуск,
-- выданный «на всякий случай», однажды выдаётся не тому — поэтому здесь три
-- условия сразу, а метка снимается той же функцией, что её поставила.

-- ── 1. Rollup помечает СВОЙ update и снимает метку за собой ──────────────────
create or replace function public.erp_subcontract_moves_rollup()
returns trigger
language plpgsql
security definer
set search_path to 'public' as $$
declare
  v_sub uuid := coalesce(new.subcontract_id, old.subcontract_id);
  v_stage uuid;
  v_total int;
begin
  update public.erp_subcontracting s
     set qty_sent     = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'send'), 0),
         qty_returned = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'return'), 0),
         qty_accepted = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'accept'), 0),
         updated_at = now()
   where s.id = v_sub
  returning s.stage_id into v_stage;

  if v_stage is not null and tg_op = 'INSERT' and new.kind = 'accept' then
    v_total := public.erp_stage_item_qty(v_stage);
    if v_total is not null then
      -- Метка живёт ровно на время этого UPDATE: страж читает её и пропускает
      -- приращение счётчиков подрядного этапа складу
      perform set_config('erp.subcontract_rollup', 'on', true);
      update public.erp_item_stages s
         set qty_done = public.erp_clamp_done(s.qty_done, new.qty::int, v_total),
             status = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then 'done' else s.status end,
             finished_at = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then now() else s.finished_at end
       where s.id = v_stage;
      perform set_config('erp.subcontract_rollup', 'off', true);
    end if;
  end if;
  return null;
end $$;

-- ── 2. Страж пропускает ровно это изменение ─────────────────────────────────
-- Текст ПОДЛИННЫЙ, снят с действующего определения; добавлена одна ветка
-- сразу после проверки «изменились ли охраняемые колонки».
create or replace function public.erp_stage_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public' as $$
declare
  v_take       boolean;
  v_progress   boolean;
  v_complete   boolean;
  v_block      boolean;
  v_defect     boolean;
  v_priority   boolean;
  v_move       boolean;
  v_moving     boolean;
  v_any        boolean;
  v_guarded    boolean;
  v_outsourced boolean;
begin
  if (select auth.uid()) is null then
    return new;
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

  v_guarded :=
       new.status          is distinct from old.status
    or new.qty_done        is distinct from old.qty_done
    or new.qty_rework      is distinct from old.qty_rework
    or new.queue_position  is distinct from old.queue_position
    or new.department_id   is distinct from old.department_id
    or new.assignee        is distinct from old.assignee
    or new.block_reason    is distinct from old.block_reason
    or new.started_at      is distinct from old.started_at
    or new.finished_at     is distinct from old.finished_at
    or new.overdue_ack_at  is distinct from old.overdue_ack_at
    or new.overdue_comment is distinct from old.overdue_comment
    or new.notes           is distinct from old.notes
    or new.depends_on      is distinct from old.depends_on
    or new.sort_order      is distinct from old.sort_order
    or new.item_id         is distinct from old.item_id
    or new.cycle           is distinct from old.cycle
    or new.origin          is distinct from old.origin
    or new.executor        is distinct from old.executor
    or new.contractor      is distinct from old.contractor
    or new.operation       is distinct from old.operation;

  if not v_guarded then
    return new;
  end if;

  -- ПРИЁМКА ПОДРЯДА СКЛАДОМ. Счётчики подрядного этапа приращает триггер
  -- журнала, а у кладовщика нет ни одного права `stage.*` — без этой ветки
  -- страж отклонял собственную транзакцию приёмки, и следующий этап
  -- не открывался никогда. Пропуск узкий: метка ставится и снимается ТОЛЬКО
  -- внутри `erp_subcontract_moves_rollup`, этап обязан быть подрядным,
  -- а вызывающий — иметь право писать журнал (та же пара прав, что в RLS
  -- `erp_subcontract_moves_insert`).
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
  v_any      := v_take or v_progress or v_complete or v_block or v_defect
                or v_priority or v_move;

  v_moving := coalesce(current_setting('erp.moving', true), '') = 'on' and v_move;

  v_outsourced := coalesce(new.executor, 'internal') = 'contractor'
               or coalesce(old.executor, 'internal') = 'contractor';

  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  if v_outsourced then
    if not (public.erp_has_permission('order.manage') or v_block or v_moving) then
      raise exception 'erp_stage_guard: подрядный этап ведёт менеджер заказа (order.manage)'
        using errcode = '42501';
    end if;
  elsif not v_moving and not public.erp_can_act_in_dept(old.department_id) then
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
      if not (v_complete or v_progress or v_moving) then
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
end $$;
