-- Третья находка ревью безопасности (05.10): исключение из потолка факта
-- считалось по НОВЫМ статусу и цеху. В одном UPDATE можно было поставить
-- `skipped` (или перевести этап в непроизводственный цех) и поднять
-- `qty_done`, а затем вернуть этап в работу — число ушло бы дальше без
-- проверки. Теперь исключение — только если этап прозрачен И ДО, И ПОСЛЕ
-- правки, а потолок проверяется и при выходе из `skipped`, и при смене цеха.
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
  v_exempt    boolean;
  v_cap       int;
  v_service   boolean;
begin
  if new.qty_done < 0 then new.qty_done := 0; end if;
  if new.qty_rework < 0 then new.qty_rework := 0; end if;

  -- ПОТОЛОК ФАКТА — ВХОД ЭТАПА (правка 05.10): «цех не может сдать больше,
  -- чем получил». Проверка — когда число выросло, этап вышел из `skipped`
  -- или сменил цех: два последних пути иначе проносили бы число, поднятое
  -- под прикрытием прозрачности
  if tg_op = 'UPDATE' and (
       new.qty_done > coalesce(old.qty_done, 0)
    or (old.status = 'skipped' and new.status <> 'skipped')
    or new.department_id is distinct from old.department_id)
  then
    select d.allows_over_plan, d.is_production into v_over_new, v_prod_new
      from erp_departments d where d.id = new.department_id;
    select d.allows_over_plan, d.is_production into v_over_old, v_prod_old
      from erp_departments d where d.id = old.department_id;

    -- Прозрачность — из ДАННЫХ участка и статуса, а не из присланного
    -- `qty_passthrough`, и только если она была и осталась: склад,
    -- закупка, пропущенный этап. Неизвестный участок — с потолком
    v_exempt := (not coalesce(v_prod_old, true) and not coalesce(v_prod_new, true))
             or (old.status = 'skipped' and new.status = 'skipped')
             or (coalesce(v_over_old, false) and coalesce(v_over_new, false));

    if not v_exempt then
      v_service := coalesce(current_setting('erp.moving', true), '') = 'on'
                or coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on';
      v_cap := public.erp_stage_input_qty(new.id);
      if v_service then
        select greatest(coalesce(i.qty, 0), v_cap)
          into v_cap
          from erp_order_items i where i.id = new.item_id;
      end if;
      if new.qty_done > v_cap then
        raise exception
          'Больше % шт на этом этапе сдать нельзя: столько передано с предыдущего этапа', v_cap
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- Вставка этапа сразу с фактом (кривой клиент, прямой REST) — тот же
  -- потолок: число, заведённое при создании, иначе ушло бы дальше без проверки
  if tg_op = 'INSERT' and coalesce(new.qty_done, 0) > 0 and new.status <> 'skipped' then
    select d.allows_over_plan, d.is_production into v_over_new, v_prod_new
      from erp_departments d where d.id = new.department_id;
    if not coalesce(v_over_new, false) and coalesce(v_prod_new, true) then
      -- Строки ещё нет (BEFORE INSERT): вход считается по `new.depends_on`
      -- тем же правилом, что в `erp_stage_input_qty_d`
      select greatest(coalesce(i.qty, 0), 0) into v_cap
        from erp_order_items i where i.id = new.item_id;
      v_cap := coalesce((
        select min(case when p.status = 'skipped' or p.qty_passthrough
                          then public.erp_stage_input_qty_d(p.id, 0)
                          else greatest(coalesce(p.qty_done, 0), 0) end)
          from erp_item_stages p
         where p.id = any (coalesce(new.depends_on, '{}'))), v_cap, 0);
      if coalesce(current_setting('erp.moving', true), '') = 'on'
         or coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on' then
        select greatest(coalesce(i.qty, 0), v_cap) into v_cap
          from erp_order_items i where i.id = new.item_id;
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
  'Нормализация счётчиков этапа: не ниже нуля; факт не выше переданного с предыдущего этапа (правка 05.10) — проверка при росте числа, выходе из skipped, смене цеха и вставке с фактом; исключение — этап прозрачен до и после правки (непроизводственный участок, skipped) или участок с allows_over_plan; метки erp.moving / erp.subcontract_rollup — потолок большее из тиража и входа. Здесь же инвариант finished_at.';
