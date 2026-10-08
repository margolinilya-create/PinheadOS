-- ЗАКРЫВАЮЩАЯ ПАРТИЯ ЗАКРОЯ ЗАПИСЫВАЕТСЯ (ошибка с боя 07.10, правка 05.10 п. 5)
--
-- `erp_stage_submit_report` отказывал всей сдаче, если она закрывала этап,
-- а у рулонов оставался остаток без решённой судьбы. С правки 05.10 судьбу
-- решает отдельное действие «Завершить рулон», и оно доступно только рулону
-- «в работе» — а рулон закрывающей партии в работу не попадал, потому что
-- сдача откатывалась. Закройщица получила «Не решена судьба остатка» шесть
-- раз на двух заказах и не могла сдать крой.
--
-- Теперь партия записывается всегда, а этап не закрывается, пока судьба
-- остатков не решена. Закрытие — «Завершить этап» после «Завершить рулон»:
-- `erp_stage_done_gate` → `erp_stage_completion_block(p_final)` проверяет
-- судьбу остатков тем же `erp_stage_rolls_fate_block`. Остальное в функции —
-- дословно версия 20260928182342.

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
