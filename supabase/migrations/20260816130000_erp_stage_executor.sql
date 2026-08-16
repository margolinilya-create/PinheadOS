-- Подряд — признак ЛЮБОГО этапа маршрута (правки заказчика 16.08, блок 2, схема).
--
-- ЧТО ПРОСИЛ ЗАКАЗЧИК. «Подряд нельзя воспринимать как один производственный
-- этап: печать выполняет подрядчик, а пошив мы; крой мы, пошив подрядчик;
-- изделие полностью производится подрядчиком. У каждого заказа единый маршрут
-- производства, и каждый этап должен иметь признак: наш цех / подрядный цех».
--
-- ЧТО БЫЛО. Подряд был ТИПОМ ПРОИЗВОДСТВА позиции (`production_type='outsource'`)
-- с двумя жёсткими подтипами, а раздел «Подряд» вёл собственный список операций
-- рядом с маршрутом. Колонка `erp_subcontracting.stage_id` («этап маршрута,
-- которым этот подряд является») существует с волны 3.5, проиндексирована,
-- её читает rollup-триггер `erp_subcontract_moves_rollup` — но её НЕ ПИШЕТ
-- НИКТО: ни клиент, ни `erp_create_order`, ни бэкфилл. На боевой базе 2 строки
-- подряда, и у обеих `stage_id is null`. То есть заявленное «подряд = этап
-- маршрута» не работало ни разу: rollup находил `v_stage := null`, и ветка
-- обновления этапа не срабатывала никогда.
--
-- ПОЧЕМУ КОЛОНКИ НА ЭТАПЕ, А НЕ ПСЕВДО-ЦЕХ «ПОДРЯД». Псевдо-цех потёк бы во все
-- поверхности, которые читают цеха из данных (сайдбар, вкладки очереди, канбан,
-- загрузка, план, мощность) — ровно то, от чего уходили, убирая ОТК. Плюс
-- уникальность `(item_id, department_id, cycle)` разрешила бы РОВНО ОДИН
-- подрядный этап на позицию, а документ требует несколько, включая возврат
-- к подрядчику после наших цехов. Та же причина записана в шапке миграции
-- 20260812120000, где задачи разработки не стали этапами.
--
-- `department_id` остаётся обязательным и меняет смысл: это не «кто делает»,
-- а ЧЕЙ ЭТО УЧАСТОК ОТВЕТСТВЕННОСТИ — какой наш цех делал бы эту работу у нас
-- и/или куда работа возвращается. Операция без нашего аналога («сублимация»)
-- цехом НЕ заводится: справочник наших цехов должен означать наши цеха.
-- Для неё берётся цех-владелец, а точное имя живёт в `operation`.
--
-- ЭТА МИГРАЦИЯ АДДИТИВНА И БЕЗОПАСНА ДЛЯ СТАРОГО БАНДЛА. Все новые предикаты
-- на текущих данных тождественны прежнему поведению: у всех этапов
-- `executor='internal'`, у всех строк подряда `stage_id is null`. Поэтому
-- сужающие гейты кладутся сразу, и окно «миграция в проде, старый бандл читает
-- удалённое» не открывается.

-- ── 1. Исполнитель этапа ─────────────────────────────────────────────────────

alter table public.erp_item_stages
  add column if not exists executor text not null default 'internal'
    check (executor in ('internal', 'contractor')),
  add column if not exists contractor text,
  add column if not exists operation text;

comment on column public.erp_item_stages.executor is
  'Кто выполняет этап: internal — наш цех, contractor — подрядчик. Подрядный этап не попадает в очередь цеха и ведётся в разделе «Подряд».';
comment on column public.erp_item_stages.contractor is
  'Подрядчик свободным текстом («ИП Иванов / печать»). Отдельного справочника подрядчиков заказчик на первом этапе не просил — с разовыми так быстрее.';
comment on column public.erp_item_stages.operation is
  'Название операции, когда оно расходится с именем цеха-владельца (сублимация, спецоперация). Подпись подрядного этапа берётся отсюда.';

create index if not exists erp_item_stages_contractor_idx
  on public.erp_item_stages (executor)
  where executor = 'contractor';

-- ── 2. Фазы подряда: «Готово у подрядчика» ───────────────────────────────────
--
-- Документ требует восьми состояний подрядного этапа. Не хватало ровно одного —
-- между «У подрядчика» и «Вернулось». «Задержка/проблема» фазой НЕ становится
-- по той же причине, по которой ею не стала оплата: это признак, а не положение
-- в потоке, и для него есть `status='blocked'` с `block_reason` — он же даёт
-- задержке место на канбане и в очереди, чего отдельная фаза не дала бы.
alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_phase_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_phase_check
  check (phase in ('planned', 'materials_ready', 'sent', 'at_contractor',
                   'ready_at_contractor', 'returned', 'accepted', 'closed'));

-- Смешанные материалы — прямо из документа: «часть материалов наша, часть
-- закупает подрядчик». Раньше выбор был двоичным, и такой этап приходилось
-- записывать одной из крайностей.
alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_material_source_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_material_source_check
  check (material_source in ('pinhead', 'contractor', 'mixed'));

-- Что передано подрядчику, если материалы наши (документ, п. 13). Отдельную
-- таблицу передачи не заводим: это складская операция, у неё уже есть
-- `erp_warehouse_ops`, а полноценный учёт — отдельная работа.
alter table public.erp_subcontracting
  add column if not exists materials_note text,
  add column if not exists materials_qty text,
  add column if not exists materials_sent_on date,
  add column if not exists cost numeric;

comment on column public.erp_subcontracting.materials_sent_on is
  'Когда наши материалы переданы подрядчику (только при material_source pinhead/mixed).';

-- ── 3. ТЗ подрядного этапа ───────────────────────────────────────────────────
--
-- «У каждого подрядного этапа должна быть возможность прикреплять ТЗ, макеты,
-- раскладки — не все файлы заказа относятся ко всем подрядчикам».
--
-- Третий якорь рядом с order_id/item_id. Этапное ТЗ ДОПОЛНЯЕТ общее, а не
-- заменяет: гейт `stageMissingTz` не трогаем, иначе заказ, у которого ТЗ позиции
-- есть, а этапного нет, встал бы молча.
alter table public.erp_tz_documents
  add column if not exists stage_id uuid references public.erp_item_stages(id) on delete cascade;

create index if not exists erp_tz_documents_stage_idx
  on public.erp_tz_documents (stage_id);

comment on column public.erp_tz_documents.stage_id is
  'ТЗ конкретного этапа маршрута (обычно подрядного). NULL — документ позиции или всего заказа.';

-- ── 4. Справочник операций маршрута ──────────────────────────────────────────
--
-- Вид справочника живёт в ЧЕТЫРЁХ местах (правило проекта): этот CHECK,
-- `DictionaryKind`, подпись с подсказкой и `KINDS` в админке.
alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in ('block_reason', 'problem_type', 'product_type', 'supplier',
                  'unit', 'experimental_task_type', 'fit', 'route_operation'));

insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'route_operation', v.code, v.name, v.ord, true
from (values ('cutting','Крой',10), ('print','Печать',20), ('embroidery','Вышивка',30),
             ('dtf','DTF',40), ('silkscreen','Шелкография',50), ('sublimation','Сублимация',60),
             ('sewing','Пошив',70), ('vto','ВТО',80), ('packing','Упаковка',90)) as v(code, name, ord)
where not exists (
  select 1 from public.erp_dictionaries d
   where d.kind = 'route_operation' and d.code = v.code);

-- ── 5. Страж этапов ──────────────────────────────────────────────────────────
--
-- Текст взят ПОДЛИННЫМ из действующей версии (`pg_get_functiondef` на проде,
-- совпадает с 20260810340000) и дополнен, а не написан по памяти: правило
-- проекта уже спасало этого стража от потери шести охраняемых колонок.
--
-- Добавлено четыре вещи:
--   1. `executor`, `contractor`, `operation` в `v_guarded`. Ранний выход
--      `if not v_guarded then return new` стоит ВЫШЕ проверки прав и проверки
--      цеха, поэтому невписанная колонка не проверяется вообще ничем — так
--      10.08 нашлись `cycle` и `origin`.
--   2. Подрядный этап нашему цеху не принадлежит, и `erp_can_act_in_dept` к нему
--      неприменима: работать в нём некому. Его ведёт менеджер заказа.
--   3. Смена исполнителя — решение по маршруту, то есть `order.manage`.
--   4. `sort_order` был в `v_guarded` БЕЗ СВОЕЙ ВЕТКИ: его менял любой,
--      у кого есть хоть одно право `stage.*` и принадлежность цеху. Порядок
--      этапов маршрута — то же решение по заказу, что и пропуск этапа.
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
  v_any        boolean;
  v_guarded    boolean;
  v_outsourced boolean;
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
    -- Правки 16.08: исполнитель этапа
    or new.executor        is distinct from old.executor
    or new.contractor      is distinct from old.contractor
    or new.operation       is distinct from old.operation;

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

  v_outsourced := coalesce(new.executor, 'internal') = 'contractor'
               or coalesce(old.executor, 'internal') = 'contractor';

  if not v_any then
    raise exception 'erp_stage_guard: изменение задания требует прав на этапы'
      using errcode = '42501';
  end if;

  -- Подрядный этап цеху не принадлежит — «свой ли это цех» к нему неприменимо.
  -- Им распоряжается менеджер заказа; `stage.block` остаётся у того, кто
  -- обнаружил задержку («Задержка/проблема» из документа — это blocked).
  if v_outsourced then
    if not (public.erp_has_permission('order.manage') or v_block or v_moving) then
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

  if new.sort_order is distinct from old.sort_order and not (public.erp_has_permission('order.manage') or v_moving) then
    raise exception 'erp_stage_guard: порядок этапов маршрута требует права order.manage'
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
    -- Подрядный этап двигает менеджер заказа: цеховых прав у него нет и быть
    -- не может, работу выполняет внешний исполнитель
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

-- ── 6. Перенос между цехами ──────────────────────────────────────────────────
--
-- Текст подлинный, дополнение одно: целевой этап ищется среди НАШИХ.
-- Без этого перенос «оживил» бы подрядный этап того же цеха вместо создания
-- своего — ровно та ловушка, которую описывает шапка 20260810180000 про `cycle`.
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
     and cycle = v_stage.cycle
     and coalesce(executor, 'internal') = 'internal';

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

-- ── 7. Появление и удаление этапов ───────────────────────────────────────────
--
-- INSERT: ветки «перенос» и «образец» сужаются до НАШИХ этапов — иначе
-- диспетчер заводил бы подряд переносом, а технолог — задачей разработки.
-- Подрядный этап появляется только решением по маршруту (`order.manage`).
drop policy if exists erp_item_stages_insert on public.erp_item_stages;
create policy erp_item_stages_insert on public.erp_item_stages
  for insert to authenticated
  with check (
    public.erp_has_permission('order.manage')
    or (coalesce(executor, 'internal') = 'internal'
        and public.erp_has_permission('stage.move_department'))
    or (coalesce(executor, 'internal') = 'internal'
        and origin = 'experimental'
        and public.erp_has_permission('experimental.manage'))
  );

-- DELETE: политика СУЩЕСТВОВАЛА и стояла на `is_admin()` — её расширяем,
-- а не заводим заново. Конструктору маршрута нужно убирать лишний этап,
-- но только «чистый»: там, где уже работали, есть `skipped` с причиной.
-- Условие стоит В ПОЛИТИКЕ, а не только в интерфейсе, иначе менеджер сотрёт
-- этап с фактом через REST.
drop policy if exists erp_item_stages_delete on public.erp_item_stages;
create policy erp_item_stages_delete on public.erp_item_stages
  for delete to authenticated
  using (
    public.is_admin()
    or (
      public.erp_has_permission('order.manage')
      and coalesce(qty_done, 0) = 0
      and coalesce(qty_rework, 0) = 0
      and started_at is null
      and status in ('waiting', 'ready')
    )
  );

-- ── 8. Гейт упаковки ─────────────────────────────────────────────────────────
--
-- Второе предусловие сужается до строк СТАРОЙ модели (`stage_id is null`).
-- Новый подряд гейтится ПЕРВЫМ предусловием («все этапы done|skipped»), потому
-- что он теперь и есть этап. На сегодняшних данных это тождественно прежнему
-- поведению: у всех живых строк `stage_id is null`.
create or replace function public.erp_can_pack_ship(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- все производственные этапы закрыты
    not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = p_order_id and s.status not in ('done','skipped'))
    -- подряд СТАРОЙ модели (без этапа) принят — по фазе, не по уехавшей строке статуса
    and not exists (
      select 1 from erp_subcontracting sc
      where sc.order_id = p_order_id
        and sc.stage_id is null
        and sc.op_type = 'finished_product'
        and sc.phase not in ('accepted', 'closed'))
    -- склад принял готовую продукцию — либо производства нет вовсе
    -- (подряд «под ключ»: этапов ноль, задача приёмки ГП не появится никогда)
    and (
      exists (
        select 1 from erp_warehouse_tasks t
        where t.order_id = p_order_id
          and t.task_type = 'fg_receipt'
          and t.status = 'accepted')
      or not exists (
        select 1 from erp_item_stages s
        join erp_order_items i on i.id = s.item_id
        where i.order_id = p_order_id));
$$;

comment on column public.erp_item_stages.sort_order is
  'Порядок этапа в маршруте позиции. С правки 16.08 ИЗМЕНЯЕМ: конструктор маршрута переписывает весь маршрут позиции шагом 10 (erp_route_apply). Правится под order.manage.';
