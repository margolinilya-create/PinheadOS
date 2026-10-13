-- `erp_analytics_by_dept` отдаёт `done_qty` вместо `released`
-- (код-ревью 23.09, находка 13).
--
-- ПОВЕДЕНИЕ НЕ МЕНЯЕТСЯ — меняется только имя колонки в результате.
--
-- ЧТО БЫЛО НЕ ТАК. Из четырёх сводок аналитики три берут выпуск из общей
-- `erp_analytics_released` — ровно как требует правило «выпуск определён ОДНОЙ
-- функцией». Четвёртая, сводка по цехам, считает свою колонку `released`
-- как `sum(qty_good)` по ВСЕМ этапам, а не только терминальным. Это верно
-- и намеренно: вопрос сводки — «где возникает брак», и ответ даёт каждый цех,
-- поэтому изделие учитывается в каждом участке, через который прошло.
--
-- Дефект был в МЕТКЕ. Одно и то же имя `released` несло в этой функции
-- величину, которая больше выпуска в разы. Интерфейс называл её честно
-- («Сдано, шт» против «Выпущено, шт» в соседней таблице), но на стороне SQL
-- разницы не было видно, и сложить две колонки или построить на них общую
-- сводку — естественная ошибка следующего читателя. Правило проекта
-- предупреждает ровно об этом: «плитка разойдётся с таблицей молча
-- и навсегда».
--
-- `drop` перед `create` обязателен: `create or replace` не меняет имена
-- выходных колонок у функции, возвращающей `table(...)`, и молча оставил бы
-- прежнюю сигнатуру.

drop function if exists public.erp_analytics_by_dept(date, date, text);

create function public.erp_analytics_by_dept(p_from date, p_to date, p_product text default null)
returns table(department_id uuid, done_qty integer, defect integer, rework integer, defect_pct numeric)
language plpgsql
stable
set search_path to 'public'
as $function$
begin
  if not public.erp_has_permission('analytics.view') then
    raise exception 'erp_analytics_by_dept: нужно право analytics.view' using errcode = '42501';
  end if;

  -- Брак считается по ВСЕМ этапам, а не только терминальным: вопрос
  -- документа — «где возникает брак», и ответ на него даёт каждый цех.
  -- Поэтому колонка называется `done_qty` («сдано участком»), а не
  -- `released`: выпуск позиции считает только `erp_analytics_released`
  return query
  select s.department_id,
         coalesce(sum(rep.qty_good), 0)::int,
         coalesce(sum(rep.qty_defect), 0)::int,
         coalesce(sum(rep.qty_rework), 0)::int,
         case when sum(rep.qty_good) + sum(rep.qty_defect) > 0
              then round(100.0 * sum(rep.qty_defect) / (sum(rep.qty_good) + sum(rep.qty_defect)), 1)
         end
    from public.erp_stage_reports rep
    join public.erp_item_stages s on s.id = rep.stage_id
    join public.erp_order_items i on i.id = s.item_id
   where rep.created_at >= p_from::timestamptz
     and rep.created_at < (p_to + 1)::timestamptz
     and (p_product is null or i.product_type = p_product)
   group by s.department_id
   order by 3 desc;
end $function$;
