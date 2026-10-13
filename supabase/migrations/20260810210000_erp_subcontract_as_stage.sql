-- Подряд как этап маршрута (правки заказчика 10.08, волна 3.5).
--
-- Документ: «Подряд должен вести себя как обычный этап производства: у него
-- один статус, он виден на канбане и в плане, частичная передача и частичный
-- возврат учитываются. Оплата не должна быть первым производственным этапом».
--
-- ЕДИНЫЙ СТАТУС — ЭТО `erp_item_stages.status`. Его читают канбан, очередь,
-- план, прогресс и гейты. Второй машины состояний рядом с ними быть не должно:
-- именно из-за неё «Вышивка → подряд» жила отдельной жизнью и не попадала
-- ни в очередь цеха, ни в загрузку.
--
-- `phase` — НЕ второй статус, а детализация ВНУТРИ `in_progress`: «передано
-- подрядчику», «у подрядчика», «вернулось». Синхронизировать их не нужно —
-- у полей разные зоны ответственности, и в этом вся суть разделения.
--
-- ОПЛАТА УХОДИТ ИЗ ПРОИЗВОДСТВЕННОГО ПОТОКА. Статус `awaiting_payment` (3 живые
-- строки) переезжает в `phase='planned'` + `payment_status='unpaid'`.
-- Финансовый признак не участвует НИ В ОДНОМ переходе — иначе неоплаченный
-- подряд останавливал бы цех, чего документ прямо не хочет.
--
-- ЖУРНАЛ ПЕРЕМЕЩЕНИЙ вместо трёх дат: передано / вернулось / принято. Частичная
-- передача и частичный возврат получаются сами, а количества на строке ведёт
-- rollup — то же решение, что у приёмки материалов (волна 3.3).
--
-- ГЛАВНЫЙ РИСК, ради которого правка идёт одной миграцией с триггером склада:
-- `erp_warehouse_task_derive` содержит СТРОКОВЫЙ гейт `sc.status <>
-- 'received_at_pinhead'`. При переезде в `phase` он перестал бы срабатывать
-- МОЛЧА, и упаковка начала бы создаваться до приёмки подряда. Ошибка такого
-- рода не падает — она просто когда-нибудь отгружает непринятое.

-- ── 1. Новые поля ──

alter table public.erp_subcontracting
  -- Этап маршрута, которым этот подряд является. NULL = подряд «под ключ»:
  -- у него этапа нет вовсе (`buildItemRoute` вырезает даже закупку при
  -- материалах подрядчика). Одна таблица, две роли.
  add column if not exists stage_id uuid references public.erp_item_stages(id) on delete set null,
  add column if not exists phase text not null default 'planned',
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists paid_amount numeric,
  add column if not exists qty_sent numeric not null default 0,
  add column if not exists qty_returned numeric not null default 0,
  add column if not exists qty_accepted numeric not null default 0;

create unique index if not exists erp_subcontracting_stage_key
  on public.erp_subcontracting (stage_id) where stage_id is not null;

alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_phase_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_phase_check check (phase in (
    'planned',          -- согласовано, ещё не передавали
    'materials_ready',  -- материалы собраны к передаче
    'sent',             -- передано подрядчику
    'at_contractor',    -- в работе у подрядчика
    'returned',         -- вернулось на Pinhead
    'accepted',         -- принято складом
    'closed'            -- закрыто
  ));

alter table public.erp_subcontracting
  drop constraint if exists erp_subcontracting_payment_check;
alter table public.erp_subcontracting
  add constraint erp_subcontracting_payment_check
  check (payment_status in ('unpaid', 'prepaid', 'paid'));

comment on column public.erp_subcontracting.phase is
  'Детализация ВНУТРИ in_progress этапа, а не второй статус: единый статус — erp_item_stages.status, его читают канбан, очередь, план и гейты.';
comment on column public.erp_subcontracting.payment_status is
  'Финансовый признак. НЕ участвует ни в одном производственном переходе: неоплаченный подряд не должен останавливать цех.';

-- ── 2. Журнал перемещений ──

create table if not exists public.erp_subcontract_moves (
  id uuid primary key default gen_random_uuid(),
  subcontract_id uuid not null references public.erp_subcontracting(id) on delete cascade,
  kind text not null check (kind in ('send', 'return', 'accept')),
  qty numeric not null check (qty > 0),
  moved_on date not null default current_date,
  comment text,
  author text,
  author_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists erp_subcontract_moves_sub_idx
  on public.erp_subcontract_moves (subcontract_id, moved_on desc);

alter table public.erp_subcontract_moves enable row level security;

drop policy if exists "erp_subcontract_moves_read" on public.erp_subcontract_moves;
create policy "erp_subcontract_moves_read" on public.erp_subcontract_moves
  for select to authenticated using (public.erp_is_member());

-- Передача и приёмка подряда — работа менеджера заказа, тем же правом,
-- что и остальные решения по маршруту.
drop policy if exists "erp_subcontract_moves_insert" on public.erp_subcontract_moves;
create policy "erp_subcontract_moves_insert" on public.erp_subcontract_moves
  for insert to authenticated with check (public.erp_has_permission('order.manage'));

drop policy if exists "erp_subcontract_moves_update" on public.erp_subcontract_moves;
create policy "erp_subcontract_moves_update" on public.erp_subcontract_moves
  for update to authenticated
  using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));

drop policy if exists "erp_subcontract_moves_delete" on public.erp_subcontract_moves;
create policy "erp_subcontract_moves_delete" on public.erp_subcontract_moves
  for delete to authenticated using (public.erp_has_permission('order.manage'));

-- ── 3. Rollup количеств ──
--
-- Приёмка (`accept`) вдобавок приращает `qty_done` привязанного этапа общим
-- правилом из 20260810180000 — и «следующий этап получает доступное
-- количество» начинает работать без единой дополнительной строки логики.

create or replace function public.erp_subcontract_moves_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
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
         updated_at = now()
   where s.id = v_sub
  returning s.stage_id into v_stage;

  -- Приёмка двигает счётчик этапа: подряд — такой же этап маршрута
  if v_stage is not null and tg_op = 'INSERT' and new.kind = 'accept' then
    v_total := public.erp_stage_item_qty(v_stage);
    if v_total is not null then
      update public.erp_item_stages s
         set qty_done = public.erp_clamp_done(s.qty_done, new.qty::int, v_total),
             status = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then 'done' else s.status end,
             finished_at = case
               when public.erp_clamp_done(s.qty_done, new.qty::int, v_total) >= v_total
                 then now() else s.finished_at end
       where s.id = v_stage;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists erp_subcontract_moves_rollup_trg on public.erp_subcontract_moves;
create trigger erp_subcontract_moves_rollup_trg
  after insert or update or delete on public.erp_subcontract_moves
  for each row execute function public.erp_subcontract_moves_rollup();

revoke execute on function public.erp_subcontract_moves_rollup() from anon, authenticated, public;

comment on function public.erp_subcontract_moves_rollup() is
  'Количества подряда из журнала перемещений; приёмка приращает qty_done привязанного этапа — подряд ведёт себя как этап маршрута, а не как параллельная сущность.';

-- ── 4. Перенос живых данных в phase/payment_status ──
--
-- Каждое старое значение статуса раскладывается на производственную фазу
-- и финансовый признак. `awaiting_payment` перестаёт быть этапом — как и
-- требует документ.

update public.erp_subcontracting set
  phase = case status
    when 'planned'               then 'planned'
    when 'awaiting_payment'      then 'planned'
    when 'materials_ready'       then 'materials_ready'
    when 'sent'                  then 'sent'
    when 'in_progress'           then 'at_contractor'
    when 'ready_to_ship'         then 'at_contractor'
    when 'shipped_by_contractor' then 'returned'
    when 'received_at_pinhead'   then 'accepted'
    when 'closed'                then 'closed'
    else 'planned'
  end,
  payment_status = case status when 'awaiting_payment' then 'unpaid' else payment_status end;

-- Уже пройденные перемещения переносим в журнал, чтобы количества не начинались
-- с нуля: тот же порядок «бэкфилл до триггера», что у приёмки материалов.
insert into public.erp_subcontract_moves (subcontract_id, kind, qty, moved_on, comment, author)
select s.id, 'send', s.qty, coalesce(s.sent_date, current_date),
       'Перенос из карточки подряда при вводе журнала перемещений', 'система'
  from public.erp_subcontracting s
 where s.qty is not null and s.qty > 0 and s.sent_date is not null
   and not exists (select 1 from public.erp_subcontract_moves m
                    where m.subcontract_id = s.id and m.kind = 'send');

insert into public.erp_subcontract_moves (subcontract_id, kind, qty, moved_on, comment, author)
select s.id, 'return', s.qty, coalesce(s.returned_date, current_date),
       'Перенос из карточки подряда при вводе журнала перемещений', 'система'
  from public.erp_subcontracting s
 where s.qty is not null and s.qty > 0 and s.returned_date is not null
   and not exists (select 1 from public.erp_subcontract_moves m
                    where m.subcontract_id = s.id and m.kind = 'return');

-- ── 5. Гейт склада переезжает на phase ──
--
-- ЭТО И ЕСТЬ ОПАСНОЕ МЕСТО. Прежний предикат сравнивал СТРОКУ статуса
-- (`sc.status <> 'received_at_pinhead'`). После переезда в `phase` он
-- продолжил бы «работать» — и всегда быть истинным, потому что такого статуса
-- у живых строк больше нет. Упаковка начала бы создаваться до приёмки подряда,
-- и заметили бы это на отгрузке непринятого.

create or replace function public.erp_warehouse_task_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_code text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select i.order_id into v_order_id from erp_order_items i where i.id = new.item_id;
  if v_order_id is null then
    return new;
  end if;
  select d.code into v_code from erp_departments d where d.id = new.department_id;

  -- Закупка закрыта → материалы прибыли, нужна приёмка складом
  if v_code = 'supply' and new.status = 'done' then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (v_order_id, 'material_receipt', 'awaiting')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Швейка взята в работу → склад выпускает маркировку
  if v_code = 'sewing' and new.status = 'in_progress' then
    insert into erp_warehouse_tasks (order_id, item_id, task_type, status)
    values (v_order_id, new.item_id, 'marking', 'new')
    on conflict (order_id, task_type) do nothing;
  end if;

  -- Последний этап завершён → упаковка и отгрузка, но НЕ пока не принято
  -- готовое изделие от подрядчика. Условие читает `phase`, а не статус:
  -- статус подряда переехал в фазу (волна 3.5), и старое сравнение строк
  -- молча стало всегда истинным.
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    )
    and not exists (
      select 1 from erp_subcontracting sc
      where sc.order_id = v_order_id
        and sc.op_type = 'finished_product'
        and sc.phase not in ('accepted', 'closed')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'pack_ship', 'awaiting_receipt')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.erp_warehouse_task_derive() from anon, authenticated, public;

comment on function public.erp_warehouse_task_derive() is
  'Складские задачи из движения этапов. Гейт упаковки читает erp_subcontracting.phase: прежнее сравнение со строкой статуса после переезда в фазу молча стало всегда истинным и пускало упаковку до приёмки подряда.';

-- Realtime: журнал перемещений не публикуем — количества приезжают через
-- rollup в `erp_subcontracting`, которая уже в публикации.
