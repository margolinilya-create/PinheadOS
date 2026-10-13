-- Производственный плюс закроя (правка заказчика 21.09, п. 3).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Количество из заказа должно быть ориентиром, а не
-- жёстким ограничением: именно в закройке может появляться производственный
-- плюс… если в заказе XS = 50, а по всем рулонам скроено XS = 55, система
-- должна сохранить фактический раскрой 55 шт и автоматически зафиксировать
-- плюс XS = 5 шт. Плюсы считать отдельно по каждому размеру и суммарно
-- по позиции».
--
-- ПОЧЕМУ СЧИТАЕТ СЕРВЕР. Правило раздела, записанное после правок 16.09:
-- «заголовочные числа отчёта при разбивке считает СЕРВЕР по ней же — иначе
-- у величины два писателя, и разойдутся они молча». Плюс выводится из тех же
-- размерных строк, что и выход закроя, поэтому и считается здесь. Клиент
-- показывает то же число до нажатия кнопки (`utils/cutExtras`), но не шлёт
-- его: присланному плюсу пришлось бы верить на слово.
--
-- ПЛЮС НАКОПИТЕЛЬНЫЙ. Закрой сдаёт частями: 30 шт сегодня, 25 завтра при
-- плане 50. Сравнивать каждую сдачу с планом порознь значило бы не заметить
-- плюс вовсе (30 < 50 и 25 < 50), хотя вместе это 55. Поэтому превышение
-- считается от СУММЫ сданного этим этапом, а в строки текущего отчёта
-- попадает ПРИРОСТ превышения.
--
-- FAIL-OPEN БЕЗ СЕТКИ. У позиции без размерной сетки плана нет, сравнивать
-- не с чем — плюсов не бывает. Объявить плюсом весь раскрой значило бы
-- записать «плюс 200 шт» там, где сетку просто не заполнили; таких позиций
-- на бою почти половина.

-- Ячейки сетки для SQL: зеркало клиентского `gridCells`. Повторы складываются
-- тем же правилом, что в `erp_size_grid_merge`
create or replace function public.erp_size_grid_cells(p_grid jsonb)
returns table (color text, size text, qty numeric)
language sql
immutable
set search_path to 'public'
as $$
  select
    coalesce(nullif(btrim(coalesce(r.elem->>'color', '')), ''), '—') as color,
    btrim(s.key)                                                     as size,
    sum(case when jsonb_typeof(s.value) = 'number'
             then (s.value #>> '{}')::numeric else 0 end)            as qty
    from jsonb_array_elements(
           case when jsonb_typeof(p_grid) = 'array' then p_grid else '[]'::jsonb end
         ) as r(elem)
    join lateral jsonb_each(
           case when jsonb_typeof(r.elem->'sizes') = 'object'
                then r.elem->'sizes' else '{}'::jsonb end
         ) as s on true
   where btrim(s.key) <> ''
   group by 1, 2
  having sum(case when jsonb_typeof(s.value) = 'number'
                  then (s.value #>> '{}')::numeric else 0 end) > 0;
$$;

comment on function public.erp_size_grid_cells(jsonb) is
  'Сетка [{color,sizes}] в строки «цвет × размер × количество». Зеркало клиентского gridCells (правка 21.09, п. 3)';

create or replace function public.erp_stage_submit_report(
  p_stage_id uuid,
  p_qty_in integer,
  p_qty_good integer,
  p_qty_defect integer default 0,
  p_qty_rework integer default 0,
  p_qty_extra integer default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb,
  p_sizes jsonb default '[]'::jsonb,
  p_rolls jsonb default '[]'::jsonb,
  p_assembly_cost numeric default null
)
returns erp_item_stages
language plpgsql
set search_path to 'public'
as $function$
declare
  v_total   int;
  v_row     public.erp_item_stages;
  v_block   text;
  v_report  uuid;
  v_sized   boolean;
  v_rolled  boolean;
  v_good    int;
  v_defect  int;
  v_rework  int;
  v_extra   int;
  v_roll    jsonb;
  v_rr      uuid;
  v_item    uuid;
  v_grid    jsonb;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  v_sized  := jsonb_typeof(p_sizes) = 'array' and jsonb_array_length(p_sizes) > 0;
  v_rolled := jsonb_typeof(p_rolls) = 'array' and jsonb_array_length(p_rolls) > 0;

  if v_rolled then
    select coalesce(sum((s->>'qty_good')::int), 0) into v_good
      from jsonb_array_elements(p_rolls) as r
      cross join lateral jsonb_array_elements(coalesce(r->'sizes', '[]'::jsonb)) as s;
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  elsif v_sized then
    select coalesce(sum(r.qty_good), 0), coalesce(sum(r.qty_defect), 0),
           coalesce(sum(r.qty_rework), 0), coalesce(sum(r.qty_extra), 0)
      into v_good, v_defect, v_rework, v_extra
      from jsonb_to_recordset(p_sizes)
        as r(color text, size text, qty_good int, qty_defect int, qty_rework int, qty_extra int);
  else
    v_good   := coalesce(p_qty_good, 0);
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  end if;

  v_block := public.erp_stage_completion_block(p_stage_id, v_good);
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id, assembly_cost_per_unit)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
     p_assembly_cost)
  returning id into v_report;

  if v_rolled then
    for v_roll in select value from jsonb_array_elements(p_rolls) loop
      insert into public.erp_stage_report_rolls
        (report_id, roll_id, material_id, qty_used, unit, roll_finished)
      values
        (v_report,
         nullif(v_roll->>'roll_id', '')::uuid,
         nullif(v_roll->>'material_id', '')::uuid,
         coalesce((v_roll->>'qty_used')::numeric, 0),
         nullif(v_roll->>'unit', ''),
         coalesce((v_roll->>'finished')::boolean, false))
      returning id into v_rr;

      insert into public.erp_stage_report_sizes
        (report_id, report_roll_id, color, size, qty_good)
      select v_report, v_rr,
             coalesce(nullif(btrim(s->>'color'), ''), '—'),
             btrim(s->>'size'),
             coalesce((s->>'qty_good')::int, 0)
        from jsonb_array_elements(coalesce(v_roll->'sizes', '[]'::jsonb)) as s
       where btrim(coalesce(s->>'size', '')) <> ''
         and coalesce((s->>'qty_good')::int, 0) > 0;

      if coalesce((v_roll->>'finished')::boolean, false) then
        update public.erp_material_rolls set status = 'used'
         where id = nullif(v_roll->>'roll_id', '')::uuid;
      else
        update public.erp_material_rolls set status = 'in_use'
         where id = nullif(v_roll->>'roll_id', '')::uuid and status = 'in_stock';
      end if;
    end loop;

    /**
     * ПЛЮСЫ (правка 21.09, п. 3) — по строкам ТОЛЬКО ЧТО записанного отчёта.
     *
     * Превышение считается от суммы сданного этим этапом (`prev` + текущий
     * отчёт) против плана позиции, а в строки попадает ПРИРОСТ превышения:
     * иначе вторая частичная сдача повторила бы плюс первой.
     *
     * Внутри ячейки плюсом объявляются ПОСЛЕДНИЕ штуки — те, что перешагнули
     * план. Строк у одной ячейки бывает несколько (один размер кроят с двух
     * рулонов), и раскладка по ним идёт накопительным итогом: пересечение
     * отрезка строки с «хвостом» превышения. Сумма плюсов по строкам при
     * этом равна плюсу ячейки — ровно то, что просит «отдельно по каждому
     * размеру и суммарно по позиции».
     *
     * Размер, которого в сетке нет вовсе, плюсом НЕ считается: это не «сверх
     * плана», а размер вне плана, и про него говорит сам факт раскроя.
     */
    select i.size_grid into v_grid
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
     where s.id = p_stage_id;

    if v_grid is not null and jsonb_typeof(v_grid) = 'array' then
      with plan as (
        select c.color, c.size, c.qty::numeric as qty
          from public.erp_size_grid_cells(v_grid) c
      ), prev as (
        select z.color, z.size, sum(z.qty_good)::numeric as qty
          from public.erp_stage_report_sizes z
          join public.erp_stage_reports r on r.id = z.report_id
         where r.stage_id = p_stage_id and r.id <> v_report
         group by 1, 2
      ), rows_now as (
        select z.id, z.color, z.size, z.qty_good::numeric as qty,
               sum(z.qty_good) over (
                 partition by z.color, z.size order by z.id
                 rows between unbounded preceding and current row
               )::numeric as cum,
               sum(z.qty_good) over (partition by z.color, z.size)::numeric as cell_total
          from public.erp_stage_report_sizes z
         where z.report_id = v_report
      ), calc as (
        select
          n.id,
          -- Плюс ячейки ЭТОЙ сдачи: прирост превышения
          greatest(coalesce(p.qty, 0) + n.cell_total - pl.qty, 0)
            - greatest(coalesce(p.qty, 0) - pl.qty, 0) as cell_extra,
          n.cum,
          n.qty,
          n.cell_total
          from rows_now n
          join plan pl on pl.color = n.color and pl.size = n.size
          left join prev p on p.color = n.color and p.size = n.size
      )
      update public.erp_stage_report_sizes z
         set qty_extra = greatest(
               least(c.cum, c.cell_total)
                 - greatest(c.cum - c.qty, c.cell_total - c.cell_extra), 0)
        from calc c
       where z.id = c.id and c.cell_extra > 0;

      -- Заголовочное число отчёта — сумма по строкам, а не присланное клиентом
      update public.erp_stage_reports r
         set qty_extra = coalesce((
               select sum(z.qty_extra) from public.erp_stage_report_sizes z
                where z.report_id = v_report), 0)
       where r.id = v_report;
    end if;
  elsif v_sized then
    insert into public.erp_stage_report_sizes
      (report_id, color, size, qty_good, qty_defect, qty_rework, qty_extra)
    select v_report,
           coalesce(nullif(btrim(r.color), ''), '—'),
           btrim(r.size),
           coalesce(r.qty_good, 0), coalesce(r.qty_defect, 0),
           coalesce(r.qty_rework, 0), coalesce(r.qty_extra, 0)
      from jsonb_to_recordset(p_sizes)
        as r(color text, size text, qty_good int, qty_defect int, qty_rework int, qty_extra int)
     where btrim(coalesce(r.size, '')) <> ''
       and coalesce(r.qty_good, 0) + coalesce(r.qty_defect, 0)
         + coalesce(r.qty_rework, 0) + coalesce(r.qty_extra, 0) > 0;
  end if;

  if p_assembly_cost is not null then
    if p_assembly_cost < 0 then
      raise exception 'erp_stage_submit_report: стоимость сборки не может быть отрицательной'
        using errcode = '22023';
    end if;
    select item_id into v_item from public.erp_item_stages where id = p_stage_id;
    perform set_config('erp.assembly_cost', 'on', true);
    update public.erp_order_items
       set assembly_cost_per_unit = p_assembly_cost,
           assembly_cost_set_at = now(),
           assembly_cost_by = nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
     where id = v_item;
    perform set_config('erp.assembly_cost', 'off', true);
  end if;

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, v_good, v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, v_rework),
         status = case
           when public.erp_clamp_done(s.qty_done, v_good, v_total) >= v_total
             then 'done' else s.status end,
         finished_at = case
           when public.erp_clamp_done(s.qty_done, v_good, v_total) >= v_total
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $function$;
