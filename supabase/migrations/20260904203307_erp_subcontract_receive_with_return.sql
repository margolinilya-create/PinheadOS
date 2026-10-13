-- §3.5 обхода 04.09: возврат от подрядчика фиксировал МЕНЕДЖЕР, и только после
-- этого склад мог принять партию. Склад, к которому партия физически приехала,
-- отметить её приход сам не мог: карточка приёмки считает доступное как
-- «вернулось − принято − брак», и при неотмеченном возврате там ноль.
--
-- На живой базе такое состояние есть прямо сейчас: операция
-- `cd080e1f-f728-4b3e-a6ea-9bd58c60f046` — передано 4670, вернулось 0.
--
-- Возврат теперь пишется ТЕМ ЖЕ вызовом, что приёмка: партия приехала — её
-- пересчитали, и оба факта попадают в журнал одной транзакцией. Разделять их
-- нельзя по той же причине, по которой 22.08 свели «принято» и «брак»:
-- между двумя записями есть окно, в котором `qty_done` этапа уже вырос,
-- а остальное ещё не отмечено.
--
-- Действие менеджера «Зафиксировать возврат» остаётся: партию бывает нужно
-- отметить вернувшейся до того, как склад её разобрал.
--
-- ПРЕЖНЯЯ СИГНАТУРА СНИМАЕТСЯ ЯВНО. Параметр с умолчанием создаёт НОВУЮ
-- функцию, старая остаётся рядом, и PostgREST выбирает из двух — правило
-- проекта, на котором уже ловились.
--
-- Проверено на живой базе от лица временного кладовщика (транзакция
-- с откатом): вернулось 105, принято 100, брак 5 — одним вызовом.

drop function if exists public.erp_subcontract_receive(uuid, integer, integer, date, text, text);

create or replace function public.erp_subcontract_receive(
  p_id uuid,
  p_accepted integer,
  p_defect integer default 0,
  p_moved_on date default null,
  p_comment text default null,
  p_author text default null,
  p_returned integer default 0
)
returns public.erp_subcontracting
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.erp_subcontracting;
  v_on date := coalesce(p_moved_on, public.erp_local_date());
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if coalesce(p_accepted, 0) <= 0
     and coalesce(p_defect, 0) <= 0
     and coalesce(p_returned, 0) <= 0 then
    raise exception 'erp_subcontract_receive: укажите принятое количество, брак или возврат'
      using errcode = '22023';
  end if;

  -- Возврат ПЕРВЫМ: приёмка считается от вернувшегося, и обратный порядок
  -- дал бы «принято больше, чем вернулось» в промежуточном состоянии
  if coalesce(p_returned, 0) > 0 then
    insert into public.erp_subcontract_moves
      (subcontract_id, kind, qty, moved_on, comment, author)
    values (p_id, 'return', p_returned, v_on, v_comment, p_author);
  end if;

  if coalesce(p_accepted, 0) > 0 then
    insert into public.erp_subcontract_moves
      (subcontract_id, kind, qty, moved_on, comment, author)
    values (p_id, 'accept', p_accepted, v_on, v_comment, p_author);
  end if;

  if coalesce(p_defect, 0) > 0 then
    insert into public.erp_subcontract_moves
      (subcontract_id, kind, qty, moved_on, comment, author)
    values (p_id, 'defect', p_defect, v_on, v_comment, p_author);
  end if;

  select * into v_row from public.erp_subcontracting where id = p_id;
  if v_row.id is null then
    raise exception 'erp_subcontract_receive: операция не найдена или нет прав'
      using errcode = '42501';
  end if;
  return v_row;
end $$;

comment on function public.erp_subcontract_receive(uuid, integer, integer, date, text, text, integer) is
  'Приёмка партии от подрядчика одной транзакцией: возврат, принятое и брак. p_returned добавлен 04.09 — до него возврат фиксировал только менеджер, и склад, к которому партия физически приехала, не мог отметить её приход сам.';
