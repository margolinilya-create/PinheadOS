-- ПРИНУДИТЕЛЬНОЕ ЗАВЕРШЕНИЕ ЭТАПА (правка заказчика 20.09, п. 5).
--
-- Задача из документа: «после обновлений ERP часть ранее заведённых сделок
-- не проходит новые проверки. Этап блокируется, заказ невозможно продвинуть
-- дальше по маршруту». Это неизбежная цена ужесточения гейтов: проверки
-- писались под заказы, заведённые ПОСЛЕ них, а на бою живут и прежние.
--
-- Что действие делает и чего НЕ делает (дословно по документу):
--   * закрывает ОДИН текущий незавершённый этап без обычных условий;
--   * НЕ завершает заказ и НЕ пропускает последующие этапы;
--   * НЕ трогает `qty_done` — сколько сделано, столько и остаётся. Записать
--     «весь тираж» значило бы выдумать факт производства: правило раздела
--     прямо запрещает «по умолчанию весь тираж».
--
-- ПРИЧИНА ОБЯЗАТЕЛЬНА. Действие обходит все проверки сразу, и через месяц
-- «почему этап закрыт без результата» не восстановить ничем, кроме текста,
-- который написал человек. Поэтому пустая причина — отказ, а не умолчание.

-- 1. ПРАВО. Отсутствие строки в матрице на сервере = запрет, поэтому право
--    заводится здесь, а не только в коде.
--
--    Только `director`: профильные admin и director оба резолвятся в него
--    (`erp_role_of_caller`), а документ просит «только администратор».
--    Руководителю производства и диспетчеру НЕ даётся намеренно — это
--    не рабочее действие цеха, а разбор последствий обновления.
insert into public.erp_role_permissions (role, permission, allowed) values
  ('director', 'stage.force_complete', true)
on conflict (role, permission) do nothing;

-- 2. СТРАЖ. Ставится ТЕМ ЖЕ файлом, что и кнопка в интерфейсе: страж строже
--    интерфейса — «кнопка есть, действие падает», мягче — дыра.
--
--    Подлинный текст взят из `pg_get_functiondef` боевой базы (правило
--    журнала миграций: файл описывает прод, и расхождение уже ловили дважды).
--    Добавлено ровно три места, все помечены «правка 20.09, п. 5».
create or replace function public.erp_stage_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
    or new.operation       is distinct from old.operation
    or new.result_kind     is distinct from old.result_kind;

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
end $$;

-- 3. ДЕЙСТВИЕ. `security invoker`: RLS и страж обязаны сработать ОТ ЛИЦА
--    вызывающего. Definer-функция обошла бы и то и другое, и право
--    проверялось бы ровно один раз — внутри неё.
create or replace function public.erp_stage_force_complete(
  p_stage_id uuid,
  p_reason text
)
returns public.erp_item_stages
language plpgsql security invoker set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_stage  public.erp_item_stages;
  v_order  uuid;
  v_actor  text;
begin
  if not public.erp_has_permission('stage.force_complete') then
    raise exception 'erp_stage_force_complete: нужно право stage.force_complete'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'erp_stage_force_complete: нужна причина принудительного завершения'
      using errcode = '22023';
  end if;

  select s.* into v_stage from public.erp_item_stages s where s.id = p_stage_id;
  if not found then
    raise exception 'erp_stage_force_complete: этап не найден' using errcode = 'P0002';
  end if;

  -- ТОЛЬКО ТЕКУЩИЙ НЕЗАВЕРШЁННЫЙ (документ). Закрытый этап закрывать нечем,
  -- а пропущенный закрывать незачем — и молчаливый успех в обоих случаях
  -- выглядел бы как выполненное действие.
  if v_stage.status in ('done', 'skipped') then
    raise exception 'erp_stage_force_complete: этап уже закрыт (%)', v_stage.status
      using errcode = 'P0001';
  end if;

  select i.order_id into v_order
    from public.erp_order_items i where i.id = v_stage.item_id;

  v_actor := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');

  -- Метка живёт ровно одну транзакцию и снимается сразу после UPDATE:
  -- оставленная включённой, она превратила бы право в пропуск для всего,
  -- что эта транзакция сделает с этапами дальше.
  perform set_config('erp.force_complete', 'on', true);

  update public.erp_item_stages
     set status = 'done',
         finished_at = coalesce(finished_at, now()),
         -- Количество НЕ трогаем: сколько сдано, столько и останется.
         notes = case
           when coalesce(btrim(notes), '') = '' then 'Завершено принудительно: ' || v_reason
           else notes || E'\n' || 'Завершено принудительно: ' || v_reason
         end
   where id = p_stage_id
   returning * into v_stage;

  perform set_config('erp.force_complete', 'off', true);

  insert into public.erp_stage_events
    (stage_id, order_id, actor, actor_id, from_status, to_status, qty_done, qty_rework, comment)
  values (
    p_stage_id, v_order, v_actor,
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
    null, 'done', v_stage.qty_done, v_stage.qty_rework,
    'Принудительное завершение: ' || v_reason
  );

  insert into public.erp_order_audit
    (order_id, field_name, old_value, new_value, changed_by, changed_by_id)
  values (
    v_order, 'stage.force_complete', null,
    'этап ' || p_stage_id::text || ' закрыт принудительно: ' || v_reason,
    v_actor,
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
  );

  return v_stage;
end $$;

comment on function public.erp_stage_force_complete(uuid, text) is
  'Закрывает ОДИН заблокированный этап без обычных условий завершения (правка 20.09, п. 5). Право stage.force_complete проверяется на сервере, причина обязательна, количество не меняется, последующие этапы не пропускаются. Пишет событие этапа и запись аудита заказа.';

revoke execute on function public.erp_stage_force_complete(uuid, text) from public, anon;
grant execute on function public.erp_stage_force_complete(uuid, text) to authenticated;
