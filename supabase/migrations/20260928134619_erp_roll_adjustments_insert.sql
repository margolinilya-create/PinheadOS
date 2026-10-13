-- Корректировку метража пишет и сдача закроя — от лица вызывающего
-- (правка 27.09, п. 4 — второй хвост, найден той же пробой на живой базе).
--
-- `erp_material_roll_adjustments` в `20260928131459` получила только SELECT:
-- «пишут RPC под security definer». Но замер остатка и списание малого
-- остатка пишет `erp_stage_submit_report`, а она `security invoker` — и
-- закройщик получал «new row violates row-level security policy» на второй
-- сдаче с замером. Проба с откатом поймала это на шаге завершения рулона.
--
-- Правка — INSERT-политика под теми же правами, что у строк расхода
-- (`erp_stage_report_rolls_insert`: `stage.progress` / `stage.complete`)
-- плюс `material.receive` (уточнение метража складом идёт через definer,
-- но право названо здесь же, чтобы политика читалась целиком). UPDATE
-- и DELETE по-прежнему закрыты: корректировка — запись журнала, её
-- не правят и не удаляют.
drop policy if exists erp_material_roll_adjustments_insert on public.erp_material_roll_adjustments;
create policy erp_material_roll_adjustments_insert on public.erp_material_roll_adjustments
  for insert to authenticated
  with check (
    (select public.erp_has_permission('stage.progress'))
    or (select public.erp_has_permission('stage.complete'))
    or (select public.erp_has_permission('material.receive'))
  );

grant insert on public.erp_material_roll_adjustments to authenticated;

comment on table public.erp_material_roll_adjustments is
  'Корректировки метража рулона с причиной, автором и датой. Не прибавляются к расходу и браку; пишут RPC сдачи и уточнения параметров, вставка — под правами этапа и приёмки, правка и удаление закрыты';
