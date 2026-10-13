-- `erp_item_economics`: список недостающих статей собирается `array_append`
-- (правка 27.09, п. 8 — хвост, найден пробой на живой базе).
--
-- В `20260928133534` стояло `v_missing := v_missing || 'assembly'`. Для
-- Postgres `text[] || 'assembly'` — это не «добавить элемент», а попытка
-- разобрать литерал как МАССИВ: «malformed array literal: "assembly"».
-- Функция падала на любой позиции без стоимости сборки, то есть на каждой
-- первой. Тело ниже — подлинный текст `20260928133534` с тремя заменами
-- на `array_append`; ничего больше не менялось.
-- ── Экономика позиции: метры, остатки и потери, два показателя на единицу ──
create or replace function public.erp_item_economics(p_item_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  v_item       public.erp_order_items;
  v_qty_cut    int := 0;
  v_qty_good   int := 0;
  v_extra      int := 0;
  v_rolls      int := 0;
  v_fabric_m   numeric := 0;
  v_fabric_priced_m numeric := 0;
  v_fabric_calc_m numeric := 0;
  v_fabric_incomplete_kg numeric := 0;
  v_fabric_rows int := 0;
  v_fabric_cost numeric;
  v_asm_avg    numeric;
  v_asm_qty    int := 0;
  v_asm_src    text;
  v_asm_total  numeric;
  v_item_cost  numeric;
  v_per_good   numeric;
  v_left       jsonb := '[]'::jsonb;
  v_left_cost  numeric;
  v_scrap      jsonb := '[]'::jsonb;
  v_scrap_cost numeric;
  v_adjust     jsonb := '[]'::jsonb;
  v_adjust_open int := 0;
  v_defects    jsonb := '[]'::jsonb;
  v_defect_qty int := 0;
  v_defect_cost numeric;
  v_wip        jsonb := '[]'::jsonb;
  v_wip_qty    int := 0;
  v_wip_rework int := 0;
  v_final_good int := 0;
  v_shipped    numeric := 0;
  v_extras_finished int := 0;
  v_extras_shipped int := 0;
  v_extras_stock int := 0;
  v_extras_by_size jsonb := '[]'::jsonb;
  v_prod_done  boolean := false;
  v_prod_any   boolean := false;
  v_costs_filled boolean := false;
  v_total_costs numeric;
  v_unit_good  numeric;
  v_unit_plan  numeric;
  v_missing    text[] := '{}';
  v_fabric_per_cut_cost numeric;
begin
  -- ГЕЙТ ВНУТРИ ФУНКЦИИ. Политика `erp_stage_reports` — это `erp_is_member()`,
  -- то есть без этой проверки себестоимость прочитала бы через REST любая
  -- швея. Тот же приём, что во всех `erp_analytics_*`.
  if not public.erp_has_permission('economics.view') then
    raise exception 'erp_item_economics: нужно право economics.view'
      using errcode = '42501';
  end if;

  select * into v_item from public.erp_order_items where id = p_item_id;
  if not found then
    return null;
  end if;

  -- ВЫКРОЕНО (включая плюсы) и ГОДНЫЕ СБОРКИ — из отчётов участков с ролью
  -- в себестоимости. Роль живёт в данных (`erp_departments.cost_role`).
  select coalesce(sum(r.qty_good), 0), coalesce(sum(r.qty_extra), 0)
    into v_qty_cut, v_extra
    from public.erp_stage_reports r
    join public.erp_item_stages s on s.id = r.stage_id
    join public.erp_departments d on d.id = s.department_id
   where s.item_id = p_item_id and d.cost_role = 'fabric';

  select coalesce(sum(r.qty_good), 0) into v_qty_good
    from public.erp_stage_reports r
    join public.erp_item_stages s on s.id = r.stage_id
    join public.erp_departments d on d.id = s.department_id
   where s.item_id = p_item_id and d.cost_role = 'assembly';

  /**
   * РАСХОД ПОЛОТНА — В МЕТРАХ, по рулонам (правка 27.09, п. 4): «стоимость
   * израсходованного полотна = расход в метрах × цена за метр. Считать
   * по каждому рулону отдельно, затем суммировать по позиции». Строки,
   * пересчитанные из кг, названы отдельно («Расчёт»); не пересчитанные —
   * килограммами, с отметкой о неполноте.
   */
  select coalesce(sum(u.metres), 0),
         coalesce(sum(u.metres) filter (where u.cost is not null), 0),
         coalesce(sum(u.metres) filter (where u.recalced), 0),
         coalesce(sum(u.kg) filter (where u.incomplete), 0),
         count(*), count(distinct u.roll_id),
         sum(u.cost)
    into v_fabric_m, v_fabric_priced_m, v_fabric_calc_m, v_fabric_incomplete_kg,
         v_fabric_rows, v_rolls, v_fabric_cost
    from public.erp_fabric_usage(p_item_id) u;

  /**
   * ПРИГОДНЫЕ ОСТАТКИ — по рулонам, которые эта позиция кроила (правка 27.09,
   * п. 8): «метры и стоимость по каждому рулону, материал, ширина, место
   * хранения и источник метража… После использования в другом заказе
   * уменьшать запас без повторного списания на исходный заказ» — остаток
   * берётся ТЕКУЩИЙ у рулона, а не на момент закроя. В затраты позиции
   * он не входит: «пригодная ткань, оставшаяся в запасах, в затраты
   * на изготовленные изделия не входит».
   */
  with mine as (
    select distinct ro.id
      from public.erp_fabric_usage(p_item_id) u
      join public.erp_material_rolls ro on ro.id = u.roll_id
     where ro.leftover_kind = 'usable'
       and coalesce(ro.length_left_m, ro.qty_left, 0) > 0
  ), rows_l as (
    select ro.id as roll_id, ro.label, coalesce(m.fact_name, m.name) as material,
           coalesce(ro.width_cm, m.width_cm) as width_cm,
           coalesce(ro.density_gsm, m.density_gsm) as density_gsm,
           ro.length_left_m, coalesce(ro.length_left_source, ro.length_source) as length_source,
           ro.qty_left as kg,
           coalesce(ro.price_per_m,
             case when coalesce(ro.kg_per_m, 0) > 0
                    and coalesce(ro.price_per_unit, m.price_per_unit) is not null
                  then coalesce(ro.price_per_unit, m.price_per_unit) * ro.kg_per_m end) as price_per_m,
           coalesce(ro.price_per_unit, m.price_per_unit) as price_per_kg,
           m.order_id as owner_order_id,
           -- Использовано ДРУГИМИ позициями после этой — движение запаса
           coalesce((select sum(u2.metres) from public.erp_fabric_usage(null) u2
                      where u2.roll_id = ro.id and u2.item_id <> p_item_id), 0) as used_elsewhere_m
      from mine
      join public.erp_material_rolls ro on ro.id = mine.id
      left join public.erp_materials m on m.id = ro.material_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'roll_id', r.roll_id, 'label', r.label, 'material', r.material,
           'width_cm', r.width_cm, 'density_gsm', r.density_gsm,
           'length_m', case when r.length_left_m is null then null else round(r.length_left_m, 2) end,
           'length_source', case when r.length_left_m is null then null else r.length_source end,
           'kg', case when r.kg is null then null else round(r.kg, 3) end,
           'price_per_m', case when r.price_per_m is null then null else round(r.price_per_m, 2) end,
           'cost', case
             when r.length_left_m is not null and r.price_per_m is not null then round(r.length_left_m * r.price_per_m, 2)
             when r.length_left_m is null and r.kg is not null and r.price_per_kg is not null then round(r.kg * r.price_per_kg, 2)
           end,
           'owner_order_id', r.owner_order_id,
           'used_elsewhere_m', round(r.used_elsewhere_m, 2)
         ) order by r.material, r.label), '[]'::jsonb),
         sum(case
           when r.length_left_m is not null and r.price_per_m is not null then r.length_left_m * r.price_per_m
           when r.length_left_m is null and r.kg is not null and r.price_per_kg is not null then r.kg * r.price_per_kg
         end)
    into v_left, v_left_cost
    from rows_l r;

  /**
   * НЕПРИГОДНЫЕ ОСТАТКИ — списания малого остатка, оформленные ПО ЭТОЙ
   * позиции (`item_id` корректировки): «стоимость отдельно списанного малого
   * остатка относить на ту позицию, к которой оформлено списание».
   * Отходы раскладки внутри расхода закроя сюда не входят — они уже
   * в метрах расхода.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'adjustment_id', a.id, 'roll_id', a.roll_id, 'label', ro.label,
           'material', coalesce(m.fact_name, m.name),
           'length_m', round(coalesce(a.before_m, 0), 2),
           'cost', case when a.cost is null then null else round(a.cost, 2) end,
           'reason', a.reason, 'author', a.author, 'created_at', a.created_at,
           'report_id', a.report_id
         ) order by a.created_at), '[]'::jsonb),
         sum(a.cost)
    into v_scrap, v_scrap_cost
    from public.erp_material_roll_adjustments a
    join public.erp_material_rolls ro on ro.id = a.roll_id
    left join public.erp_materials m on m.id = ro.material_id
   where a.kind = 'scrap_writeoff' and a.item_id = p_item_id;

  -- Прочие корректировки рулонов, которые кроила эта позиция, — для раскрытия
  -- «до исходных записей»; `cost_residual` без подтверждения держит расчёт
  -- предварительным («неразобранные расхождения»)
  select coalesce(jsonb_agg(jsonb_build_object(
           'adjustment_id', a.id, 'roll_id', a.roll_id, 'label', ro.label, 'kind', a.kind,
           'before_m', a.before_m, 'after_m', a.after_m, 'delta_m', a.delta_m,
           'cost', a.cost, 'reason', a.reason, 'author', a.author, 'created_at', a.created_at
         ) order by a.created_at), '[]'::jsonb),
         count(*) filter (where a.kind = 'cost_residual')
    into v_adjust, v_adjust_open
    from public.erp_material_roll_adjustments a
    join public.erp_material_rolls ro on ro.id = a.roll_id
   where a.kind <> 'scrap_writeoff'
     and (a.item_id = p_item_id
          or a.roll_id in (select u.roll_id from public.erp_fabric_usage(p_item_id) u));

  /**
   * СТОИМОСТЬ ПОШИВА — СРЕДНЕВЗВЕШЕННАЯ ПО КОЛИЧЕСТВУ (документ 20.09), и её
   * СУММА по сданному: Σ(цена сдачи × годные). У сдач без цены — цена
   * позиции (последняя записанная); если нет и её — сумма неизвестна.
   */
  select
    round(sum(r.assembly_cost_per_unit * r.qty_good)
          / nullif(sum(r.qty_good) filter (where r.assembly_cost_per_unit is not null), 0), 2),
    coalesce(sum(r.qty_good) filter (where r.assembly_cost_per_unit is not null), 0)
    into v_asm_avg, v_asm_qty
    from public.erp_stage_reports r
    join public.erp_item_stages s on s.id = r.stage_id
    join public.erp_departments d on d.id = s.department_id
   where s.item_id = p_item_id and d.cost_role = 'assembly'
     and r.assembly_cost_per_unit is not null;

  v_item_cost := v_item.assembly_cost_per_unit;
  if v_asm_avg is not null then
    v_asm_src := 'reports';
  elsif v_item_cost is not null then
    v_asm_avg := round(v_item_cost, 2);
    v_asm_src := 'item_fallback';
  end if;

  select sum(coalesce(r.assembly_cost_per_unit, v_item_cost) * r.qty_good)
    into v_asm_total
    from public.erp_stage_reports r
    join public.erp_item_stages s on s.id = r.stage_id
    join public.erp_departments d on d.id = s.department_id
   where s.item_id = p_item_id and d.cost_role = 'assembly';
  if v_qty_good > 0 and exists (
    select 1 from public.erp_stage_reports r
      join public.erp_item_stages s on s.id = r.stage_id
      join public.erp_departments d on d.id = s.department_id
     where s.item_id = p_item_id and d.cost_role = 'assembly'
       and r.assembly_cost_per_unit is null and v_item_cost is null
  ) then
    v_asm_total := null;
  end if;

  v_per_good := case when v_qty_good > 0 and v_fabric_cost is not null
                     then round(v_fabric_cost / v_qty_good, 2) end;
  -- Полотно на одну ВЫКРОЕННУЮ единицу — для оценки брака и незавершёнки
  v_fabric_per_cut_cost := case when v_qty_cut > 0 and v_fabric_cost is not null
                                then v_fabric_cost / v_qty_cut end;

  /**
   * ОКОНЧАТЕЛЬНЫЙ БРАК — по отчётам всех этапов позиции: количество, этап,
   * причина (комментарий сдачи), автор, дата и НАКОПЛЕННАЯ стоимость на момент
   * списания: полотно на скроенную единицу плюс сборка, если брак возник
   * на сборке или после неё. Это ОЦЕНКА («Расчёт»): точной связи затрат
   * с партией нет, и документ разрешает распределение пропорционально
   * количеству. Стоимость брака — часть уже учтённых затрат, не добавка.
   */
  with d as (
    select r.id as report_id, s.id as stage_id, dep.name as department, dep.code as dept_code,
           dep.cost_role, r.qty_defect, r.comment, r.author, r.created_at,
           case
             when dep.cost_role = 'fabric' then coalesce(v_fabric_per_cut_cost, 0)
             else coalesce(v_fabric_per_cut_cost, 0)
                  + case when dep.cost_role = 'assembly' or v_qty_good > 0
                         then coalesce(v_asm_avg, 0) else 0 end
           end as unit_cost,
           (v_fabric_per_cut_cost is null
            or (dep.cost_role <> 'fabric' and v_asm_avg is null)) as unknown
      from public.erp_stage_reports r
      join public.erp_item_stages s on s.id = r.stage_id
      join public.erp_departments dep on dep.id = s.department_id
     where s.item_id = p_item_id and coalesce(r.qty_defect, 0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'report_id', d.report_id, 'stage_id', d.stage_id, 'department', d.department,
           'dept_code', d.dept_code, 'qty', d.qty_defect, 'reason', d.comment,
           'author', d.author, 'created_at', d.created_at,
           'cost', case when d.unknown then null else round(d.qty_defect * d.unit_cost, 2) end,
           'calc', true
         ) order by d.created_at), '[]'::jsonb),
         coalesce(sum(d.qty_defect), 0),
         sum(case when d.unknown then null else d.qty_defect * d.unit_cost end)
    into v_defects, v_defect_qty, v_defect_cost
    from d;

  /**
   * В РАБОТЕ И ПЕРЕДЕЛКЕ — по незакрытым производственным этапам: не учтено
   * (`erp_stage_unaccounted`, та же формула, что у гейта завершения)
   * с разбивкой по размерам и цветам (принято по размеру − сдано − брак),
   * переделка внутри незавершённого, не вторично. Затраты на выполненные
   * операции: у этапов после закроя — полотно на скроенную единицу
   * (расчёт); у самого закроя операций ещё нет — «Не рассчитано».
   */
  with st as (
    select s.id, s.status, s.qty_rework, dep.name as department, dep.code as dept_code, dep.cost_role,
           public.erp_stage_unaccounted(s.id, 0, 0) as unaccounted,
           public.erp_stage_size_input(s.id) as size_input
      from public.erp_item_stages s
      join public.erp_departments dep on dep.id = s.department_id
     where s.item_id = p_item_id
       and coalesce(dep.is_production, false)
       and s.origin is distinct from 'experimental'
       and s.status not in ('done', 'skipped')
  ), sized as (
    select st.id,
           coalesce((
             select jsonb_agg(jsonb_build_object('color', c->>'color', 'size', c->>'size',
                      'qty', greatest((c->>'qty')::int - coalesce((
                        select sum(z.qty_good + z.qty_defect)
                          from public.erp_stage_report_sizes z
                          join public.erp_stage_reports rp on rp.id = z.report_id
                         where rp.stage_id = st.id
                           and coalesce(nullif(btrim(z.color), ''), '—') = coalesce(nullif(btrim(c->>'color'), ''), '—')
                           and btrim(z.size) = btrim(c->>'size')), 0), 0)))
               from jsonb_array_elements(st.size_input) c), '[]'::jsonb) as by_size
      from st
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', st.id, 'department', st.department, 'dept_code', st.dept_code,
           'status', st.status,
           'unaccounted', greatest(coalesce(st.unaccounted, 0), 0),
           'rework', coalesce(st.qty_rework, 0),
           'by_size', sized.by_size,
           'cost', case when st.cost_role = 'fabric' or v_fabric_per_cut_cost is null then null
                        else round(greatest(coalesce(st.unaccounted, 0), 0) * v_fabric_per_cut_cost, 2) end,
           'calc', true
         ) order by st.department), '[]'::jsonb),
         coalesce(sum(greatest(coalesce(st.unaccounted, 0), 0)), 0),
         coalesce(sum(coalesce(st.qty_rework, 0)), 0)
    into v_wip, v_wip_qty, v_wip_rework
    from st
    join sized on sized.id = st.id
   where greatest(coalesce(st.unaccounted, 0), 0) > 0 or coalesce(st.qty_rework, 0) > 0;

  /**
   * ГОТОВЫЙ ВЫПУСК — после всех операций: отчёты ТЕРМИНАЛЬНЫХ
   * производственных этапов позиции (то же определение, что
   * у `erp_analytics_released`, — определение выпуска в системе одно).
   * «Промежуточные передачи между цехами не суммировать как новые изделия».
   */
  select coalesce(sum(r.qty_good), 0) into v_final_good
    from public.erp_stage_reports r
    join public.erp_item_stages s on s.id = r.stage_id
    join public.erp_departments dep on dep.id = s.department_id
   where s.item_id = p_item_id
     and coalesce(dep.is_production, false)
     and s.origin is distinct from 'experimental'
     and not exists (
       select 1 from public.erp_item_stages n
        where n.item_id = s.item_id and s.id = any(n.depends_on)
          and n.origin is distinct from 'experimental'
     );

  select coalesce(sum(sh.qty), 0) into v_shipped
    from public.erp_order_shipments sh where sh.item_id = p_item_id;

  /**
   * ГОДНЫЕ ПЛЮСЫ — «только готовые годные изделия сверх клиентского тиража,
   * которые ещё не выданы». Не разница «выкроено − тираж»: часть кроя
   * в работе или в браке. Разбивка по размерам и цветам — из плюсов закроя
   * (`erp_stage_report_sizes.qty_extra`): это единственный размерный факт
   * о плюсах в системе.
   */
  v_extras_finished := greatest(v_final_good - coalesce(v_item.qty, 0), 0);
  v_extras_shipped := greatest(floor(v_shipped)::int - coalesce(v_item.qty, 0), 0);
  v_extras_stock := greatest(v_extras_finished - v_extras_shipped, 0);
  select coalesce(jsonb_agg(jsonb_build_object('color', t.color, 'size', t.size, 'qty', t.qty)
           order by t.color, t.size), '[]'::jsonb)
    into v_extras_by_size
    from (
      select z.color, z.size, sum(z.qty_extra)::int as qty
        from public.erp_stage_report_sizes z
        join public.erp_stage_reports r on r.id = z.report_id
        join public.erp_item_stages s on s.id = r.stage_id
       where s.item_id = p_item_id and coalesce(z.qty_extra, 0) > 0
       group by z.color, z.size
    ) t;

  -- ПРИЗНАКИ. Производство завершено — все производственные этапы позиции
  -- закрыты (и хоть один есть); затраты заполнены — полотно оценено по всем
  -- строкам и стоимость сборки известна
  select bool_and(s.status in ('done', 'skipped')), count(*) > 0
    into v_prod_done, v_prod_any
    from public.erp_item_stages s
    join public.erp_departments dep on dep.id = s.department_id
   where s.item_id = p_item_id
     and coalesce(dep.is_production, false)
     and s.origin is distinct from 'experimental';
  v_prod_done := coalesce(v_prod_done, false) and v_prod_any;

  if v_fabric_rows = 0 then v_missing := array_append(v_missing, 'fabric'); end if;
  if v_fabric_rows > 0 and (v_fabric_cost is null or v_fabric_priced_m < v_fabric_m - 0.005
                            or v_fabric_incomplete_kg > 0) then
    v_missing := array_append(v_missing, 'fabric_price');
  end if;
  if v_asm_total is null then v_missing := array_append(v_missing, 'assembly'); end if;
  v_costs_filled := cardinality(v_missing) = 0;

  /**
   * ДВА ПОКАЗАТЕЛЯ НА ЕДИНИЦУ (правка 27.09, п. 8). Затраты позиции =
   * полотно (метры × цена за метр) + списанные малые остатки этой позиции +
   * сборка. Брак, переделка, плюсы и отходы НЕ прибавляются: они уже внутри.
   *   · годной произведённой единицы = затраты / готовый выпуск (с плюсами);
   *   · клиентского тиража = затраты / тираж позиции.
   * Нулевой знаменатель — null («Нет данных для расчёта»). Пока состав
   * затрат неполный, сумма считается по тому, что есть, а недостающее
   * названо в `missing` — «незаполненную стоимость не принимать за ноль».
   */
  v_total_costs := case when v_fabric_cost is null and v_asm_total is null and v_scrap_cost is null
                        then null
                        else coalesce(v_fabric_cost, 0) + coalesce(v_scrap_cost, 0) + coalesce(v_asm_total, 0) end;
  v_unit_good := case when v_total_costs is not null and v_final_good > 0
                      then round(v_total_costs / v_final_good, 2) end;
  v_unit_plan := case when v_total_costs is not null and coalesce(v_item.qty, 0) > 0
                      then round(v_total_costs / v_item.qty, 2) end;

  return jsonb_build_object(
    'item_id', p_item_id,
    'client_qty', v_item.qty,
    -- Расход полотна — в метрах (правка 27.09, п. 4)
    'fabric', jsonb_build_object(
      'metres', round(v_fabric_m, 2),
      'priced_metres', round(v_fabric_priced_m, 2),
      -- Метры, пересчитанные из кг по коэффициенту рулона — «Расчёт»
      'calc_metres', round(v_fabric_calc_m, 2),
      -- Килограммы строк, которые пересчитать не из чего
      'incomplete_kg', round(v_fabric_incomplete_kg, 3),
      'rows', v_fabric_rows,
      -- Средний расход на годную скроенную единицу, включая плюсы
      'avg_m_per_cut', case when v_qty_cut > 0 and v_fabric_m > 0 then round(v_fabric_m / v_qty_cut, 4) end
    ),
    'fabric_cost_total', case when v_fabric_cost is null then null else round(v_fabric_cost, 2) end,
    'rolls_used', v_rolls,
    'qty_cut', v_qty_cut,
    'qty_good', v_qty_good,
    'qty_extra', v_extra,
    'assembly', jsonb_build_object(
      'avg', v_asm_avg,
      'covered_qty', v_asm_qty,
      'source', v_asm_src,
      'total', case when v_asm_total is null then null else round(v_asm_total, 2) end
    ),
    'fabric_cost_per_good', v_per_good,
    'direct_unit_cost', case when v_per_good is not null and v_asm_avg is not null
                             then round(v_per_good + v_asm_avg, 2) end,
    -- «Остатки и потери по заказу» (правка 27.09, п. 8)
    'losses', jsonb_build_object(
      'leftovers_usable', v_left,
      'leftovers_usable_cost', case when v_left_cost is null then null else round(v_left_cost, 2) end,
      'leftovers_scrap', v_scrap,
      'leftovers_scrap_cost', case when v_scrap_cost is null then null else round(v_scrap_cost, 2) end,
      'adjustments', v_adjust,
      'adjustments_open', v_adjust_open,
      'extras', jsonb_build_object(
        'cut_extra', v_extra,
        'by_size', v_extras_by_size,
        'finished', v_extras_finished,
        'shipped', v_extras_shipped,
        'in_stock', v_extras_stock,
        'unit_cost', v_unit_good,
        'value', case when v_unit_good is null then null else round(v_extras_stock * v_unit_good, 2) end
      ),
      'defects', v_defects,
      'defects_qty', v_defect_qty,
      'defects_cost', case when v_defect_cost is null then null else round(v_defect_cost, 2) end,
      'wip', v_wip,
      'wip_qty', v_wip_qty,
      'wip_rework', v_wip_rework
    ),
    'final_good', v_final_good,
    'shipped', v_shipped,
    'production_done', v_prod_done,
    'costs_filled', v_costs_filled,
    -- Предварительный, пока есть изделия в работе, переделке или
    -- неразобранные расхождения (остаточная стоимость без подтверждения)
    'preliminary', (not v_prod_done) or v_wip_qty > 0 or v_wip_rework > 0 or v_adjust_open > 0,
    'costs', jsonb_build_object(
      'fabric', case when v_fabric_cost is null then null else round(v_fabric_cost, 2) end,
      'scrap', case when v_scrap_cost is null then null else round(v_scrap_cost, 2) end,
      'assembly', case when v_asm_total is null then null else round(v_asm_total, 2) end,
      'total', case when v_total_costs is null then null else round(v_total_costs, 2) end,
      'missing', to_jsonb(v_missing)
    ),
    'unit_cost_good', v_unit_good,
    'unit_cost_plan', v_unit_plan
  );
end $function$;

revoke execute on function public.erp_item_economics(uuid) from public, anon;
grant execute on function public.erp_item_economics(uuid) to authenticated;
