-- АВТОМАТИЧЕСКОЕ ЗАВЕРШЕНИЕ ЗАКУПКИ (правка заказчика 27.09, п. 9).
--
-- ЧТО БЫЛО. «Все материалы поступили в полном объёме, но закупка остаётся
-- в статусе „В работе", пока сотрудник не нажмёт „Завершить закупку"»
-- (заказ 65004 «Кепки_евразия»). Автозакрытие при этом СУЩЕСТВОВАЛО —
-- клиентский `maybeCloseSupply` — и не срабатывало по двум причинам:
--
--   1. Оно выполнялось от лица того, кто принял материал, — КЛАДОВЩИКА.
--      `erp_stage_guard` не пускает его в чужой цех (`erp_can_act_in_dept`),
--      `setStageStatus` получал 42501 и откатывался; кладовщик видел тост
--      «Этап не обновлён», а закупка закрывалась, когда закупщик в следующий
--      раз что-нибудь правил. Событие, которого могло и не случиться.
--   2. Правило «на месте» (`isMaterialSettled`) спрашивало вердикт приёмки,
--      но не сравнивало КОЛИЧЕСТВО: `accepted_partial` закрывал закупку
--      раньше полного прихода, а недостача держала её и после довоза.
--
-- ЧТО ТЕПЕРЬ. Закрывает СЕРВЕР, в той же транзакции, что меняет материал,
-- под меткой `erp.supply_autoclose` (как перенос между цехами и приёмка
-- подряда). Клиент больше не пишет `done` этапу закупки сам — он только
-- перечитывает заказ и сообщает человеку результат. Один писатель.
--
-- «ПОЛНОСТЬЮ ПОСТУПИЛ» — новое, более строгое правило, чем «на месте»:
-- документ просит «проверять фактически принятое количество, а не только
-- статус „Пришло"; при частичном поступлении или нерешённой проблеме
-- оставлять закупку открытой». Гейты запуска и завершения ЦЕХА остаются
-- на `isMaterialPending`/`erp_stage_completion_block` — решение 22.07
-- «цех работает тем, что приехало» не отменяется: частично принятая ткань
-- по-прежнему пускает закрой, но закупку по ней не закрывает.
--
-- Клиентское зеркало — `utils/supply.isMaterialFullyReceived`; сторож
-- `materialSettled.test.ts` сверяет оба.

create or replace function public.erp_material_fully_received(m public.erp_materials)
returns boolean
language sql
immutable
set search_path = public as $$
  select coalesce(m.status, '') in ('reserved', 'not_needed')
      or (coalesce(m.status, '') = 'received'
          and coalesce(m.accept_status, '') = 'accepted_full'
          -- Плановое количество обязательно (правка 4.1.3): без него
          -- сверять не с чем, и закупка ждёт закупщика — как и на клиенте
          -- (`supply.missingPlan`)
          and coalesce(m.qty_expected, 0) > 0
          and coalesce(m.qty_received, 0) >= m.qty_expected);
$$;

comment on function public.erp_material_fully_received(public.erp_materials) is
  'Материал поступил ПОЛНОСТЬЮ: со склада / не требуется, либо пришёл, принят складом без расхождений (accepted_full) и принятое количество покрывает плановое. Условие автозакрытия закупки; зеркало utils/supply.isMaterialFullyReceived (правка 27.09, п. 9).';

revoke execute on function public.erp_material_fully_received(public.erp_materials)
  from public, anon, authenticated;

create or replace function public.erp_supply_autoclose()
returns trigger
language plpgsql
security definer
set search_path = public as $$
declare
  v_supply uuid;
  v_stage  record;
  v_order  uuid := new.order_id;
  v_actor  text;
  v_actor_id uuid;
begin
  if v_order is null then
    return null;
  end if;
  -- Дешёвый выход: строка не стала «полностью поступившей» — считать нечего
  if not public.erp_material_fully_received(new) then
    return null;
  end if;

  select d.id into v_supply
    from public.erp_departments d
   where d.code = 'supply'
   limit 1;
  if v_supply is null then
    return null;
  end if;

  -- Закупка ведётся ПО ЗАКАЗУ (материалы принадлежат заказу целиком,
  -- `erp_materials.order_id`), поэтому и закрывается по всем открытым этапам
  -- закупки заказа разом — то же правило, что у ручного «Завершить закупку»
  -- и у прежнего клиентского автозакрытия.
  --
  -- Пустой список готовым НЕ считается: заказ без заведённых материалов
  -- не должен закрывать закупку сам собой — для него есть явное действие
  -- с комментарием, от человека.
  if not exists (select 1 from public.erp_materials m where m.order_id = v_order) then
    return null;
  end if;
  if exists (
    select 1 from public.erp_materials m
     where m.order_id = v_order
       and not public.erp_material_fully_received(m)
  ) then
    return null;
  end if;

  v_actor := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;

  for v_stage in
    select s.id, s.status, s.qty_done, s.qty_rework
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
     where i.order_id = v_order
       and s.department_id = v_supply
       and s.status not in ('done', 'skipped')
     order by s.sort_order, s.created_at
  loop
    -- Метка живёт ровно одну транзакцию и снимается сразу после UPDATE:
    -- оставленная включённой, она превратила бы пропуск стража в пропуск
    -- для всего, что эта транзакция сделает с этапами дальше
    perform set_config('erp.supply_autoclose', 'on', true);
    update public.erp_item_stages
       set status = 'done',
           finished_at = coalesce(finished_at, now())
     where id = v_stage.id
       and status not in ('done', 'skipped');
    perform set_config('erp.supply_autoclose', 'off', true);

    -- Событие истории — только когда переход состоялся (правило 20.09:
    -- журнал без движения не наполняется)
    if found then
      insert into public.erp_stage_events
        (stage_id, order_id, actor, actor_id, from_status, to_status,
         qty_done, qty_rework, comment)
      values
        (v_stage.id, v_order, v_actor, v_actor_id, v_stage.status, 'done',
         v_stage.qty_done, v_stage.qty_rework,
         'Материалы приняты полностью — закупка закрыта автоматически');
    end if;
  end loop;

  return null;
end $$;

comment on function public.erp_supply_autoclose() is
  'Закрывает открытые этапы закупки заказа, когда ВСЕ его материалы поступили полностью (erp_material_fully_received). Идёт под меткой erp.supply_autoclose — от лица кладовщика, которого страж иначе не пустил бы в чужой цех. Повторное сохранение прихода ничего не меняет: закрытый этап пропускается, событие пишется только при переходе (правка 27.09, п. 9).';

revoke execute on function public.erp_supply_autoclose() from anon, authenticated, public;

drop trigger if exists erp_supply_autoclose on public.erp_materials;
create trigger erp_supply_autoclose
  after insert or update of status, accept_status, qty_received, qty_expected
  on public.erp_materials
  for each row execute function public.erp_supply_autoclose();

-- Страж этапов: подлинный текст `20260924231233` с одной вставкой — ветка
-- пропуска под меткой `erp.supply_autoclose` (после сравнения снимков,
-- перед прежними исключениями). Правка применённой миграции запрещена,
-- поэтому функция переписана здесь целиком.
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

  -- АВТОЗАКРЫТИЕ ЗАКУПКИ (правка 27.09, п. 9). Этап `supply` закрывает
  -- триггер `erp_supply_autoclose` в транзакции приёмки — от лица
  -- КЛАДОВЩИКА, который в цех закупки не входит. Метка живёт одну
  -- транзакцию, и пропуск узкий: только переход в `done` у этапа закупки
  -- и ничего, кроме статуса и времени завершения.
  if coalesce(current_setting('erp.supply_autoclose', true), '') = 'on'
     and new.status = 'done' and old.status is distinct from 'done'
     and exists (select 1 from public.erp_departments d
                  where d.id = old.department_id and d.code = 'supply')
     and (to_jsonb(new) - array['updated_at', 'status', 'finished_at'])
         is not distinct from
         (to_jsonb(old) - array['updated_at', 'status', 'finished_at'])
  then
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
revoke execute on function public.erp_stage_guard() from anon, authenticated, public;
