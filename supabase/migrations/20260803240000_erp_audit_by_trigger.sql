-- B5 (аудит 29.07): аудит производства перестаёт зависеть от браузера.
--
-- Находка: `logStageEvent` — fire-and-forget с одной повторной попыткой. Закрытая
-- вкладка или потеря сети = событие потеряно, а ДВИЖЕНИЕ ОСТАЛОСЬ: этап уже
-- переведён. Плюс `actor` хранится ИМЕНЕМ строкой — переименовали сотрудника,
-- и история порвалась; тёзки неразличимы. Смежные таблицы (материалы, позиции,
-- закупка, подряд, смена исполнителя) не логировались вообще, а именно эти
-- правки срывают заказ.
--
-- ── Почему не переписываем `erp_stage_events` на триггер ──
-- Оно несёт человекочитаемый комментарий («Возврат брака…», «Перенос: X → Y»),
-- которого в базе нет: намерение знает только клиент. Триггер написал бы
-- «status: in_progress → done» вместо «Перенос: Закрой → Швейка», и история
-- в карточке стала бы беднее, чем сегодня.
--
-- Поэтому разделяем роли, а не заменяем одно другим:
--   * `erp_stage_events` остаётся богатой лентой действий (пишет клиент, как и был);
--   * `erp_order_audit` становится ГАРАНТИРОВАННЫМ следом (пишет триггер).
-- Закрылась вкладка — лента потеряет строку, но факт движения останется в аудите
-- вместе с тем, кто его сделал. Ровно та дыра, которую называет находка.
-- Механика взята готовая: так уже логировались плановые даты этапа
-- (`erp_log_stage_plan_changes`), теперь она обобщена на пять таблиц.

-- ── 1. Действующее лицо как uuid ──
-- Имя оставляем: история читается человеком, и join на каждую строку ради
-- подписи не нужен. Но опорой становится id — он переживает переименование
-- и различает тёзок.
alter table public.erp_order_audit
  add column if not exists changed_by_id uuid references public.profiles(id) on delete set null;
alter table public.erp_stage_events
  add column if not exists actor_id uuid references public.profiles(id) on delete set null;

create index if not exists erp_order_audit_actor_idx on public.erp_order_audit (changed_by_id);

-- ── 2. Общий журналист ──
-- Аргументы триггера: [0] — как добраться до заказа ('order_id' | 'item_id'),
-- [1] — префикс поля, [2..] — какие колонки писать.
--
-- Префикс обязателен для НОВЫХ источников: `status` есть и у заказа, и у материала,
-- и у этапа, а `field_name` в аудите один на всех — без префикса история показывала
-- бы «Статус заказа» на смену статуса материала. Плановые даты этапа продолжают
-- писаться БЕЗ префикса (`planned_start`/`planned_end`): такие строки уже есть
-- в проде, и переименование поменяло бы смысл прошлого.
create or replace function public.erp_log_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor    text;
  v_actor_id uuid;
  v_order    uuid;
  v_prefix   text := TG_ARGV[1];
  f          text;
  old_v      text;
  new_v      text;
  i          int;
begin
  v_actor_id := (select auth.uid());
  select coalesce(p.name, p.email) into v_actor
    from public.profiles p where p.id = v_actor_id;
  v_actor := coalesce(v_actor, 'система');

  if TG_ARGV[0] = 'item_id' then
    select order_id into v_order from public.erp_order_items where id = new.item_id;
  else
    v_order := new.order_id;
  end if;
  -- Позиция могла быть удалена каскадом: писать аудит некуда, но и падать
  -- на этом нельзя — иначе триггер уронит саму работу цеха.
  if v_order is null then
    return new;
  end if;

  for i in 2 .. array_upper(TG_ARGV, 1) loop
    f := TG_ARGV[i];
    execute format('select ($1).%I::text, ($2).%I::text', f, f)
      into old_v, new_v using old, new;
    if old_v is not distinct from new_v then
      continue;
    end if;

    -- Цех в истории должен читаться названием, а не uuid.
    if f = 'department_id' then
      select name into old_v from public.erp_departments where id::text = old_v;
      select name into new_v from public.erp_departments where id::text = new_v;
    end if;

    insert into public.erp_order_audit
      (order_id, field_name, old_value, new_value, changed_by, changed_by_id)
    values
      (v_order,
       case when v_prefix = '' then f else v_prefix || '.' || f end,
       old_v, new_v, v_actor, v_actor_id);
  end loop;
  return new;
end $$;

-- ── 3. Этапы: плановые даты как были + движение производства ──
-- Прежний триггер писал только план. Заменяем двумя: план — без префикса
-- (продолжение существующей истории), остальное — с префиксом `stage`.
drop trigger if exists erp_stages_plan_audit on public.erp_item_stages;
create trigger erp_stages_plan_audit after update on public.erp_item_stages
  for each row execute function public.erp_log_changes('item_id', '', 'planned_start', 'planned_end');

drop trigger if exists erp_stages_audit on public.erp_item_stages;
create trigger erp_stages_audit after update on public.erp_item_stages
  for each row execute function public.erp_log_changes(
    'item_id', 'stage',
    'status', 'qty_done', 'qty_rework', 'assignee', 'department_id', 'block_reason');

-- ── 4. Смежные таблицы, которые не логировались вообще ──
drop trigger if exists erp_materials_audit on public.erp_materials;
create trigger erp_materials_audit after update on public.erp_materials
  for each row execute function public.erp_log_changes(
    'order_id', 'material',
    'status', 'accept_status', 'qty_expected', 'qty_received',
    'eta_date', 'supplier', 'responsible', 'name', 'kind');

drop trigger if exists erp_order_items_audit on public.erp_order_items;
create trigger erp_order_items_audit after update on public.erp_order_items
  for each row execute function public.erp_log_changes(
    'order_id', 'item', 'qty', 'product_type', 'variant', 'notes');

drop trigger if exists erp_procurement_audit on public.erp_procurement_tasks;
create trigger erp_procurement_audit after update on public.erp_procurement_tasks
  for each row execute function public.erp_log_changes(
    'order_id', 'procurement',
    'status', 'required_qty', 'supplier', 'planned_date', 'responsible');

drop trigger if exists erp_subcontracting_audit on public.erp_subcontracting;
create trigger erp_subcontracting_audit after update on public.erp_subcontracting
  for each row execute function public.erp_log_changes(
    'order_id', 'subcontract',
    'status', 'contractor', 'qty', 'planned_date', 'returned_date', 'delay_comment');

-- ── 5. Историю нельзя подделать и нельзя читать до одобрения ──
-- Политики стояли `using (true)` / `with check (true)`: любой авторизованный,
-- включая неодобренного, читал ленту всех заказов и мог дописать в неё что угодно.
drop policy if exists erp_stage_events_read on public.erp_stage_events;
create policy erp_stage_events_read on public.erp_stage_events
  for select to authenticated using (public.erp_is_member());
drop policy if exists erp_stage_events_insert on public.erp_stage_events;
create policy erp_stage_events_insert on public.erp_stage_events
  for insert to authenticated with check (public.erp_is_member());

comment on function public.erp_log_changes() is
  'Общий аудит: пишет изменения перечисленных колонок в erp_order_audit с actor-id. Аргументы: (order_id|item_id, префикс поля, колонки...).';
comment on column public.erp_stage_events.actor_id is
  'Кто совершил действие. Имя в actor остаётся для чтения, но опора — id: он переживает переименование и различает тёзок.';
