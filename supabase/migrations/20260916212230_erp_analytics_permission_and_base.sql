-- РАЗДЕЛ «АНАЛИТИКА»: ПРАВО И ОПРЕДЕЛЕНИЕ ВЫПУСКА (правка 16.09, п. 7).
--
-- ПРАВО ОТДЕЛЬНОЕ, а не `catalog.edit` и не роль. Сводка показывает
-- себестоимость сборки, расход ткани и брак по цехам — вопросы руководства;
-- при этом она ТОЛЬКО ЧИТАЕТ, и запирать её правом на правку справочников
-- значило бы раздавать вместе с ней право менять данные.
--
-- Засеяно директору и руководителю производства. Диспетчеру НЕ достаётся:
-- в `DEFAULT_PERMISSIONS` его набор строится исключениями, и новое право
-- ушло бы ему молча — поэтому оно там названо явно. Понадобится — выдаётся
-- галочкой в матрице, на то она и есть.
--
-- ВЫПУСК СЧИТАЕТСЯ ОДНОЙ ФУНКЦИЕЙ, КОТОРУЮ ЧИТАЮТ ВСЕ ОСТАЛЬНЫЕ. Это главное
-- решение здесь: «сколько выпустили» можно определить четырьмя способами
-- (по закрытым этапам, по последнему отчёту, по отгрузке, по ОТК), и если
-- каждая сводка посчитает по-своему, плитка разойдётся с таблицей — молча
-- и навсегда. Определение одно: отчёты ПОСЛЕДНИХ производственных этапов
-- позиции, то есть тех, от которых никто не зависит.
--
-- Проверено на живой базе: терминальных этапов 26 (ВТО и вышивка), отчётов
-- на них пока ноль — значит выпуск за период честно нулевой, а не потерян
-- разбором. Брак при этом считается по ВСЕМ этапам (см. `erp_analytics_by_dept`):
-- вопрос документа — «где возникает брак», и отвечает на него каждый цех.

insert into public.erp_role_permissions (role, permission, allowed) values
  ('director',        'analytics.view', true),
  ('production_head', 'analytics.view', true)
on conflict (role, permission) do nothing;

create or replace function public.erp_analytics_released(
  p_from date,
  p_to date
)
returns table (
  report_id uuid,
  stage_id uuid,
  item_id uuid,
  order_id uuid,
  department_id uuid,
  sku_card_id uuid,
  product_type text,
  at timestamptz,
  qty_good int,
  qty_defect int,
  qty_rework int,
  qty_extra int,
  item_qty int,
  assembly_cost numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with terminal as (
    select s.id, s.item_id, s.department_id
      from public.erp_item_stages s
      join public.erp_departments d on d.id = s.department_id
     where coalesce(d.is_production, false)
       -- Этапы образца в выпуск не идут: разработка это не тираж
       and s.origin is distinct from 'experimental'
       and not exists (
         select 1 from public.erp_item_stages n
          where n.item_id = s.item_id and s.id = any(n.depends_on)
       )
  )
  select r.id, r.stage_id, i.id, i.order_id, t.department_id,
         i.sku_card_id, i.product_type, r.created_at,
         r.qty_good, r.qty_defect, r.qty_rework, r.qty_extra,
         i.qty, i.assembly_cost_per_unit
    from public.erp_stage_reports r
    join terminal t on t.id = r.stage_id
    join public.erp_order_items i on i.id = t.item_id
   where r.created_at >= p_from::timestamptz
     and r.created_at < (p_to + 1)::timestamptz;
$$;

comment on function public.erp_analytics_released(date, date) is
  'Выпуск за период: отчёты ПОСЛЕДНИХ производственных этапов позиции — один источник для всех сводок';

revoke execute on function public.erp_analytics_released(date, date) from public, anon;
grant execute on function public.erp_analytics_released(date, date) to authenticated, service_role;
