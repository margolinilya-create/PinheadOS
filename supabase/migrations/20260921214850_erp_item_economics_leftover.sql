-- Возвратный остаток полотна и плюс закроя в экономике позиции
-- (правки заказчика 21.09, пп. 1, 3, 5).
--
-- 1. ОСТАТОК. «Если выбран „Остаток пригоден", система включает его
--    в экономику заказа и показывает общий остаток ткани в кг и в рублях.
--    Стоимость остатка считать по закупочной цене конкретного рулона».
--    Считается только по `usable`: «малый остаток» в показатель не входит
--    по прямому требованию документа.
--
-- 2. ЦЕНА БЕРЁТСЯ У РУЛОНА, и только потом у материала: она записана снимком
--    на момент приёмки, и правка цены задним числом не должна переписывать
--    себестоимость уже закрытых заказов.
--
-- 3. ПЛЮС ЗАКРОЯ приезжает вместе с «выкроено» — одним запросом по тем же
--    отчётам, чтобы карточка позиции показывала оба числа рядом.
--
-- Проверено на живом «тест закрой 1» прогоном с откатом (пример из документа):
-- 4 рулона по 20 кг при цене 700 ₽/кг, израсходовано 70 кг → расход
-- 70 кг / 49 000 ₽, остаток 10 кг / 7 000 ₽.

create or replace function public.erp_item_economics(p_item_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
declare
  v_qty_cut   int := 0;
  v_qty_good  int := 0;
  v_fabric    jsonb := '[]'::jsonb;
  v_cost      numeric;
  v_rolls     int := 0;
  v_asm_avg   numeric;
  v_asm_qty   int := 0;
  v_asm_src   text;
  v_item_cost numeric;
  v_per_good  numeric;
  v_extra     int := 0;
  v_left      jsonb := '[]'::jsonb;
  v_left_cost numeric;
begin
  -- ГЕЙТ ВНУТРИ ФУНКЦИИ. Политика `erp_stage_reports` — это `erp_is_member()`,
  -- то есть без этой проверки себестоимость прочитала бы через REST любая
  -- швея. Тот же приём, что во всех `erp_analytics_*`.
  if not public.erp_has_permission('economics.view') then
    raise exception 'erp_item_economics: нужно право economics.view'
      using errcode = '42501';
  end if;

  -- ВЫКРОЕНО и ГОДНЫЕ — из отчётов участков с соответствующей ролью
  -- в себестоимости. Роль живёт в данных (`erp_departments.cost_role`),
  -- а не в коде: «закрой → ткань» константой здесь держать запрещено.
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
   * РАСХОД ПОЛОТНА — РАЗБИВКОЙ ПО ЕДИНИЦАМ, а не одним числом.
   *
   * Сложить «61 кг и 120 м» нельзя: правило раздела «пересчёта единиц
   * система не делает» записано в `erp_analytics_overview`. Рубли при этом
   * складываются всегда — поэтому стоимость ниже одна, а расход массивом.
   *
   * ОТБОР «ОСНОВНОЕ ПОЛОТНО» FAIL-OPEN. Колонка `erp_materials.role`
   * nullable и без CHECK; на бою она заполнена у одного материала из
   * двадцати пяти. Строгий `role = 'main'` выбросил бы весь расход,
   * и вкладка показала бы нули на заказе, где кроили три рулона.
   *
   * ЦЕНА — СНАЧАЛА У РУЛОНА (правка 21.09, п. 1): она записана снимком
   * на момент приёмки, и правка цены материала задним числом не должна
   * переписывать себестоимость уже закрытых заказов. Цена материала
   * остаётся запасным вариантом для рулонов, принятых до правки.
   */
  with used as (
    select
      coalesce(rr.unit, m.unit) as unit,
      rr.qty_used               as qty_used,
      rr.roll_id                as roll_id,
      case when coalesce(ro.price_per_unit, m.price_per_unit) is not null
           then rr.qty_used * coalesce(ro.price_per_unit, m.price_per_unit) end as cost,
      case when coalesce(ro.price_per_unit, m.price_per_unit) is not null
           then rr.qty_used end as priced_qty
      from public.erp_stage_report_rolls rr
      join public.erp_stage_reports r on r.id = rr.report_id
      join public.erp_item_stages s on s.id = r.stage_id
      join public.erp_departments d on d.id = s.department_id
      left join public.erp_material_rolls ro on ro.id = rr.roll_id
      left join public.erp_materials m on m.id = coalesce(rr.material_id, ro.material_id)
     where s.item_id = p_item_id
       and d.cost_role = 'fabric'
       and (m.role = 'main' or (m.role is null and m.kind = 'fabric'))
  ), by_unit as (
    select
      unit,
      sum(qty_used)                as qty_used,
      sum(cost)                    as cost,
      coalesce(sum(priced_qty), 0) as priced_qty
      from used
     group by unit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unit', b.unit,
      'qty_used', round(b.qty_used, 3),
      'cost', case when b.cost is null then null else round(b.cost, 2) end,
      'priced_qty', round(b.priced_qty, 3),
      -- Средний расход на ВЫКРОЕННУЮ единицу: делитель — выход закроя,
      -- а не тираж. Тираж ещё не сделан, и делить на него значило бы
      -- занижать расход тем сильнее, чем меньше сделано.
      'avg_per_cut', case when v_qty_cut > 0
                          then round(b.qty_used / v_qty_cut, 4) end
    ) order by b.unit), '[]'::jsonb),
    (select sum(cost) from used),
    (select count(distinct roll_id) from used)
    into v_fabric, v_cost, v_rolls
    from by_unit b;

  /**
   * ВОЗВРАТНЫЙ ОСТАТОК ПОЛОТНА (правка 21.09, п. 5): «если выбран „Остаток
   * пригоден", система включает его в экономику заказа и показывает общий
   * остаток ткани в кг и в рублях. Стоимость остатка считать по закупочной
   * цене конкретного рулона».
   *
   * Считается ТОЛЬКО по `usable`: «малый остаток» в показатель не входит
   * по прямому требованию документа. Разбивка по единицам — та же, что
   * у расхода, и по той же причине: килограммы с метрами не складываются.
   *
   * Берутся рулоны, которые эта позиция КРОИЛА: остаток принадлежит заказу,
   * который открыл рулон, а не материалу вообще.
   */
  with mine as (
    select distinct ro.id, ro.qty_left, coalesce(ro.unit, m.unit) as unit,
           coalesce(ro.price_per_unit, m.price_per_unit) as price
      from public.erp_stage_report_rolls rr
      join public.erp_stage_reports r on r.id = rr.report_id
      join public.erp_item_stages s on s.id = r.stage_id
      join public.erp_departments d on d.id = s.department_id
      join public.erp_material_rolls ro on ro.id = rr.roll_id
      left join public.erp_materials m on m.id = ro.material_id
     where s.item_id = p_item_id
       and d.cost_role = 'fabric'
       and ro.leftover_kind = 'usable'
       and coalesce(ro.qty_left, 0) > 0
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unit', t.unit,
      'qty', round(t.qty, 3),
      'cost', case when t.cost is null then null else round(t.cost, 2) end,
      'rolls', t.rolls
    ) order by t.unit), '[]'::jsonb),
    (select sum(qty_left * price) from mine where price is not null)
    into v_left, v_left_cost
    from (
      select unit, sum(qty_left) as qty, sum(qty_left * price) as cost, count(*) as rolls
        from mine group by unit
    ) t;

  /**
   * СТОИМОСТЬ ПОШИВА — СРЕДНЕВЗВЕШЕННАЯ ПО КОЛИЧЕСТВУ (документ: «если пошив
   * сдаётся несколькими партиями по разной стоимости, считать средневзвешенное
   * значение по количеству изделий»). Та же формула, что у `assembly_avg`
   * в `erp_analytics_overview`, — иначе вкладка и сводка разошлись бы.
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

  if v_asm_avg is not null then
    v_asm_src := 'reports';
  else
    -- ОТЧЁТЫ ДО ПРАВКИ ЦЕНЫ НЕ НЕСУТ: колонка появилась вместе с ней.
    -- Показать «—» там, где стоимость вводили, значило бы потерять данные
    -- на экране — берём последнюю записанную у позиции и говорим об этом.
    select i.assembly_cost_per_unit into v_item_cost
      from public.erp_order_items i where i.id = p_item_id;
    if v_item_cost is not null then
      v_asm_avg := round(v_item_cost, 2);
      v_asm_src := 'item_fallback';
    end if;
  end if;

  v_per_good := case when v_qty_good > 0 and v_cost is not null
                     then round(v_cost / v_qty_good, 2) end;

  return jsonb_build_object(
    'item_id', p_item_id,
    'fabric', v_fabric,
    'fabric_cost_total', case when v_cost is null then null else round(v_cost, 2) end,
    'rolls_used', v_rolls,
    'qty_cut', v_qty_cut,
    'qty_good', v_qty_good,
    -- Плюс закроя (правка 21.09, п. 3): изделия сверх заказа
    'qty_extra', v_extra,
    -- Возвратный остаток полотна (правка 21.09, п. 5)
    'leftover', v_left,
    'leftover_cost', case when v_left_cost is null then null else round(v_left_cost, 2) end,
    'assembly', jsonb_build_object(
      'avg', v_asm_avg,
      'covered_qty', v_asm_qty,
      'source', v_asm_src
    ),
    'fabric_cost_per_good', v_per_good,
    -- ПРЯМАЯ ПРОИЗВОДСТВЕННАЯ СЕБЕСТОИМОСТЬ ЕДИНИЦЫ — «стоимость полотна
    -- на годную единицу + средняя стоимость пошива единицы». Null, если
    -- хоть одно слагаемое неизвестно: сумма с дырой хуже прочерка.
    'direct_unit_cost', case when v_per_good is not null and v_asm_avg is not null
                             then round(v_per_good + v_asm_avg, 2) end
    -- Ключа «расход на годную единицу» здесь НЕТ намеренно: документ прямо
    -- запрещает его выводить.
  );
end $function$;
