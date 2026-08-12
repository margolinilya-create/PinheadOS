-- Страж этапов: закрыть непроверяемый переход в `ready`.
--
-- Найдено прогоном 12.08. Цепочка ветвлений по статусу разбирала
-- `in_progress`, `done`, `blocked`, `skipped`, снятие блокировки и `waiting`,
-- а перехода В `ready` не было ни одного. По правилу, записанному в самой
-- функции, «не подпал ни под одну ветку» означает РАЗРЕШЕНО — значит любой
-- участник с любым правом на этапы и принадлежностью цеху мог перевести
-- задание из `waiting` в `ready` прямым запросом к REST и взять его в работу,
-- обойдя гейт зависимостей и материальный гейт целиком.
--
-- Дефект спал: клиент пишет `ready` только при ВСТАВКЕ (подрядная операция,
-- отправка образца в цех) и никогда при UPDATE. Поэтому новая ветка ничего
-- не отбирает у интерфейса — правило «страж разрешает ровно то, что разрешает
-- интерфейс» соблюдено, и парного изменения на клиенте не требуется.
--
-- Функция пересоздаётся ЦЕЛИКОМ из подлинного текста предыдущей миграции
-- (20260810340000), а не по памяти: сверка уже показывала расхождение
-- в пяти правилах из десяти, когда текст писали заново.

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

  -- `cycle` и `origin` добавлены 10.08 и в список не попали. Ранний выход ниже
  -- стоит ВЫШЕ проверки прав и проверки цеха, поэтому UPDATE, трогающий только
  -- их, не проверялся вообще ничем: любой участник менял цикл чужого этапа
  -- (ломая поиск целевого этапа при переносе) или переписывал origin
  -- с «образца» на «производство», обходя узкую ветку политики вставки.
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

  -- ПРОПУСК ПЕРЕНОСА ДЕЙСТВУЕТ ТОЛЬКО ВНУТРИ ПЕРЕНОСА.
  --
  -- `v_move` стоял OR-ом в проверке цеха и в ветках in_progress/done/waiting
  -- и в записи результата. Это опиралось на допущение, записанное здесь же:
  -- «право переноса и так есть только у ролей со сквозным доступом». 10.08
  -- допущение сломалось — `stage.move_department` выдали МЕНЕДЖЕРУ, у которого
  -- нет ни take, ни progress, ни complete, ни defect. Он мог закрыть любой этап
  -- любого цеха прямым запросом и довести заказ до отгружаемого состояния.
  --
  -- Метку ставит `erp_stage_move_department`, она живёт только до конца его
  -- транзакции. Прямой PATCH метки не имеет и падает на настоящих правах.
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

  -- Маршрутные колонки: решение по заказу, а не работа цеха
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
      -- Ветка обязана стоять ВЫШЕ `old.status = 'blocked'`: иначе пропуск
      -- заблокированного этапа проходил по stage.block (разбор кода 10.08)
      if not (public.erp_has_permission('order.manage') or v_moving) then
        raise exception 'erp_stage_guard: пропуск этапа требует права order.manage'
          using errcode = '42501';
      end if;

    elsif new.status = 'ready' then
      -- `ready` — это «зависимости выполнены и материалы на месте», состояние
      -- ВЫЧИСЛЯЕМОЕ, а не назначаемое человеком. Ни один экран не переводит
      -- этап в `ready` через UPDATE: значение ставится только при ВСТАВКЕ
      -- (подрядная операция, отправка образца в цех).
      --
      -- Ветки для него не было вовсе, а «не подпал ни под одну ветку» в этой
      -- функции означает РАЗРЕШЕНО. То есть рабочий, имеющий `stage.take`
      -- и принадлежащий цеху, мог прямым PATCH объявить своё задание готовым
      -- и тут же взять его в работу — мимо гейта зависимостей и мимо
      -- материального гейта. Ровно тот класс, что дыра со `skipped`,
      -- закрытая миграцией 20260810150000.
      --
      -- Ветка стоит ВЫШЕ `old.status = 'blocked'` намеренно: снятие блокировки
      -- сразу «в готово» — тот же обход, а разблокировка в интерфейсе пишет
      -- `waiting` и под эту ветку не попадает.
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
  'Разбирает изменение этапа по колонкам. Пропуск переноса действует ТОЛЬКО внутри erp_stage_move_department (метка erp.moving) — иначе право переноса работало сквозным пропуском всех остальных проверок. Порядок веток статуса значим: skipped выше old.status=blocked, ready выше него же, waiting ниже. cycle/origin — под order.manage. Перевод в ready — под order.manage: состояние вычисляемое, интерфейс его при UPDATE не пишет.';
