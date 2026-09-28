-- ОСТАТОК ПРИ ЧАСТИЧНОЙ СДАЧЕ (правка заказчика 27.09, п. 7)
-- И СУДЬБА ОСТАТКА РУЛОНА (п. 2 — см. раздел про рулоны ниже).
--
-- ЧТО БЫЛО. «Выкроено и принято в пошив 472 изделия. После сдачи 368 сшитых
-- оставшиеся 104 пропали из учёта. Частичная сдача не должна закрывать весь
-- объём задачи». Этап закрывался по `qty_done >= тираж позиции`
-- (в `erp_stage_submit_report` и `erp_stage_report_progress`), а не по
-- принятому: тираж 350 + плюс закроя 122 = 472 принято, 368 ≥ 350 — `done`.
-- Потолка по размеру между сдачами не было вовсе: прежние сдачи этапа
-- форма не читала, сервер по размерам не сверял.
--
-- ЧТО ТЕПЕРЬ. Одна формула на клиенте и сервере:
--   не учтено = greatest(тираж, принято) − сдано годных − списано в брак.
--   · «принято» — `erp_stage_input_qty` (минимум по предшественникам);
--     `greatest` с тиражом нужен, потому что у предшественника В РАБОТЕ вход
--     ещё растёт, и закрывать по нему рано (тот же потолок, что
--     у `erp_clamp_stage_qty`);
--   · брак — сумма `qty_defect` по отчётам этапа (окончательный);
--   · переделка остаток НЕ уменьшает: изделие в переделке вернётся годным
--     или браком в следующей сдаче.
-- Этап закрывается сам, когда не учтено ≤ 0. Обычное завершение при
-- остатке > 0 у участков с формой результата запрещено (клиент —
-- `stageUnaccountedBlock`; серверное зеркало на прямом переходе в `done`
-- — следующей миграцией, вместе с остальными ветками гейта завершения).
--
-- ПО РАЗМЕРАМ: `erp_stage_size_input` — зеркало клиентского `sizeInputFor`
-- с обходом графа вверх (правка 6: закрой сквозь нанесение), остаток
-- по размеру = принято − прежние (годные + брак); сдача сверх остатка
-- отклоняется с числами.
--
-- Клиентские половины: `utils/stageRemaining.ts`, `utils/stageSizes.ts`;
-- сторож — `stageRemaining.test.ts`.

-- ── Размерный выход этапа: свой, а без своего — предков (минимум по веткам) ──
create or replace function public.erp_stage_size_output(p_stage_id uuid, p_depth int default 0)
returns jsonb
language plpgsql
stable
set search_path = public as $$
declare
  v_own   jsonb;
  v_deps  uuid[];
  v_dep   uuid;
  v_out   jsonb;
  v_outs  jsonb[] := '{}';
  v_keys  jsonb;
begin
  -- Защита от петли в графе: маршрут ацикличен по построению, но кривые
  -- данные не должны вешать сдачу
  if p_depth > 32 then
    return null;
  end if;

  select jsonb_agg(jsonb_build_object('color', t.color, 'size', t.size, 'qty', t.qty))
    into v_own
    from (
      select coalesce(nullif(btrim(z.color), ''), '—') as color,
             btrim(z.size) as size,
             sum(greatest(z.qty_good, 0))::int as qty
        from public.erp_stage_report_sizes z
        join public.erp_stage_reports r on r.id = z.report_id
       where r.stage_id = p_stage_id
       group by 1, 2
    ) t;
  if v_own is not null then
    return v_own;
  end if;

  select s.depends_on into v_deps from public.erp_item_stages s where s.id = p_stage_id;
  if v_deps is null or cardinality(v_deps) = 0 then
    return null;
  end if;

  foreach v_dep in array v_deps loop
    v_out := public.erp_stage_size_output(v_dep, p_depth + 1);
    if v_out is not null then
      v_outs := v_outs || v_out;
    end if;
  end loop;
  if cardinality(v_outs) = 0 then
    return null;
  end if;
  if cardinality(v_outs) = 1 then
    return v_outs[1];
  end if;

  -- МИНИМУМ по веткам, размер за размером: параллельные нанесения проходят
  -- одни и те же изделия; размер, которого нет в ветке, — ноль в ней
  with cells as (
    select distinct c->>'color' as color, c->>'size' as size
      from unnest(v_outs) o
      cross join lateral jsonb_array_elements(o) c
  ), per_branch as (
    select cells.color, cells.size, n.i,
           coalesce((
             select (c->>'qty')::int
               from jsonb_array_elements(v_outs[n.i]) c
              where c->>'color' = cells.color and c->>'size' = cells.size
              limit 1), 0) as qty
      from cells
      cross join generate_series(1, cardinality(v_outs)) as n(i)
  )
  select jsonb_agg(elem)
    into v_keys
    from (
      select jsonb_build_object('color', color, 'size', size, 'qty', min(qty)) as elem
        from per_branch
       group by color, size
    ) g;
  return v_keys;
end $$;

comment on function public.erp_stage_size_output(uuid, int) is
  'Размерный выход этапа: сумма qty_good его отчётов по (цвет, размер); без своих размерных строк — выход предшественников, минимум по веткам, вверх по графу (правка 27.09, пп. 6–7). NULL — разбивки нет во всей цепочке. Зеркало клиентского utils/stageSizes.';

-- ── Принято на этап по размерам: минимум по прямым предшественникам ──
create or replace function public.erp_stage_size_input(p_stage_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public as $$
declare
  v_deps uuid[];
  v_dep  uuid;
  v_out  jsonb;
  v_outs jsonb[] := '{}';
  v_res  jsonb;
begin
  select s.depends_on into v_deps from public.erp_item_stages s where s.id = p_stage_id;
  if v_deps is null or cardinality(v_deps) = 0 then
    return null;
  end if;
  foreach v_dep in array v_deps loop
    v_out := public.erp_stage_size_output(v_dep, 1);
    if v_out is not null then
      v_outs := v_outs || v_out;
    end if;
  end loop;
  if cardinality(v_outs) = 0 then
    return null;
  end if;
  if cardinality(v_outs) = 1 then
    return v_outs[1];
  end if;
  with cells as (
    select distinct c->>'color' as color, c->>'size' as size
      from unnest(v_outs) o
      cross join lateral jsonb_array_elements(o) c
  ), per_branch as (
    select cells.color, cells.size, n.i,
           coalesce((
             select (c->>'qty')::int
               from jsonb_array_elements(v_outs[n.i]) c
              where c->>'color' = cells.color and c->>'size' = cells.size
              limit 1), 0) as qty
      from cells
      cross join generate_series(1, cardinality(v_outs)) as n(i)
  )
  select jsonb_agg(elem)
    into v_res
    from (
      select jsonb_build_object('color', color, 'size', size, 'qty', min(qty)) as elem
        from per_branch
       group by color, size
    ) g;
  return v_res;
end $$;

comment on function public.erp_stage_size_input(uuid) is
  'Принято на этап по (цвет, размер): минимум по размерным выходам прямых предшественников (erp_stage_size_output). NULL — размерных данных нет (fail-open). Зеркало клиентского sizeInputFor (правка 27.09, п. 7).';

revoke execute on function public.erp_stage_size_output(uuid, int) from public, anon;
revoke execute on function public.erp_stage_size_input(uuid) from public, anon;
grant execute on function public.erp_stage_size_output(uuid, int) to authenticated;
grant execute on function public.erp_stage_size_input(uuid) to authenticated;

-- ── Окончательный брак этапа — сумма по его отчётам ──
create or replace function public.erp_stage_defect_reported(p_stage_id uuid)
returns int
language sql
stable
set search_path = public as $$
  select coalesce(sum(greatest(r.qty_defect, 0)), 0)::int
    from public.erp_stage_reports r
   where r.stage_id = p_stage_id;
$$;
revoke execute on function public.erp_stage_defect_reported(uuid) from public, anon;
grant execute on function public.erp_stage_defect_reported(uuid) to authenticated;

-- ── Не учтено на этапе: потолок минус сдано минус брак ──
--
-- `security definer`, потому что `erp_stage_input_qty` отозвана у REST
-- (20260915224637) и вызывающей RPC (invoker) недоступна. Гейт внутри —
-- членство в ERP: число про этап, и чужому оно не отдаётся.
create or replace function public.erp_stage_unaccounted(
  p_stage_id uuid,
  p_added_good int default 0,
  p_added_defect int default 0
)
returns int
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_qty   int;
  v_done  int;
  v_input int;
begin
  if not public.erp_is_member() then
    return null;
  end if;
  select greatest(coalesce(i.qty, 0), 0), greatest(coalesce(s.qty_done, 0), 0)
    into v_qty, v_done
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
  if v_qty is null then
    return null;
  end if;
  v_input := coalesce(public.erp_stage_input_qty(p_stage_id), v_qty);
  return greatest(v_qty, v_input)
       - (v_done + coalesce(p_added_good, 0))
       - (public.erp_stage_defect_reported(p_stage_id) + coalesce(p_added_defect, 0));
end $$;

comment on function public.erp_stage_unaccounted(uuid, int, int) is
  'Сколько изделий на этапе ещё не учтено: greatest(тираж, принято) − сдано годных − списано в брак (с приращениями текущей сдачи). ≤ 0 — этап можно закрыть; переделка остаток не уменьшает. Одна формула с клиентским utils/stageRemaining.stageUnaccounted (правка 27.09, п. 7).';

revoke execute on function public.erp_stage_unaccounted(uuid, int, int) from public, anon;
grant execute on function public.erp_stage_unaccounted(uuid, int, int) to authenticated;

-- ── Программа вышивки раньше вышивки (правка 27.09, п. 3) ──
--
-- По вышивке заводятся два этапа одного участка: разработка программы
-- (`result_kind = 'embroidery_program'`, зависимости в графе нет намеренно —
-- крой она не держит) и сама вышивка. Завершение граф не проверял, и
-- «Вышивку» можно было закрыть при незавершённой программе. Сравниваются
-- этапы ТОЙ ЖЕ позиции и того же участка — программа другой позиции
-- ограничение не снимает. `skipped` считается завершением. Зеркало
-- клиентского `stageResult.embroideryProgramBlock`.
create or replace function public.erp_stage_program_block(p_stage_id uuid)
returns text
language sql
stable
set search_path = public as $$
  select case when exists (
    select 1
      from public.erp_item_stages s
      join public.erp_item_stages p
        on p.item_id = s.item_id
       and p.department_id = s.department_id
       and p.id <> s.id
     where s.id = p_stage_id
       and s.result_kind is null
       and p.result_kind = 'embroidery_program'
       and p.status not in ('done', 'skipped')
  ) then 'Сначала завершите задачу “Разработка программы вышивки”' else null end;
$$;

comment on function public.erp_stage_program_block(uuid) is
  'Почему вышивку нельзя закрыть, или NULL: незавершённая «Разработка программы вышивки» той же позиции и того же участка (правка 27.09, п. 3). Зеркало клиентского stageResult.embroideryProgramBlock.';

revoke execute on function public.erp_stage_program_block(uuid) from public, anon;
grant execute on function public.erp_stage_program_block(uuid) to authenticated;

-- ── Судьба остатков рулонов при закрытии закроя (правка 27.09, п. 2) ──
--
-- Рулон со статусом «в работе», остатком и без вида остатка после закрытия
-- последнего этапа участка в заказе повисает: «Остатки ткани» показывают
-- только `usable`, экономика — тоже. Пока в заказе открыт другой этап того же
-- участка (соседняя позиция кроится с того же рулона), решать рано.
-- Fail-open у рулона без веса — остатка у него не существует.
-- Слова совпадают с клиентским `cutRolls.rollsFateBlock`.
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
  pending as (
    select r.label, r.qty_left, coalesce(r.unit, m.unit) as unit, r.seq
      from me
      join public.erp_materials m on m.order_id = me.order_id
      join public.erp_material_rolls r on r.material_id = m.id
     where me.result_detail = 'rolls'
       and not exists (select 1 from others_open)
       and r.status = 'in_use'
       and coalesce(r.qty_left, 0) > 0
       and r.leftover_kind is null
  )
  select case when count(*) = 0 then null else
    'Не решена судьба остатка: '
    || string_agg(label || ' (' || qty_left || coalesce(' ' || unit, '') || ')', ', ' order by seq)
    || ' — отметьте «Остаток пригоден» или «Малый остаток, не учитывать».'
  end
  from pending;
$$;

comment on function public.erp_stage_rolls_fate_block(uuid) is
  'Почему закрой нельзя закрыть по рулонам, или NULL: рулоны заказа «в работе» с остатком и без вида, когда других открытых этапов участка в заказе нет. Зеркало клиентского cutRolls.rollsFateBlock (правка 27.09, п. 2).';

revoke execute on function public.erp_stage_rolls_fate_block(uuid) from public, anon;
grant execute on function public.erp_stage_rolls_fate_block(uuid) to authenticated;

-- ── Сдача результата: потолок по размеру и закрытие по учтённому ──
-- Подлинный текст `20260921214250` с двумя вставками (см. шапку).
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
  p_assembly_cost numeric default null
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

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id, assembly_cost_per_unit)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
     p_assembly_cost)
  returning id into v_report;

  if v_rolled then
    for v_roll in select value from jsonb_array_elements(p_rolls) loop
      v_roll_id := nullif(v_roll->>'roll_id', '')::uuid;
      v_used    := coalesce((v_roll->>'qty_used')::numeric, 0);
      v_fin     := coalesce((v_roll->>'finished')::boolean, false);
      v_kind    := nullif(v_roll->>'leftover', '');

      if v_kind is not null and v_kind not in ('usable', 'scrap') then
        raise exception 'erp_stage_submit_report: неизвестный вид остатка «%»', v_kind
          using errcode = '22023';
      end if;

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
      if v_roll_id is not null then
        select r.qty, r.label, coalesce((
                 select sum(rr.qty_used) from public.erp_stage_report_rolls rr
                  where rr.roll_id = r.id), 0)
          into v_cap, v_label, v_spent
          from public.erp_material_rolls r where r.id = v_roll_id;

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
        (report_id, roll_id, material_id, qty_used, unit, roll_finished)
      values
        (v_report, v_roll_id,
         nullif(v_roll->>'material_id', '')::uuid,
         v_used,
         nullif(v_roll->>'unit', ''),
         v_fin)
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
       * ОСТАТОК РУЛОНА (правка 21.09, п. 5): «система автоматически считает
       * остаток рулона: первоначальный вес минус фактический расход».
       * Считает СЕРВЕР — расход и остаток это одна величина с двух сторон,
       * и второй писатель развёл бы их молча.
       *
       * Вид остатка ставит закройщик («остаток пригоден» / «малый остаток,
       * не учитывать»), автоматического порога в килограммах НЕТ: документ
       * прямо просит его не задавать. Нулевой остаток вида не получает —
       * решать нечего.
       */
      if v_roll_id is not null then
        v_left := case when v_cap is null then null
                       else greatest(v_cap - (v_spent + v_used), 0) end;

        update public.erp_material_rolls r
           set qty_left = coalesce(v_left, r.qty_left),
               leftover_kind = case
                 when v_fin and coalesce(v_left, 0) > 0 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status = 'in_stock' then 'in_use'
                             else r.status end
         where r.id = v_roll_id;
      end if;
    end loop;

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

-- ── Частичная готовность: то же правило закрытия ──
-- Подлинный текст `20260810180000`, изменено только условие `done`.
create or replace function public.erp_stage_report_progress(p_stage_id uuid, p_qty int)
returns public.erp_item_stages
language plpgsql set search_path = public as $$
declare
  v_total int;
  v_next  int;
  v_row   public.erp_item_stages;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'erp_stage_report_progress: количество должно быть больше нуля'
      using errcode = '22023';
  end if;

  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_report_progress: этап не найден'
      using errcode = 'P0002';
  end if;

  select public.erp_clamp_done(s.qty_done, p_qty, v_total)
    into v_next
    from public.erp_item_stages s
   where s.id = p_stage_id
     for update;
  if v_next is null then
    raise exception 'erp_stage_report_progress: этап не найден'
      using errcode = 'P0002';
  end if;

  -- Закрытие по учтённому (правка 27.09, п. 7): принято с плюсом закроя
  -- сдаётся целиком, а не до тиража
  update public.erp_item_stages s
     set qty_done    = v_next,
         status      = case when public.erp_stage_unaccounted(p_stage_id, p_qty, 0) <= 0
                                 and public.erp_stage_program_block(p_stage_id) is null
                            then 'done' else s.status end,
         finished_at = case when public.erp_stage_unaccounted(p_stage_id, p_qty, 0) <= 0
                                 and public.erp_stage_program_block(p_stage_id) is null
                            then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $$;
revoke execute on function public.erp_stage_report_progress(uuid, int) from public, anon;
grant execute on function public.erp_stage_report_progress(uuid, int) to authenticated;

comment on function public.erp_stage_report_progress(uuid, int) is
  'Частичная готовность приращением: qty_done += N; этап закрывается, когда не учтённых изделий не осталось (erp_stage_unaccounted), а не по тиражу (правка 27.09, п. 7).';
