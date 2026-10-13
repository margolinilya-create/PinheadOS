-- ЭКОНОМИКА ПОЗИЦИИ (правка заказчика 20.09, п. 9).
--
-- «Система автоматически собирает данные из закупки, закройки и швейного цеха
-- и выводит расчёт во вкладке „Экономика позиции". На текущем этапе считаем
-- только основное полотно и пошив».
--
-- ПОЧЕМУ СЧИТАЕТ СЕРВЕР. Клиент держит только незакрытые заказы; расход
-- рулонов, журнал отчётов и цены закупки в память не возятся. Тот же довод,
-- что у `erp_analytics_*` и `erp_bootstrap`.
--
-- ПОЧЕМУ НОВОЕ ПРАВО, А НЕ `analytics.view`. Карточка заказа и сводный раздел
-- отвечают разным людям: «во что обошлась ЭТА позиция» спрашивает в том числе
-- менеджер заказа, а `analytics.view` открыл бы ему заодно брак по цехам
-- и себестоимость всех чужих заказов.

insert into public.erp_role_permissions (role, permission, allowed) values
  ('director', 'economics.view', true),
  ('production_head', 'economics.view', true),
  ('manager', 'economics.view', true)
on conflict (role, permission) do nothing;

create or replace function public.erp_item_economics(p_item_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
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
  select coalesce(sum(r.qty_good), 0) into v_qty_cut
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
   */
  with used as (
    select
      coalesce(rr.unit, m.unit) as unit,
      rr.qty_used               as qty_used,
      rr.roll_id                as roll_id,
      case when m.price_per_unit is not null
           then rr.qty_used * m.price_per_unit end as cost,
      case when m.price_per_unit is not null
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
end $$;

comment on function public.erp_item_economics(uuid) is
  'Экономика позиции (правка 20.09, п. 9): расход и стоимость основного полотна, выход закроя и швейки, средневзвешенная стоимость сборки и прямая себестоимость единицы. Только полотно и пошив. Право economics.view проверяется внутри.';

create or replace function public.erp_order_economics(p_order_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  -- ОДИН ВЫЗОВ НА ЗАКАЗ, а не по одному на позицию: у заказа их бывает
  -- с десяток, и N запросов на открытие вкладки — ровно то, от чего
  -- в разделе уходили `erp_bootstrap` и сводки аналитики.
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id,
    'product_type', i.product_type,
    'variant', i.variant,
    'qty', i.qty,
    'economics', public.erp_item_economics(i.id)
  ) order by i.created_at), '[]'::jsonb)
    from public.erp_order_items i
   where i.order_id = p_order_id;
$$;

comment on function public.erp_order_economics(uuid) is
  'Экономика всех позиций заказа одним вызовом (правка 20.09, п. 9). Право проверяет erp_item_economics.';

revoke execute on function public.erp_item_economics(uuid) from public, anon;
revoke execute on function public.erp_order_economics(uuid) from public, anon;
grant execute on function public.erp_item_economics(uuid) to authenticated;
grant execute on function public.erp_order_economics(uuid) to authenticated;
