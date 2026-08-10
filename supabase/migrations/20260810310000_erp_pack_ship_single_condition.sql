-- Разбор кода 10.08 (находка 2): у заказа с этапами И подрядом упаковка
-- не создавалась ВООБЩЕ.
--
-- Предусловий у упаковки три, и копий этого условия было тоже три: в
-- `erp_warehouse_task_derive`, в `erp_warehouse_fg_accepted` и в клиенте.
-- Копии разошлись ровно так, как расходятся копии.
--
-- Цепочка для заказа с производственными этапами И подрядом «готовое изделие»:
--   1. этапы закрылись → derive завёл приёмку ГП, упаковку пропустил
--      (подряд ещё не принят) — верно;
--   2. склад принял ГП → `fg_accepted` тоже пропустил (подряд всё ещё
--      не принят) — верно;
--   3. склад принял подряд → а на подряде триггера НЕТ ВОВСЕ, и клиент после
--      правки «не создавать упаковку у заказа с этапами» тоже ничего не делал.
-- Заказ оставался без задачи упаковки навсегда, и ничего при этом не падало.
--
-- Условие теперь ОДНО — `erp_can_pack_ship()`. Третье предусловие сформулировано
-- так, чтобы работать для обоих видов заказа: приёмка готовой продукции
-- обязательна там, где есть производство, и не существует у подряда «под ключ» —
-- у него нет ни одного этапа, и приёмке ГП взяться неоткуда.
--
-- Приёмка ПОДРЯДА заодно двигает фазу самой подрядной операции. Раньше это
-- делал клиент, и после ввода `warehouse.manage` кладовщик получал на этом
-- 42501: складскую задачу он двигать вправе, а `erp_subcontracting` стоит
-- под `order.manage`, которого у него нет. Здесь функция SECURITY DEFINER —
-- права не нужны, и решение принимает сервер, у которого видны все условия.

create or replace function public.erp_can_pack_ship(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- все производственные этапы закрыты
    not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = p_order_id and s.status not in ('done','skipped'))
    -- подряд «готовое изделие» принят (по фазе, не по уехавшей строке статуса)
    and not exists (
      select 1 from erp_subcontracting sc
      where sc.order_id = p_order_id
        and sc.op_type = 'finished_product'
        and sc.phase not in ('accepted', 'closed'))
    -- склад принял готовую продукцию — либо производства нет вовсе
    -- (подряд «под ключ»: этапов ноль, задача приёмки ГП не появится никогда)
    and (
      exists (
        select 1 from erp_warehouse_tasks t
        where t.order_id = p_order_id
          and t.task_type = 'fg_receipt'
          and t.status = 'accepted')
      or not exists (
        select 1 from erp_item_stages s
        join erp_order_items i on i.id = s.item_id
        where i.order_id = p_order_id));
$$;

revoke execute on function public.erp_can_pack_ship(uuid) from public, anon;
grant execute on function public.erp_can_pack_ship(uuid) to authenticated;

comment on function public.erp_can_pack_ship(uuid) is
  'Три предусловия упаковки одним выражением: этапы закрыты, подряд принят, склад принял ГП (или производства нет вовсе — подряд «под ключ»). Три копии этого условия уже разошлись, поэтому оно одно.';

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

  if new.status = 'done' then
    -- Все производственные этапы закрыты → продукция готова, склад её принимает
    if not exists (
      select 1 from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
      where i.order_id = v_order_id and s.status not in ('done','skipped')
    ) then
      insert into erp_warehouse_tasks (order_id, task_type, status)
      values (v_order_id, 'fg_receipt', 'awaiting')
      on conflict (order_id, task_type) do nothing;
    end if;

    if public.erp_can_pack_ship(v_order_id) then
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
  'Складские задачи из движения этапов. Предусловия упаковки считает erp_can_pack_ship() — копий этого условия было три, и они разошлись.';

create or replace function public.erp_warehouse_fg_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'accepted' or old.status = 'accepted' then
    return new;
  end if;
  if new.task_type not in ('fg_receipt', 'subcontract_receipt') then
    return new;
  end if;

  -- Приёмка подряда закрывает саму подрядную операцию.
  -- SECURITY DEFINER: кладовщик двигает склад, но `order.manage` у него нет.
  if new.task_type = 'subcontract_receipt' then
    update erp_subcontracting
       set phase = 'accepted',
           status = 'received_at_pinhead',
           returned_date = coalesce(returned_date, current_date)
     where order_id = new.order_id
       and op_type = 'finished_product'
       and phase not in ('accepted', 'closed');
  end if;

  if public.erp_can_pack_ship(new.order_id) then
    insert into erp_warehouse_tasks (order_id, task_type, status)
    values (new.order_id, 'pack_ship', 'awaiting_receipt')
    on conflict (order_id, task_type) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function public.erp_warehouse_fg_accepted() from anon, authenticated, public;

comment on function public.erp_warehouse_fg_accepted() is
  'Закрытие приёмки (ГП или подряда) открывает упаковку и закрывает подрядную операцию. Отдельный триггер, потому что к этому моменту все этапы закрыты — событий от них больше не будет. SECURITY DEFINER: кладовщик двигает склад, но не имеет order.manage.';

-- ── Находка 3: частичная приёмка ГП не закрывалась никогда ──
--
-- Карточка считала недостачу по ТЕКУЩЕЙ форме: «ожидалось − принято в этом
-- вводе». Приняли 60 из 100 — задача осталась открытой (верно). Назавтра
-- приняли ещё 40 — недостача снова считалась как 100 − 40 = 60, и задача
-- не закрывалась. Клиент журнал не читает, ручной кнопки «принять» нет,
-- а упаковка с 10.08 требует ПРИНЯТОЙ приёмки ГП — то есть заказ становилось
-- невозможно упаковать. Единственный обход — ввести все 100 разом, записав
-- в журнал 160 принятых единиц.
--
-- Решение принимает сервер: журнал лежит здесь, накопленная сумма считается
-- одним выражением, и второй источник правды клиенту не нужен.

create or replace function public.erp_warehouse_submit_report(
  p_task_id uuid,
  p_qty_in int,
  p_qty_good int,
  p_qty_defect int default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.erp_warehouse_tasks
language plpgsql security invoker set search_path = public as $$
declare
  v_row public.erp_warehouse_tasks;
  v_expected int;
  v_accepted int;
begin
  insert into public.erp_stage_reports
    (warehouse_task_id, qty_in, qty_good, qty_defect, comment, extra, author, author_id)
  values
    (p_task_id, p_qty_in, coalesce(p_qty_good, 0), coalesce(p_qty_defect, 0),
     nullif(btrim(p_comment), ''), coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid);

  select * into v_row from public.erp_warehouse_tasks where id = p_task_id;

  -- Приёмка ГП закрывается, когда НАКОПЛЕННАЯ приёмка добрала тираж.
  -- Брак в зачёт не идёт: он объясняет расхождение, а не заменяет недостающее.
  if v_row.task_type = 'fg_receipt' and v_row.status <> 'accepted' then
    select coalesce(sum(it.qty), 0) into v_expected
      from public.erp_order_items it where it.order_id = v_row.order_id;

    select coalesce(sum(r.qty_good), 0) into v_accepted
      from public.erp_stage_reports r where r.warehouse_task_id = p_task_id;

    if v_expected > 0 and v_accepted >= v_expected then
      update public.erp_warehouse_tasks set status = 'accepted' where id = p_task_id
      returning * into v_row;
    end if;
  end if;

  return v_row;
end $$;

revoke execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  from public, anon;
grant execute on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb)
  to authenticated;

comment on function public.erp_warehouse_submit_report(uuid, int, int, int, text, jsonb) is
  'Отчёт склада по задаче: строка в erp_stage_reports с якорем warehouse_task_id. Приёмка ГП закрывается по НАКОПЛЕННОЙ сумме журнала — частичная приёмка (60, потом 40) иначе не закрывалась никогда, а упаковка её требует.';

-- ── Находка 4: отклонённая приёмка считалась принятым количеством ──
--
-- Rollup складывал ВСЕ строки журнала, не глядя на `accept_status`. Отклонённая
-- поставка («не тот артикул, отправлено назад») увеличивала `qty_received`,
-- и закупка видела материал полностью принятым: подтверждение «принять как
-- полную приёмку?» переставало срабатывать, потому что недостачу обнуляла
-- строка, товар по которой уехал обратно.
--
-- Остальное поведение сохранено дословно: `sum` без coalesce (нет строк — NULL,
-- то есть «не приходило»), `max(received_on)` как дата последнего прихода,
-- `updated_at = now()` и `return null` (триггер AFTER).

create or replace function public.erp_material_receipts_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material uuid := coalesce(new.material_id, old.material_id);
begin
  update public.erp_materials m
     set qty_received = (
           select sum(r.qty) from public.erp_material_receipts r
            where r.material_id = v_material
              and coalesce(r.accept_status, '') <> 'rejected'
         ),
         received_at = (
           select max(r.received_on) from public.erp_material_receipts r
            where r.material_id = v_material
              and coalesce(r.accept_status, '') <> 'rejected'
         ),
         updated_at = now()
   where m.id = v_material;
  return null;
end $$;

revoke execute on function public.erp_material_receipts_rollup() from anon, authenticated, public;

comment on function public.erp_material_receipts_rollup() is
  'Сумма журнала приёмок в erp_materials.qty_received. Отклонённые строки НЕ считаются: товар отправлен назад, и включать его в принятое значит показать закупке полную приёмку там, где её не было.';

-- Пересчёт существующих строк по новому правилу
update public.erp_materials m
   set qty_received = (
         select sum(r.qty) from public.erp_material_receipts r
          where r.material_id = m.id and coalesce(r.accept_status, '') <> 'rejected')
 where exists (select 1 from public.erp_material_receipts r where r.material_id = m.id);
