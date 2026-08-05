-- Этапы производства: атомарные операции + достройка стража (ревью 05.08).
--
-- Закрывает четыре находки ревью, все — про одну таблицу `erp_item_stages`:
--
-- 1. «Взять в работу» падало на сервере. `useStageActions.onStart` перед сменой
--    статуса пишет `planned_end` (форма взятия ВСЕГДА подставляет дату), а страж
--    20260803230000 требует на плановые даты `order.manage`. У ролей `worker`
--    и `foreman` этого права нет ни в сиде, ни в `DEFAULT_PERMISSIONS`, поэтому
--    каждый рабочий на каждом взятии задания получал 42501 и красный тост,
--    а плановая дата не сохранялась — вместе с ней переставала считаться
--    просрочка этапа. Ровно тот отказ, который страж обязан не порождать.
--    Решение: прогноз завершения при взятии задания — часть взятия, а не правка
--    расписания заказа, поэтому `planned_end` принимается и под `stage.take`,
--    когда этап тем же запросом уходит в `in_progress`. Колонка «План» в карточке
--    заказа (произвольная правка дат в любом статусе) остаётся под `order.manage`.
--
-- 2. Потерянное обновление счётчиков. `reportProgress`/`reportDefect` читали
--    `qty_done`/`qty_rework` из локального стора и писали АБСОЛЮТ. Два планшета
--    в одном цехе на одном задании: A записал 30, B со своим ещё нулевым
--    состоянием записал 20 — в базе 20, тридцатка исчезла. Для цеха с несколькими
--    исполнителями это не гонка-теоретик, а обычный день. Решение: считать
--    приращением НА СЕРВЕРЕ (`erp_stage_report_progress`, `erp_stage_apply_defect`).
--
-- 3. Частичная запись при браке и перенумерации очереди. Клиент слал 2-4
--    независимых UPDATE через `Promise.all` и при сбое любого откатывал интерфейс
--    целиком — поверх уже закоммиченных остальных. Проект сам сформулировал
--    обратное правило для `moveStageToDepartment`, но на брак его не распространил.
--    Решение: одна транзакция на действие (RPC), откатывать нечего по построению.
--
-- 4. Финальный ОТК открывался раньше перенесённой работы. Перенос закрывает
--    исходный этап и открывает целевой, но `depends_on` тех, кто ждал исходный,
--    никто не переписывал: ОТК зависел от закрытого ВТО и становился готовым,
--    пока ДТФ ещё не начинал. Решение: `erp_stage_move_department` переводит
--    зависимых с исходного этапа на целевой той же транзакцией.
--
-- Все RPC — `security invoker`: RLS и страж исполняются от лица вызывающего,
-- иначе атомарность покупалась бы обходом прав.

-- ── Принадлежность цеху на сервере ──
-- Дословное зеркало `canActInDept` из src/erp/utils/permissions.ts:
--   admin/director/rop профиля — везде;
--   привязки в erp_employees нет — тоже везде (fail-open: в цехах, где сотрудников
--     ещё не завели, запрет остановил бы производство);
--   привязка есть — только свой цех.
-- Клиентский dev-режим (`user.id === 'dev'`) серверного соответствия не имеет
-- и не должен: это локальный автологин, а не роль.
create or replace function public.erp_can_act_in_dept(p_dept uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with me as (
    select p.role as profile_role,
           (select e.department_id
              from public.erp_employees e
             where e.profile_id = p.id and e.active is true
             limit 1) as my_dept
      from public.profiles p
     where p.id = (select auth.uid()) and p.active is true and p.approved is true
  )
  select case
    when (select profile_role from me) in ('admin', 'director', 'rop') then true
    when (select my_dept from me) is null then true
    else p_dept is not null and (select my_dept from me) = p_dept
  end;
$$;
grant execute on function public.erp_can_act_in_dept(uuid) to authenticated;

comment on function public.erp_can_act_in_dept(uuid) is
  'Зеркало canActInDept: руководство — везде, без привязки к цеху — везде (fail-open), с привязкой — только свой цех.';

-- ── Страж этапов ──
-- Текст перенесён из ПОДЛИННОЙ 20260803230000 (правило проекта: пересоздавая
-- функцию целиком, брать исходную миграцию, а не писать по памяти). Изменены
-- ровно два места, оба отмечены «ревью 05.08»; остальные правила дословны.
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
  'Разбирает изменение этапа по колонкам: приоритет, перенос, брак, статусы и результат — каждое под своим правом; плановые даты — под order.manage либо stage.take при взятии в работу; чужой цех — только с правом переноса.';

-- ── Тираж позиции по этапу (общий хелпер RPC ниже) ──
create or replace function public.erp_stage_item_qty(p_stage_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select i.qty
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
$$;
grant execute on function public.erp_stage_item_qty(uuid) to authenticated;

-- ── Частичная готовность: приращение считает сервер ──
-- Клиент присылает СКОЛЬКО сделано сейчас, а не итог: иначе два планшета в одном
-- цехе затирают результат друг друга. Обрезка по тиражу и авто-закрытие этапа
-- тоже здесь — оба решения зависят от актуального значения в строке, а не от
-- того, что клиент видел минуту назад.
create or replace function public.erp_stage_report_progress(p_stage_id uuid, p_qty int)
returns public.erp_item_stages
language plpgsql set search_path = public as $$
declare
  v_total int;
  v_next  int;
  v_row   public.erp_item_stages;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'erp_stage_report_progress: количество должно быть больше нуля'
      using errcode = '22023';
  end if;

  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_report_progress: этап не найден'
      using errcode = 'P0002';
  end if;

  select least(coalesce(s.qty_done, 0) + p_qty, v_total)
    into v_next
    from public.erp_item_stages s
   where s.id = p_stage_id
     for update;
  if v_next is null then
    raise exception 'erp_stage_report_progress: этап не найден'
      using errcode = 'P0002';
  end if;

  update public.erp_item_stages s
     set qty_done    = v_next,
         status      = case when v_next >= v_total then 'done' else s.status end,
         finished_at = case when v_next >= v_total then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $$;
grant execute on function public.erp_stage_report_progress(uuid, int) to authenticated;

comment on function public.erp_stage_report_progress(uuid, int) is
  'Частичная готовность приращением: qty_done += N с обрезкой по тиражу и авто-закрытием этапа. Абсолют с клиента терял результат второго исполнителя.';

-- ── Возврат брака: все затронутые этапы одной транзакцией ──
-- КАКИЕ этапы затронуты, считает клиент (`utils/stageDefect.intermediateReopened`
-- по графу `depends_on`) — и остаётся единственным источником этого правила:
-- второй его реализацией на SQL мы бы завели ровно ту рассинхронизацию, из-за
-- которой текст подтверждения когда-то разошёлся с фактом. Сервер отвечает за то,
-- чего клиент не может: приращение счётчиков и атомарность.
--
-- Формат патча: {id, qty_done_delta, qty_rework_delta, status, reopen_if_done,
-- clear_finished}. `status` = null означает «оставить как есть»; `reopen_if_done`
-- переводит в `waiting` только уже закрытый этап — решение принимается по
-- актуальной строке, а не по той, что видел клиент.
create or replace function public.erp_stage_apply_defect(p_patches jsonb)
returns setof public.erp_item_stages
language plpgsql set search_path = public as $$
declare
  v_patch jsonb;
  v_total int;
  v_row   public.erp_item_stages;
begin
  if p_patches is null or jsonb_typeof(p_patches) <> 'array' then
    raise exception 'erp_stage_apply_defect: ожидается массив патчей'
      using errcode = '22023';
  end if;

  for v_patch in select * from jsonb_array_elements(p_patches)
  loop
    v_total := public.erp_stage_item_qty((v_patch->>'id')::uuid);
    if v_total is null then
      raise exception 'erp_stage_apply_defect: этап % не найден', v_patch->>'id'
        using errcode = 'P0002';
    end if;

    update public.erp_item_stages s
       set qty_done = greatest(
             least(
               coalesce(s.qty_done, 0) + coalesce((v_patch->>'qty_done_delta')::int, 0),
               v_total),
             0),
           qty_rework = greatest(
             coalesce(s.qty_rework, 0) + coalesce((v_patch->>'qty_rework_delta')::int, 0),
             0),
           status = case
             when coalesce((v_patch->>'reopen_if_done')::boolean, false)
                  and s.status = 'done' then 'waiting'
             else coalesce(v_patch->>'status', s.status)
           end,
           finished_at = case
             when coalesce((v_patch->>'clear_finished')::boolean, false) then null
             when coalesce((v_patch->>'reopen_if_done')::boolean, false)
                  and s.status = 'done' then null
             else s.finished_at
           end
     where s.id = (v_patch->>'id')::uuid
    returning * into v_row;

    return next v_row;
  end loop;
end $$;
grant execute on function public.erp_stage_apply_defect(jsonb) to authenticated;

comment on function public.erp_stage_apply_defect(jsonb) is
  'Патчи брака одной транзакцией: счётчики приращением, статусы по актуальной строке. Прежде клиент слал независимые UPDATE и при сбое одного откатывал интерфейс поверх закоммиченных остальных.';

-- ── Приоритет очереди: перенумерация цеха одной транзакцией ──
-- Обычный путь переставляет одну строку и в RPC не нуждается, но редкий
-- (соседние позиции слиплись по точности double) переписывает всю очередь цеха:
-- десяток независимых UPDATE, где сбой одного оставлял очередь в перемешанном
-- состоянии, а интерфейс откатывался целиком.
create or replace function public.erp_stage_reorder_queue(p_writes jsonb)
returns setof public.erp_item_stages
language plpgsql set search_path = public as $$
begin
  if p_writes is null or jsonb_typeof(p_writes) <> 'array' then
    raise exception 'erp_stage_reorder_queue: ожидается массив позиций'
      using errcode = '22023';
  end if;

  return query
    update public.erp_item_stages s
       set queue_position = (w->>'queue_position')::numeric
      from jsonb_array_elements(p_writes) w
     where s.id = (w->>'id')::uuid
    returning s.*;
end $$;
grant execute on function public.erp_stage_reorder_queue(jsonb) to authenticated;

comment on function public.erp_stage_reorder_queue(jsonb) is
  'Перенумерация очереди цеха одной транзакцией.';

-- ── Перенос задания между цехами ──
-- Три записи, которые обязаны быть неделимыми: закрыть исходный этап, открыть
-- целевой (создав его, если цеха нет в маршруте) и перевести на целевой тех,
-- кто ждал исходный.
--
-- Про третью запись. Без неё финальный ОТК открывался РАНЬШЕ перенесённой работы:
-- маршрут «…→ВТО→ОТК», работу из ВТО переносят в ДТФ, ВТО закрывается `done`,
-- ОТК видит свою зависимость выполненной и встаёт в очередь — хотя ДТФ ещё
-- не начинал. Перевод зависимых верен в обе стороны: при возврате назад
-- (цель раньше по маршруту) ОТК точно так же обязан снова ждать.
--
-- Компенсирующая запись при сбое второго шага, которую держал клиент, больше
-- не нужна: транзакция либо проходит целиком, либо не оставляет следа.
create or replace function public.erp_stage_move_department(
  p_stage_id uuid,
  p_target_dept uuid,
  p_queue_position numeric default null
)
returns setof public.erp_item_stages
language plpgsql set search_path = public as $$
declare
  v_stage  public.erp_item_stages;
  v_target public.erp_item_stages;
  v_total  int;
  v_now    timestamptz := now();
  v_row    public.erp_item_stages;
begin
  select * into v_stage from public.erp_item_stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'erp_stage_move_department: этап не найден' using errcode = 'P0002';
  end if;
  if v_stage.department_id = p_target_dept then
    raise exception 'erp_stage_move_department: задание уже в этом цехе' using errcode = '22023';
  end if;

  v_total := public.erp_stage_item_qty(p_stage_id);

  -- 1. Исходный этап закрывается на полный тираж (последствия интерфейс
  --    перечисляет в подтверждении до вызова — молча этап не закрывается).
  update public.erp_item_stages
     set status = 'done', qty_done = v_total, finished_at = v_now
   where id = p_stage_id
  returning * into v_row;
  return next v_row;

  -- 2. Целевой этап: он уже в маршруте позиции — открываем, нет — создаём.
  select * into v_target
    from public.erp_item_stages
   where item_id = v_stage.item_id and department_id = p_target_dept;

  if v_target.id is null then
    insert into public.erp_item_stages
      (item_id, department_id, sort_order, depends_on,
       status, started_at, finished_at, queue_position)
    values
      (v_stage.item_id, p_target_dept, v_stage.sort_order + 5, array[p_stage_id],
       'in_progress', v_now, null, p_queue_position)
    returning * into v_target;
  else
    update public.erp_item_stages
       set status = 'in_progress',
           started_at = v_now,
           finished_at = null,
           queue_position = coalesce(queue_position, p_queue_position)
     where id = v_target.id
    returning * into v_target;
  end if;
  return next v_target;

  -- 3. Кто ждал исходный этап — ждёт теперь и целевой.
  return query
    update public.erp_item_stages s
       set depends_on = s.depends_on || v_target.id
     where s.item_id = v_stage.item_id
       and s.id <> v_target.id
       and p_stage_id = any (s.depends_on)
       and not (v_target.id = any (s.depends_on))
    returning s.*;
end $$;
grant execute on function public.erp_stage_move_department(uuid, uuid, numeric) to authenticated;

comment on function public.erp_stage_move_department(uuid, uuid, numeric) is
  'Перенос задания в другой цех одной транзакцией: закрыть исходный этап, открыть (или создать) целевой и перевести на него зависимых — иначе финальный ОТК открывается раньше перенесённой работы.';
