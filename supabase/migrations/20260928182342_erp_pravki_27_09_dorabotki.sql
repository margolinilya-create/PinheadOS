-- Доработки по сверке документа «ЕРП правки» 27.09 (сессия 72, 28.09).
--
-- Сверка каждого пункта с кодом после выката #186 нашла пробелы; здесь —
-- серверная часть их закрытия. Тела функций — подлинные тексты последних
-- миграций (`20260928131459`, `20260928133534`, `20260928135632`,
-- `20260928083215`) с точечными вставками; каждая вставка подписана
-- «правка 28.09».
--
--  1. Уточнение метража у рулона со старым расходом в кг: килограммы тоже
--     расход (прежде остаток в метрах выходил равным полному метражу).
--  2. Чистый вес рулона при метраже: «для связи с закупкой в кг нужен
--     чистый вес» — вес дозаполняется здесь же рулону без веса.
--  3. Место хранения рулона (`location`) и его запись складом.
--  4. Пригодный остаток идёт в другой заказ: сдача закроя проверяет, чей
--     рулон (прежде не проверяла вовсе), и снова открывает взятый остаток.
--  5. Журнал корректировок пишет только хелпер под меткой транзакции:
--     INSERT-политика снята (через REST корректировку можно было подделать).
--  6. «Малый остаток» у рулона «в работе» и в пути в кг — записью списания
--     со стоимостью на позицию, а не одним видом рулона.
--  7. Подтверждение остаточной стоимости рулона (`cost_residual`): без него
--     расчёт оставался предварительным навсегда.
--  8. Программа вышивки держит только ЗАКРЫТИЕ вышивки, не сдачу части.
--  9. Отказ «не учтено изделий» называет разбивку по размерам.
-- 10. Экономика: брак без стоимости последующих операций, незавершёнка
--     с выполненной сборкой, средний расход по тем же операциям, полотно
--     на единицу выпуска, старые малые остатки, место хранения.
-- 11. Аналитика: фильтр «Изделие» у разреза по моделям, годные без
--     задвоения при рулонах разной ширины, отметки «расчёт»/«неполно» в рядах.
-- 12. `erp_fabric_leftovers` — остатки ткани по ВСЕМ заказам (экран читал
--     только загруженные, и остатки закрытых заказов пропадали).

-- ── Колонки ────────────────────────────────────────────────────────────────
alter table public.erp_material_rolls add column if not exists location text;
comment on column public.erp_material_rolls.location is
  'Место хранения рулона (стеллаж, ячейка) — свободный текст склада (правка 28.09)';

alter table public.erp_material_roll_adjustments
  add column if not exists qty_kg numeric,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid;
comment on column public.erp_material_roll_adjustments.qty_kg is
  'Списанное количество в кг (у списания малого остатка; у метров — расчётное)';
comment on column public.erp_material_roll_adjustments.confirmed_at is
  'Когда подтверждена остаточная стоимость (cost_residual); до этого расчёт предварительный';

-- ── Журнал корректировок: единственный писатель ────────────────────────────
/**
 * Корректировку пишут сдача закроя (invoker), уточнение параметров и
 * списание остатка (definer) — все через этот хелпер и только под меткой
 * `erp.roll_adjust`, которую ставят сами эти функции. Метку нельзя поставить
 * через REST: `set_config` не выставлен PostgREST-ом. INSERT-политика
 * `20260928134619` снята — через неё корректировку можно было записать
 * руками, мимо операции, которая её порождает.
 */
create or replace function public.erp_roll_adjustment_add(
  p_roll_id uuid, p_kind text, p_before numeric, p_after numeric, p_delta numeric,
  p_cost numeric, p_reason text, p_report_id uuid, p_item_id uuid, p_qty_kg numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if coalesce(current_setting('erp.roll_adjust', true), '') <> 'on' then
    raise exception 'erp_roll_adjustment_add: корректировку пишет только операция с рулоном'
      using errcode = '42501';
  end if;
  insert into public.erp_material_roll_adjustments
    (roll_id, kind, before_m, after_m, delta_m, cost, reason, report_id, item_id, qty_kg, author, author_id)
  values
    (p_roll_id, p_kind, p_before, p_after, p_delta, p_cost, p_reason, p_report_id, p_item_id, p_qty_kg,
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.erp_roll_adjustment_add(uuid, text, numeric, numeric, numeric, numeric, text, uuid, uuid, numeric) from public, anon;
grant execute on function public.erp_roll_adjustment_add(uuid, text, numeric, numeric, numeric, numeric, text, uuid, uuid, numeric) to authenticated;

drop policy if exists erp_material_roll_adjustments_insert on public.erp_material_roll_adjustments;
revoke insert on public.erp_material_roll_adjustments from authenticated;
comment on table public.erp_material_roll_adjustments is
  'Корректировки метража рулона с причиной, автором и датой. Не прибавляются к расходу и браку. Писатель один — erp_roll_adjustment_add под меткой erp.roll_adjust (правка 28.09); правки и удаления нет';

-- ── Этап после участка с ролью (сборка) ───────────────────────────────────
create or replace function public.erp_stage_after_role(p_stage_id uuid, p_role text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  with recursive up(id, depth) as (
    select unnest(s.depends_on), 1 from public.erp_item_stages s where s.id = p_stage_id
    union
    select unnest(s.depends_on), up.depth + 1
      from up join public.erp_item_stages s on s.id = up.id
     where up.depth < 50
  )
  select exists (
    select 1 from up
      join public.erp_item_stages s on s.id = up.id
      join public.erp_departments d on d.id = s.department_id
     where d.cost_role = p_role
  );
$$;
comment on function public.erp_stage_after_role(uuid, text) is
  'Стоит ли этап после участка с данной ролью в себестоимости (по графу depends_on) — для стоимости брака и незавершёнки (правка 28.09)';
revoke execute on function public.erp_stage_after_role(uuid, text) from public, anon;
grant execute on function public.erp_stage_after_role(uuid, text) to authenticated;

-- ── Разбивка «не учтено» по размерам ──────────────────────────────────────
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
  )
  select string_agg(
           case when color = '—' then size else size || ' · ' || color end
             || ' — ' || rest || ' шт', ', ' order by ord)
    from left_
   where rest > 0;
$$;
comment on function public.erp_stage_unaccounted_by_size(uuid) is
  'Не учтено по размерам: принято по размеру − сдано годных − брак своими отчётами, «M — 60 шт, L · чёрный — 44 шт»; NULL без размерных данных (правка 28.09). Зеркало stageRemaining.sizeBreakdownText';
revoke execute on function public.erp_stage_unaccounted_by_size(uuid) from public, anon;
grant execute on function public.erp_stage_unaccounted_by_size(uuid) to authenticated;

-- ── Гейт завершения: программа — только при закрытии, разбивка в отказе ───
-- Двухаргументная сигнатура снята ещё в 20260928083215; повтор — no-op,
-- но сторож читает файл последнего определения
drop function if exists public.erp_stage_completion_block(uuid, int);
create or replace function public.erp_stage_completion_block(
  p_stage_id uuid,
  p_added_good int default 0,
  p_final boolean default false
)
returns text
language plpgsql
stable
set search_path = public as $$
declare
  v_stage  record;
  v_block  text;
  v_names  text;
  v_unacc  int;
  v_detail text;
begin
  select s.id, s.qty_done, s.result_kind,
         i.id as item_id, i.qty as item_qty, i.order_id,
         d.gate_material_kinds, d.result_fields, d.is_production
    into v_stage
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
    left join public.erp_departments d on d.id = s.department_id
   where s.id = p_stage_id;
  if v_stage.id is null then
    return null;
  end if;

  if p_final then
    -- 1. Программа вышивки раньше вышивки (п. 3). Только при ЗАКРЫТИИ:
    --    документ запрещает завершение, а не сдачу части результата
    --    (правка 28.09 — прежде сдача падала на этой ветке целиком)
    v_block := public.erp_stage_program_block(p_stage_id);
    if v_block is not null then
      return v_block;
    end if;

    -- 2. Судьба остатков рулонов (п. 2)
    v_block := public.erp_stage_rolls_fate_block(p_stage_id);
    if v_block is not null then
      return v_block;
    end if;

    -- 3. Не учтённые изделия (п. 7): производственный участок с формой
    --    результата; файловый результат изделий не имеет
    if coalesce(v_stage.is_production, false)
       and jsonb_typeof(v_stage.result_fields) = 'array'
       and jsonb_array_length(v_stage.result_fields) > 0
       and v_stage.result_kind is null
    then
      v_unacc := public.erp_stage_unaccounted(p_stage_id, p_added_good, 0);
      if coalesce(v_unacc, 0) > 0 then
        -- Число и предмет разведены: склонение в SQL не заводится.
        -- Разбивка по размерам — «показывать причину и размерную разбивку»
        -- (правка 28.09); порядок — как у принятого по размерам
        v_detail := public.erp_stage_unaccounted_by_size(p_stage_id);
        return 'Нельзя завершить этап: не учтено изделий — ' || v_unacc
          || coalesce(' (' || v_detail || ')', '')
          || '. Сдайте оставшиеся изделия или укажите окончательный брак.';
      end if;
    end if;
  end if;

  -- 4. Закупка (подлинное условие 20260904180307). Только у участка
  --    с материальным гейтом и только когда запись реально добирает тираж:
  --    частичная сдача при неприехавшем материале законна
  if coalesce(cardinality(v_stage.gate_material_kinds), 0) = 0 then
    return null;
  end if;
  if coalesce(v_stage.qty_done, 0) + coalesce(p_added_good, 0) < v_stage.item_qty then
    return null;
  end if;
  -- Снятие действует, пока проверку не вернули; глобальное (order_id
  -- is null) — на все заказы, узкое — на свой
  if exists (
    select 1 from public.erp_bypasses b
     where b.kind = 'material_gate'
       and b.restored_at is null
       and (b.order_id is null or b.order_id = v_stage.order_id)
  ) then
    return null;
  end if;
  -- Дословное зеркало `routes.materialPending`: со склада и «не требуется»
  -- годны без приёмки, пришедшее закупочное — только после неё
  select string_agg(m.name, ', ' order by m.name)
    into v_names
    from public.erp_materials m
   where m.order_id = v_stage.order_id
     and (m.item_id is null or m.item_id = v_stage.item_id)
     and coalesce(m.status, '') not in ('reserved', 'not_needed')
     and (coalesce(m.status, '') <> 'received'
          or coalesce(m.accept_status, '') not in ('accepted_full', 'accepted_partial'));
  if v_names is null then
    return null;
  end if;
  return 'Закупка не завершена: ' || v_names
    || '. Этап можно закрыть, когда материалы придут и склад их примет.';
end $$;

comment on function public.erp_stage_completion_block(uuid, int, boolean) is
  'Почему этап нельзя закрыть, или NULL: при p_final — программа вышивки (п. 3), судьба остатков рулонов (п. 2), не учтённые изделия с разбивкой по размерам (п. 7); закупка. Правки 27.09 и 28.09.';
revoke execute on function public.erp_stage_completion_block(uuid, int, boolean) from public, anon;
grant execute on function public.erp_stage_completion_block(uuid, int, boolean) to authenticated;

-- ── Судьба остатков: и рулоны других заказов, взятые этим ─────────────────
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
    || ' — отметьте «Остаток пригоден» или «Малый остаток, не учитывать».'
  end
  from pending;
$$;

-- ── Уточнение параметров рулона: вес, кг-строки в метрах ───────────────────
drop function if exists public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text);
create or replace function public.erp_material_roll_set_params(
  p_roll_id uuid,
  p_width_cm numeric default null,
  p_density_gsm numeric default null,
  p_length_m numeric default null,
  p_length_source text default null,
  p_reason text default null,
  p_weight_kg numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r          public.erp_material_rolls;
  v_mat      public.erp_materials;
  v_ops      int;
  v_spent_m  numeric;
  v_spent_kg numeric;
  v_cost_ops numeric;
  v_cost_unknown int;
  v_src      text;
  v_new_len  numeric;
  v_new_left numeric;
  v_before   numeric;
  v_left_kg  numeric;
  v_residual numeric;
  v_actor    text;
  v_actor_id uuid;
  v_calc     numeric;
  v_kg_only  numeric;
  v_k        numeric;
  v_others   numeric;
begin
  if not (public.erp_has_permission('material.receive')
          or public.erp_has_permission('stage.progress')
          or public.erp_has_permission('stage.complete')) then
    raise exception 'erp_material_roll_set_params: нужно право material.receive или stage.progress'
      using errcode = '42501';
  end if;

  select * into r from public.erp_material_rolls where id = p_roll_id for update;
  if not found then
    raise exception 'erp_material_roll_set_params: рулон не найден' using errcode = 'P0002';
  end if;
  select * into v_mat from public.erp_materials where id = r.material_id;

  if p_width_cm is not null and p_width_cm <= 0 then
    raise exception 'erp_material_roll_set_params: ширина должна быть больше нуля' using errcode = '22023';
  end if;
  if p_density_gsm is not null and p_density_gsm <= 0 then
    raise exception 'erp_material_roll_set_params: плотность должна быть больше нуля' using errcode = '22023';
  end if;
  if p_length_m is not null and p_length_m <= 0 then
    raise exception 'erp_material_roll_set_params: метраж должен быть больше нуля' using errcode = '22023';
  end if;
  /**
   * ЧИСТЫЙ ВЕС РУЛОНА (правка 28.09): «если есть метраж поставщика или замер,
   * отсутствие плотности не должно мешать учёту в метрах. Для связи
   * с закупкой в кг при этом нужен чистый вес рулона». Вес записывается
   * здесь только рулону БЕЗ веса (принятому до правки 21.09); сумма весов
   * партии не может превысить принятое. Записанный вес правит склад.
   */
  if p_weight_kg is not null then
    if p_weight_kg <= 0 then
      raise exception 'erp_material_roll_set_params: вес рулона должен быть больше нуля' using errcode = '22023';
    end if;
    if r.qty is not null and abs(r.qty - p_weight_kg) > 0.0005 then
      raise exception 'erp_material_roll_set_params: вес рулона уже записан (%) — поправить его может склад', r.qty
        using errcode = '22023';
    end if;
    if r.qty is null then
      select coalesce(sum(o.qty), 0) into v_others
        from public.erp_material_rolls o
       where o.material_id = r.material_id and o.id <> r.id;
      if v_mat.qty_received is not null and v_others + p_weight_kg > v_mat.qty_received + 0.01 then
        raise exception 'erp_material_roll_set_params: вес рулонов партии (%) больше принятого (%)',
          v_others + p_weight_kg, v_mat.qty_received using errcode = '22023';
      end if;
      update public.erp_material_rolls
         set qty = p_weight_kg, qty_left = coalesce(qty_left, p_weight_kg)
       where id = p_roll_id;
      r.qty := p_weight_kg;
    end if;
  end if;
  if p_length_m is not null and r.qty is null then
    raise exception 'erp_material_roll_set_params: укажите чистый вес рулона — без него метраж не связать с закупкой в кг'
      using errcode = '22023';
  end if;

  v_src := coalesce(nullif(btrim(coalesce(p_length_source, '')), ''), 'measured');
  if p_length_m is not null and v_src not in ('supplier', 'measured') then
    raise exception 'erp_material_roll_set_params: источник метража — supplier или measured'
      using errcode = '22023';
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;

  -- Параметры партии: переданные побеждают, остальное как было
  update public.erp_material_rolls
     set width_cm = coalesce(p_width_cm, width_cm),
         density_gsm = coalesce(p_density_gsm, density_gsm)
   where id = p_roll_id;

  -- Строки в кг без снимка стоимости оцениваются по цене кг рулона:
  -- иначе остаточная стоимость у рулона со старым расходом неизвестна
  select count(*), coalesce(sum(rr.length_used_m), 0), coalesce(sum(rr.qty_used), 0),
         coalesce(sum(coalesce(rr.cost,
           rr.qty_used * coalesce(r.price_per_unit, v_mat.price_per_unit))), 0),
         count(*) filter (where rr.cost is null
           and (rr.qty_used is null or coalesce(r.price_per_unit, v_mat.price_per_unit) is null)),
         coalesce(sum(rr.qty_used) filter (where rr.length_used_m is null), 0)
    into v_ops, v_spent_m, v_spent_kg, v_cost_ops, v_cost_unknown, v_kg_only
    from public.erp_stage_report_rolls rr
   where rr.roll_id = p_roll_id;

  if v_ops = 0 then
    -- До первого расхода: метраж переписывается, всё производное пересчитывается
    if p_length_m is not null then
      update public.erp_material_rolls
         set length_m = p_length_m, length_source = v_src
       where id = p_roll_id;
    end if;
    perform public.erp_roll_recalc(p_roll_id);
    select * into r from public.erp_material_rolls where id = p_roll_id;
    return jsonb_build_object(
      'roll_id', r.id, 'length_m', r.length_m, 'length_source', r.length_source,
      'kg_per_m', r.kg_per_m, 'price_per_m', r.price_per_m, 'length_left_m', r.length_left_m,
      'refined', false);
  end if;

  /**
   * ПОСЛЕ НАЧАЛА РАСХОДА. Новый полный метраж — переданный, либо (если
   * поменяли параметры у расчётного метража) пересчитанный по новым
   * параметрам. Прошлые операции остаются как записаны.
   */
  select * into r from public.erp_material_rolls where id = p_roll_id;
  if p_length_m is not null then
    v_new_len := p_length_m;
  elsif coalesce(r.length_source, 'calc') = 'calc' then
    v_calc := case when coalesce(r.qty, 0) > 0
                     and public.erp_fabric_kg_per_m(r.width_cm, r.density_gsm) is not null
                   then r.qty / public.erp_fabric_kg_per_m(r.width_cm, r.density_gsm) end;
    if v_calc is null then
      return jsonb_build_object('roll_id', r.id, 'refined', false);
    end if;
    v_new_len := v_calc;
    v_src := 'calc';
  else
    return jsonb_build_object('roll_id', r.id, 'refined', false);
  end if;

  /**
   * РАСХОД, ЗАПИСАННЫЙ В КГ (до 27.09), — тоже расход (правка 28.09).
   * Прежде уточнение считало израсходованным только `length_used_m`,
   * и у рулона со старыми строками в кг остаток в метрах выходил равным
   * полному метражу. Килограммы переводятся по коэффициенту НОВОГО метража:
   * вес / полный метраж (замер, поставщик), иначе ширина × плотность.
   */
  v_k := case when coalesce(r.qty, 0) > 0 and v_new_len > 0 then r.qty / v_new_len
              else public.erp_fabric_kg_per_m(r.width_cm, r.density_gsm) end;
  if v_kg_only > 0 and coalesce(v_k, 0) > 0 then
    v_spent_m := v_spent_m + v_kg_only / v_k;
  end if;

  v_new_left := v_new_len - v_spent_m;
  if v_new_left < -0.005 then
    raise exception 'erp_material_roll_set_params: уточнённый метраж % м меньше уже израсходованного % м',
      round(v_new_len, 2), round(v_spent_m, 2) using errcode = '22023';
  end if;
  v_new_left := greatest(v_new_left, 0);
  -- Рулон, впервые получающий метраж, «до» не имеет (правка 28.09)
  v_before := case when r.length_m is null then null
                   else coalesce(r.length_left_m, r.length_m - v_spent_m) end;

  perform set_config('erp.roll_adjust', 'on', true);
  perform public.erp_roll_adjustment_add(p_roll_id, 'length_refine', v_before, v_new_left,
    case when v_before is null then null else v_new_left - v_before end, null, nullif(btrim(coalesce(p_reason, '')), ''), null, null, null);

  -- Учётный остаток кг и остаточная стоимость (известна, если у всех операций есть стоимость)
  v_left_kg := case when r.qty is not null then greatest(r.qty - v_spent_kg, 0) end;
  v_residual := case
    when v_cost_unknown = 0 and coalesce(r.price_per_unit, v_mat.price_per_unit) is not null
         and r.qty is not null
      then r.qty * coalesce(r.price_per_unit, v_mat.price_per_unit) - v_cost_ops
  end;

  if v_new_left > 0 then
    update public.erp_material_rolls
       set length_m = v_new_len,
           length_source = v_src,
           length_calc_m = case when v_src = 'calc' then v_new_len else length_calc_m end,
           length_left_m = v_new_left,
           length_left_source = v_src,
           kg_per_m = case when v_left_kg is not null then v_left_kg / v_new_left else kg_per_m end,
           kg_per_m_source = case when v_left_kg is not null then 'refined' else kg_per_m_source end,
           price_per_m = case when v_residual is not null then greatest(v_residual, 0) / v_new_left
                              when v_left_kg is not null
                                   and coalesce(r.price_per_unit, v_mat.price_per_unit) is not null
                                then coalesce(r.price_per_unit, v_mat.price_per_unit) * v_left_kg / v_new_left
                              else price_per_m end,
           qty_left = coalesce(v_left_kg, qty_left)
     where id = p_roll_id;
  else
    -- Нулевой фактический остаток: остаточная стоимость — отдельной корректировкой
    update public.erp_material_rolls
       set length_m = v_new_len,
           length_source = v_src,
           length_calc_m = case when v_src = 'calc' then v_new_len else length_calc_m end,
           length_left_m = 0,
           length_left_source = v_src,
           qty_left = coalesce(v_left_kg, qty_left)
     where id = p_roll_id;
    if v_residual is not null and abs(v_residual) > 0.005 then
      perform public.erp_roll_adjustment_add(p_roll_id, 'cost_residual', v_before, 0,
        case when v_before is null then null else -v_before end,
        v_residual, 'Остаточная стоимость при нулевом остатке — на подтверждение', null, null, null);
    end if;
  end if;

  perform set_config('erp.roll_adjust', 'off', true);
  select * into r from public.erp_material_rolls where id = p_roll_id;
  return jsonb_build_object(
    'roll_id', r.id, 'length_m', r.length_m, 'length_source', r.length_source,
    'kg_per_m', r.kg_per_m, 'price_per_m', r.price_per_m, 'length_left_m', r.length_left_m,
    'refined', true);
end $function$;

comment on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text, numeric) is
  'Дозаполнение и уточнение ширины, плотности, метража и чистого веса рулона (правки 27.09, 28.09). До первого расхода — пересчёт; после — корректировка length_refine, расход в кг переводится в метры по новому коэффициенту';
revoke execute on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text, numeric) from public, anon;
grant execute on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text, numeric) to authenticated;

-- ── Место хранения ────────────────────────────────────────────────────────
create or replace function public.erp_material_roll_set_location(p_roll_id uuid, p_location text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.erp_has_permission('material.receive') or public.erp_has_permission('warehouse.manage')) then
    raise exception 'erp_material_roll_set_location: нужно право material.receive или warehouse.manage'
      using errcode = '42501';
  end if;
  update public.erp_material_rolls
     set location = nullif(btrim(coalesce(p_location, '')), '')
   where id = p_roll_id;
  if not found then
    raise exception 'erp_material_roll_set_location: рулон не найден' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.erp_material_roll_set_location(uuid, text) from public, anon;
grant execute on function public.erp_material_roll_set_location(uuid, text) to authenticated;

-- ── Судьба остатка рулона «в работе» — со списанием ───────────────────────
/**
 * Кнопки «Остаток пригоден» / «Малый остаток, не учитывать» у рулона,
 * оставленного «в работе» (правка 27.09, п. 2), писали прямой UPDATE вида —
 * без записи списания, и стоимость малого остатка терялась для позиции
 * («малый остаток списывается отдельно как непригодный, а не исчезает»).
 * Позиция списания — переданная, иначе последняя, кроившая рулон.
 */
create or replace function public.erp_roll_set_leftover(p_roll_id uuid, p_kind text, p_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r      public.erp_material_rolls;
  v_mat  public.erp_materials;
  v_item uuid;
  v_cost numeric;
  v_kg   numeric;
begin
  if not (public.erp_has_permission('stage.progress') or public.erp_has_permission('stage.complete')) then
    raise exception 'erp_roll_set_leftover: нужно право stage.progress или stage.complete' using errcode = '42501';
  end if;
  if p_kind not in ('usable', 'scrap') then
    raise exception 'erp_roll_set_leftover: вид остатка — usable или scrap' using errcode = '22023';
  end if;
  select * into r from public.erp_material_rolls where id = p_roll_id for update;
  if not found then
    raise exception 'erp_roll_set_leftover: рулон не найден' using errcode = 'P0002';
  end if;
  if r.leftover_kind is not null then
    raise exception '%: судьба остатка уже решена', r.label using errcode = '22023';
  end if;
  if r.status is distinct from 'in_use' then
    raise exception '%: судьбу остатка решают у рулона в работе', r.label using errcode = '22023';
  end if;
  if coalesce(r.length_left_m, r.qty_left, 0) <= 0.0005 then
    raise exception '%: остатка нет — решать нечего', r.label using errcode = '22023';
  end if;
  select * into v_mat from public.erp_materials where id = r.material_id;

  update public.erp_material_rolls
     set leftover_kind = p_kind, status = 'used'
   where id = p_roll_id;

  if p_kind = 'scrap' then
    v_item := coalesce(p_item_id, (select u.item_id from public.erp_fabric_usage(null) u
                                    where u.roll_id = p_roll_id order by u.at desc limit 1));
    v_kg := coalesce(r.qty_left, case when r.kg_per_m is not null then r.length_left_m * r.kg_per_m end);
    v_cost := case
      when r.length_left_m is not null and r.price_per_m is not null then r.length_left_m * r.price_per_m
      when v_kg is not null and coalesce(r.price_per_unit, v_mat.price_per_unit) is not null
        then v_kg * coalesce(r.price_per_unit, v_mat.price_per_unit) end;
    perform set_config('erp.roll_adjust', 'on', true);
    perform public.erp_roll_adjustment_add(p_roll_id, 'scrap_writeoff', r.length_left_m, r.length_left_m, 0,
      v_cost, 'Малый остаток списан как непригодный', null, v_item, v_kg);
    perform set_config('erp.roll_adjust', 'off', true);
  end if;
  return jsonb_build_object('roll_id', p_roll_id, 'leftover_kind', p_kind, 'item_id', v_item);
end $$;
revoke execute on function public.erp_roll_set_leftover(uuid, text, uuid) from public, anon;
grant execute on function public.erp_roll_set_leftover(uuid, text, uuid) to authenticated;

-- ── Подтверждение остаточной стоимости ────────────────────────────────────
/**
 * «При нулевом фактическом остатке остаточную стоимость вынести отдельной
 * корректировкой на подтверждение» — подтверждать было нечем, и расчёт
 * позиции оставался предварительным навсегда. Подтверждает держатель
 * `economics.view`; стоимость относится на позицию (переданную или
 * последнюю, кроившую рулон) и входит в её затраты.
 */
create or replace function public.erp_roll_adjustment_confirm(p_adjustment_id uuid, p_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.erp_material_roll_adjustments;
  v_item uuid;
begin
  if not public.erp_has_permission('economics.view') then
    raise exception 'erp_roll_adjustment_confirm: нужно право economics.view' using errcode = '42501';
  end if;
  select * into a from public.erp_material_roll_adjustments where id = p_adjustment_id for update;
  if not found then
    raise exception 'erp_roll_adjustment_confirm: корректировка не найдена' using errcode = 'P0002';
  end if;
  if a.kind <> 'cost_residual' then
    raise exception 'erp_roll_adjustment_confirm: подтверждается только остаточная стоимость' using errcode = '22023';
  end if;
  if a.confirmed_at is not null then
    return jsonb_build_object('adjustment_id', a.id, 'item_id', a.item_id, 'already', true);
  end if;
  v_item := coalesce(p_item_id, a.item_id, (select u.item_id from public.erp_fabric_usage(null) u
                                             where u.roll_id = a.roll_id order by u.at desc limit 1));
  update public.erp_material_roll_adjustments
     set confirmed_at = now(),
         confirmed_by = nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
         item_id = v_item
   where id = a.id;
  return jsonb_build_object('adjustment_id', a.id, 'item_id', v_item, 'already', false);
end $$;
revoke execute on function public.erp_roll_adjustment_confirm(uuid, uuid) from public, anon;
grant execute on function public.erp_roll_adjustment_confirm(uuid, uuid) to authenticated;

-- ── Остатки ткани по всем заказам ─────────────────────────────────────────
/**
 * Экран «Остатки ткани» собирал рулоны из заказов, загруженных в стор, —
 * без открытого архива только активные: остаток закрытого заказа пропадал
 * из раздела, хотя ткань лежит на складе. Теперь источник — сервер, и тот
 * же список предлагает закрою пригодный остаток ДРУГОГО заказа.
 */
create or replace function public.erp_fabric_leftovers()
returns table (
  roll_id uuid, label text, seq int, material_id uuid, material text, kind text, unit text,
  order_id uuid, order_title text, order_status text,
  width_cm numeric, density_gsm numeric,
  length_m numeric, length_left_m numeric, length_source text,
  qty numeric, qty_left numeric, kg_per_m numeric,
  price_per_unit numeric, price_per_m numeric,
  location text, status text, created_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select r.id, r.label, r.seq, m.id, coalesce(m.fact_name, m.name), m.kind, coalesce(r.unit, m.unit),
         o.id, o.title, o.status,
         coalesce(r.width_cm, m.width_cm), coalesce(r.density_gsm, m.density_gsm),
         r.length_m, r.length_left_m, coalesce(r.length_left_source, r.length_source),
         r.qty, r.qty_left, r.kg_per_m,
         coalesce(r.price_per_unit, m.price_per_unit), r.price_per_m,
         r.location, r.status, r.created_at
    from public.erp_material_rolls r
    join public.erp_materials m on m.id = r.material_id
    join public.erp_orders o on o.id = m.order_id
   where r.leftover_kind = 'usable'
     and r.status = 'used'
     and coalesce(r.length_left_m, r.qty_left, 0) > 0
     and (select public.erp_is_member())
   order by coalesce(m.fact_name, m.name), r.created_at;
$$;
comment on function public.erp_fabric_leftovers() is
  'Пригодные остатки ткани по всем заказам, включая закрытые (правка 28.09) — для экрана «Остатки ткани» и выбора остатка закроем';
revoke execute on function public.erp_fabric_leftovers() from public, anon;
grant execute on function public.erp_fabric_leftovers() to authenticated;

-- ── Сдача результата: чей рулон, взятый остаток, журнал через хелпер ──────
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
  p_assembly_cost numeric default null,
  p_client_key uuid default null
)
returns erp_item_stages
language plpgsql
set search_path to 'public'
as $function$
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
  v_grid    jsonb;
  v_roll_id uuid;
  v_used    numeric;
  v_cap     numeric;
  v_spent   numeric;
  v_left    numeric;
  v_kind    text;
  v_fin     boolean;
  v_over    boolean;
  v_input   jsonb;
  v_cell    record;
  v_cap_cell int;
  v_prior   int;
  v_label   text;
  -- Учёт в метрах (правка 27.09, п. 4)
  v_metres  boolean;
  v_len     numeric;
  v_meas    numeric;
  v_avail_m numeric;
  v_left_m  numeric;
  v_kpm     numeric;
  v_kpm_src text;
  v_ppm     numeric;
  v_cost    numeric;
  v_rollrec record;
  v_actor   text;
  v_actor_id uuid;
  v_order   uuid;
  v_reason  text;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  -- Повтор той же попытки: отчёт уже записан, материал уже списан — этап как есть
  if p_client_key is not null and exists (
    select 1 from public.erp_stage_reports r where r.client_key = p_client_key
  ) then
    select * into v_row from public.erp_item_stages where id = p_stage_id;
    return v_row;
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

  /**
   * ПОТОЛОК ПО РАЗМЕРУ — ОСТАТОК ИЗ ПРИНЯТЫХ (правка 27.09, п. 7).
   *
   * «Не давать сдать по размеру больше доступного остатка». Остаток =
   * принято по размеру (зеркало клиентского `sizeInputFor`: закрой сквозь
   * нанесение) − уже сдано годных − уже списано в брак СВОИМИ отчётами.
   * Текущая сдача считается целиком — сшито + брак + переделка: больше
   * изделий, чем есть на участке, тронуть нельзя.
   *
   * Закрой (`allows_over_plan`) под потолок не попадает — «плюсы» рождаются
   * там. Fail-open: без размерных данных во всей цепочке потолка нет —
   * тот же принцип, что у гейта ТЗ.
   */
  if v_sized and not v_rolled then
    select coalesce(d.allows_over_plan, false) into v_over
      from public.erp_item_stages s
      join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id;
    if not coalesce(v_over, false) then
      v_input := public.erp_stage_size_input(p_stage_id);
      if v_input is not null then
        for v_cell in
          select coalesce(nullif(btrim(r.color), ''), '—') as color,
                 btrim(r.size) as size,
                 coalesce(r.qty_good, 0) + coalesce(r.qty_defect, 0)
                   + coalesce(r.qty_rework, 0) as now_qty
            from jsonb_to_recordset(p_sizes)
              as r(color text, size text, qty_good int, qty_defect int, qty_rework int)
           where btrim(coalesce(r.size, '')) <> ''
        loop
          select coalesce((
            select (c->>'qty')::int
              from jsonb_array_elements(v_input) c
             where coalesce(nullif(btrim(c->>'color'), ''), '—') = v_cell.color
               and btrim(c->>'size') = v_cell.size
             limit 1), 0)
            into v_cap_cell;
          select coalesce(sum(z.qty_good + z.qty_defect), 0)
            into v_prior
            from public.erp_stage_report_sizes z
            join public.erp_stage_reports rp on rp.id = z.report_id
           where rp.stage_id = p_stage_id
             and coalesce(nullif(btrim(z.color), ''), '—') = v_cell.color
             and btrim(z.size) = v_cell.size;
          if v_prior + v_cell.now_qty > v_cap_cell then
            raise exception '%: больше % шт сдать нельзя — столько осталось из принятых (введено %)',
              case when v_cell.color = '—' then v_cell.size
                   else v_cell.size || ' · ' || v_cell.color end,
              greatest(v_cap_cell - v_prior, 0), v_cell.now_qty
              using errcode = 'check_violation';
          end if;
        end loop;
      end if;
    end if;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id, assembly_cost_per_unit, client_key)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     v_actor, v_actor_id,
     p_assembly_cost, p_client_key)
  returning id into v_report;

  if v_rolled then
    select s.item_id, i.order_id into v_item, v_order
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
     where s.id = p_stage_id;
    -- Журнал корректировок пишет только хелпер под этой меткой (правка 28.09)
    perform set_config('erp.roll_adjust', 'on', true);

    for v_roll in select value from jsonb_array_elements(p_rolls) loop
      v_roll_id := nullif(v_roll->>'roll_id', '')::uuid;
      /**
       * ДВА ПУТИ ЗАПИСИ РАСХОДА. Новый клиент шлёт `length_used_m` (правка
       * 27.09, п. 4) — расход в погонных метрах полной ширины; прежний бандл
       * и офлайн-очередь — `qty_used` в килограммах. Второй путь сохранён
       * без изменений: убрать его значило бы уронить накопленное на планшетах
       * в день выката, а старые строки в кг документ велит хранить.
       */
      v_len     := nullif(v_roll->>'length_used_m', '')::numeric;
      v_meas    := nullif(v_roll->>'leftover_measured_m', '')::numeric;
      v_metres  := v_len is not null;
      v_used    := case when v_metres then null else coalesce((v_roll->>'qty_used')::numeric, 0) end;
      v_fin     := coalesce((v_roll->>'finished')::boolean, false);
      v_kind    := nullif(v_roll->>'leftover', '');
      v_reason  := nullif(btrim(coalesce(v_roll->>'leftover_reason', '')), '');
      v_kpm := null; v_kpm_src := null; v_ppm := null; v_cost := null;
      v_left_m := null; v_avail_m := null; v_cap := null; v_label := null; v_spent := 0;

      if v_kind is not null and v_kind not in ('usable', 'scrap') then
        raise exception 'erp_stage_submit_report: неизвестный вид остатка «%»', v_kind
          using errcode = '22023';
      end if;

      if v_roll_id is not null then
        select r.qty, r.label, r.length_m, r.length_left_m, r.length_source,
               r.length_left_source, r.kg_per_m, r.kg_per_m_source, r.price_per_m,
               coalesce(r.price_per_unit, m.price_per_unit) as price_kg,
               coalesce((select sum(rr.qty_used) from public.erp_stage_report_rolls rr
                          where rr.roll_id = r.id), 0) as spent_kg,
               coalesce((select sum(rr.length_used_m) from public.erp_stage_report_rolls rr
                          where rr.roll_id = r.id), 0) as spent_m,
               r.status, r.leftover_kind, m.order_id as roll_order,
               exists (
                 select 1 from public.erp_stage_report_rolls rr2
                   join public.erp_stage_reports rp2 on rp2.id = rr2.report_id
                   join public.erp_item_stages s2 on s2.id = rp2.stage_id
                   join public.erp_order_items i2 on i2.id = s2.item_id
                  where rr2.roll_id = r.id and i2.order_id = v_order) as cut_here
          into v_rollrec
          from public.erp_material_rolls r
          left join public.erp_materials m on m.id = r.material_id
         where r.id = v_roll_id;
        v_cap   := v_rollrec.qty;
        v_label := v_rollrec.label;
        v_spent := v_rollrec.spent_kg;

        /**
         * ЧЕЙ РУЛОН (правка 28.09). Кроить можно с рулонов своего заказа
         * и с ПРИГОДНОГО ОСТАТКА любого заказа: «если рулон используется
         * в нескольких заказах, каждый следующий заказ получает только его
         * доступный остаток». Прежде сервер принадлежность не проверял вовсе:
         * через REST списывалось с любого рулона базы. Закрытый рулон без
         * пригодного остатка (израсходован, малый остаток) не открывается.
         */
        if v_rollrec.status = 'used' and v_rollrec.leftover_kind is distinct from 'usable' then
          raise exception '%: работа по рулону закончена — пригодного остатка для раскроя нет',
            coalesce(v_label, 'рулон') using errcode = '22023';
        end if;
        if v_rollrec.roll_order is distinct from v_order
           and not v_rollrec.cut_here
           and not (v_rollrec.status = 'used' and v_rollrec.leftover_kind = 'usable') then
          raise exception '%: рулон другого заказа — брать можно только пригодный остаток',
            coalesce(v_label, 'рулон') using errcode = '22023';
        end if;
      end if;

      if v_roll_id is not null and v_metres then
        /**
         * РАСХОД В МЕТРАХ (правка 27.09, п. 4). Без рабочего метража расход
         * не записывается: «пока нет рабочего метража, показывать „Не заполнены
         * данные для учёта в метрах" и не давать записать расход в метрах».
         * Это НЕ fail-open, как у веса в килограммах: там поле было
         * необязательным по решению документа, здесь документ требует
         * обратного, а закрой может дозаполнить параметры сам
         * (`erp_material_roll_set_params`).
         */
        if v_len <= 0 then
          raise exception 'erp_stage_submit_report: расход в метрах должен быть больше нуля'
            using errcode = '22023';
        end if;
        if v_rollrec.length_m is null then
          raise exception
            '%: Не заполнены данные для учёта в метрах — укажите ширину и плотность полотна или метраж рулона',
            coalesce(v_label, 'рулон') using errcode = '22023';
        end if;

        /**
         * ПОТОЛОК — ДОСТУПНЫЙ МЕТРАЖ, накопительно: «если рулон используется
         * в нескольких заказах, каждый следующий заказ получает только его
         * доступный остаток». Превышение — не молчаливая обрезка и не минус:
         * «предложить уточнить метраж рулона и подтвердить корректировку,
         * затем сохранить расход; отрицательный остаток не допускать».
         * Уточнение делает `erp_material_roll_set_params`, после него расход
         * проходит. Допуск 0.005 — округление ввода до сотых.
         */
        v_avail_m := coalesce(v_rollrec.length_left_m,
                              greatest(v_rollrec.length_m - v_rollrec.spent_m, 0));
        if v_len > v_avail_m + 0.005 then
          raise exception
            '%: доступно % м, а списывается % м — уточните метраж рулона или уменьшите расход',
            coalesce(v_label, 'рулон'),
            replace(round(v_avail_m, 2)::text, '.', ','),
            replace(round(v_len, 2)::text, '.', ',')
            using errcode = '22023';
        end if;

        -- Снимки операции: коэффициент, цена за метр и стоимость на момент сдачи
        v_kpm     := v_rollrec.kg_per_m;
        v_kpm_src := v_rollrec.kg_per_m_source;
        v_ppm     := coalesce(v_rollrec.price_per_m,
                              case when v_rollrec.price_kg is not null and v_kpm is not null
                                   then v_rollrec.price_kg * v_kpm end);
        v_used    := case when v_kpm is not null then v_len * v_kpm end;
        v_cost    := case when v_ppm is not null then v_len * v_ppm end;
        v_left_m  := greatest(v_avail_m - v_len, 0);

        if v_meas is not null then
          if v_meas < 0 then
            raise exception 'erp_stage_submit_report: измеренный остаток не может быть отрицательным'
              using errcode = '22023';
          end if;
          if not v_fin then
            raise exception '%: измеренный остаток указывается при завершении работы по рулону',
              coalesce(v_label, 'рулон') using errcode = '22023';
          end if;
        end if;

        /**
         * У ЗАКОНЧЕННОГО РУЛОНА С ОСТАТКОМ ВИД ОБЯЗАТЕЛЕН (правка 27.09, п. 2),
         * теперь в метрах: «при положительном остатке обязательно выбрать
         * „Остаток пригоден" или „Малый остаток, не учитывать"… При нуле
         * выбор не нужен». Остаток — измеренный, если его замерили.
         */
        if v_fin and v_kind is null and coalesce(v_meas, v_left_m) > 0.0005 then
          raise exception
            '%: остался % м — выберите «Остаток пригоден» или «Малый остаток, не учитывать»',
            coalesce(v_label, 'рулон'),
            replace(round(coalesce(v_meas, v_left_m), 2)::text, '.', ',')
            using errcode = '22023';
        end if;
      elsif v_roll_id is not null then
        /**
         * РАСХОД НЕ БОЛЬШЕ ПРИНЯТОГО ВЕСА (правка 21.09, п. 2): «фактический
         * расход не может быть больше принятого веса рулона». Считается
         * НАКОПИТЕЛЬНО: с рулона кроят в несколько заходов, и проверка
         * «эта сдача ≤ вес» пропустила бы 20 + 20 при рулоне в 25 кг.
         *
         * FAIL-OPEN у рулона без веса: сорок один рулон принят до правки,
         * и у них вес пуст. Останавливать на этом закрой значило бы остановить
         * цех из-за отсутствующего поля — то же правило, что у гейта ТЗ.
         */
        if v_cap is not null and v_spent + v_used > v_cap + 0.01 then
          raise exception
            'erp_stage_submit_report: с рулона уже израсходовано %, в нём %, а вы списываете ещё %',
            v_spent, v_cap, v_used using errcode = '22023';
        end if;

        /**
         * У ЗАКОНЧЕННОГО РУЛОНА С ОСТАТКОМ ВИД ОБЯЗАТЕЛЕН (правка 27.09, п. 2).
         * Клиент это требовал с 21.09, сервер — нет: через REST рулон
         * закрывался с остатком без судьбы, и на бою 27.09 вид не выбран
         * ни у одного из 60 рулонов. Fail-open у рулона без веса — остатка
         * у него не существует.
         */
        if v_fin and v_kind is null and v_cap is not null
           and v_cap - (v_spent + v_used) > 0.0005 then
          raise exception
            '%: остался % — выберите «Остаток пригоден» или «Малый остаток, не учитывать»',
            coalesce(v_label, 'рулон'),
            round(v_cap - (v_spent + v_used), 3)
            using errcode = '22023';
        end if;
      end if;

      insert into public.erp_stage_report_rolls
        (report_id, roll_id, material_id, qty_used, qty_source, unit, roll_finished,
         length_used_m, kg_per_m, kg_per_m_source, price_per_m, cost)
      values
        (v_report, v_roll_id,
         nullif(v_roll->>'material_id', '')::uuid,
         v_used,
         case when v_metres then 'calc' else 'entered' end,
         nullif(v_roll->>'unit', ''),
         v_fin,
         v_len, v_kpm, v_kpm_src, v_ppm, v_cost)
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

      /**
       * Вид остатка ставит закройщик («остаток пригоден» / «малый остаток,
       * не учитывать»), автоматического порога НЕТ ни в килограммах, ни
       * в метрах: документ прямо просит его не задавать. Нулевой остаток
       * вида не получает — решать нечего.
       */
      if v_roll_id is not null and v_metres then
        /**
         * ОСТАТОК В МЕТРАХ: «доступно на начало работы − расход по текущей
         * работе. Пока исходный метраж расчётный, остаток тоже обозначать
         * как расчётный. При завершении работы разрешить указать измеренный
         * остаток». Расхождение замера с расчётом — ОТДЕЛЬНОЙ корректировкой
         * с причиной, автором и датой: в расход и брак оно не попадает.
         * Килограммы остатка — расчётные (метры × коэффициент).
         */
        if v_meas is not null then
          perform public.erp_roll_adjustment_add(v_roll_id, 'leftover_measure', v_left_m, v_meas,
            v_meas - v_left_m, null,
            coalesce(v_reason, 'Замер остатка при завершении работы по рулону'),
            v_report, v_item, null);
          v_left_m := v_meas;
        end if;

        update public.erp_material_rolls r
           set length_left_m = v_left_m,
               length_left_source = case when v_meas is not null then 'measured'
                                         else coalesce(r.length_left_source, r.length_source) end,
               qty_left = case when v_kpm is not null then v_left_m * v_kpm else r.qty_left end,
               leftover_kind = case
                 when v_fin and v_left_m > 0.0005 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 -- Взятый в работу пригодный остаток снова «в работе»: его
                 -- судьбу решает тот, кто его взял (правка 28.09)
                 when r.status = 'used' then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status in ('in_stock', 'used') then 'in_use'
                             else r.status end
         where r.id = v_roll_id;

        /**
         * МАЛЫЙ ОСТАТОК «списывается отдельно как непригодный, а не исчезает
         * из учёта»: запись списания с ценой рулона относится к ТОЙ позиции,
         * к которой оформлена (правка 27.09, п. 8: «стоимость отдельно
         * списанного малого остатка относить на ту позицию, к которой
         * оформлено списание»). Сам рулон остаётся с остатком и видом `scrap`.
         */
        if v_fin and v_kind = 'scrap' and v_left_m > 0.0005 then
          perform public.erp_roll_adjustment_add(v_roll_id, 'scrap_writeoff', v_left_m, v_left_m, 0,
            case when v_ppm is not null then v_left_m * v_ppm end,
            'Малый остаток списан как непригодный', v_report, v_item,
            case when v_kpm is not null then v_left_m * v_kpm end);
        end if;
      elsif v_roll_id is not null then
        /**
         * ОСТАТОК РУЛОНА В КИЛОГРАММАХ (правка 21.09, п. 5) — прежний путь
         * для расхода, записанного в кг: «первоначальный вес минус
         * фактический расход». Считает СЕРВЕР — расход и остаток это одна
         * величина с двух сторон, и второй писатель развёл бы их молча.
         */
        v_left := case when v_cap is null then null
                       else greatest(v_cap - (v_spent + v_used), 0) end;

        update public.erp_material_rolls r
           set qty_left = coalesce(v_left, r.qty_left),
               leftover_kind = case
                 when v_fin and coalesce(v_left, 0) > 0 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 when r.status = 'used' then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status in ('in_stock', 'used') then 'in_use'
                             else r.status end
         where r.id = v_roll_id;

        /**
         * Малый остаток и в килограммах списывается записью, а не исчезает
         * (правка 28.09): прежде путь в кг ставил вид `scrap` без списания,
         * и стоимость остатка терялась для позиции.
         */
        if v_fin and v_kind = 'scrap' and coalesce(v_left, 0) > 0.0005 then
          perform public.erp_roll_adjustment_add(v_roll_id, 'scrap_writeoff', null, null, null,
            case when v_rollrec.price_kg is not null then v_left * v_rollrec.price_kg end,
            'Малый остаток списан как непригодный', v_report, v_item, v_left);
        end if;
      end if;
    end loop;
    perform set_config('erp.roll_adjust', 'off', true);

    /**
     * ПЛЮСЫ (правка 21.09, п. 3) — по строкам ТОЛЬКО ЧТО записанного отчёта.
     * Превышение считается от суммы сданного этим этапом против плана
     * позиции, а в строки попадает ПРИРОСТ превышения. Внутри ячейки плюс
     * достаётся тому рулону, на котором план кончился (порядок — по сквозному
     * номеру рулона). Размер вне сетки плюсом не считается.
     */
    select i.size_grid into v_grid
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
     where s.id = p_stage_id;

    if v_grid is not null and jsonb_typeof(v_grid) = 'array' then
      with plan as (
        select c.color, c.size, c.qty::numeric as qty
          from public.erp_size_grid_cells(v_grid) c
      ), prev as (
        select z.color, z.size, sum(z.qty_good)::numeric as qty
          from public.erp_stage_report_sizes z
          join public.erp_stage_reports r on r.id = z.report_id
         where r.stage_id = p_stage_id and r.id <> v_report
         group by 1, 2
      ), src as (
        select z.id, z.color, z.size, z.qty_good::numeric as qty, mr.seq
          from public.erp_stage_report_sizes z
          left join public.erp_stage_report_rolls rr on rr.id = z.report_roll_id
          left join public.erp_material_rolls mr on mr.id = rr.roll_id
         where z.report_id = v_report
      ), rows_now as (
        select s.id, s.color, s.size, s.qty,
               sum(s.qty) over (
                 partition by s.color, s.size order by s.seq nulls last, s.id
                 rows between unbounded preceding and current row
               ) as cum,
               sum(s.qty) over (partition by s.color, s.size) as cell_total
          from src s
      ), calc as (
        select
          n.id,
          greatest(coalesce(p.qty, 0) + n.cell_total - pl.qty, 0)
            - greatest(coalesce(p.qty, 0) - pl.qty, 0) as cell_extra,
          n.cum, n.qty, n.cell_total
          from rows_now n
          join plan pl on pl.color = n.color and pl.size = n.size
          left join prev p on p.color = n.color and p.size = n.size
      )
      update public.erp_stage_report_sizes z
         set qty_extra = greatest(
               least(c.cum, c.cell_total)
                 - greatest(c.cum - c.qty, c.cell_total - c.cell_extra), 0)
        from calc c
       where z.id = c.id and c.cell_extra > 0;

      update public.erp_stage_reports r
         set qty_extra = coalesce((
               select sum(z.qty_extra) from public.erp_stage_report_sizes z
                where z.report_id = v_report), 0)
       where r.id = v_report;
    end if;
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
    perform set_config('erp.assembly_cost', 'on', true);
    update public.erp_order_items
       set assembly_cost_per_unit = p_assembly_cost,
           assembly_cost_set_at = now(),
           assembly_cost_by = nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
     where id = v_item;
    perform set_config('erp.assembly_cost', 'off', true);
  end if;

  /**
   * ЗАКРЫТИЕ — ПО УЧТЁННОМУ, А НЕ ПО ТИРАЖУ (правка 27.09, п. 7).
   *
   * Прежнее `qty_done >= тираж` закрывало швейку на 368 сданных при 472
   * принятых (тираж 350 + плюс закроя): 104 изделия исчезали из учёта.
   * Теперь этап закрыт, когда не учтённых изделий не осталось:
   * `greatest(тираж, принято) − сдано годных − списано в брак ≤ 0`
   * (`erp_stage_unaccounted`; брак этого отчёта уже в журнале, поэтому
   * приращение — только годные). Переделка остаток не уменьшает —
   * она вернётся годными или браком в следующих сдачах.
   */
  /**
   * ЗАКРЫТИЕ ЗАКРОЯ ТРЕБУЕТ СУДЬБЫ КАЖДОГО ОСТАТКА (правка 27.09, п. 2):
   * рулон, оставленный «в работе» прежней сдачей, с остатком и без вида
   * не попадает ни в «Остатки ткани», ни в экономику. Проверяется только
   * когда эта сдача закрывает этап и в заказе не осталось других открытых
   * этапов того же участка (рулон мог ждать соседнюю позицию).
   */
  if public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0 then
    v_block := public.erp_stage_rolls_fate_block(p_stage_id);
    if v_block is not null then
      raise exception '%', v_block using errcode = 'P0001';
    end if;
  end if;

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, v_good, v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, v_rework),
         -- Незавершённая программа вышивки НЕ закрывает этап (правка 27.09,
         -- п. 3): факт записывается, статус остаётся — запрещён переход
         status = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
             then 'done' else s.status end,
         finished_at = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $function$;

revoke execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) from public, anon;
grant execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) to authenticated;

-- ── Расход полотна: годные с рулона ───────────────────────────────────────
drop function if exists public.erp_fabric_usage(uuid);
create or replace function public.erp_fabric_usage(p_item_id uuid default null)
returns table (
  report_roll_id uuid,
  report_id uuid,
  stage_id uuid,
  item_id uuid,
  order_id uuid,
  department_id uuid,
  product_type text,
  material_id uuid,
  material text,
  width_cm numeric,
  roll_id uuid,
  roll_label text,
  at timestamptz,
  report_good int,
  -- Годные, скроенные С ЭТОГО рулона в этой сдаче (строки размеров рулона):
  -- знаменатель среднего по материалу и ширине без задвоения (правка 28.09)
  roll_good int,
  -- Метры: введённые (длина операции) либо пересчитанные из кг по коэффициенту рулона
  metres numeric,
  -- Строка пересчитана из килограммов по коэффициенту рулона — «Расчёт»
  recalced boolean,
  -- Пересчитать не из чего: коэффициента у рулона нет — строка неполная
  incomplete boolean,
  kg numeric,
  price_per_m numeric,
  cost numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select rr.id, rep.id, s.id, i.id, i.order_id, s.department_id, i.product_type,
         coalesce(rr.material_id, ro.material_id),
         coalesce(m.fact_name, m.name),
         coalesce(ro.width_cm, m.width_cm),
         rr.roll_id, ro.label, rep.created_at, rep.qty_good,
         coalesce((select sum(z.qty_good) from public.erp_stage_report_sizes z
                    where z.report_roll_id = rr.id), 0)::int,
         u.metres,
         (rr.length_used_m is null and u.metres is not null),
         (u.metres is null),
         rr.qty_used,
         u.ppm,
         -- Стоимость: снимок операции; у пересчитанной строки — метры × цена
         -- за метр рулона; у непересчитанной — килограммы × цена за кг
         coalesce(rr.cost,
           case when u.metres is not null and u.ppm is not null then u.metres * u.ppm end,
           case when rr.qty_used is not null and coalesce(ro.price_per_unit, m.price_per_unit) is not null
                then rr.qty_used * coalesce(ro.price_per_unit, m.price_per_unit) end)
    from public.erp_stage_report_rolls rr
    join public.erp_stage_reports rep on rep.id = rr.report_id
    join public.erp_item_stages s on s.id = rep.stage_id
    join public.erp_departments d on d.id = s.department_id
    join public.erp_order_items i on i.id = s.item_id
    left join public.erp_material_rolls ro on ro.id = rr.roll_id
    left join public.erp_materials m on m.id = coalesce(rr.material_id, ro.material_id)
    cross join lateral (
      select
        case when rr.length_used_m is not null then rr.length_used_m
             when coalesce(rr.qty_used, 0) > 0 and coalesce(ro.kg_per_m, 0) > 0
               then rr.qty_used / ro.kg_per_m end as metres,
        coalesce(rr.price_per_m, ro.price_per_m,
          case when coalesce(ro.kg_per_m, 0) > 0
                 and coalesce(ro.price_per_unit, m.price_per_unit) is not null
               then coalesce(ro.price_per_unit, m.price_per_unit) * ro.kg_per_m end) as ppm
    ) u
   where d.cost_role = 'fabric'
     -- Отбор «основное полотно» fail-open (правило 20.09): `role` заполнена
     -- у одной строки из двадцати пяти
     and (m.id is null or m.role = 'main' or (m.role is null and m.kind = 'fabric'))
     and (p_item_id is null or i.id = p_item_id);
$$;

comment on function public.erp_fabric_usage(uuid) is
  'Расход полотна построчно в метрах (правка 27.09, п. 4): введённые метры либо пересчёт из кг по коэффициенту рулона (recalced), без коэффициента — incomplete; roll_good — годные с рулона (28.09). Один источник для аналитики и экономики';
revoke execute on function public.erp_fabric_usage(uuid) from public, anon;
grant execute on function public.erp_fabric_usage(uuid) to authenticated;

-- ── Разрез по моделям: фильтр «Изделие», годные без задвоения ─────────────
drop function if exists public.erp_analytics_fabric_by_sku(date, date, uuid);
create or replace function public.erp_analytics_fabric_by_sku(
  p_from date,
  p_to date,
  p_dept uuid default null,
  p_product text default null
)
returns table (
  product_type text,
  material text,
  width_cm numeric,
  fabric_m numeric,
  cut_good int,
  per_item numeric,
  calc boolean,
  incomplete boolean,
  orders int
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_fabric_by_sku: нужно право analytics.view' using errcode = '42501';
  end if;

  return query
  with rows_all as (
    select u.* from public.erp_fabric_usage(null) u
     where u.at >= p_from::timestamptz and u.at < (p_to + 1)::timestamptz
       and (p_dept is null or u.department_id = p_dept)
       -- Фильтр «Изделие» — тот же, что у сводки (правка 28.09)
       and (p_product is null or u.product_type = p_product)
  ), per_report as (
    -- Годные — СКРОЕННЫЕ С РУЛОНОВ ЭТОЙ ГРУППЫ, а не весь отчёт: отчёт
    -- с рулонами двух ширин прежде попадал годными целиком в обе группы
    select coalesce(r.product_type, '—') as product_type,
           coalesce(r.material, '—') as material,
           r.width_cm, r.report_id, r.order_id,
           sum(r.roll_good) as good,
           sum(r.metres) as metres,
           bool_or(r.incomplete) as incomplete,
           bool_or(r.recalced) as recalced
      from rows_all r
     group by 1, 2, 3, 4, 5
  )
  select p.product_type, p.material, p.width_cm,
         round(coalesce(sum(p.metres) filter (where not p.incomplete), 0), 2),
         coalesce(sum(p.good) filter (where not p.incomplete), 0)::int,
         -- Среднее через общие суммы, а не среднее из средних (документ)
         case when coalesce(sum(p.good) filter (where not p.incomplete), 0) > 0
              then round(sum(p.metres) filter (where not p.incomplete)
                         / sum(p.good) filter (where not p.incomplete), 4) end,
         coalesce(bool_or(p.recalced), false),
         coalesce(bool_or(p.incomplete), false),
         count(distinct p.order_id)::int
    from per_report p
   group by p.product_type, p.material, p.width_cm
   order by 4 desc;
end $$;

revoke execute on function public.erp_analytics_fabric_by_sku(date, date, uuid, text) from public, anon;
grant execute on function public.erp_analytics_fabric_by_sku(date, date, uuid, text) to authenticated, service_role;

-- ── Ряды: отметки «расчёт» и «неполно» ────────────────────────────────────
drop function if exists public.erp_analytics_series(date, date, text, text, uuid);
create or replace function public.erp_analytics_series(
  p_from date,
  p_to date,
  p_bucket text default 'day',
  p_product text default null,
  p_dept uuid default null
)
returns table (bucket date, released int, defect int, rework int, extra int, fabric numeric,
               fabric_calc boolean, fabric_incomplete boolean)
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
  -- Метры по отчётам закроя; отметки — как у сводки (правка 28.09):
  -- пересчитанные из кг строки и строки, которые пересчитать не из чего
  fab as (
    select date_trunc(p_bucket, u.at)::date as b,
           sum(u.metres) as metres,
           bool_or(u.recalced) as calc,
           bool_or(u.incomplete) as incomplete
      from public.erp_fabric_usage(null) u
     where u.at >= p_from::timestamptz
       and u.at < (p_to + 1)::timestamptz
       and (p_product is null or u.product_type = p_product)
       and (p_dept is null or u.department_id = p_dept)
     group by 1
  )
  select coalesce(rel.b, fab.b) as bucket,
         coalesce(sum(rel.qty_good), 0)::int,
         coalesce(sum(rel.qty_defect), 0)::int,
         coalesce(sum(rel.qty_rework), 0)::int,
         coalesce(sum(rel.qty_extra), 0)::int,
         round(coalesce(max(fab.metres), 0), 2),
         coalesce(bool_or(fab.calc), false),
         coalesce(bool_or(fab.incomplete), false)
    from rel
    full join fab on fab.b = rel.b
   group by coalesce(rel.b, fab.b)
   order by 1;
end $$;
revoke execute on function public.erp_analytics_series(date, date, text, text, uuid) from public, anon;
grant execute on function public.erp_analytics_series(date, date, text, text, uuid) to authenticated, service_role;

-- ── Экономика позиции ─────────────────────────────────────────────────────
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
  v_avg_m      numeric;
  v_residual   numeric;
  v_legacy_scrap jsonb := '[]'::jsonb;
  v_legacy_scrap_cost numeric;
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
   * СРЕДНИЙ РАСХОД — по тем же операциям (правка 28.09): метры строк
   * с метражом / годные, скроенные С ЭТИХ ЖЕ рулонов. Прежде метры делились
   * на всё выкроенное, включая сдачи без рулонов и непересчитанные строки,
   * и позиция расходилась с аналитикой.
   */
  select case when sum(u.roll_good) filter (where not u.incomplete) > 0
              then sum(u.metres) filter (where not u.incomplete)
                   / sum(u.roll_good) filter (where not u.incomplete) end
    into v_avg_m
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
           (select o.title from public.erp_orders o where o.id = m.order_id) as owner_order_title,
           ro.location,
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
           'owner_order_title', r.owner_order_title,
           'location', r.location,
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
           'length_m', case when a.before_m is null then null else round(a.before_m, 2) end,
           'kg', case when a.qty_kg is null then null else round(a.qty_kg, 3) end,
           'price_per_m', case when coalesce(a.before_m, 0) > 0 and a.cost is not null
                               then round(a.cost / a.before_m, 2) end,
           'cost', case when a.cost is null then null else round(a.cost, 2) end,
           'reason', a.reason, 'author', a.author, 'created_at', a.created_at,
           'report_id', a.report_id, 'calc', false
         ) order by a.created_at), '[]'::jsonb),
         sum(a.cost)
    into v_scrap, v_scrap_cost
    from public.erp_material_roll_adjustments a
    join public.erp_material_rolls ro on ro.id = a.roll_id
    left join public.erp_materials m on m.id = ro.material_id
   where a.kind = 'scrap_writeoff' and a.item_id = p_item_id;

  /**
   * МАЛЫЕ ОСТАТКИ ДО 28.09 — вид `scrap` без записи списания (путь в кг
   * и кнопка у рулона «в работе» писали только вид). Стоимость — оценка
   * по остатку и цене рулона («Расчёт»), относится к позиции, которая
   * кроила рулон последней.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'adjustment_id', null, 'roll_id', ro.id, 'label', ro.label,
           'material', coalesce(m.fact_name, m.name),
           'length_m', case when ro.length_left_m is null then null else round(ro.length_left_m, 2) end,
           'kg', case when ro.qty_left is null then null else round(ro.qty_left, 3) end,
           'price_per_m', case when ro.price_per_m is null then null else round(ro.price_per_m, 2) end,
           'cost', round(coalesce(ro.length_left_m * ro.price_per_m,
                                  ro.qty_left * coalesce(ro.price_per_unit, m.price_per_unit)), 2),
           'reason', 'Малый остаток (отмечен до 28.09, списание оценено)',
           'author', null, 'created_at', null, 'report_id', null, 'calc', true
         ) order by ro.seq), '[]'::jsonb),
         sum(coalesce(ro.length_left_m * ro.price_per_m,
                      ro.qty_left * coalesce(ro.price_per_unit, m.price_per_unit)))
    into v_legacy_scrap, v_legacy_scrap_cost
    from public.erp_material_rolls ro
    left join public.erp_materials m on m.id = ro.material_id
   where ro.leftover_kind = 'scrap'
     and coalesce(ro.length_left_m, ro.qty_left, 0) > 0
     and not exists (select 1 from public.erp_material_roll_adjustments a0
                      where a0.roll_id = ro.id and a0.kind = 'scrap_writeoff')
     and p_item_id = (select u.item_id from public.erp_fabric_usage(null) u
                       where u.roll_id = ro.id order by u.at desc limit 1);
  v_scrap := v_scrap || v_legacy_scrap;
  if v_legacy_scrap_cost is not null then
    v_scrap_cost := coalesce(v_scrap_cost, 0) + v_legacy_scrap_cost;
  end if;

  -- Подтверждённая остаточная стоимость рулона, отнесённая на позицию
  select sum(a.cost) into v_residual
    from public.erp_material_roll_adjustments a
   where a.kind = 'cost_residual' and a.confirmed_at is not null and a.item_id = p_item_id;

  -- Прочие корректировки рулонов, которые кроила эта позиция, — для раскрытия
  -- «до исходных записей»; `cost_residual` без подтверждения держит расчёт
  -- предварительным («неразобранные расхождения»)
  select coalesce(jsonb_agg(jsonb_build_object(
           'adjustment_id', a.id, 'roll_id', a.roll_id, 'label', ro.label, 'kind', a.kind,
           'before_m', a.before_m, 'after_m', a.after_m, 'delta_m', a.delta_m,
           'cost', a.cost, 'reason', a.reason, 'author', a.author, 'created_at', a.created_at,
           'confirmed_at', a.confirmed_at
         ) order by a.created_at), '[]'::jsonb),
         count(*) filter (where a.kind = 'cost_residual' and a.confirmed_at is null)
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
                  -- Сборка — только если брак возник на ней или после неё:
                  -- «последующие операции на эти изделия не начислять»
                  -- (правка 28.09; прежде хватало любой сдачи швейки)
                  + case when dep.cost_role = 'assembly'
                              or public.erp_stage_after_role(s.id, 'assembly')
                         then coalesce(v_asm_avg, 0) else 0 end
           end as unit_cost,
           (v_fabric_per_cut_cost is null
            or ((dep.cost_role = 'assembly' or public.erp_stage_after_role(s.id, 'assembly'))
                and v_asm_avg is null)) as unknown
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
       -- В РАБОТЕ — то, что уже пришло на участок или начато: этап, который
       -- ещё ждёт предшественника (`waiting`), и первый этап маршрута без
       -- единой сдачи изделий не держат — держат тираж, а он не незавершёнка
       and s.status <> 'waiting'
       and (s.status in ('in_progress', 'paused', 'blocked')
            or coalesce(cardinality(s.depends_on), 0) > 0
            or exists (select 1 from public.erp_stage_reports r0 where r0.stage_id = s.id))
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
           -- Накопленное на выполненных операциях: полотно, и сборка —
           -- у этапов после неё (правка 28.09)
           'cost', case when st.cost_role = 'fabric' or v_fabric_per_cut_cost is null then null
                        when public.erp_stage_after_role(st.id, 'assembly') and v_asm_avg is null then null
                        else round(greatest(coalesce(st.unaccounted, 0), 0)
                                   * (v_fabric_per_cut_cost
                                      + case when public.erp_stage_after_role(st.id, 'assembly')
                                             then v_asm_avg else 0 end), 2) end,
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

  /**
   * ПОЛОТНО НА ГОДНУЮ ЕДИНИЦУ — «после выпуска: затраты полотна по позиции /
   * фактический годный выпуск» (правка 28.09; прежде делили на годные сборки)
   */
  v_per_good := case when v_final_good > 0 and v_fabric_cost is not null
                     then round(v_fabric_cost / v_final_good, 2) end;

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
                             and v_residual is null
                        then null
                        else coalesce(v_fabric_cost, 0) + coalesce(v_scrap_cost, 0)
                             + coalesce(v_residual, 0) + coalesce(v_asm_total, 0) end;
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
      'avg_m_per_cut', case when v_avg_m is null then null else round(v_avg_m, 4) end
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
      'residual', case when v_residual is null then null else round(v_residual, 2) end,
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
