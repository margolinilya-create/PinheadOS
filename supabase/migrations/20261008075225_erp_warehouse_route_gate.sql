-- СКЛАД НЕ ПРИНИМАЕТ ТО, ДО ЧЕГО НЕ ДОШЁЛ МАРШРУТ (ошибка с боя 08.10, «Буше»)
--
-- Заказ стоял в закупке, а склад уже видел «Приёмку готового изделия»
-- с кнопкой. Интерфейс починен (`FgIntakeQueue` показывает только дошедшие
-- этапы), но сервер пропускал всё: проба на бою — этап склада, ждущий
-- открытую закупку, брался в работу, принимал отчёт и закрывался. Гейт
-- держит то же, что интерфейс: этап склада начинает работу, получает
-- факт и закрывается, только когда все предшественники `done`/`skipped`
-- (зеркало `isStageReady`, ветка зависимостей).
--
-- Только СКЛАД: правило «взять — когда предыдущий закрыт» у остальных цехов
-- держит интерфейс, а ограничение на сервере для всех участков — отдельное
-- решение (подряд, разработка, перенос между цехами идут своими путями).
-- Пропуск — service role и метки тех же служебных путей, что у
-- `erp_stage_done_gate`. Нарушений на бою на момент выката нет (23 этапа
-- склада с открытым предшественником — все в `waiting`).

create or replace function public.erp_warehouse_route_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_open text;
begin
  if (select auth.uid()) is null
     or coalesce(current_setting('erp.force_complete', true), '') = 'on'
     or coalesce(current_setting('erp.moving', true), '') = 'on'
     or coalesce(current_setting('erp.subcontract_rollup', true), '') = 'on'
     or coalesce(current_setting('erp.supply_autoclose', true), '') = 'on' then
    return new;
  end if;

  -- Начало работы, закрытие или новый факт; остальное (план, исполнитель,
  -- проблема) гейт не касается
  if not (
       (new.status in ('in_progress', 'done') and old.status not in ('in_progress', 'done'))
    or coalesce(new.qty_done, 0) > coalesce(old.qty_done, 0)
  ) then
    return new;
  end if;

  if coalesce(new.executor, 'internal') <> 'internal' or not exists (
    select 1 from public.erp_departments d
     where d.id = new.department_id and d.code = 'warehouse'
  ) then
    return new;
  end if;

  select coalesce(d.name, 'Предыдущий этап') into v_open
    from public.erp_item_stages p
    left join public.erp_departments d on d.id = p.department_id
   where p.id = any(new.depends_on)
     and p.status not in ('done', 'skipped')
   order by p.sort_order
   limit 1;

  if found then
    raise exception 'Склад: этап ещё не дошёл — %: ещё не завершено', v_open
      using errcode = 'P0001';
  end if;
  return new;
end $function$;

revoke execute on function public.erp_warehouse_route_gate() from public, anon, authenticated;

create or replace trigger erp_item_stages_warehouse_route_gate
  before update of status, qty_done on public.erp_item_stages
  for each row execute function public.erp_warehouse_route_gate();
