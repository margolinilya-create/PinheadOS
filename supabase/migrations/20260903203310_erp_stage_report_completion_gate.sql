-- Отчёт цеха по схеме участка больше не закрывает этап мимо гейта закупки.
-- Аудит 03.09.2026, блокер Б1.
--
-- ЧТО БЫЛО. Правка 30.08 (п. 5) запретила закрывать этап, пока по позиции
-- не закрыта закупка. Проверка жила только в интерфейсе и перечисляла точки
-- закрытия руками — их было три. Четвёртая в список не попала: «Записать
-- результат» у участка с настроенной схемой отчёта (`result_fields`) идёт
-- в `erp_stage_submit_report`, а он сам ставит `done`, когда `qty_done`
-- добирает тираж.
--
-- Цена не теоретическая: `result_fields` засеяны миграцией 20260810190000
-- в том числе закрою и швейке — РОВНО тем двум участкам, у которых непустой
-- `gate_material_kinds` (20260803120000). Гейт молчал именно там, ради чего
-- писался: закрой закрывал этап при неприехавшей ткани и открывал швейке
-- тираж, которого физически нет.
--
-- ПОЧЕМУ ГЕЙТ ЗДЕСЬ, А НЕ В `erp_stage_guard`. Страж висит на КАЖДОМ обновлении
-- этапа, в том числе на тех, что делают сами серверные механики: rollup журнала
-- подряда, применение брака, передача разработки. Материальный гейт там задел бы
-- потоки, к закупке отношения не имеющие. Эта функция — ровно тот путь, которым
-- цех сдаёт работу, и ровно тот, что закрывал этап молча.
--
-- ЗЕРКАЛО КЛИЕНТА, ДОСЛОВНОЕ. `utils/supply.materialsBlockingCompletion`:
-- участок без `gate_material_kinds` не гейтится вовсе (fail-open); у гейтируемого
-- держат ВСЕ материалы позиции, а не только виды его гейта; материал «на месте» —
-- received / reserved / not_needed; материалы позиции это `item_id is null`
-- (общие по заказу) или свои. Аварийное снятие (`erp_bypasses`, kind
-- 'material_gate') отпускает гейт — иначе режим, заведённый ради застрявшей
-- работы, отпускал бы вход и держал выход.

create or replace function public.erp_stage_completion_block(
  p_stage_id uuid,
  p_added_good int default 0
)
returns text
language sql
stable
set search_path = public as $$
  with ctx as (
    select s.id,
           s.qty_done,
           s.department_id,
           i.id   as item_id,
           i.qty  as item_qty,
           i.order_id,
           d.gate_material_kinds
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
      left join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id
  ),
  gate as (
    select ctx.*,
           -- Снятие действует, пока проверку не вернули; глобальное (order_id
           -- is null) — на все заказы, узкое — на свой
           exists (
             select 1 from public.erp_bypasses b
              where b.kind = 'material_gate'
                and b.restored_at is null
                and (b.order_id is null or b.order_id = ctx.order_id)
           ) as bypassed
      from ctx
  ),
  blocking as (
    select m.name
      from gate g
      join public.erp_materials m on m.order_id = g.order_id
     where coalesce(cardinality(g.gate_material_kinds), 0) > 0
       and not g.bypassed
       -- Запись реально добирает тираж? Частичная сдача при неприехавшем
       -- материале законна — цех отчитывается за то, что сделал.
       and coalesce(g.qty_done, 0) + coalesce(p_added_good, 0) >= g.item_qty
       and (m.item_id is null or m.item_id = g.item_id)
       and coalesce(m.status, '') not in ('received', 'reserved', 'not_needed')
     order by m.name
  )
  select case when count(*) = 0 then null else
    'Закупка не завершена: '
    || string_agg(name, ', ' order by name)
    || '. Этап можно закрыть, когда материалы придут или будут взяты со склада.'
  end
  from blocking;
$$;

comment on function public.erp_stage_completion_block(uuid, int) is
  'Что мешает закрыть этап по закупке, или NULL. Зеркало клиентской utils/supply.materialsBlockingCompletion с учётом аварийных снятий (аудит 03.09.2026).';

-- Подлинный текст функции взят из pg_get_functiondef боевой базы и дополнен
-- одной проверкой — остальное не тронуто.
create or replace function public.erp_stage_submit_report(
  p_stage_id uuid,
  p_qty_in integer,
  p_qty_good integer,
  p_qty_defect integer default 0,
  p_qty_rework integer default 0,
  p_qty_extra integer default 0,
  p_comment text default null::text,
  p_extra jsonb default '{}'::jsonb
)
returns erp_item_stages
language plpgsql
set search_path to 'public' as $$
declare
  v_total int;
  v_row   public.erp_item_stages;
  v_block text;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  -- Гейт закупки: отчёт, добирающий тираж, закрывает этап (см. update ниже)
  v_block := public.erp_stage_completion_block(p_stage_id, coalesce(p_qty_good, 0));
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id)
  values
    (p_stage_id, p_qty_in, coalesce(p_qty_good, 0), coalesce(p_qty_defect, 0),
     coalesce(p_qty_rework, 0), coalesce(p_qty_extra, 0), nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid);

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, coalesce(p_qty_rework, 0)),
         status = case
           when public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total) >= v_total
             then 'done' else s.status end,
         finished_at = case
           when public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total) >= v_total
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $$;

comment on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb) is
  'Отчёт цеха одной транзакцией: строка журнала + приращение счётчиков этапа. SECURITY INVOKER — страж этапов проверяет права от лица вызывающего. С 03.09 отчёт, добирающий тираж, проходит гейт закупки (erp_stage_completion_block): до этого он был единственным путём, закрывавшим этап молча.';
