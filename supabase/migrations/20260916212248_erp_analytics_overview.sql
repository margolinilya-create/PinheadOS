-- КАРТОЧКИ РАЗДЕЛА «АНАЛИТИКА» (правка 16.09, п. 7).
--
-- Пять показателей «Обзора» одним вызовом: выпуск (и сопоставимый предыдущий
-- период), плюсы, средняя себестоимость сборки, использовано ткани, средний
-- расход на изделие.
--
-- ПРАВО ПРОВЕРЯЕТСЯ ВНУТРИ, а не только вкладкой. Политика
-- `erp_stage_reports` — `erp_is_member()`, то есть без этой проверки сводку
-- прочитал бы через REST любой участник производства. Тот же гейт стоит
-- во всех функциях раздела.
--
-- СРЕДНЯЯ СЕБЕСТОИМОСТЬ — СРЕДНЕВЗВЕШЕННАЯ ПО ВЫПУСКУ. Простое среднее
-- по позициям дало бы единичной позиции тот же вес, что тиражу в тысячу штук.
-- Рядом возвращается ПОКРЫТИЕ (`assembly_covered_qty`): среднее по трём
-- позициям из тридцати читается как среднее по всему, если не сказать, сколько
-- изделий в него вошло.
--
-- ТКАНЬ СЧИТАЕТСЯ ТОЛЬКО В КИЛОГРАММАХ. Метры в этот показатель не попадают
-- и не пересчитываются: пересчёта единиц система не делает — это записанное
-- решение раздела, и «сложить кг с метрами» здесь было бы первым его
-- нарушением. Отбор идёт через `erp_unit_tracks_rolls`, ту же функцию,
-- по которой склад решает, спрашивать ли рулоны.
--
-- ПРЕДЫДУЩИЙ ПЕРИОД — ТОЙ ЖЕ ДЛИНЫ И ПРИМЫКАЮЩИЙ СЛЕВА. «Месяц к месяцу»
-- и «30 дней к 30 дням» дают разные числа, и спорить об этом надо один раз:
-- длина берётся у выбранного периода.

create or replace function public.erp_analytics_overview(
  p_from date,
  p_to date,
  p_product text default null,
  p_dept uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
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
         coalesce(sum(qty_rework), 0), coalesce(sum(qty_extra), 0)
    into v_released, v_defect, v_rework, v_extra
    from public.erp_analytics_released(p_from, p_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

  select coalesce(sum(qty_good), 0) into v_prev
    from public.erp_analytics_released(v_prev_from, v_prev_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

  select case when sum(qty_good) filter (where assembly_cost is not null) > 0
           then round(sum(assembly_cost * qty_good) filter (where assembly_cost is not null)
                      / sum(qty_good) filter (where assembly_cost is not null), 2)
         end,
         coalesce(sum(qty_good) filter (where assembly_cost is not null), 0)
    into v_cost, v_cost_covered
    from public.erp_analytics_released(p_from, p_to) r
   where (p_product is null or r.product_type = p_product)
     and (p_dept is null or r.department_id = p_dept);

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
end $$;

comment on function public.erp_analytics_overview(date, date, text, uuid) is
  'Карточки раздела «Аналитика»: выпуск, плюсы, себестоимость сборки, расход ткани';

revoke execute on function public.erp_analytics_overview(date, date, text, uuid) from public, anon;
grant execute on function public.erp_analytics_overview(date, date, text, uuid) to authenticated, service_role;
