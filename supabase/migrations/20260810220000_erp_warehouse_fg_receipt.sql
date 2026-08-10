-- Приёмка готовой продукции складом (правки заказчика 10.08, волна 3.4).
--
-- Документ: «Склад должен принимать готовую продукцию с производства так же,
-- как принимает материалы: с количеством, недостачей и комментарием».
--
-- ЧТО ЗДЕСЬ НЕ МЕНЯЕТСЯ, и почему это важно. `unique (order_id, task_type)`
-- НЕ трогаем: он делает `erp_warehouse_task_derive` идемпотентным, а триггер
-- срабатывает на КАЖДОЙ смене статуса этапа. Без него один заказ обзаводился
-- бы десятком одинаковых задач приёмки.
--
-- Разграничение остаётся прежним: задача склада — одна на заказ на тип; приход
-- — сколько угодно под задачей; строка, которую видит кладовщик, — производная.
--
-- ГРАНИЦА МЕЖДУ ДВУМЯ ЖУРНАЛАМИ проведена по ЕДИНИЦЕ ИЗМЕРЕНИЯ, а не по
-- «складу вообще»: штуки изделий идут в `erp_stage_reports` (там же, где отчёты
-- цехов, с тем же набором «принято / брак / переделка»), килограммы и метры —
-- в `erp_material_receipts`. Иначе «сколько всего изделий приняли» пришлось бы
-- собирать из двух мест с разными правилами округления.
--
-- РИСК, названный вслух: новый тип задачи имеет двенадцать точек касания
-- (иконка, терминальный статус, порядок сортировки, вкладка, подпись, сводка,
-- ветка Drawer, CHECK, derive-триггер, счётчик меню, фильтр «только открытые»,
-- лейблы статусов). ПРОПУЩЕННЫЙ ТЕРМИНАЛЬНЫЙ СТАТУС даёт вечный бейдж на пункте
-- меню: задача закрыта, а счётчик её считает — и никто не понимает, что горит.
-- Поэтому терминальные статусы сторожатся тестом.

alter table public.erp_warehouse_tasks
  drop constraint if exists erp_warehouse_tasks_task_type_check;
alter table public.erp_warehouse_tasks
  add constraint erp_warehouse_tasks_task_type_check
  check (task_type in (
    'material_receipt',      -- приёмка материалов (кг/м/уп → erp_material_receipts)
    'marking',               -- выпуск маркировки
    'fg_receipt',            -- приёмка готовой продукции (шт → erp_stage_reports)
    'subcontract_receipt',   -- приёмка готового изделия от подрядчика
    'pack_ship'              -- упаковка и отгрузка
  ));

comment on column public.erp_warehouse_tasks.task_type is
  'Тип задачи склада. fg_receipt (приёмка готовой продукции) считается в ШТУКАХ и пишет отчёты в erp_stage_reports через якорь warehouse_task_id; материалы идут своим журналом — граница по единице измерения.';

-- ── Задача приёмки ГП рождается там же, где остальные ──
--
-- Момент: последний ПРОИЗВОДСТВЕННЫЙ этап позиции закрыт — продукция физически
-- готова и её надо принять на склад. Раньше этого шага не было вовсе: заказ
-- переходил из цеха сразу в упаковку, и «сколько штук реально доехало до
-- склада» нигде не фиксировалось.
--
-- Гейт упаковки при этом НЕ ужесточаем: `pack_ship` по-прежнему создаётся по
-- закрытию всех этапов. Сделать упаковку зависимой от приёмки ГП значило бы
-- остановить 37 активных заказов, у которых этой приёмки никогда не было.
-- Связку вводим шагом позже, осознанно и с миграцией данных.

create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_code text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  -- Закупка закрыта → материалы прибыли, нужна приёмка складом
  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (v_order_id, 'material_receipt', 'awaiting')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Швейка взята в работу → склад выпускает маркировку
  if v_code = 'sewing' and new.status = 'in_progress' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    values (v_order_id, new.item_id, 'marking', 'new')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Все производственные этапы заказа закрыты → продукция готова, склад её принимает
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'fg_receipt', 'awaiting')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  -- Упаковка и отгрузка. Условие читает `phase` подряда (волна 3.5):
  -- прежнее сравнение со строкой статуса после переезда в фазу молча стало
  -- всегда истинным и пускало упаковку до приёмки подряда.
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    )
    and not exists (
      select 1 from erp_subcontracting sc
      where sc.order_id = v_order_id
        and sc.op_type = 'finished_product'
        and sc.phase not in ('accepted', 'closed')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'pack_ship', 'awaiting_receipt')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.erp_warehouse_task_derive() from anon, authenticated, public;

comment on function public.erp_warehouse_task_derive() is
  'Складские задачи из движения этапов: приёмка материалов, маркировка, приёмка готовой продукции и упаковка. Гейт упаковки читает erp_subcontracting.phase — сравнение со строкой статуса после переезда в фазу молча стало всегда истинным.';

-- ── Отчёт по складской задаче ──
--
-- Тот же журнал, что у цехов: приёмка ГП считается в штуках и отвечает на те же
-- вопросы («принято / недостача / комментарий»). Отдельной таблицы для неё нет
-- намеренно — иначе «сколько изделий приняли» собиралось бы из двух мест.
create or replace function public.erp_warehouse_submit_report(
  p_task_id uuid,
  p_qty_in int,
  p_qty_good int,
  p_qty_defect int default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.erp_warehouse_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_row public.erp_warehouse_tasks;
begin
  insert into public.erp_stage_reports
    (warehouse_task_id, qty_in, qty_good, qty_defect, comment, extra, author, author_id)
  values
    (p_task_id, p_qty_in, coalesce(p_qty_good, 0), coalesce(p_qty_defect, 0),
     nullif(btrim(p_comment), ''), coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid);

  select * into v_row from public.erp_warehouse_tasks where id = p_task_id;
  return v_row;
end $$;

revoke execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  from public, anon;
grant execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  to authenticated;

comment on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb) is
  'Отчёт склада по задаче: строка в erp_stage_reports с якорем warehouse_task_id. Тот же журнал, что у цехов — приёмка ГП считается в штуках и отвечает на те же вопросы.';
