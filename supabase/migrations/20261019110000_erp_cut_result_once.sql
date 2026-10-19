-- ЗАКРОЙ: ВЫПУСК ОДИН РАЗ, РАСХОД ПО РУЛОНАМ, СТРАЖ РУЛОНОВ (правки 19.10, миграция C1)
--
-- Решения Р5–Р7, Р11 плана «Правки 19.10, часть A»:
--
-- 1. `erp_stage_submit_report` (подпись прежняя, тело — 20261008003410 с правками):
--    новая форма закроя шлёт годные ОДИН раз таблицей `p_sizes`, а рулоны —
--    только расходом (без размеров). Годные — из таблицы, строки выпуска пишутся
--    с `report_roll_id = null` ДО расчёта плюсов; плюсы считаются у любой
--    размерной сдачи закроя, и без рулонов («Сдать без списания», Р7). Без рулонов
--    брак, переделка и плюс берутся из `p_qty_*`, если строки их не несут
--    (зеркало `reportTotals.ts`). Рулоны сдачи блокируются (`for update`), повтор
--    рулона — 22023, `material_id` строки расхода — из рулона; рулон в кг — расход > 0.
--    Старый формат (размеры на рулоне) и повтор `p_client_key` — как раньше.
-- 2. Читатели `erp_fabric_usage` → `erp_analytics_fabric_by_sku`, `erp_item_economics`
--    пересоздаются: средний расход нового отчёта — метры + списание малого остатка
--    этой сдачи / годные отчёта того же цвета, что материал (без регистра, пробелов
--    и «ё/е»), иначе все годные сдачи («по всей позиции»); старые отчёты — по-старому
--    (`roll_good`). По материалу и по позиции — Σ/Σ, не среднее средних.
-- 3. `erp_material_roll_guard` — страж рулонов (Р11): метраж, вес, остаток, статус,
--    вид остатка и цены меняются только писателями-RPC (definer), сдачей закроя
--    (метки `erp.roll_adjust` / `erp.cut_submit`) или со складским правом
--    `warehouse.manage`. Прежде любой со `stage.progress` правил через REST метраж
--    любого рулона, а новая форма опирается на `length_left_m`.
--
-- Откат — supabase/rollout/r1910a/20261019110000_erp_cut_result_once_rollback.sql
-- (только `erp_stage_submit_report` прежним телом; читатели и страж остаются).

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
  v_fate_pending boolean := false;
  -- Выпуск один раз (правки 19.10, Р5): размеры на рулонах — старый формат
  v_roll_sized boolean;
  v_mat_id  uuid;
  v_dup     text;
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
  /**
   * ДВА ФОРМАТА СДАЧИ ПО РУЛОНАМ (правки 19.10, Р5). Старый — размеры
   * на рулоне («с рулона 12 скроено S 10, M 20»): прежний бандл и офлайн-
   * очередь, поведение не меняется. Новый — рулоны несут только расход,
   * а выпуск вводится ОДИН раз таблицей `p_sizes`: закройщик не делит
   * изделия по рулонам, которых в жизни не делит.
   */
  v_roll_sized := v_rolled and exists (
    select 1 from jsonb_array_elements(p_rolls) as r
     where jsonb_typeof(r->'sizes') = 'array' and jsonb_array_length(r->'sizes') > 0);
  select coalesce(d.allows_over_plan, false) into v_over
    from public.erp_item_stages s
    join public.erp_departments d on d.id = s.department_id
   where s.id = p_stage_id;

  /**
   * СТРОКИ ВЫПУСКА ПРОВЕРЯЮТСЯ ДО СЧЁТА. Отрицательное число в строке
   * без других чисел отбрасывалось бы вставкой (`> 0`) и при этом
   * уменьшало бы годные отчёта — запись и сумма разошлись бы молча.
   */
  if v_sized and not v_roll_sized then
    if exists (
      select 1 from jsonb_to_recordset(p_sizes)
        as r(qty_good int, qty_defect int, qty_rework int, qty_extra int)
       where least(coalesce(r.qty_good, 0), coalesce(r.qty_defect, 0),
                   coalesce(r.qty_rework, 0), coalesce(r.qty_extra, 0)) < 0
    ) then
      raise exception 'erp_stage_submit_report: количество по размеру не может быть отрицательным'
        using errcode = '22023';
    end if;
  end if;

  if v_roll_sized then
    select coalesce(sum((s->>'qty_good')::int), 0) into v_good
      from jsonb_array_elements(p_rolls) as r
      cross join lateral jsonb_array_elements(coalesce(r->'sizes', '[]'::jsonb)) as s;
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  elsif v_rolled then
    -- ВЫПУСК ОДИН РАЗ: годные — из таблицы выпуска, рулоны — только расход
    select coalesce(sum(r.qty_good), 0) into v_good
      from jsonb_to_recordset(case when v_sized then p_sizes else '[]'::jsonb end)
        as r(qty_good int);
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  elsif v_sized then
    /**
     * БРАК, ПЕРЕДЕЛКА И ПЛЮС БЕЗ РУЛОНОВ — поле за полем (ревизия A4).
     * Строки швейки несут все три числа (даже нулём) — они и задают сумму.
     * Строки закроя несут одно `qty_good`, и «Сдать без списания» (Р7)
     * теряла бы брак формы: число берётся из скаляра, если ни одна строка
     * его не несёт. Зеркало `reportTotals.ts` (`fromSizes`).
     */
    select coalesce(sum(r.qty_good), 0) into v_good
      from jsonb_to_recordset(p_sizes) as r(qty_good int);
    v_defect := case when exists (select 1 from jsonb_array_elements(p_sizes) e
                                  where coalesce(e->'qty_defect', 'null'::jsonb) <> 'null'::jsonb)
                     then (select coalesce(sum(r.qty_defect), 0)
                             from jsonb_to_recordset(p_sizes) as r(qty_defect int))
                     else coalesce(p_qty_defect, 0) end;
    v_rework := case when exists (select 1 from jsonb_array_elements(p_sizes) e
                                  where coalesce(e->'qty_rework', 'null'::jsonb) <> 'null'::jsonb)
                     then (select coalesce(sum(r.qty_rework), 0)
                             from jsonb_to_recordset(p_sizes) as r(qty_rework int))
                     else coalesce(p_qty_rework, 0) end;
    v_extra := case when exists (select 1 from jsonb_array_elements(p_sizes) e
                                 where coalesce(e->'qty_extra', 'null'::jsonb) <> 'null'::jsonb)
                    then (select coalesce(sum(r.qty_extra), 0)
                            from jsonb_to_recordset(p_sizes) as r(qty_extra int))
                    else coalesce(p_qty_extra, 0) end;
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
  if v_sized and not v_roll_sized then
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
    /**
     * ОДИН РУЛОН — ОДИН РАЗ В СДАЧЕ, И ПОД БЛОКИРОВКОЙ (правки 19.10, Р11).
     * Две сессии на один рулон обе читали «доступно 50 м» и обе списывали
     * по 50: остаток считался из прочитанного, а не из записанного. Теперь
     * рулоны сдачи блокируются заранее, в порядке id (без взаимной
     * блокировки двух сдач), и каждый читается заново под блокировкой —
     * вторая сессия видит остаток первой и получает отказ. Повтор рулона
     * в одной сдаче списал бы его дважды одним запросом.
     */
    select r->>'roll_id' into v_dup
      from jsonb_array_elements(p_rolls) as r
     where nullif(r->>'roll_id', '') is not null
     group by r->>'roll_id'
    having count(*) > 1
     limit 1;
    if v_dup is not null then
      raise exception 'erp_stage_submit_report: рулон указан в сдаче дважды'
        using errcode = '22023';
    end if;
    perform 1
       from public.erp_material_rolls r0
      where r0.id in (select nullif(r->>'roll_id', '')::uuid
                        from jsonb_array_elements(p_rolls) as r)
      order by r0.id
        for update;

    -- Журнал корректировок пишет только хелпер под этой меткой (правка 28.09)
    perform set_config('erp.roll_adjust', 'on', true);
    -- Страж рулонов пропускает запись остатка и статуса из сдачи закроя (19.10)
    perform set_config('erp.cut_submit', 'on', true);

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
      v_mat_id := nullif(v_roll->>'material_id', '')::uuid;

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
               r.material_id as roll_material,
               exists (
                 select 1 from public.erp_stage_report_rolls rr2
                   join public.erp_stage_reports rp2 on rp2.id = rr2.report_id
                   join public.erp_item_stages s2 on s2.id = rp2.stage_id
                   join public.erp_order_items i2 on i2.id = s2.item_id
                  where rr2.roll_id = r.id and i2.order_id = v_order) as cut_here
          into v_rollrec
          from public.erp_material_rolls r
          left join public.erp_materials m on m.id = r.material_id
         where r.id = v_roll_id
           for update of r;
        v_cap   := v_rollrec.qty;
        -- Материал строки расхода — материал рулона, а не слово клиента
        v_mat_id := v_rollrec.roll_material;
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
        if coalesce(v_used, 0) <= 0 then
          raise exception 'erp_stage_submit_report: расход в килограммах должен быть больше нуля'
            using errcode = '22023';
        end if;
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
         v_mat_id,
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
    perform set_config('erp.cut_submit', 'off', true);
  end if;

  /**
   * СТРОКИ ВЫПУСКА БЕЗ РУЛОНА (правки 19.10, Р5): `report_roll_id = null`.
   * И у швейки (как раньше), и у закроя нового формата — с рулонами
   * без размеров или без рулонов вовсе (Р7). Пишутся ДО плюсов: плюсы
   * считаются по строкам только что записанного отчёта.
   */
  if v_sized and not v_roll_sized then
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

  /**
   * Плюсы — у любой сдачи по рулонам и у любой размерной сдачи закроя
   * (`allows_over_plan`), в том числе без рулонов (Р7): выпуск сверх плана
   * рождается на закрое независимо от того, отмечены ли рулоны.
   */
  if v_rolled or (v_sized and coalesce(v_over, false)) then
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
  /**
   * ПРАВКА 05.10 (ошибка с боя 07.10): судьба остатков больше НЕ ОТМЕНЯЕТ
   * сдачу партии. Прежде отказ откатывал всю запись, а «Завершить рулон» —
   * с 05.10 отдельное действие — доступен только рулону, который уже
   * в работе: рулон закрывающей партии в работу так и не попадал, и закрой
   * нельзя было сдать вовсе (шесть отказов подряд у закройщицы). Теперь
   * партия записывается, а этап остаётся открытым, пока судьба остатков
   * не решена: «Завершить рулон», затем «Завершить этап» — его гейт
   * (`erp_stage_done_gate`) проверяет судьбу остатков тем же правилом.
   */
  v_fate_pending := public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
    and public.erp_stage_rolls_fate_block(p_stage_id) is not null;

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, v_good, v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, v_rework),
         -- Незавершённая программа вышивки НЕ закрывает этап (правка 27.09,
         -- п. 3): факт записывается, статус остаётся — запрещён переход
         status = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
                and not v_fate_pending
             then 'done' else s.status end,
         finished_at = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
                and not v_fate_pending
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $function$;

revoke execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) from public, anon;
grant execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) to authenticated;

-- ── Цвет для сравнения: без регистра, пробелов и «ё/е» (Р6) ────────────────
/**
 * Зеркало клиентского `colorKey` (`erp/utils/cutUsage.ts`): цвет строки выпуска
 * («черный») и цвет материала («Чёрный») — один цвет. Одна функция на читателей,
 * а не копия выражения по месту: копии расходятся в одном символе.
 */
create or replace function public.erp_color_key(p_color text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select replace(lower(regexp_replace(coalesce(p_color, ''), '\s+', '', 'g')), 'ё', 'е');
$$;

revoke execute on function public.erp_color_key(text) from public, anon;
grant execute on function public.erp_color_key(text) to authenticated;

-- ── Читатели расхода: пересоздание в зависимом порядке ─────────────────────
-- Возвращаемая таблица `erp_fabric_usage` меняется (новые колонки), поэтому
-- функции удаляются и создаются заново: сперва читатели, затем источник.
drop function if exists public.erp_item_economics(uuid);
drop function if exists public.erp_analytics_fabric_by_sku(date, date, uuid, text);
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
  -- Знаменатель среднего без задвоения. Старый отчёт — годные, скроенные С ЭТОГО
  -- рулона (28.09). Новый (19.10, Р6) — годные сдачи того же цвета, что материал,
  -- иначе все годные сдачи; относятся на ОДНУ строку материала в сдаче, у прочих 0
  roll_good int,
  -- Метры: введённые (длина операции) либо пересчитанные из кг по коэффициенту рулона
  metres numeric,
  -- Строка пересчитана из килограммов по коэффициенту рулона — «Расчёт»
  recalced boolean,
  -- Пересчитать не из чего: коэффициента у рулона нет — строка неполная
  incomplete boolean,
  kg numeric,
  price_per_m numeric,
  cost numeric,
  -- Откуда знаменатель: 'roll' — старый отчёт, 'color' — по цвету материала,
  -- 'item' — по всей позиции (совпадений цвета нет)
  good_scope text,
  -- Списанный малый остаток этого рулона в этой сдаче, м (только новый отчёт):
  -- входит в средний расход, в стоимость полотна — нет (он в списаниях позиции)
  scrap_m numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with base as (
    select rr.id as rr_id, rep.id as rep_id, s.id as stage_id, i.id as item_id, i.order_id,
           s.department_id, i.product_type,
           coalesce(rr.material_id, ro.material_id) as mat_id,
           coalesce(m.fact_name, m.name) as mat_name,
           coalesce(nullif(btrim(m.fact_color), ''), m.color) as mat_color,
           coalesce(ro.width_cm, m.width_cm) as width_cm,
           rr.roll_id, ro.label, rep.created_at, rep.qty_good as rep_good,
           -- Старый формат: у отчёта есть строки размеров, привязанные к рулону
           exists (select 1 from public.erp_stage_report_sizes z0
                    where z0.report_id = rep.id and z0.report_roll_id is not null) as old_fmt,
           coalesce((select sum(z.qty_good) from public.erp_stage_report_sizes z
                      where z.report_roll_id = rr.id), 0)::int as roll_good_old,
           u.metres,
           (rr.length_used_m is null and u.metres is not null) as recalced,
           (u.metres is null) as incomplete,
           rr.qty_used as kg,
           u.ppm,
           -- Стоимость: снимок операции; у пересчитанной строки — метры × цена
           -- за метр рулона; у непересчитанной — килограммы × цена за кг
           coalesce(rr.cost,
             case when u.metres is not null and u.ppm is not null then u.metres * u.ppm end,
             case when rr.qty_used is not null and coalesce(ro.price_per_unit, m.price_per_unit) is not null
                  then rr.qty_used * coalesce(ro.price_per_unit, m.price_per_unit) end) as cost
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
       and (p_item_id is null or i.id = p_item_id)
  ), shaped as (
    select b.*,
           case when b.old_fmt then null else
             (select sum(z.qty_good) from public.erp_stage_report_sizes z
               where z.report_id = b.rep_id and z.report_roll_id is null
                 and b.mat_color is not null
                 and public.erp_color_key(z.color) = public.erp_color_key(b.mat_color))
           end as color_good,
           row_number() over (partition by b.rep_id, b.mat_id order by b.incomplete, b.rr_id) as rn,
           case when b.old_fmt or b.roll_id is null then 0 else
             coalesce((select sum(a.before_m) from public.erp_material_roll_adjustments a
                        where a.kind = 'scrap_writeoff'
                          and a.report_id = b.rep_id
                          and a.roll_id = b.roll_id), 0)
           end as scrap_m
      from base b
  )
  select b.rr_id, b.rep_id, b.stage_id, b.item_id, b.order_id, b.department_id, b.product_type,
         b.mat_id, b.mat_name, b.width_cm, b.roll_id, b.label, b.created_at, b.rep_good,
         (case when b.old_fmt then b.roll_good_old
               when b.rn = 1 then coalesce(nullif(b.color_good, 0), b.rep_good, 0)
               else 0 end)::int,
         b.metres, b.recalced, b.incomplete, b.kg, b.ppm, b.cost,
         case when b.old_fmt then 'roll'
              when coalesce(b.color_good, 0) > 0 then 'color'
              else 'item' end,
         b.scrap_m
    from shaped b;
$$;

comment on function public.erp_fabric_usage(uuid) is
  'Расход полотна построчно в метрах (27.09, п. 4): recalced — пересчёт из кг, incomplete — без коэффициента. roll_good — знаменатель среднего: старый отчёт — годные с рулона (28.09), новый (19.10, Р6) — годные сдачи по цвету материала либо вся позиция (good_scope), на одну строку материала; scrap_m — списанный малый остаток сдачи. Один источник для аналитики и экономики';
revoke execute on function public.erp_fabric_usage(uuid) from public, anon;
grant execute on function public.erp_fabric_usage(uuid) to authenticated;

-- ── Разрез по моделям: средний с отходами новой сдачи ─────────────────────
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
    -- Годные — знаменатель строк этой группы (`roll_good` без задвоения),
    -- метры — расход и списание малого остатка новой сдачи (19.10, Р6)
    select coalesce(r.product_type, '—') as product_type,
           coalesce(r.material, '—') as material,
           r.width_cm, r.report_id, r.order_id,
           sum(r.roll_good) as good,
           sum(r.metres + r.scrap_m) as metres,
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

-- ── Экономика позиции: средний по материалу, отходы новой сдачи ──────────
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
  v_by_material jsonb := '[]'::jsonb;
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
   *
   * С 19.10 (Р5, Р6) у новой сдачи закроя знаменатель — годные сдачи того же
   * цвета, что материал (`roll_good` источника, без задвоения), а в числитель
   * входит и списанный малый остаток этой сдачи (`scrap_m`): «3 × 50 м,
   * остаток 12 м списан, годных 100» — это 1,00 м/шт, а не 0,88. Старые
   * отчёты — по-старому (`scrap_m` у них 0). Позиция — Σ/Σ, не среднее средних.
   */
  select case when sum(u.roll_good) filter (where not u.incomplete) > 0
              then sum(u.metres + u.scrap_m) filter (where not u.incomplete)
                   / sum(u.roll_good) filter (where not u.incomplete) end
    into v_avg_m
    from public.erp_fabric_usage(p_item_id) u;

  -- ПО МАТЕРИАЛУ (Р6): то же Σ/Σ отдельно для каждого материала позиции
  select coalesce(jsonb_agg(jsonb_build_object(
           'material_id', t.material_id, 'material', t.material,
           'metres', round(t.metres, 2), 'scrap_m', round(t.scrap_m, 2), 'good', t.good,
           'avg_m_per_cut', case when t.good > 0 then round((t.metres + t.scrap_m) / t.good, 4) end,
           'scope', t.scope
         ) order by t.material), '[]'::jsonb)
    into v_by_material
    from (
      select u.material_id, max(u.material) as material,
             coalesce(sum(u.metres) filter (where not u.incomplete), 0) as metres,
             coalesce(sum(u.scrap_m) filter (where not u.incomplete), 0) as scrap_m,
             coalesce(sum(u.roll_good) filter (where not u.incomplete), 0)::int as good,
             case when bool_or(u.good_scope = 'item') then 'item'
                  when bool_or(u.good_scope = 'color') then 'color'
                  else 'roll' end as scope
        from public.erp_fabric_usage(p_item_id) u
       group by u.material_id
    ) t;

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
      'avg_m_per_cut', case when v_avg_m is null then null else round(v_avg_m, 4) end,
      -- Средний по каждому материалу позиции (19.10, Р6)
      'by_material', v_by_material
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

-- ── Страж рулонов (Р11) ───────────────────────────────────────────────────
/**
 * РУЛОН ПРАВЯТ ПИСАТЕЛИ, А НЕ REST (правки 19.10, Р11).
 *
 * Политика `erp_material_rolls_update` открывает UPDATE всякому со
 * `stage.progress`/`stage.complete`: через REST любая закройщица переписывала
 * метраж, остаток, статус и цену ЛЮБОГО рулона базы. Новая форма закроя
 * опирается на `length_left_m` — «доступно на начало работы», — и правка его
 * мимо сдачи меняла бы и потолок расхода, и остатки, и экономику.
 *
 * Страж перечисляет ИСКЛЮЧЕНИЯ, а не охраняемые колонки: сравнивается снимок
 * строки без исключений, поэтому колонка, добавленная позже, защищена сразу.
 * Исключений нет — у клиента нет прямой записи рулона вовсе, все писатели
 * идут через RPC. Пропускаются:
 *   · писатели-RPC `security definer` (`erp_material_rolls_set_weights`,
 *     `erp_roll_recalc`, `erp_material_roll_set_params`, `erp_roll_set_leftover`,
 *     `erp_material_roll_set_location`): внутри них `current_user` — владелец,
 *     у клиента — `authenticated`; свои гейты прав у них внутри;
 *   · сдача закроя (`erp_stage_submit_report`, invoker) — метки
 *     `erp.roll_adjust` / `erp.cut_submit`, их ставит только сама функция;
 *   · склад — право `warehouse.manage`;
 *   · service role.
 * Сам страж — invoker: внутри definer `current_user` был бы владельцем всегда.
 */
create or replace function public.erp_material_roll_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_free constant text[] := array[]::text[];
begin
  if coalesce((select auth.role()), '') = 'service_role' then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (to_jsonb(new) - v_free) is not distinct from (to_jsonb(old) - v_free) then
    return new;
  end if;
  -- Родитель удалён: `receipt_id` уходит в NULL каскадом `on delete set null`
  -- (удаление поставки), это не правка рулона
  if new.receipt_id is null and old.receipt_id is not null
     and not exists (select 1 from public.erp_material_receipts p where p.id = old.receipt_id)
     and (to_jsonb(new) - 'receipt_id') = (to_jsonb(old) - 'receipt_id') then
    return new;
  end if;
  if coalesce(current_setting('erp.roll_adjust', true), '') = 'on'
     or coalesce(current_setting('erp.cut_submit', true), '') = 'on'
     or public.erp_has_permission('warehouse.manage') then
    return new;
  end if;
  raise exception 'erp_material_roll_guard: метраж, вес, остаток, статус и цену рулона меняют сдача закроя, уточнение метража или склад'
    using errcode = '42501';
end $function$;

revoke execute on function public.erp_material_roll_guard() from public, anon, authenticated;

create trigger erp_material_roll_guard
  before update on public.erp_material_rolls
  for each row execute function public.erp_material_roll_guard();
