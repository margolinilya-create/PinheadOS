-- Граф маршрута и принадлежность этапа позиции — под `order.manage`.
--
-- ЧТО БЫЛО. `v_guarded` перечисляет все двадцать колонок `erp_item_stages`,
-- включая `depends_on` и `item_id`, — то есть ранний выход их пропускает
-- правильно, и правило «колонка попадает в `v_guarded` тем же коммитом»
-- соблюдено. Но дальше по функции ветка есть у `queue_position`,
-- `department_id`, `executor`/`contractor`/`operation`, `sort_order`,
-- `cycle`/`origin`, `qty_rework`, `status` и `qty_done` — и НИ ОДНОЙ
-- у `depends_on` и `item_id`.
--
-- Значит, изменение только этих двух колонок проходило функцию насквозь
-- и упиралось лишь в два общих условия: есть хоть какое-то право `stage.*`
-- (у рабочего их шесть) и принадлежность цеху этапа. Через REST рабочий мог:
--
--   · очистить `depends_on` своего этапа — то есть снять зависимость
--     от предыдущего цеха и сделать этап готовым к запуску, минуя маршрут.
--     Ровно то, ради чего заведён `erp_bypasses` — но там с причиной,
--     журналом и видимой цеху пометкой, а здесь без следа;
--   · перевесить этап на позицию ЧУЖОГО заказа (`item_id`), сломав обоим
--     расчёт прогресса и гейт отгрузки.
--
-- Соседняя колонка `sort_order`, описывающая ту же сущность (порядок
-- в маршруте), уже требовала `order.manage`. Через интерфейс ни того,
-- ни другого не сделать — маршрут правит только конструктор через
-- `erp_route_apply`. Но страж на то и страж: он последний рубеж, а не дубль
-- интерфейса, и REST открыт всем участникам. Этими же словами написана
-- миграция 20260821130000, закрывшая соседнюю дыру.
--
-- ЧТО СТАЛО. Одна ветка рядом с `sort_order`, теми же словами и тем же
-- правом. `v_moving` в ней есть по той же причине, что у соседей: перенос
-- между цехами (`erp_stage_move_department`) переводит на целевой этап всех,
-- кто зависел от исходного, то есть ЗАКОННО правит `depends_on` — без
-- пропуска он отказывал бы сам себе.
--
-- ПОДЛИННЫЙ ТЕКСТ. Функция снята с ДЕЙСТВУЮЩЕГО определения в базе
-- (`pg_get_functiondef`, 25.08) и приведена к виду миграций проекта:
-- заголовок в нижнем регистре, `$$` вместо `$function$`. Комментарии внутри
-- тела в базе отсутствуют — при выкладке 21.08 к проду применяли текст без
-- них, — поэтому здесь они восстановлены из файла 20260821130000 дословно.
-- Изменение ровно одно: добавлен блок «граф маршрута».

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

  -- ПРИЁМКА ПОДРЯДА СКЛАДОМ. Счётчики подрядного этапа приращает триггер
  -- журнала, а у кладовщика нет ни одного права `stage.*` — без этой ветки
  -- страж отклонял собственную транзакцию приёмки, и следующий этап
  -- не открывался никогда. Пропуск узкий: метка ставится и снимается ТОЛЬКО
  -- внутри `erp_subcontract_moves_rollup`, этап обязан быть подрядным,
  -- а вызывающий — иметь право писать журнал.
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

  -- Изменение, которое ЯВЛЯЕТСЯ блокировкой: постановка или снятие блока
  -- либо правка её причины. Право `stage.block` пропускает подрядный этап
  -- только ради этого — цех обязан уметь сказать «стоит», но не более
  v_block_change :=
    (new.status is distinct from old.status
       and (new.status = 'blocked' or old.status = 'blocked'))
    or new.block_reason is distinct from old.block_reason;

  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  if v_outsourced then
    -- `v_block` СУЖЕН до собственно блокировки. Прежде он пропускал ЛЮБОЕ
    -- изменение подрядного этапа, а `stage.block` есть у каждого рабочего:
    -- рабочий чужого цеха мог взять подрядный этап в работу и закрыть его,
    -- то есть объявить работу подрядчика выполненной, не передав и не приняв
    -- ни одной штуки.
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

  -- ГРАФ МАРШРУТА И ПРИНАДЛЕЖНОСТЬ ПОЗИЦИИ (ревизия 25.08).
  --
  -- `depends_on` — это и есть маршрут: пустой массив означает «работать можно
  -- прямо сейчас», и очистка своей строки снимала гейт предыдущего цеха
  -- без причины, без журнала и без пометки, которую видит цех. `item_id`
  -- переносит этап в другой заказ целиком.
  --
  -- Обе колонки правит ровно один законный путь — конструктор маршрута
  -- (`erp_route_apply`, под `order.manage`), плюс перенос между цехами:
  -- `erp_stage_move_department` переводит на целевой этап всех, кто зависел
  -- от исходного, и без `v_moving` отказывал бы сам себе.
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

comment on function public.erp_stage_guard() is
  'Разбор UPDATE по erp_item_stages: каждое изменение требует своего права '
  'из матрицы, плюс принадлежность цеху. Колонки маршрута (sort_order, '
  'depends_on, item_id, cycle, origin, executor) — под order.manage: их правит '
  'конструктор маршрута и перенос между цехами, а не цех со своего экрана.';
