-- Подряд: количество в работе отдельно от физической передачи, и явный брак
-- (правки заказчика 22.08, пункты 3.8 и 3.9).
--
-- ЧТО БЫЛО НЕ ТАК.
--
-- 1. «Сколько подрядчик должен сделать» и «сколько мы ему физически отдали»
--    были ОДНОЙ величиной — `qty_sent`, суммой журнальных записей `send`.
--    Подрядчик, печатающий 200 штук НА СВОЁМ материале, не получает от нас
--    ничего, и провести такой этап можно было только фиктивной передачей
--    200 единиц. Документ формулирует это прямо: «можно корректно провести
--    подрядный этап на материале подрядчика без фиктивной передачи 200 единиц
--    со стороны Pinhead».
--
-- 2. Всё непринятое считалось БРАКОМ. `subcontractShortfall` выводила его как
--    «вернулось − принято», поэтому сразу после возврата (вернулось 200,
--    принято 0) экран показывал «брак: 200» — при том, что изделия просто
--    ещё не проходили приёмку. Брак обязан появляться только тогда, когда
--    человек ЯВНО отметил конкретное количество как брак.
--
-- ЧТО ДЕЛАЕМ.
--
-- `qty_in_work` — сколько единиц подрядчик должен произвести. Это РЕШЕНИЕ
-- менеджера, а не приращаемая величина: журнала у неё нет и быть не должно.
-- Физическая передача остаётся журналом (`send` → `qty_sent`), и она больше
-- не обязательна для запуска подрядного этапа.
--
-- `qty_defect` — брак. Ведёт ЖУРНАЛ, новым видом перемещения `defect`, тем же
-- триггером, что и остальные количества: правило проекта «журнал хранит
-- приращения, агрегат — итог, пишутся одной транзакцией» здесь действует
-- буквально. Вторая колонка-счётчик рядом с журналом означала бы двух
-- писателей одной величины — ровно то, на чём в проекте уже ловились
-- с `qty_received` у материалов.
--
-- «Ожидает приёмки» НЕ ХРАНИТСЯ: это `вернулось − принято − брак`, и считает
-- его клиент (`utils/outsourcing.subcontractShortfall`). Хранить вычислимое
-- значит завести два источника правды, которые разъедутся на первой же
-- частичной приёмке.
--
-- БРАК НЕ ПРИРАЩАЕТ `qty_done` ЭТАПА, и это осознанно: забракованные изделия
-- производством не сданы. Этап закрывает только приёмка — как и раньше.

alter table public.erp_subcontracting
  add column if not exists qty_in_work integer,
  add column if not exists qty_defect numeric not null default 0;

comment on column public.erp_subcontracting.qty_in_work is
  'Сколько единиц подрядчик должен произвести. Отдельно от qty_sent: при материалах подрядчика мы не передаём ничего, но работа у него есть';
comment on column public.erp_subcontracting.qty_defect is
  'Брак, отмеченный ЯВНО. Ведёт триггер erp_subcontract_moves_rollup из записей журнала kind=defect';

-- Вид перемещения `defect`. Пересоздаём CHECK целиком: добавить значение
-- в существующий нельзя, а перечисление обязано остаться одним.
alter table public.erp_subcontract_moves
  drop constraint if exists erp_subcontract_moves_kind_check;
alter table public.erp_subcontract_moves
  add constraint erp_subcontract_moves_kind_check
  check (kind in ('send', 'return', 'accept', 'defect'));

-- Свод журнала. Подлинный текст прежней функции плюс одна ветка `defect`;
-- ветка приёмки (приращение `qty_done` этапа с меткой транзакции для стража)
-- оставлена дословно — она и есть то, чем закрывается подрядный этап.
create or replace function public.erp_subcontract_moves_rollup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sub uuid := coalesce(new.subcontract_id, old.subcontract_id);
  v_stage uuid;
  v_total int;
begin
  update public.erp_subcontracting s
     set qty_sent     = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'send'), 0),
         qty_returned = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'return'), 0),
         qty_accepted = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'accept'), 0),
         qty_defect   = coalesce((select sum(m.qty) from public.erp_subcontract_moves m
                                   where m.subcontract_id = v_sub and m.kind = 'defect'), 0),
         updated_at = now()
   where s.id = v_sub
  returning s.stage_id into v_stage;

  if v_stage is not null and tg_op = 'INSERT' and new.kind = 'accept' then
    v_total := public.erp_stage_item_qty(v_stage);
    if v_total is not null then
      perform set_config('erp.subcontract_rollup', 'on', true);
      update public.erp_item_stages s
         set qty_done = public.erp_clamp_done(s.qty_done, new.qty::int, v_total),
             status = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then 'done' else s.status end,
             finished_at = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then now() else s.finished_at end
       where s.id = v_stage;
      perform set_config('erp.subcontract_rollup', 'off', true);
    end if;
  end if;
  return null;
end $$;

-- Действие над подрядной операцией. Подлинный текст плюс два изменения:
-- принимается `qty_in_work` (запуск работы у подрядчика) и вид `defect`.
--
-- Прежняя сигнатура снимается ЯВНО: добавление параметра со значением
-- по умолчанию создало бы вторую перегрузку, и PostgREST отвечал бы
-- «could not choose the best candidate function» на каждый вызов.
drop function if exists public.erp_subcontract_apply(uuid, text, text, integer, date, text, text);

create or replace function public.erp_subcontract_apply(
  p_id uuid,
  p_phase text,
  p_kind text default null,
  p_qty integer default null,
  p_moved_on date default null,
  p_comment text default null,
  p_author text default null,
  p_qty_in_work integer default null
)
returns public.erp_subcontracting
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.erp_subcontracting;
begin
  if p_kind is not null then
    if p_kind not in ('send', 'return', 'defect') then
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
         -- Количество в работе задаётся один раз, при запуске у подрядчика.
         -- `coalesce` оставляет прежнее значение, когда параметр не прислан:
         -- иначе любое следующее действие обнуляло бы его молча.
         qty_in_work = coalesce(p_qty_in_work, qty_in_work),
         sent_date = case
                       when p_kind = 'send'
                       then coalesce(sent_date, coalesce(p_moved_on, public.erp_local_date()))
                       else sent_date
                     end
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'erp_subcontract_apply: операция не найдена или нет прав'
      using errcode = '42501';
  end if;

  return v_row;
end $$;

-- Приёмка подряда складом ОДНИМ действием: принято и брак — две записи
-- журнала в одной транзакции.
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ДВА ВЫЗОВА С КЛИЕНТА. Приёмка распределяет
-- вернувшуюся партию: «принято X, брак Y». Два независимых INSERT означают
-- окно, в котором принято уже записано, а брак ещё нет, — и на экране
-- в этот момент правда о партии неполная. Ровно тем же приёмом устроена
-- приёмка материала (`erp_material_accept`).
--
-- ФАЗУ ЗДЕСЬ НЕ ДВИГАЕМ: `erp_subcontracting` UPDATE гейтится `order.manage`,
-- а приёмку делает склад (`warehouse.manage`). Фаза `accepted` придёт от
-- менеджера обычным `erp_subcontract_apply`; счётчики и закрытие этапа
-- ведёт триггер журнала — то есть всё, ради чего приёмка и существует,
-- происходит здесь.
--
-- `security invoker` (по умолчанию): RLS журнала уже пускает и склад,
-- и менеджера заказа, и подменять её собственной проверкой нельзя.
create or replace function public.erp_subcontract_receive(
  p_id uuid,
  p_accepted integer,
  p_defect integer default 0,
  p_moved_on date default null,
  p_comment text default null,
  p_author text default null
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
  if coalesce(p_accepted, 0) <= 0 and coalesce(p_defect, 0) <= 0 then
    raise exception 'erp_subcontract_receive: укажите принятое количество или брак'
      using errcode = '22023';
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

-- Триггерные функции недоступны через REST обходом по типу возврата
-- (миграция 20260812…): `erp_subcontract_moves_rollup` пересоздана выше
-- и снова попадает под то же правило — отзыв повторяем явно.
revoke execute on function public.erp_subcontract_moves_rollup() from public, anon, authenticated;
