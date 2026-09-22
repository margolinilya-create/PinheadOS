-- Плитка «Количество плюсов» считала плюсы там, где их не бывает
-- (правка заказчика 21.09, п. 3).
--
-- Плюс возникает ТОЛЬКО на закрое — это прямая формулировка документа
-- («разница сверх заказа… формируется только на этапе закройки»), и с этой
-- правки его пишет `erp_stage_submit_report` в размерные строки отчёта
-- закроя. Плитка же брала `qty_extra` из `erp_analytics_released`, то есть
-- из отчётов ПОСЛЕДНИХ производственных этапов позиции. Закрой последним
-- не бывает никогда — значит плитка показывала ноль по построению, и любой
-- будущий плюс в неё бы не попал.
--
-- Тот же довод, что у брака в `erp_analytics_by_dept`: «брак считается
-- по ВСЕМ этапам, потому что вопрос „где возникает брак" на терминальном
-- этапе ответа не имеет». Здесь ровно так же — вопрос «сколько наплюсовали»
-- адресован закрою.
--
-- Остальные числа плитки (выпуск, брак, переделка, себестоимость) остаются
-- на `erp_analytics_released`: определение выпуска в системе ОДНО, и менять
-- его ради плюсов нельзя.

create or replace function public.erp_analytics_overview(
  p_from date, p_to date, p_product text default null, p_dept uuid default null
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_days int;
  v_prev_from date;
  v_prev_to date;
  v_released int;
  v_prev int;
  v_defect int;
  v_rework int;
  v_extra int;
  v_cost numeric;
  v_cost_covered int;
  v_fabric numeric;
  v_rolls int;
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_overview: нужно право analytics.view'
      using errcode = '42501';
  end if;

  v_days := greatest((p_to - p_from) + 1, 1);
  v_prev_to := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  select coalesce(sum(qty_good), 0), coalesce(sum(qty_defect), 0),
         coalesce(sum(qty_rework), 0)
    into v_released, v_defect, v_rework
    from public.erp_analytics_released(p_from, p_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

  -- ПЛЮСЫ — по ВСЕМ отчётам периода, а не по терминальным этапам: они
  -- возникают на закрое, а закрой терминальным не бывает
  select coalesce(sum(rep.qty_extra), 0) into v_extra
    from public.erp_stage_reports rep
    join public.erp_item_stages s on s.id = rep.stage_id
    join public.erp_order_items i on i.id = s.item_id
   where rep.created_at >= p_from::timestamptz
     and rep.created_at < (p_to + 1)::timestamptz
     and (p_product is null or i.product_type = p_product)
     and (p_dept is null or s.department_id = p_dept);

  select coalesce(sum(qty_good), 0) into v_prev
    from public.erp_analytics_released(v_prev_from, v_prev_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

  -- Средневзвешенная по выпуску: среднее «по позициям» дало бы вес
  -- единичной позиции, равный весу тиража в тысячу штук
  select case when sum(qty_good) filter (where assembly_cost is not null) > 0
           then round(sum(assembly_cost * qty_good) filter (where assembly_cost is not null)
                      / sum(qty_good) filter (where assembly_cost is not null), 2)
         end,
         coalesce(sum(qty_good) filter (where assembly_cost is not null), 0)
    into v_cost, v_cost_covered
    from public.erp_analytics_released(p_from, p_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

  -- Ткань считается ТОЛЬКО в килограммах: метры в этот показатель
  -- не пересчитываются, потому что система пересчёта единиц не делает
  select coalesce(sum(rr.qty_used), 0), count(distinct rr.roll_id)
    into v_fabric, v_rolls
    from public.erp_stage_report_rolls rr
    join public.erp_stage_reports rep on rep.id = rr.report_id
    left join public.erp_materials m on m.id = rr.material_id
   where rep.created_at >= p_from::timestamptz
     and rep.created_at < (p_to + 1)::timestamptz
     and public.erp_unit_tracks_rolls(coalesce(rr.unit, m.unit));

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'prev_from', v_prev_from,
    'prev_to', v_prev_to,
    'released', v_released,
    'released_prev', v_prev,
    'defect', v_defect,
    'rework', v_rework,
    'extra', v_extra,
    'assembly_avg', v_cost,
    'assembly_covered_qty', v_cost_covered,
    'fabric_kg', round(v_fabric, 3),
    'fabric_rolls', v_rolls,
    'fabric_per_item', case when v_released > 0 then round(v_fabric / v_released, 4) end
  );
end $function$;
