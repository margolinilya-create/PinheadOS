-- Экспериментальный цех: работа образца становится настоящим этапом
-- (правки заказчика 10.08, волна 3.6).
--
-- Документ: «Когда образец уходит на нанесение, это должна быть ОДНА задача,
-- а не отдельная запись в разработке и отдельная в цехе. Цех должен видеть её
-- в своей очереди, как любую другую работу».
--
-- ЧТО БЫЛО. Передача образца жила в `erp_experimental_ops` — отдельной таблице
-- со своими статусами. Цех ДТФ её не видел: в очередь попадают `erp_item_stages`.
-- Технолог отмечал «передал», цех узнавал голосом, и в плане этой работы
-- не существовало.
--
-- ПОЧЕМУ ТАК СДЕЛАЛИ И ПОЧЕМУ ТЕПЕРЬ МОЖНО ИНАЧЕ. Мешал ровно один констрейнт:
-- `unique (item_id, department_id)` — позиция могла побывать в цехе один раз,
-- а образец ходит туда-обратно («сшили → примерили → переделали → сшили снова»),
-- и это НОРМАЛЬНЫЙ ход разработки, а не брак. Волна 3.0 добавила `cycle`
-- и перенесла уникальность на `(item_id, department_id, cycle)`. Препятствие
-- исчезло — и вместе с ним причина держать вторую машину состояний.
--
-- ТРЕБОВАНИЕ ВЫПОЛНЯЕТСЯ ПО ПОСТРОЕНИЮ, а не по соглашению: задача нанесения
-- образца — строка `erp_item_stages`. У неё один статус, её видит очередь цеха
-- (тот же `buildQueueEntries`), те же права, тот же страж, тот же план. Двух
-- независимых задач нет физически.
--
-- `origin` отличает образец от серии: бейдж «Образец» в очереди и фильтр.
-- В маршрутную логику он НЕ входит — этап образца проходит те же гейты
-- и те же переходы, иначе цех работал бы с ним по особым правилам.

alter table public.erp_item_stages
  add column if not exists origin text not null default 'production';

alter table public.erp_item_stages
  drop constraint if exists erp_item_stages_origin_check;
alter table public.erp_item_stages
  add constraint erp_item_stages_origin_check
  check (origin in ('production', 'experimental'));

comment on column public.erp_item_stages.origin is
  'Откуда работа: production — серия, experimental — образец из экспериментального цеха. Даёт бейдж и фильтр; в маршрутную логику НЕ входит — этап образца проходит те же гейты и переходы.';

create index if not exists erp_item_stages_origin_idx
  on public.erp_item_stages (origin) where origin <> 'production';

-- Связь операции разработки с этапом, которым она стала. NULL у старых записей
-- и у фаз, у которых цеха нет вовсе (лекала, подбор материалов, примерка).
alter table public.erp_experimental_ops
  add column if not exists stage_id uuid references public.erp_item_stages(id) on delete set null;

create unique index if not exists erp_experimental_ops_stage_key
  on public.erp_experimental_ops (stage_id) where stage_id is not null;

-- ── Передача образца в цех ──
--
-- Создаёт этап в СЛЕДУЮЩЕМ свободном цикле: образец возвращается в тот же цех
-- многократно, и каждый заход — своя строка со своей историей. Номер цикла
-- считает сервер, потому что «следующий свободный» зависит от того, что уже
-- есть в базе, а не от того, что видел клиент минуту назад.
create or replace function public.erp_experimental_send_to_dept(
  p_item_id uuid,
  p_department_id uuid,
  p_planned_end date default null
)
returns public.erp_item_stages
language plpgsql security invoker set search_path = public as $$
declare
  v_cycle int;
  v_sort  int;
  v_row   public.erp_item_stages;
begin
  select coalesce(max(cycle), -1) + 1 into v_cycle
    from public.erp_item_stages
   where item_id = p_item_id and department_id = p_department_id;

  select coalesce(max(sort_order), 0) + 10 into v_sort
    from public.erp_item_stages where item_id = p_item_id;

  -- `depends_on` пустой намеренно: образец идёт вне очереди основного маршрута,
  -- его отправляет технолог решением, а не последовательность этапов. Статус
  -- сразу `ready` — цех видит работу в очереди и берёт её обычной кнопкой.
  insert into public.erp_item_stages
    (item_id, department_id, cycle, origin, depends_on, status, sort_order, planned_end)
  values
    (p_item_id, p_department_id, v_cycle, 'experimental', '{}', 'ready', v_sort, p_planned_end)
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.erp_experimental_send_to_dept(uuid, uuid, date) from public, anon;
grant execute on function public.erp_experimental_send_to_dept(uuid, uuid, date) to authenticated;

comment on function public.erp_experimental_send_to_dept(uuid, uuid, date) is
  'Передача образца в цех: настоящий этап в следующем свободном цикле. Цех видит его в своей очереди как любую другую работу — двух независимых задач нет физически, а не по соглашению.';
