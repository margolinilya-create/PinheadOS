-- Действие над подрядной операцией — ОДНА транзакция (правки 20.08).
--
-- ЧТО ЗАМЕНЯЕТ. Фазу выставлял селект в таблице, отдельно от журнала
-- перемещений. То есть «Завершено» ставилось, не передав и не приняв ни одной
-- штуки, а `qty_done` этапа приращает ТОЛЬКО журнал: на экране закрыто,
-- в производстве этап открыт, следующий не начинается. Теперь движение —
-- действие: «Передать» · «Готово у подрядчика» · «Вернулось» · «На переделку»,
-- и то, что меняет количества, пишет журнал ТЕМ ЖЕ действием.
--
-- ПОЧЕМУ RPC, А НЕ ДВА ЗАПРОСА. Правило проекта: действие из нескольких
-- записей — одна транзакция. Журнал без фазы означает сдвинутые счётчики при
-- прежнем состоянии, фаза без журнала — состояние без факта; и то и другое
-- человек увидит только как «почему-то стоит».
--
-- ПРИЁМКИ ЗДЕСЬ НЕТ. Её делает СКЛАД задачей «Приёмка подряда»: он пишет
-- журнал `accept` (это приращает `qty_done` этапа), а фазу двигает триггер
-- `erp_warehouse_fg_accepted`. Второй путь к тому же переходу обошёл бы
-- складской гейт и фиксацию брака.
create or replace function public.erp_subcontract_apply(
  p_id       uuid,
  p_phase    text,
  p_kind     text default null,
  p_qty      int  default null,
  p_moved_on date default null,
  p_comment  text default null,
  p_author   text default null
)
returns public.erp_subcontracting
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.erp_subcontracting;
begin
  if p_kind is not null then
    if p_kind not in ('send', 'return') then
      -- `accept` намеренно недоступен: приёмку оформляет склад
      raise exception 'erp_subcontract_apply: вид перемещения % недопустим', p_kind
        using errcode = '22023';
    end if;
    if coalesce(p_qty, 0) <= 0 then
      raise exception 'erp_subcontract_apply: количество должно быть больше нуля'
        using errcode = '22023';
    end if;
    insert into public.erp_subcontract_moves
      (subcontract_id, kind, qty, moved_on, comment, author)
    values
      (p_id, p_kind, p_qty, coalesce(p_moved_on, public.erp_local_date()),
       nullif(btrim(coalesce(p_comment, '')), ''), p_author);
  end if;

  update public.erp_subcontracting
     set phase  = p_phase,
         status = case p_phase
                    when 'planned'             then 'planned'
                    when 'materials_ready'     then 'awaiting_materials'
                    when 'sent'                then 'sent'
                    when 'at_contractor'       then 'in_progress'
                    when 'ready_at_contractor' then 'ready_to_ship'
                    when 'returned'            then 'returned'
                    when 'rework'              then 'in_progress'
                    when 'accepted'            then 'received_at_pinhead'
                    when 'closed'              then 'received_at_pinhead'
                    else 'planned'
                  end,
         sent_date = case
                       when p_kind = 'send'
                       then coalesce(sent_date, coalesce(p_moved_on, public.erp_local_date()))
                       else sent_date
                     end
   where id = p_id
  returning * into v_row;

  -- RLS запрещает UPDATE через USING, то есть отдаёт «0 строк», а не ошибку.
  -- Без этой проверки интерфейс показал бы зелёное «сохранено» на отказе прав.
  if v_row.id is null then
    raise exception 'erp_subcontract_apply: операция не найдена или нет прав'
      using errcode = '42501';
  end if;

  return v_row;
end $$;

grant execute on function public.erp_subcontract_apply(uuid, text, text, int, date, text, text)
  to authenticated;

comment on function public.erp_subcontract_apply(uuid, text, text, int, date, text, text) is
  'Действие над подрядной операцией одной транзакцией: запись журнала (send/return) + фаза + зеркало устаревшего статуса. Приёмка (accept) сюда не входит — её оформляет склад.';
