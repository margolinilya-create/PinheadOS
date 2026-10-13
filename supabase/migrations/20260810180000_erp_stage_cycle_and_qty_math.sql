-- Фундамент волны 3 (правки заказчика 10.08): цикл этапа и общая арифметика счётчиков.
--
-- ЧАСТЬ 1. `cycle` — сколько раз позиция проходила ЭТОТ ЖЕ цех.
--
-- Зачем. Экспериментальный цех (правка 6) устроен так, что образец уходит
-- в пошив, возвращается на примерку, уходит на нанесение, возвращается снова —
-- и это НОРМАЛЬНЫЙ ход разработки, а не брак. Смоделировать его этапами мешал
-- ровно один констрейнт: `unique (item_id, department_id)` разрешал позиции
-- побывать в цехе один-единственный раз. Из-за него эксп. цех и жил отдельной
-- таблицей со своими фазами — то есть второй машиной состояний рядом с этапами.
--
-- Для всех 443 живых этапов `cycle = 0`, и поведение не меняется НИ В ОДНОМ
-- сценарии: пока второго прохода нет, новый индекс работает как старый.
--
-- ДВА СПУТНИКА, без которых свап индекса ломает работу МОЛЧА:
--
--   1. `erp_stage_move_department` ищет целевой этап через `select … into`
--      без `strict`. При одном цикле это всегда одна строка, при нескольких —
--      Postgres молча вернёт произвольную, и перенос откроет не тот цикл.
--      Добавляем `and cycle = v_stage.cycle`: перенос происходит внутри своего
--      прохода, чужие циклы он не трогает.
--
--   2. `subcontractingSlice` апсертит этап возврата подряда по
--      `onConflict: 'item_id,department_id'`. После свапа индекса PostgREST
--      получит спецификацию, под которую нет уникального индекса, и ответит
--      42P10 — на КАЖДОМ возврате подряда. Клиент правится тем же коммитом,
--      соответствие сторожит `upsertConflict.test.ts`.
--
-- ЧАСТЬ 2. Арифметика счётчиков — одно правило на все точки записи.
--
-- `qty_done` и `qty_rework` пишутся приращением на сервере (правило проекта:
-- абсолют с клиента теряет результат второго планшета в цехе). Сегодня формула
-- обрезки продублирована в `erp_stage_report_progress` и `erp_stage_apply_defect`,
-- а `erp_stage_move_department` пишет тираж напрямую. Волна 3 добавляет
-- ЧЕТВЁРТУЮ точку записи — журнал результатов, — и без общего правила это была
-- бы четвёртая копия.
--
-- Почему функции-ВЫРАЖЕНИЯ, а не функция-обёртка с UPDATE внутри. Обёртка
-- заставила бы `erp_stage_apply_defect` писать строку дважды: сначала счётчики,
-- потом статус. А `erp_stage_guard` — ТРИГГЕР: одно комбинированное изменение
-- он разбирает один раз, разбитое на два — дважды, и «статус отдельно от
-- счётчиков» могло бы не пройти там, где комбинированное проходит. Цена
-- рефакторинга не должна быть отказом прав у цеха. Выражения дают ту же
-- единственность правила при одном UPDATE.

-- ── Часть 1: цикл ──

alter table public.erp_item_stages
  add column if not exists cycle int not null default 0;

comment on column public.erp_item_stages.cycle is
  'Номер прохода позиции через этот цех: 0 — обычное производство, 1+ — повторные заходы образца (экспериментальный цех). Входит в уникальность строки.';

alter table public.erp_item_stages
  drop constraint if exists erp_item_stages_item_id_department_id_key;

create unique index if not exists erp_item_stages_item_dept_cycle_key
  on public.erp_item_stages (item_id, department_id, cycle);

-- ── Часть 2: арифметика счётчиков ──

-- Сделано: приращение, не ниже нуля и не выше тиража позиции.
create or replace function public.erp_clamp_done(p_current int, p_delta int, p_total int)
returns int language sql immutable set search_path = public as $$
  select greatest(least(coalesce(p_current, 0) + coalesce(p_delta, 0), p_total), 0)
$$;

-- Переделка: приращение, не ниже нуля. Потолка нет намеренно — одну и ту же
-- единицу могут вернуть в переделку дважды, и это не ошибка данных.
create or replace function public.erp_clamp_rework(p_current int, p_delta int)
returns int language sql immutable set search_path = public as $$
  select greatest(coalesce(p_current, 0) + coalesce(p_delta, 0), 0)
$$;

comment on function public.erp_clamp_done(int, int, int) is
  'Единственное правило приращения qty_done: обрезка снизу нулём, сверху тиражом. Вызывается ВНУТРИ UPDATE, чтобы страж этапов разбирал одно изменение, а не два.';
comment on function public.erp_clamp_rework(int, int) is
  'Единственное правило приращения qty_rework: не ниже нуля, потолка нет — одну единицу можно вернуть в переделку повторно.';

-- Обе вызываются из SECURITY INVOKER-функций и из UPDATE самого клиента,
-- поэтому остаются доступными authenticated. Своих данных они не читают —
-- это чистая арифметика над переданными числами.
revoke execute on function public.erp_clamp_done(int, int, int) from public, anon;
revoke execute on function public.erp_clamp_rework(int, int) from public, anon;
grant execute on function public.erp_clamp_done(int, int, int) to authenticated;
grant execute on function public.erp_clamp_rework(int, int) to authenticated;

-- ── Часть 3: три существующие точки записи переходят на общее правило ──
-- Поведение прежнее байт в байт; меняется только источник формулы.

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

  select public.erp_clamp_done(s.qty_done, p_qty, v_total)
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
revoke execute on function public.erp_stage_report_progress(uuid, int) from public, anon;
grant execute on function public.erp_stage_report_progress(uuid, int) to authenticated;

comment on function public.erp_stage_report_progress(uuid, int) is
  'Частичная готовность приращением: qty_done += N с обрезкой по тиражу и авто-закрытием этапа. Абсолют с клиента терял результат второго исполнителя.';

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

    -- ОДИН update: счётчики и статус меняются вместе, поэтому страж этапов
    -- разбирает изменение как одно целое (см. шапку миграции).
    update public.erp_item_stages s
       set qty_done = public.erp_clamp_done(
             s.qty_done, coalesce((v_patch->>'qty_done_delta')::int, 0), v_total),
           qty_rework = public.erp_clamp_rework(
             s.qty_rework, coalesce((v_patch->>'qty_rework_delta')::int, 0)),
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
revoke execute on function public.erp_stage_apply_defect(jsonb) from public, anon;
grant execute on function public.erp_stage_apply_defect(jsonb) to authenticated;

comment on function public.erp_stage_apply_defect(jsonb) is
  'Патчи брака одной транзакцией: счётчики приращением, статусы по актуальной строке. Прежде клиент слал независимые UPDATE и при сбое одного откатывал интерфейс поверх закоммиченных остальных.';

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
  --    `and cycle = v_stage.cycle` обязателен: без него при нескольких проходах
  --    (образец из эксп. цеха) `select … into` молча возьмёт произвольную строку
  --    и перенос откроет чужой цикл.
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
revoke execute on function public.erp_stage_move_department(uuid, uuid, numeric) from public, anon;
grant execute on function public.erp_stage_move_department(uuid, uuid, numeric) to authenticated;

comment on function public.erp_stage_move_department(uuid, uuid, numeric) is
  'Перенос задания в другой цех одной транзакцией: закрыть исходный этап, открыть (или создать) целевой в ТОМ ЖЕ цикле и перевести на него зависимых — иначе финальный ОТК открывается раньше перенесённой работы.';
