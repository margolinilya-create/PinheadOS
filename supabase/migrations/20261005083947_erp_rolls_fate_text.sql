-- Текст отказа «не решена судьба остатка» под новую форму закроя
-- (правка 05.10, п. 5): галочки «Остаток пригоден» / «Малый остаток,
-- не учитывать» в строке рулона больше нет — судьбу остатка решает
-- отдельное действие «Завершить рулон». Логика гейта не меняется.
create or replace function public.erp_stage_rolls_fate_block(p_stage_id uuid)
returns text
language sql
stable
set search_path = public as $$
  with me as (
    select s.id, s.department_id, i.order_id, d.result_detail
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
      left join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id
  ),
  others_open as (
    select 1
      from me
      join public.erp_order_items i2 on i2.order_id = me.order_id
      join public.erp_item_stages s2 on s2.item_id = i2.id
     where s2.department_id = me.department_id
       and s2.id <> me.id
       and s2.status not in ('done', 'skipped')
     limit 1
  ),
  -- Рулоны заказа И рулоны ДРУГИХ заказов, с которых этот заказ кроил
  -- пригодный остаток (правка 28.09): взятый остаток решает тот, кто взял
  scope as (
    select r.id
      from me
      join public.erp_materials m on m.order_id = me.order_id
      join public.erp_material_rolls r on r.material_id = m.id
    union
    select rr.roll_id
      from me
      join public.erp_order_items i3 on i3.order_id = me.order_id
      join public.erp_item_stages s3 on s3.item_id = i3.id
      join public.erp_stage_reports rp on rp.stage_id = s3.id
      join public.erp_stage_report_rolls rr on rr.report_id = rp.id
     where rr.roll_id is not null
  ),
  pending as (
    select r.label, r.qty_left, r.length_left_m, coalesce(r.unit, m.unit) as unit, r.seq
      from me
      join scope on true
      join public.erp_material_rolls r on r.id = scope.id
      left join public.erp_materials m on m.id = r.material_id
     where me.result_detail = 'rolls'
       and not exists (select 1 from others_open)
       and r.status = 'in_use'
       -- Остаток в метрах, а у рулона без метража — в килограммах (до правки)
       and coalesce(r.length_left_m, r.qty_left, 0) > 0
       and r.leftover_kind is null
  )
  select case when count(*) = 0 then null else
    'Не решена судьба остатка: '
    || string_agg(label || ' ('
         || case when length_left_m is not null
                 then replace(round(length_left_m, 2)::text, '.', ',') || ' м'
                 else qty_left::text || coalesce(' ' || unit, '') end
         || ')', ', ' order by seq)
    || ' — нажмите «Завершить рулон» и выберите: оставить пригодный остаток или списать непригодный.'
  end
  from pending;
$$;
