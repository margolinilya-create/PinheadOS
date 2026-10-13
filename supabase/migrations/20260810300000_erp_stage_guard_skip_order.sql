-- Разбор кода 10.08 (находка 1): «заблокирован → пропущен» обходил право.
--
-- Цепочка if/elsif в страже проверяет условия ПО ПОРЯДКУ. Ветка
-- `elsif old.status = 'blocked'` стояла ЧЕТВЁРТОЙ, а `new.status = 'skipped'` —
-- шестой, поэтому пропуск ЗАБЛОКИРОВАННОГО этапа попадал в ветку «снятие
-- блокировки» и требовал всего лишь `stage.block`.
--
-- Рабочий с обычным набором прав мог заблокировать СВОЁ задание и следом
-- объявить его пройденным: работа исчезала из очереди, а все зависимые этапы
-- открывались. Это ровно та щель, которую миграция 20260810150000 объявила
-- закрытой, — она закрыла её для остальных статусов, но не для blocked.
--
-- Ветка `skipped` поднята ВЫШЕ `old.status = 'blocked'`, но `waiting` остаётся
-- НИЖЕ неё: снятие блокировки переводит этап в `waiting`, и обратный порядок
-- потребовал бы от цеха права `stage.defect` — то есть цех перестал бы
-- разблокировать собственные задания.
--
-- Остальное тело взято ДОСЛОВНО из 20260810150000. Проверено дифом: попытка
-- переписать стража по памяти теряла шесть охраняемых колонок
-- (`depends_on`, `sort_order`, `item_id`, `notes`, `overdue_*`), расширяла
-- исключение для плановых дат и добавляла `v_move` в проверку брака.

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

  -- Плановые даты этапа: расписание заказа, его ведёт менеджер (`order.manage`).
  -- Проверка стоит ДО `v_guarded` — изменение одних только плановых дат в тот
  -- список не входит и возвращалось бы из стража раньше всех правил.
  --
  -- Ревью 05.08: исключение для взятия задания в работу. Форма «Взять в работу»
  -- в очереди цеха просит план завершения (норматив участка либо срок клиента)
  -- и пишет его тем же действием, что переводит этап в `in_progress`. Это
  -- прогноз исполнителя, а не правка расписания заказа, поэтому здесь достаточно
  -- `stage.take`. Произвольная правка дат в любом статусе (колонка «План»
  -- в карточке заказа) по-прежнему требует `order.manage`.
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

  -- ── Принадлежность цеху (ревью 05.08) ──
  -- Интерфейс гейтит действия ДВАЖДЫ: право (`can`) И цех (`canActIn`), и в
  -- `permissions.ts` записано прямым текстом, что матрица второго не отменяет —
  -- «бригадир швейки не должен закрывать этапы вышивки». На сервере второй половины
  -- гейта не было вовсе, и любой член ERP со `stage.complete` закрывал этап чужого
  -- цеха через REST.
  --
  -- Проверяем цех ИСХОДНОЙ строки: у переноса между цехами целевая строка по
  -- определению в чужом цехе, а сам перенос интерфейс гейтит по цеху-ИСТОЧНИКУ
  -- (`ErpKanban`: canDo('stage.move_department', dragged.stage.department_id)).
  -- Поэтому право переноса снимает эту проверку — иначе сервер стал бы строже
  -- интерфейса, а это «кнопка есть, а действие падает». Право переноса и так есть
  -- только у ролей со сквозным доступом.
  if not v_move and not public.erp_can_act_in_dept(old.department_id) then
    raise exception 'erp_stage_guard: задание другого цеха изменить нельзя'
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


    elsif new.status = 'skipped' then
      -- «Пропустить этап» (правки заказчика 10.08).
      --
      -- До этой правки переход в `skipped` не подпадал НИ ПОД ОДНУ ветку и проходил
      -- вообще без проверки прав: любой участник ERP с любым правом на этапы мог
      -- объявить задание пройденным — оно исчезало из очереди вместе с работой,
      -- а следующие цеха открывались. Щель нашлась при разборе стража, а не в проде.
      --
      -- Право `order.manage`: пропуск — решение по МАРШРУТУ заказа, а не работа
      -- цеха. `stage.move_department` тоже проходит: перенос между цехами закрывает
      -- исходный этап, и запрет здесь сделал бы сервер строже интерфейса.
      --
      -- ПОРЯДОК ВЕТОК ЗНАЧИМ (разбор кода 10.08). Ветка обязана стоять ВЫШЕ
      -- `old.status = 'blocked'`: цепочка if/elsif проверяет условия по
      -- очереди, и пропуск ЗАБЛОКИРОВАННОГО этапа попадал в ветку «снятие
      -- блокировки», проходя всего лишь по `stage.block`. Рабочий мог
      -- заблокировать собственное задание и объявить его пройденным,
      -- открыв все зависимые этапы. Ниже `waiting` её ставить нельзя
      -- по обратной причине: снятие блокировки переводит этап в `waiting`,
      -- и цех потерял бы возможность разблокировать свою работу.
      if not (public.erp_has_permission('order.manage') or v_move) then
        raise exception 'erp_stage_guard: пропуск этапа требует права order.manage'
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

comment on function public.erp_stage_guard() is
  'Разбирает изменение этапа по колонкам: приоритет, перенос, брак, статусы и результат — каждое под своим правом; плановые даты — под order.manage либо stage.take при взятии в работу; пропуск этапа — под order.manage; чужой цех — только с правом переноса. ПОРЯДОК веток статуса значим: skipped выше old.status=blocked, waiting ниже.';
