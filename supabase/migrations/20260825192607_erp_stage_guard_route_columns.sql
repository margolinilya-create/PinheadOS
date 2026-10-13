-- Колонки маршрута под стражем этапов (ревизия 25.08).
--
-- ФАЙЛ ВОССТАНОВЛЕН ЗАДНИМ ЧИСЛОМ 31.08. Миграция была применена к проду
-- 25.08 (`20260825192607 erp_stage_guard_route_columns`), а файла в репозитории
-- не завели — тот самый отказ, ради которого существуют `APPLIED.json`
-- и его сторож. Цена шести дней молчания была прямая: `latestDefining`
-- читает ПОСЛЕДНЮЮ репозиторную миграцию, то есть все сторожа прав сверялись
-- с текстом от 21.08 и подтверждали как норму состояние, которого в базе
-- давно нет.
--
-- Текст ПОДЛИННЫЙ: снят с действующего определения через `pg_get_functiondef`
-- и приведён к виду миграций проекта (строчный заголовок вместо заглавного
-- и `$$` вместо `$function$` — иначе `latestDefining` не найдёт функцию
-- и сторож продолжит спать). Совпадение проверено round-trip'ом: файл
-- применён к проду в транзакции с откатом, md5 определения совпал
-- с действующим (`ca5bb69220f8dec69b7a207da6c1433c`).
--
-- ЧТО ДЕЛАЕТ САМА ПРАВКА. Правило проекта: «колонка, добавленная
-- в `erp_item_stages`, попадает в `v_guarded` ТЕМ ЖЕ коммитом» — ранний выход
-- стража стоит выше проверки прав и проверки цеха, поэтому не вписанная
-- колонка не проверяется вообще ничем. Здесь под охрану взяты колонки
-- маршрута: `depends_on`, `item_id`, `cycle`, `origin`, `executor`,
-- `contractor`, `operation`, и у каждой названо, какое право её правит.

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
  v_block_change boolean;
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
            or (v_block and v_block_change)) then
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
