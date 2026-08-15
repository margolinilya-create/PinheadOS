-- ВОССТАНОВЛЕНО 15.08.2026 из боевой базы (`supabase_migrations.schema_migrations`,
-- версия 20260813061312, имя `erp_stage_guard_ready`).
--
-- Миграция была применена на проде 13.08, но её файл не попал в git ни в одной
-- ветке. Тело ниже — ДОСЛОВНО то, что исполнила база; строка «Полный текст
-- и обоснование — …20260812200000_erp_stage_guard_ready.sql» указывает на этот
-- самый файл, которого до сегодняшнего дня не существовало.
--
-- Почему это важно исправлять: весь слой сторожевых тестов проекта читает
-- МИГРАЦИИ (`latestDefining` в `utils/migrations.testutil`). Пока файла не было,
-- `serverPermissions.test.ts` сверял клиентские права с предыдущей версией
-- `erp_stage_guard` — то есть с текстом, который база не исполняет. А
-- восстановление схемы из репозитория откатило бы страж на версию без ветки
-- `ready`.
--
-- Что делает: закрывает непроверяемый переход этапа в `ready`. До неё ветки
-- `ready` в разборе статусов не было вовсе, а «не подпал ни под одну ветку»
-- в этом страже означает «разрешено» — то есть любой участник с любым правом
-- на этапы объявлял чужое задание готовым к работе, минуя расчёт готовности
-- (зависимости, материальный гейт, ТЗ). Состояние `ready` вычисляемое,
-- интерфейс его при UPDATE не пишет.

-- Страж этапов: закрыть непроверяемый переход в `ready`.
-- Полный текст и обоснование — supabase/migrations/20260812200000_erp_stage_guard_ready.sql
create or replace function public.erp_stage_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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
    or new.origin          is distinct from old.origin;

  if not v_guarded then
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

  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  if not v_moving and not public.erp_can_act_in_dept(old.department_id) then
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
    if new.status = 'in_progress' then
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
     and not (v_progress or v_complete or v_defect or v_moving) then
    raise exception 'erp_stage_guard: запись результата требует права stage.progress'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_stage_guard() is
  'Разбирает изменение этапа по колонкам. Пропуск переноса действует ТОЛЬКО внутри erp_stage_move_department (метка erp.moving). Порядок веток статуса значим: skipped выше old.status=blocked, ready выше него же, waiting ниже. cycle/origin — под order.manage. Перевод в ready — под order.manage: состояние вычисляемое, интерфейс его при UPDATE не пишет.';
