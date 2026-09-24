-- Четыре стража переходят с перечисления ОХРАНЯЕМЫХ колонок на перечисление
-- ИСКЛЮЧЕНИЙ (обзор 24.09, п. 13; сессия 68). Тот же приём, что у
-- `erp_order_guard` (20260924122634): снимок строки `to_jsonb(new)` минус
-- разрешённые поля сравнивается со снимком `to_jsonb(old)`, и колонка,
-- добавленная в таблицу позже, защищена по умолчанию, а не открыта.
--
-- ЧТО БЫЛО ОТКРЫТО. Сверка поимённых списков с живой схемой 24.09:
--
--   erp_attachment_guard  — не охранял `message_id` (колонку дописала миграция
--     чата 14.09, после стража). Держатель `files.manage` перепривязывал ЛЮБОЕ
--     вложение к своему сообщению чата и удалял сообщение через
--     `erp_chat_delete`: она `security definer` и удаляет вложения по
--     `message_id` мимо DELETE-политики. Так уходили `stage_result`, `dev_*`,
--     `preview`, `tech` — то, что политика отдаёт только админу или
--     `experimental.manage`. Проверено по всем статическим слоям: UPDATE
--     у authenticated на всю таблицу, RLS `files.manage`, других UPDATE-
--     триггеров нет, CHECK, связывающего `message_id` с видом `chat`, нет.
--   erp_stage_guard       — не охранял `id` и `created_at` ничем: политика
--     UPDATE стоит на `erp_is_member()`, и любой участник ERP мог сменить id
--     этапа любого цеха. Граф маршрута `depends_on` — массив без внешнего
--     ключа, поэтому смена id молча рвала зависимости.
--   erp_calendar_guard    — `id` и `created_at` были открыты держателю `plan.fact`.
--   erp_notification_guard — дыр нет; переводится ради того, чтобы следующая
--     колонка уведомления не оказалась открытой молча.
--
-- ЧТО НЕ МЕНЯЕТСЯ ДЛЯ ИНТЕРФЕЙСА. Писатели сверены по коду: вложения клиент
-- правит одним полем (`kind`, перенос между папками), уведомления — одним
-- (`read_at`), план — плановыми полями под `plan.manage` и фактом/проблемой
-- под `plan.fact`; этапы — всеми колонками, что уже стояли в списке `v_guarded`.
-- Новые запреты касаются только колонок, которые интерфейс не пишет вовсе
-- (`message_id`, `id`, `created_at`), поэтому клиентский гейт не нужен.
--
-- `erp_material_guard` сюда НЕ входит, и это не забыто: закупочные поля
-- открыты записанным решением 10.08 («ведение закупки не гейтится»), а страж
-- сторожит узкое подмножество приёмки. Перевод на исключения запер бы
-- закупщика — это решение владельца, а не починка.
--
-- Тексты функций взяты с ЖИВОЙ базы (`pg_get_functiondef`, 24.09), а не
-- из прежних миграций; меняется только вычисление «что изменилось».

-- ── Вложения: меняется только папка (`kind`) ─────────────────────────────
create or replace function public.erp_attachment_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.kind is distinct from old.kind then
    if not (old.kind = any (array['attachment', 'production'])
            and new.kind = any (array['attachment', 'production'])) then
      raise exception 'erp_attachment_guard: между папками перекладываются только свободные файлы (attachment, production)'
        using errcode = '42501';
    end if;
    if not public.erp_has_permission('files.manage') then
      raise exception 'erp_attachment_guard: перемещение файла требует права files.manage'
        using errcode = '42501';
    end if;
  end if;

  -- Всё, кроме папки, неизменно — одним сравнением снимков, без перечня колонок.
  -- В том числе `message_id`: перепривязка к своему сообщению открывала
  -- удаление чужого файла через `erp_chat_delete`.
  if (to_jsonb(new) - 'kind') is distinct from (to_jsonb(old) - 'kind') then
    raise exception 'erp_attachment_guard: у вложения правится только папка (kind); файл заменяется новой строкой'
      using errcode = '42501';
  end if;

  return new;
end $function$;

-- ── Уведомления: меняется только отметка о прочтении ─────────────────────
create or replace function public.erp_notification_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'erp_notification_guard: у уведомления правится только отметка о прочтении'
      using errcode = '42501';
  end if;

  return new;
end $function$;

-- ── План: без plan.manage меняются только факт, проблема и статус ────────
create or replace function public.erp_calendar_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Поля цеха (`plan.fact`): факт дня, проблема, исполнитель и статус.
  -- Всё остальное — план, и его ставит `plan.manage`. `updated_at`
  -- проставляет соседний триггер `erp_calendar_slots_touch`.
  v_fact constant text[] := array[
    'qty_done', 'qty_defect', 'fact_comment', 'deviation_reason', 'fact_by', 'fact_at',
    'problem_type', 'problem_note', 'problem_affects_due', 'problem_needs_help',
    'problem_can_continue', 'assignee', 'status', 'updated_at'
  ];
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.erp_has_permission('plan.manage') then
    return new;
  end if;

  if (to_jsonb(new) - v_fact) is distinct from (to_jsonb(old) - v_fact) then
    raise exception 'erp_calendar_guard: изменение плана требует права plan.manage'
      using errcode = '42501';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    raise exception 'erp_calendar_guard: снятие задачи из плана требует права plan.manage'
      using errcode = '42501';
  end if;

  return new;
end $function$;

-- ── Этапы: «что-то изменилось» — сравнением снимков ──────────────────────
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

-- Функции-триггеры клиенту не выставлены. Отзыв повторяется в каждой
-- миграции, пересоздающей функцию: `create or replace` права сохраняет,
-- но полагаться на это — зависеть от того, существовала ли функция раньше
revoke execute on function public.erp_attachment_guard() from anon, authenticated, public;
revoke execute on function public.erp_notification_guard() from anon, authenticated, public;
revoke execute on function public.erp_calendar_guard() from anon, authenticated, public;
revoke execute on function public.erp_stage_guard() from anon, authenticated, public;
