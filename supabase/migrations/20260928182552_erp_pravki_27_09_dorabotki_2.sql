-- Доработки 28.09, вторая порция — по итогам пробы на живой базе.
--
-- 1. Разбивка «не учтено» по размерам показывается, только когда сходится
--    с итогом. Проба на заказе 65004: не учтено 104 изделия, а по размерам
--    выходило 251 — часть сдач швейки записана без размеров, и учтённое
--    по размерам меньше учтённого штуками. Такая разбивка вводит в
--    заблуждение; честнее не показать её вовсе. Зеркало клиентского
--    `stageGates.unaccountedBreakdown(…, expectedTotal)`.
-- 2. `erp_order_foreign_rolls` — рулоны ДРУГИХ заказов, с которых кроил этот
--    заказ (взятые пригодные остатки). Закрой должен их видеть в форме:
--    иначе взятый в работу остаток нельзя ни доиспользовать, ни решить его
--    судьбу — а гейт закрытия (`erp_stage_rolls_fate_block`) их уже требует.

create or replace function public.erp_stage_unaccounted_by_size(p_stage_id uuid)
returns text
language sql
stable
set search_path to 'public'
as $$
  with inp as (
    select coalesce(nullif(btrim(c->>'color'), ''), '—') as color,
           btrim(c->>'size') as size,
           (c->>'qty')::int as qty,
           ord
      from jsonb_array_elements(public.erp_stage_size_input(p_stage_id)) with ordinality as t(c, ord)
  ), left_ as (
    select inp.*,
           inp.qty - coalesce((
             select sum(z.qty_good + z.qty_defect)
               from public.erp_stage_report_sizes z
               join public.erp_stage_reports rp on rp.id = z.report_id
              where rp.stage_id = p_stage_id
                and coalesce(nullif(btrim(z.color), ''), '—') = inp.color
                and btrim(z.size) = inp.size), 0) as rest
      from inp
  ), pos as (
    select * from left_ where rest > 0
  )
  select case
    when (select coalesce(sum(rest), 0) from pos)
         = coalesce(public.erp_stage_unaccounted(p_stage_id, 0, 0), -1)
      then (select string_agg(
              case when color = '—' then size else size || ' · ' || color end
                || ' — ' || rest || ' шт', ', ' order by ord) from pos)
  end;
$$;
comment on function public.erp_stage_unaccounted_by_size(uuid) is
  'Не учтено по размерам: «M — 60 шт, L · чёрный — 44 шт»; NULL без размерных данных или когда сумма по размерам не сходится с итогом erp_stage_unaccounted (сдачи без размеров). Правки 28.09';
revoke execute on function public.erp_stage_unaccounted_by_size(uuid) from public, anon;
grant execute on function public.erp_stage_unaccounted_by_size(uuid) to authenticated;

create or replace function public.erp_order_foreign_rolls(p_order_id uuid)
returns table (
  roll_id uuid, label text, seq int, material_id uuid, material text, kind text, unit text,
  order_id uuid, order_title text, order_status text,
  width_cm numeric, density_gsm numeric,
  length_m numeric, length_left_m numeric, length_source text,
  qty numeric, qty_left numeric, kg_per_m numeric,
  price_per_unit numeric, price_per_m numeric,
  location text, status text, created_at timestamptz, leftover_kind text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select distinct on (r.id)
         r.id, r.label, r.seq, m.id, coalesce(m.fact_name, m.name), m.kind, coalesce(r.unit, m.unit),
         o.id, o.title, o.status,
         coalesce(r.width_cm, m.width_cm), coalesce(r.density_gsm, m.density_gsm),
         r.length_m, r.length_left_m, coalesce(r.length_left_source, r.length_source),
         r.qty, r.qty_left, r.kg_per_m,
         coalesce(r.price_per_unit, m.price_per_unit), r.price_per_m,
         r.location, r.status, r.created_at, r.leftover_kind
    from public.erp_stage_report_rolls rr
    join public.erp_stage_reports rp on rp.id = rr.report_id
    join public.erp_item_stages s on s.id = rp.stage_id
    join public.erp_order_items i on i.id = s.item_id
    join public.erp_material_rolls r on r.id = rr.roll_id
    join public.erp_materials m on m.id = r.material_id
    join public.erp_orders o on o.id = m.order_id
   where i.order_id = p_order_id
     and m.order_id <> p_order_id
     and (select public.erp_is_member())
   order by r.id;
$$;
comment on function public.erp_order_foreign_rolls(uuid) is
  'Рулоны других заказов, с которых кроил этот заказ (взятые пригодные остатки) — для формы закроя и решения судьбы их остатка (правка 28.09)';
revoke execute on function public.erp_order_foreign_rolls(uuid) from public, anon;
grant execute on function public.erp_order_foreign_rolls(uuid) to authenticated;
