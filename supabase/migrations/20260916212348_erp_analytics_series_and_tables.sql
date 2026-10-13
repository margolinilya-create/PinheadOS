-- РЯДЫ И ТАБЛИЦЫ РАЗДЕЛА «АНАЛИТИКА» (правка 16.09, п. 7).
--
-- Три функции: динамика по дням/неделям, производство по моделям и брак
-- по цехам. Все читают ОДНО определение выпуска (`erp_analytics_released`) —
-- иначе плитка «Выпущено» разошлась бы с таблицей молча.
--
-- ИСКЛЮЧЕНИЕ ОДНО, И ОНО ОСОЗНАННОЕ: брак по цехам считается по ВСЕМ этапам,
-- а не только терминальным. Вопрос документа — «где возникает брак», и ответ
-- на него даёт каждый цех: брак закроя на терминальном этапе не виден вовсе.
--
-- ДЕТАЛИЗАЦИЯ ПРОВЕРЯЕТСЯ СПИСКОМ, а не подставляется в `date_trunc` как есть:
-- иначе значение из адресной строки уехало бы прямо в SQL.
--
-- Расход ткани в рядах идёт ПОЛНЫМ ОБЪЕДИНЕНИЕМ с выпуском: день, когда
-- кроили, но ничего не сдали, обязан остаться в ряду — иначе график «расход
-- ткани» терял бы ровно те дни, ради которых его смотрят.

create or replace function public.erp_analytics_series(
  p_from date,
  p_to date,
  p_bucket text default 'day',
  p_product text default null,
  p_dept uuid default null
)
returns table (bucket date, released int, defect int, rework int, extra int, fabric numeric)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_series: нужно право analytics.view' using errcode = '42501';
  end if;
  if p_bucket not in ('day', 'week') then
    raise exception 'erp_analytics_series: неизвестная детализация «%»', p_bucket
      using errcode = '22023';
  end if;

  return query
  with rel as (
    select date_trunc(p_bucket, r.at)::date as b,
           r.qty_good, r.qty_defect, r.qty_rework, r.qty_extra, r.report_id
      from public.erp_analytics_released(p_from, p_to) r
     where (p_product is null or r.product_type = p_product)
       and (p_dept is null or r.department_id = p_dept)
  ),
  fab as (
    select date_trunc(p_bucket, rep.created_at)::date as b,
           sum(rr.qty_used) as kg
      from public.erp_stage_report_rolls rr
      join public.erp_stage_reports rep on rep.id = rr.report_id
      left join public.erp_materials m on m.id = rr.material_id
     where rep.created_at >= p_from::timestamptz
       and rep.created_at < (p_to + 1)::timestamptz
       and public.erp_unit_tracks_rolls(coalesce(rr.unit, m.unit))
     group by 1
  )
  select coalesce(rel.b, fab.b) as bucket,
         coalesce(sum(rel.qty_good), 0)::int,
         coalesce(sum(rel.qty_defect), 0)::int,
         coalesce(sum(rel.qty_rework), 0)::int,
         coalesce(sum(rel.qty_extra), 0)::int,
         round(coalesce(max(fab.kg), 0), 3)
    from rel
    full join fab on fab.b = rel.b
   group by coalesce(rel.b, fab.b)
   order by 1;
end $$;

create or replace function public.erp_analytics_by_sku(
  p_from date,
  p_to date,
  p_dept uuid default null
)
returns table (
  sku_card_id uuid,
  product_type text,
  released int,
  defect int,
  rework int,
  extra int,
  defect_pct numeric,
  assembly_avg numeric,
  orders int
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_by_sku: нужно право analytics.view' using errcode = '42501';
  end if;

  return query
  select r.sku_card_id,
         coalesce(r.product_type, '—'),
         coalesce(sum(r.qty_good), 0)::int,
         coalesce(sum(r.qty_defect), 0)::int,
         coalesce(sum(r.qty_rework), 0)::int,
         coalesce(sum(r.qty_extra), 0)::int,
         -- Доля брака считается от СДЕЛАННОГО (годное + брак), а не от тиража:
         -- у частично сданного этапа тираж ещё не выбран, и процент был бы занижен
         case when sum(r.qty_good) + sum(r.qty_defect) > 0
              then round(100.0 * sum(r.qty_defect) / (sum(r.qty_good) + sum(r.qty_defect)), 1)
         end,
         case when sum(r.qty_good) filter (where r.assembly_cost is not null) > 0
              then round(sum(r.assembly_cost * r.qty_good) filter (where r.assembly_cost is not null)
                         / sum(r.qty_good) filter (where r.assembly_cost is not null), 2)
         end,
         count(distinct r.order_id)::int
    from public.erp_analytics_released(p_from, p_to) r
   where (p_dept is null or r.department_id = p_dept)
   group by r.sku_card_id, coalesce(r.product_type, '—')
   order by 3 desc;
end $$;

create or replace function public.erp_analytics_by_dept(
  p_from date,
  p_to date,
  p_product text default null
)
returns table (
  department_id uuid,
  released int,
  defect int,
  rework int,
  defect_pct numeric
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_by_dept: нужно право analytics.view' using errcode = '42501';
  end if;

  return query
  select s.department_id,
         coalesce(sum(rep.qty_good), 0)::int,
         coalesce(sum(rep.qty_defect), 0)::int,
         coalesce(sum(rep.qty_rework), 0)::int,
         case when sum(rep.qty_good) + sum(rep.qty_defect) > 0
              then round(100.0 * sum(rep.qty_defect) / (sum(rep.qty_good) + sum(rep.qty_defect)), 1)
         end
    from public.erp_stage_reports rep
    join public.erp_item_stages s on s.id = rep.stage_id
    join public.erp_order_items i on i.id = s.item_id
   where rep.created_at >= p_from::timestamptz
     and rep.created_at < (p_to + 1)::timestamptz
     and (p_product is null or i.product_type = p_product)
   group by s.department_id
   order by 3 desc;
end $$;

revoke execute on function public.erp_analytics_series(date, date, text, text, uuid) from public, anon;
grant execute on function public.erp_analytics_series(date, date, text, text, uuid) to authenticated, service_role;
revoke execute on function public.erp_analytics_by_sku(date, date, uuid) from public, anon;
grant execute on function public.erp_analytics_by_sku(date, date, uuid) to authenticated, service_role;
revoke execute on function public.erp_analytics_by_dept(date, date, text) from public, anon;
grant execute on function public.erp_analytics_by_dept(date, date, text) to authenticated, service_role;
