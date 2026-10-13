-- СДАЧА РЕЗУЛЬТАТА ПИШЕТ СТОИМОСТЬ СБОРКИ ПОЗИЦИИ (правка 16.09, п. 6).
--
-- `p_assembly_cost` — ₽ за единицу, один раз на позицию. Пусто — значение
-- не трогается вовсе: «обязательное поле» из документа означает «пока его
-- нет», а не «вводите одно и то же на каждой частичной сдаче».
--
-- Запись идёт под меткой `erp.assembly_cost`, которую страж позиции
-- пропускает только вместе с правом цеха и только при изменении трёх
-- колонок стоимости (см. 20260916210629). Метка ставится вокруг своего
-- update и снимается сразу: она не должна пережить вызов.
--
-- DROP+CREATE с явными правами — по той же причине, что во всех прежних
-- правках этой функции: лишний аргумент при `create or replace` даёт
-- перегрузку и неоднозначность PostgREST.

drop function if exists public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb);

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
security invoker
set search_path to 'public'
as $$
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
     author, author_id)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid)
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
    -- Метка ставится ВОКРУГ своего update и снимается сразу: страж позиции
    -- пропускает по ней только три колонки стоимости
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
end $$;

comment on function public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric) is
  'Сдача результата этапа: журнал, размеры, рулоны, стоимость сборки позиции и счётчики';

revoke execute on function public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric) from public, anon;
grant execute on function public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric) to authenticated, service_role;
