-- СДАЧА РЕЗУЛЬТАТА ПРИНИМАЕТ РАСХОД ПО РУЛОНАМ (правка 16.09, п. 4).
--
-- `p_rolls` — массив «рулон → расход → размеры». Когда он непуст, заголовочное
-- `qty_good` СЧИТАЕТСЯ ИЗ НЕГО, как и при размерной разбивке: у числа один
-- писатель, и форма не может разойтись с журналом.
--
-- СТАТУС РУЛОНА ВЕДЁТ ЭТА ЖЕ ТРАНЗАКЦИЯ: «израсходован» ставится по галочке
-- закройщика, «в работе» — автоматически при первом расходе. Второго писателя
-- у статуса нет: склад рулоны только заводит.
--
-- ПОРЯДОК ВЕТОК ВАЖЕН. Сначала рулоны, потом размеры без рулонов, потом
-- скаляры: у закроя приходит и то и другое, и если бы размерная ветка шла
-- первой, строки записались бы дважды — один раз без рулона, второй с ним.
--
-- DROP+CREATE с явными правами — по той же причине, что во всех предыдущих
-- правках этой функции: лишний аргумент при `create or replace` даёт
-- ПЕРЕГРУЗКУ и неоднозначность PostgREST на действии, которым живёт цех.

drop function if exists public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb);

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
  p_rolls jsonb default '[]'::jsonb
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
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb) is
  'Сдача результата этапа: журнал, размерные строки, расход по рулонам и счётчики этапа';

revoke execute on function public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb) to authenticated, service_role;
