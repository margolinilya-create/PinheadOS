-- Security-разбор 10.08 (четыре независимых прохода): три находки.
--
-- ── 1. HIGH. Подменить чужой файл в бакете мог любой участник ──
--
-- `erp_att_update` стояла на `erp_is_member()` в обоих предикатах, но до 10.08
-- была неработоспособна: Postgres требует SELECT-политику для `UPDATE … RETURNING`
-- и для пути upsert, а её у бакета не было. Миграция 20260810120000 завела
-- `erp_att_read` — и тем самым РАЗБЛОКИРОВАЛА запись для всех участников сразу,
-- хотя вводилась ради чтения ТЗ.
--
-- Проверено на боевой базе от лица роли `worker` (в транзакции с откатом):
-- обновлены ВСЕ объекты бакета, включая PDF технического задания. Строка
-- в `erp_tz_documents` при этом не меняется: `version` прежняя, бейдж
-- «ТЗ обновлено» не срабатывает, история замен пуста. Цеха скачивают
-- по прежней ссылке подменённый файл. Тем же приёмом стираются фото брака.
--
-- Приводим к тому же виду, что уже у `erp_att_delete` (20260805130000): автор
-- правит свой объект, администратор — любой. Та же болезнь у `sku_photos_update`.

drop policy if exists "erp_att_update" on storage.objects;
create policy "erp_att_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'erp-attachments'
         and (public.is_admin()
              or (owner = (select auth.uid()) and public.erp_is_member())))
  with check (bucket_id = 'erp-attachments'
         and (public.is_admin()
              or (owner = (select auth.uid()) and public.erp_is_member())));

drop policy if exists "sku_photos_update" on storage.objects;
create policy "sku_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sku-photos'
         and (public.is_admin() or owner = (select auth.uid())))
  with check (bucket_id = 'sku-photos'
         and (public.is_admin() or owner = (select auth.uid())));

-- ── 2. HIGH. Право переноса работало сквозным пропуском ──
--
-- `v_move` стоял OR-ом не только там, где меняется цех, но и в проверке
-- ПРИНАДЛЕЖНОСТИ цеху, и в ветках `in_progress`/`done`/`waiting`, и в записи
-- результата. Это опиралось на допущение, записанное в самом страже: «право
-- переноса и так есть только у ролей со сквозным доступом».
--
-- 10.08 допущение сломалось: `stage.move_department` выдали МЕНЕДЖЕРУ по
-- решению заказчика, а `stage.take/progress/complete/defect` у него false —
-- и клиент это честно соблюдает. Через REST менеджер мог закрыть ЛЮБОЙ этап
-- ЛЮБОГО цеха с любым количеством и довести заказ до отгружаемого состояния,
-- не выполнив ни единицы работы.
--
-- Метку `erp.moving` ставит сам перенос и только он; она живёт до конца его
-- транзакции. Прямой PATCH метки не имеет и упирается в настоящие права.
-- Право переноса RPC теперь проверяет явно — раньше это делал только страж.
--
-- ── 3. MEDIUM. `cycle` и `origin` не попали в список охраняемых колонок ──
--
-- Обе добавлены этим же днём. Ранний выход `if not v_guarded then return new`
-- стоит ВЫШЕ проверки прав и проверки цеха, поэтому UPDATE, трогающий только
-- их, не проверялся ничем. Следствия: подменённый `cycle` ломает поиск целевого
-- этапа при переносе (создаётся дубль вместо переоткрытия), а `origin`,
-- переписанный с «образца» на «производство», обходит узкую ветку политики
-- вставки, ради которой она и писалась.
--
-- Тексты `erp_stage_move_department` и `erp_stage_guard` взяты дословно
-- из действующих версий: правило проекта уже спасало сегодня стража этапов
-- от потери шести охраняемых колонок при переписывании по памяти.

create or replace function public.erp_stage_move_department(
  p_stage_id uuid, p_target_dept uuid, p_queue_position numeric default null::numeric)
returns setof public.erp_item_stages
language plpgsql
set search_path to 'public'
as $$
declare
  v_stage  public.erp_item_stages;
  v_target public.erp_item_stages;
  v_total  int;
  v_now    timestamptz := now();
  v_row    public.erp_item_stages;
begin
  if not public.erp_has_permission('stage.move_department') then
    raise exception 'erp_stage_move_department: перенос требует права stage.move_department'
      using errcode = '42501';
  end if;
  -- Метка живёт до конца транзакции и только внутри неё: страж по ней отличает
  -- закрытие исходного этапа при переносе от произвольного закрытия чужого этапа
  perform set_config('erp.moving', 'on', true);

  select * into v_stage from public.erp_item_stages where id = p_stage_id for update;
  if v_stage.id is null then
    raise exception 'erp_stage_move_department: этап не найден' using errcode = 'P0002';
  end if;
  if v_stage.department_id = p_target_dept then
    raise exception 'erp_stage_move_department: задание уже в этом цехе' using errcode = '22023';
  end if;

  v_total := public.erp_stage_item_qty(p_stage_id);

  update public.erp_item_stages
     set status = 'done', qty_done = v_total, finished_at = v_now
   where id = p_stage_id
  returning * into v_row;
  return next v_row;

  select * into v_target
    from public.erp_item_stages
   where item_id = v_stage.item_id
     and department_id = p_target_dept
     and cycle = v_stage.cycle;

  if v_target.id is null then
    insert into public.erp_item_stages
      (item_id, department_id, cycle, sort_order, depends_on,
       status, started_at, finished_at, queue_position)
    values
      (v_stage.item_id, p_target_dept, v_stage.cycle, v_stage.sort_order + 5, array[p_stage_id],
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

  return query
    update public.erp_item_stages s
       set depends_on = s.depends_on || v_target.id
     where s.item_id = v_stage.item_id
       and s.id <> v_target.id
       and p_stage_id = any (s.depends_on)
       and not (v_target.id = any (s.depends_on))
    returning s.*;
end $$;

comment on function public.erp_stage_move_department(uuid, uuid, numeric) is
  'Перенос задания между цехами одной транзакцией. Проверяет право явно и ставит метку erp.moving: страж отличает по ней закрытие исходного этапа от произвольного закрытия чужого задания.';

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
  'Разбирает изменение этапа по колонкам. Пропуск переноса действует ТОЛЬКО внутри erp_stage_move_department (метка erp.moving) — иначе право переноса работало сквозным пропуском всех остальных проверок. Порядок веток статуса значим: skipped выше old.status=blocked, waiting ниже. cycle/origin — под order.manage.';
