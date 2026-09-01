-- Экспериментальный цех перестаёт задваивать этапы маршрута.
-- Правка заказчика 01.09 (вторая итерация), пп. 1–2.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «После обновления начали появляться дубли этапов.
-- В тестовом заказе маршрут сформировался как Закупка → Закрой → Вышивка →
-- Швейка → ВТО → Вышивка → Склад. Одна и та же вышивка не должна появляться
-- два раза. Если в заказе указано одно нанесение, оно должно быть создано
-- в маршруте один раз и в правильном месте».
--
-- ОТКУДА БРАЛСЯ ДУБЛЬ. Два независимых механизма читают ОДИН источник —
-- нанесения позиции (`erp_item_prints` через карту `BRANDING_DEPT`):
--   1) `buildRoute` при создании заказа заводит этап цеха вышивки;
--   2) вход карточки разработки в шаг «Нанесения» звал эту функцию, а она
--      ВСЕГДА вставляла новый этап, подбирая себе свободный `cycle`.
-- Уникальный индекс `(item_id, department_id, cycle)` тут бессилен
-- по построению: функция сама выбирает номер, при котором конфликта нет.
-- На проде это дало семь пар, и в каждой этап маршрута навсегда остался
-- `waiting`, а работа шла на втором — то есть заказ не закрылся бы никогда.
--
-- ПОЧЕМУ ИМЕННО ПЕРЕИСПОЛЬЗОВАНИЕ, А НЕ ЗАПРЕТ ВСТАВКИ. Ради повторных заходов
-- образца в один цех (доработка: вышивка → примерка → снова вышивка) в проекте
-- и заведён `cycle`, а прежний `unique (item_id, department_id)` был снят
-- осознанно (20260810180000). Поэтому ищется ОТКРЫТЫЙ этап: если работа в этом
-- цехе уже закрыта, второй заход обязан получить свой этап, иначе цех новой
-- работы просто не увидит.
--
-- ЭТИМ ЖЕ ЧИНИТСЯ П. 1. Гейт «с Нанесений нельзя дальше, пока цех не закрыл»
-- читает статус ЗАДАЧИ разработки, а его ведёт триггер `erp_experimental_task_sync`
-- от статуса этапа. Пока задача висела на собственном этапе ЭКС, закрытие
-- настоящего этапа маршрута до неё не доходило вовсе.

create or replace function public.erp_experimental_task_send(
  p_task_id uuid,
  p_department_id uuid,
  p_planned_end date default null,
  p_qty int default null
)
returns public.erp_experimental_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_item   uuid;
  v_cycle  int;
  v_sort   int;
  v_stage  uuid;
  v_row    public.erp_experimental_tasks;
begin
  select e.item_id into v_item
    from public.erp_experimental_tasks t
    join public.erp_experimental e on e.id = t.experimental_id
   where t.id = p_task_id;

  if v_item is null then
    raise exception 'erp_experimental_task_send: у разработки не указана позиция заказа'
      using errcode = '22023';
  end if;

  -- Открытый этап этого цеха уже есть — работаем НА НЁМ.
  -- Наименьший `cycle`: у образца бывает несколько заходов, и взять надо тот,
  -- который идёт сейчас, а не любой.
  select id into v_stage
    from public.erp_item_stages
   where item_id = v_item
     and department_id = p_department_id
     and status not in ('done', 'skipped')
   order by cycle, sort_order
   limit 1;

  if v_stage is null then
    -- Этапа нет (работа вне маршрута или повторный заход после закрытого) —
    -- заводим свой, ровно как раньше. Ветка не удалена: без неё подрядная
    -- и внеплановая работа не попала бы в цех вовсе.
    select coalesce(max(cycle), -1) + 1 into v_cycle
      from public.erp_item_stages
     where item_id = v_item and department_id = p_department_id;

    select coalesce(max(sort_order), 0) + 10 into v_sort
      from public.erp_item_stages where item_id = v_item;

    -- `depends_on` пустой намеренно: этап заведён решением технолога, а не
    -- последовательностью маршрута. Статус сразу `ready` — цех видит работу.
    insert into public.erp_item_stages
      (item_id, department_id, cycle, origin, depends_on, status, sort_order, planned_end)
    values
      (v_item, p_department_id, v_cycle, 'experimental', '{}', 'ready', v_sort, p_planned_end)
    returning id into v_stage;
  elsif p_planned_end is not null then
    -- План передаём существующему этапу, но НЕ трогаем статус и счётчики:
    -- их ведёт цех, и переписывать их отсюда значило бы завести второго писателя
    update public.erp_item_stages
       set planned_end = p_planned_end
     where id = v_stage;
  end if;

  update public.erp_experimental_tasks
     set stage_id = v_stage,
         department_id = p_department_id,
         qty = coalesce(p_qty, qty),
         due_date = coalesce(p_planned_end, due_date),
         status = 'waiting'
   where id = p_task_id
  returning * into v_row;

  return v_row;
end $$;

comment on function public.erp_experimental_task_send(uuid, uuid, date, int) is
  'Передача задачи разработки в цех. Переиспользует ОТКРЫТЫЙ этап этого цеха у позиции (правка 01.09, п. 2 — дубли), свой этап с origin=experimental заводит только когда открытого нет: повторный заход образца в тот же цех обязан получить новый цикл.';

-- ЗЕРКАЛО СТАТУСА БОЛЬШЕ НЕ ЗАВИСИТ ОТ `origin`.
--
-- Условие `new.origin = 'experimental'` было верным, пока задача разработки
-- висела только на собственном этапе ЭКС. Теперь она живёт на этапе МАРШРУТА
-- (origin = 'production'), и со старым условием закрытие цехом до задачи
-- не доходило бы — то есть гейт п. 1 не разблокировался бы никогда.
-- Отбор и так точен: `where t.stage_id = new.id` находит только те задачи,
-- которые к этому этапу привязаны, а у обычных производственных этапов их нет.
drop trigger if exists erp_experimental_task_sync on public.erp_item_stages;
create trigger erp_experimental_task_sync
  after update of status on public.erp_item_stages
  for each row
  when (new.status is distinct from old.status)
  execute function public.erp_experimental_task_sync();
