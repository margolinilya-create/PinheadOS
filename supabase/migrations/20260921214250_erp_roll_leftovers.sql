-- Остаток рулона и его судьба (правки заказчика 21.09, пп. 2 и 5).
--
-- ЧТО ДОБАВЛЯЕТСЯ К `erp_stage_submit_report`.
--
-- 1. ПОТОЛОК РАСХОДА: «фактический расход не может быть больше принятого веса
--    рулона». Проверка НАКОПИТЕЛЬНАЯ — с рулона кроят в несколько заходов,
--    и условие «эта сдача ≤ вес» пропустило бы 20 + 20 при рулоне в 25 кг.
--    Fail-open у рулона без веса: сорок один рулон принят до правки, и вес
--    у них пуст; останавливать на этом закрой значило бы остановить цех
--    из-за отсутствующего поля.
--
-- 2. ОСТАТОК: «система автоматически считает остаток рулона: первоначальный
--    вес минус фактический расход». Пишет сервер — расход и остаток это одна
--    величина с двух сторон, и второй писатель развёл бы их молча.
--
-- 3. ВИД ОСТАТКА: «остаток пригоден» / «малый остаток, не учитывать» — выбор
--    закройщика при завершении работы по рулону. Автоматического порога
--    в килограммах НЕТ: документ прямо просит его не задавать. Нулевой остаток
--    вида не получает — решать нечего.
--
-- Проверено на живом заказе прогоном с откатом (пример из документа):
-- рулон 20 кг израсходован полностью → остаток 0; второй 20 кг при расходе
-- 10 → остаток 10 кг с видом `usable`; попытка списать сверх веса отклонена.

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
  v_roll_id uuid;
  v_used    numeric;
  v_cap     numeric;
  v_spent   numeric;
  v_left    numeric;
  v_kind    text;
  v_fin     boolean;
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
      v_roll_id := nullif(v_roll->>'roll_id', '')::uuid;
      v_used    := coalesce((v_roll->>'qty_used')::numeric, 0);
      v_fin     := coalesce((v_roll->>'finished')::boolean, false);
      v_kind    := nullif(v_roll->>'leftover', '');

      if v_kind is not null and v_kind not in ('usable', 'scrap') then
        raise exception 'erp_stage_submit_report: неизвестный вид остатка «%»', v_kind
          using errcode = '22023';
      end if;

      /**
       * РАСХОД НЕ БОЛЬШЕ ПРИНЯТОГО ВЕСА (правка 21.09, п. 2): «фактический
       * расход не может быть больше принятого веса рулона». Считается
       * НАКОПИТЕЛЬНО: с рулона кроят в несколько заходов, и проверка
       * «эта сдача ≤ вес» пропустила бы 20 + 20 при рулоне в 25 кг.
       *
       * FAIL-OPEN у рулона без веса: сорок один рулон принят до правки,
       * и у них вес пуст. Останавливать на этом закрой значило бы остановить
       * цех из-за отсутствующего поля — то же правило, что у гейта ТЗ.
       */
      if v_roll_id is not null then
        select r.qty, coalesce((
                 select sum(rr.qty_used) from public.erp_stage_report_rolls rr
                  where rr.roll_id = r.id), 0)
          into v_cap, v_spent
          from public.erp_material_rolls r where r.id = v_roll_id;

        if v_cap is not null and v_spent + v_used > v_cap + 0.01 then
          raise exception
            'erp_stage_submit_report: с рулона уже израсходовано %, в нём %, а вы списываете ещё %',
            v_spent, v_cap, v_used using errcode = '22023';
        end if;
      end if;

      insert into public.erp_stage_report_rolls
        (report_id, roll_id, material_id, qty_used, unit, roll_finished)
      values
        (v_report, v_roll_id,
         nullif(v_roll->>'material_id', '')::uuid,
         v_used,
         nullif(v_roll->>'unit', ''),
         v_fin)
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

      /**
       * ОСТАТОК РУЛОНА (правка 21.09, п. 5): «система автоматически считает
       * остаток рулона: первоначальный вес минус фактический расход».
       * Считает СЕРВЕР — расход и остаток это одна величина с двух сторон,
       * и второй писатель развёл бы их молча.
       *
       * Вид остатка ставит закройщик («остаток пригоден» / «малый остаток,
       * не учитывать»), автоматического порога в килограммах НЕТ: документ
       * прямо просит его не задавать. Нулевой остаток вида не получает —
       * решать нечего.
       */
      if v_roll_id is not null then
        v_left := case when v_cap is null then null
                       else greatest(v_cap - (v_spent + v_used), 0) end;

        update public.erp_material_rolls r
           set qty_left = coalesce(v_left, r.qty_left),
               leftover_kind = case
                 when v_fin and coalesce(v_left, 0) > 0 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status = 'in_stock' then 'in_use'
                             else r.status end
         where r.id = v_roll_id;
      end if;
    end loop;

    /**
     * ПЛЮСЫ (правка 21.09, п. 3) — по строкам ТОЛЬКО ЧТО записанного отчёта.
     * Превышение считается от суммы сданного этим этапом против плана
     * позиции, а в строки попадает ПРИРОСТ превышения. Внутри ячейки плюс
     * достаётся тому рулону, на котором план кончился (порядок — по сквозному
     * номеру рулона). Размер вне сетки плюсом не считается.
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
      ), src as (
        select z.id, z.color, z.size, z.qty_good::numeric as qty, mr.seq
          from public.erp_stage_report_sizes z
          left join public.erp_stage_report_rolls rr on rr.id = z.report_roll_id
          left join public.erp_material_rolls mr on mr.id = rr.roll_id
         where z.report_id = v_report
      ), rows_now as (
        select s.id, s.color, s.size, s.qty,
               sum(s.qty) over (
                 partition by s.color, s.size order by s.seq nulls last, s.id
                 rows between unbounded preceding and current row
               ) as cum,
               sum(s.qty) over (partition by s.color, s.size) as cell_total
          from src s
      ), calc as (
        select
          n.id,
          greatest(coalesce(p.qty, 0) + n.cell_total - pl.qty, 0)
            - greatest(coalesce(p.qty, 0) - pl.qty, 0) as cell_extra,
          n.cum, n.qty, n.cell_total
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
