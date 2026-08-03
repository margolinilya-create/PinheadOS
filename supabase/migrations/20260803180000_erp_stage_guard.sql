-- Матрица прав на сервере, шаг 2: этапы производства (волна 4 аудита, хвост).
--
-- `erp_item_stages` — последнее место, где права оставались декоративными: политика
-- UPDATE требовала лишь `erp_is_member()`, поэтому рабочий, умеющий позвать REST,
-- мог поменять приоритет очереди, перенести задание или закрыть чужой этап,
-- хотя матрица ему это запрещает.
--
-- Почему стражем, а не политикой: одна UPDATE-операция несёт ШЕСТЬ разных прав
-- (взять, записать результат, завершить, заблокировать, брак, приоритет), и какое
-- из них требуется — видно только по тому, какие колонки и как изменились.
-- RLS работает на уровне строки и этого не различает.
--
-- Правило соответствия одно: страж разрешает ровно то, что разрешает интерфейс.
-- Сервер строже клиента — это «кнопка есть, а действие падает», и виноватым
-- выглядит цех; сервер мягче клиента — дыра. Поэтому каждое правило ниже названо
-- действием интерфейса, которое его порождает.

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
  v_any        boolean;
  v_guarded    boolean;
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, запирать починку
  -- через SQL и серверные задачи страж не должен.
  if (select auth.uid()) is null then
    return new;
  end if;

  /*
   * Плановые даты этапа НЕ охраняются: их правит колонка «План» в карточке заказа
   * (`PlanCell` → `setStagePlan`), которая правами не гейтится вовсе. Повесить сюда
   * проверку значило бы отобрать у менеджера то, что он делает сегодня, — это уже
   * не ужесточение, а поломка. Гейт для плановых дат нужен, но вместе с гейтом
   * в интерфейсе, отдельной задачей.
   */
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
    or new.item_id         is distinct from old.item_id;

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

  -- Ни одного права на этапы — трогать задания нельзя вовсе.
  -- Так закрывается самый широкий случай: кадры и менеджер по REST.
  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  -- ── Приоритет в очереди цеха (`reorderStageQueue`) ──
  if new.queue_position is distinct from old.queue_position and not v_priority then
    raise exception 'erp_stage_guard: изменение приоритета требует права stage.priority'
      using errcode = '42501';
  end if;

  -- ── Перенос задания в другой цех ──
  -- Приложение переносит НЕ сменой `department_id`, а закрытием исходного этапа
  -- и открытием этапа целевого цеха. Колонку всё равно охраняем: прямая правка
  -- через REST — ровно тот обход, ради которого страж и пишется.
  if new.department_id is distinct from old.department_id and not v_move then
    raise exception 'erp_stage_guard: перенос между цехами требует права stage.move_department'
      using errcode = '42501';
  end if;

  -- ── Брак и переделка (`reportDefect`) ──
  -- Возврат брака ТОЛЬКО увеличивает счётчик переделок; уменьшение — это правка
  -- истории, её оставляем администратору через SQL.
  if coalesce(new.qty_rework, 0) is distinct from coalesce(old.qty_rework, 0)
     and not v_defect then
    raise exception 'erp_stage_guard: оформление брака требует права stage.defect'
      using errcode = '42501';
  end if;

  -- ── Переходы статуса ──
  if new.status is distinct from old.status then
    if new.status = 'in_progress' then
      -- «Взять в работу»; сюда же приходит открытие этапа целевого цеха при
      -- переносе и переоткрытие этапа при возврате брака.
      if not (v_take or v_move or v_defect) then
        raise exception 'erp_stage_guard: взять задание в работу требует права stage.take'
          using errcode = '42501';
      end if;

    elsif new.status = 'done' then
      -- «Завершить этап»; `reportProgress` закрывает этап сам, когда факт добрал
      -- тираж, поэтому права `stage.progress` тоже достаточно — ровно как
      -- в интерфейсе. Перенос закрывает исходный этап, отсюда и `move`.
      if not (v_complete or v_progress or v_move) then
        raise exception 'erp_stage_guard: завершение этапа требует права stage.complete'
          using errcode = '42501';
      end if;

    elsif new.status = 'blocked' then
      if not v_block then
        raise exception 'erp_stage_guard: блокировка этапа требует права stage.block'
          using errcode = '42501';
      end if;

    elsif old.status = 'blocked' then
      -- Снятие блокировки — то же право, что и постановка.
      if not v_block then
        raise exception 'erp_stage_guard: снятие блокировки требует права stage.block'
          using errcode = '42501';
      end if;

    elsif new.status = 'waiting' then
      -- Возврат этапов в очередь при браке (`reportDefect`).
      if not (v_defect or v_move) then
        raise exception 'erp_stage_guard: возврат этапа в очередь требует права stage.defect'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- ── Результат в штуках ──
  -- Пишут трое: «записать результат», завершение этапа и возврат брака
  -- (он уменьшает сделанное). Требовать здесь именно `progress` значило бы
  -- сломать закрытие этапа и брак.
  if new.qty_done is distinct from old.qty_done
     and not (v_progress or v_complete or v_defect or v_move) then
    raise exception 'erp_stage_guard: запись результата требует права stage.progress'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists erp_item_stages_guard on public.erp_item_stages;
create trigger erp_item_stages_guard before update on public.erp_item_stages
  for each row execute function public.erp_stage_guard();

-- ── Появление новых этапов ──
-- Пишут двое: RPC `erp_create_order` (он `security invoker`, то есть исполняется
-- от лица создающего заказ) и перенос задания в цех, которого нет в маршруте.
-- Поэтому право одно из двух, а не `erp_is_member()`.
drop policy if exists erp_item_stages_insert on public.erp_item_stages;
create policy erp_item_stages_insert on public.erp_item_stages
  for insert to authenticated
  with check (
    public.erp_has_permission('order.manage')
    or public.erp_has_permission('stage.move_department')
  );
