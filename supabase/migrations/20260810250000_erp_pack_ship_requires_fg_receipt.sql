-- Упаковка не начинается, пока склад не принял готовую продукцию
-- (правки заказчика 10.08, решение по волне 3.4).
--
-- Волна 3.4 завела приёмку готовой продукции, но НЕ сделала её обязательной:
-- заказ можно было упаковать и отгрузить, не отметив приёмку. Расхождение
-- «цех сдал 100 / склад принял 96» фиксировалось в журнале и никого
-- не останавливало — то есть отвечало на вопрос уже после отгрузки.
--
-- ПОЧЕМУ ГЕЙТ НЕ ВВЕЛИ СРАЗУ. Опасение было, что он остановит активные заказы,
-- у которых приёмки ГП никогда не существовало. Проверка показала цифру меньше
-- ожидаемой: заказов с полностью закрытым производством всего ДВА, и оба уже
-- в упаковке. Остальные до гейта ещё не дошли и получат задачу приёмки штатно,
-- когда закроют этапы.
--
-- БЭКФИЛЛ ИДЁТ ПЕРВЫМ и ставит приёмку СРАЗУ ПРИНЯТОЙ: продукция этих заказов
-- физически на складе — она уже упаковывается. Пометить её «ожидает приёмки»
-- значило бы завести задачу, которую кладовщик не понимает: принимать нечего,
-- всё давно принято.

-- ── 1. Бэкфилл: закрытое производство + идущая упаковка = приёмка была ──

insert into public.erp_warehouse_tasks (order_id, task_type, status, note)
select o.id, 'fg_receipt', 'accepted',
       'Проставлено при вводе обязательной приёмки ГП: производство закрыто, упаковка уже идёт'
  from public.erp_orders o
 where not exists (
         select 1 from public.erp_item_stages s
          join public.erp_order_items i on i.id = s.item_id
         where i.order_id = o.id and s.status not in ('done','skipped'))
   and exists (
         select 1 from public.erp_warehouse_tasks t
          where t.order_id = o.id and t.task_type = 'pack_ship')
   and not exists (
         select 1 from public.erp_warehouse_tasks t
          where t.order_id = o.id and t.task_type = 'fg_receipt')
on conflict (order_id, task_type) do nothing;

-- ── 2. Гейт ──
--
-- Условие добавляется к уже существующим (все этапы закрыты И подряд принят),
-- а не заменяет их: у упаковки теперь три предусловия, и каждое отвечает
-- за свой вид «работа ещё не дошла до склада».

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

  -- Все производственные этапы закрыты → продукция готова, склад её принимает
  if new.status = 'done' then
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'fg_receipt', 'awaiting')
      on conflict (order_id, task_type) do nothing;
    end if;
  end if;

  -- Упаковка и отгрузка. Три предусловия, и каждое про своё:
  --   · все этапы закрыты — производство закончило;
  --   · подряд принят (по `phase`, не по строке статуса — та молча уехала);
  --   · склад ПРИНЯЛ готовую продукцию — иначе упаковывают то, чего никто
  --     не пересчитал, и недостача всплывает у клиента.
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
    )
    and exists (
      select 1 from erp_warehouse_tasks t
      where t.order_id = v_order_id
        and t.task_type = 'fg_receipt'
        and t.status = 'accepted'
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
  'Складские задачи из движения этапов. Упаковка требует ТРЁХ предусловий: этапы закрыты, подряд принят (по phase), склад принял готовую продукцию. Последнее — чтобы не упаковывали то, чего никто не пересчитал.';

-- ── 3. Приёмка ГП закрыта → упаковка появляется ──
--
-- Триггер выше срабатывает на смене статуса ЭТАПА. Но к моменту, когда склад
-- принимает продукцию, все этапы уже закрыты — нового события не будет, и
-- упаковка не появилась бы никогда. Поэтому у складских задач свой триггер:
-- закрытие приёмки ГП — это и есть недостающее событие.

create or replace function public.erp_warehouse_fg_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_type <> 'fg_receipt' or new.status <> 'accepted' then
    return new;
  end if;
  if old.status = 'accepted' then
    return new;
  end if;

  if not exists (
    select 1 from erp_item_stages s
    join erp_order_items i on i.id = s.item_id
    where i.order_id = new.order_id and s.status not in ('done','skipped')
  )
  and not exists (
    select 1 from erp_subcontracting sc
    where sc.order_id = new.order_id
      and sc.op_type = 'finished_product'
      and sc.phase not in ('accepted', 'closed')
  ) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (new.order_id, 'pack_ship', 'awaiting_receipt')
    on conflict (order_id, task_type) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists erp_warehouse_fg_accepted_trg on public.erp_warehouse_tasks;
create trigger erp_warehouse_fg_accepted_trg
  after update on public.erp_warehouse_tasks
  for each row execute function public.erp_warehouse_fg_accepted();

revoke execute on function public.erp_warehouse_fg_accepted() from anon, authenticated, public;

comment on function public.erp_warehouse_fg_accepted() is
  'Закрытие приёмки ГП открывает упаковку. Отдельный триггер, потому что к этому моменту все этапы уже закрыты — события от них больше не будет, и упаковка не появилась бы никогда.';
