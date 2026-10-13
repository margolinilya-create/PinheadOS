-- Четвёртая находка ревью безопасности (05.10) к потолку факта:
-- 1. при вставке вход считался по `new.depends_on` без проверки, что
--    предшественники — этапы ТОЙ ЖЕ позиции: ссылка на чужой этап с большим
--    фактом поднимала потолок;
-- 2. на UPDATE потолок брался из `erp_stage_input_qty(new.id)`, то есть
--    по СОХРАНЁННОЙ строке, и смена `depends_on`/`item_id` в том же UPDATE
--    его не меняла.
-- Теперь потолок один на оба случая и считается по НОВОЙ строке: только
-- предшественники той же позиции; ссылки есть, а своих этапов среди них
-- нет — потолок ноль. Проверка — при росте числа, выходе из `skipped`,
-- смене цеха, графа или позиции и при вставке с фактом. Отказ в функции
-- один (сторож stageFinishedAt.test.ts).
create or replace function public.erp_clamp_stage_qty()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_over_new  boolean;
  v_over_old  boolean;
  v_prod_new  boolean;
  v_prod_old  boolean;
  v_check     boolean;
  v_exempt    boolean;
  v_total     int;
  v_deps      uuid[];
  v_cap       int;
begin
  if new.qty_done < 0 then new.qty_done := 0; end if;
  if new.qty_rework < 0 then new.qty_rework := 0; end if;

  -- ПОТОЛОК ФАКТА — ВХОД ЭТАПА (правка 05.10): «цех не может сдать больше,
  -- чем получил». Когда проверять: число выросло, этап вышел из `skipped`,
  -- сменил цех, граф или позицию, либо вставлен сразу с фактом
  if tg_op = 'INSERT' then
    v_check := coalesce(new.qty_done, 0) > 0;
  else
    v_check := new.qty_done > coalesce(old.qty_done, 0)
            or (old.status = 'skipped' and new.status <> 'skipped')
            or new.department_id is distinct from old.department_id
            or new.depends_on is distinct from old.depends_on
            or new.item_id is distinct from old.item_id;
  end if;

  if v_check and coalesce(new.qty_done, 0) > 0 then
    select d.allows_over_plan, d.is_production into v_over_new, v_prod_new
      from erp_departments d where d.id = new.department_id;
    if tg_op = 'UPDATE' then
      select d.allows_over_plan, d.is_production into v_over_old, v_prod_old
        from erp_departments d where d.id = old.department_id;
    else
      v_over_old := v_over_new;
      v_prod_old := v_prod_new;
    end if;

    -- Прозрачность — из ДАННЫХ участка и статуса, а не из присланного
    -- `qty_passthrough`, и только если она была и осталась: склад,
    -- закупка, пропущенный этап. Неизвестный участок — с потолком
    v_exempt := (not coalesce(v_prod_old, true) and not coalesce(v_prod_new, true))
             or (new.status = 'skipped'
                 and (tg_op = 'INSERT' or old.status = 'skipped'))
             or (coalesce(v_over_old, false) and coalesce(v_over_new, false));

    if not v_exempt then
      select greatest(coalesce(i.qty, 0), 0) into v_total
        from erp_order_items i where i.id = new.item_id;
      v_deps := coalesce(new.depends_on, '{}');
      if cardinality(v_deps) = 0 then
        v_cap := coalesce(v_total, 0);
      else
        -- Только этапы ТОЙ ЖЕ позиции; своих среди ссылок нет — ноль
        v_cap := coalesce((
          select min(case when p.status = 'skipped' or p.qty_passthrough
                            then public.erp_stage_input_qty_d(p.id, 0)
                            else greatest(coalesce(p.qty_done, 0), 0) end)
            from erp_item_stages p
           where p.id = any (v_deps)
             and p.item_id = new.item_id
             and p.id <> new.id), 0);
      end if;
      -- Служебные переходы (перенос между цехами, приёмка подряда)
      -- закрывают этап по тиражу — у них большее из тиража и входа
      if coalesce(current_setting('erp.moving', true), '') = 'on'
         or coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on' then
        v_cap := greatest(coalesce(v_total, 0), v_cap);
      end if;
      if new.qty_done > v_cap then
        raise exception
          'Больше % шт на этом этапе сдать нельзя: столько передано с предыдущего этапа', v_cap
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.status = 'done' and new.finished_at is null then
    new.finished_at := now();
  elsif new.status in ('waiting', 'ready', 'in_progress', 'blocked')
        and new.finished_at is not null then
    new.finished_at := null;
  end if;

  return new;
end $$;

comment on function public.erp_clamp_stage_qty() is
  'Нормализация счётчиков этапа: не ниже нуля; факт не выше переданного с предыдущего этапа (правка 05.10) — потолок по НОВОЙ строке, только предшественники той же позиции; проверка при росте числа, выходе из skipped, смене цеха, графа или позиции и вставке с фактом; исключение — этап прозрачен до и после правки (непроизводственный участок, skipped) или участок с allows_over_plan; метки erp.moving / erp.subcontract_rollup — большее из тиража и входа. Здесь же инвариант finished_at.';
