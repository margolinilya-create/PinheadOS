-- Правки заказчика 30.08, п. 4 — завершение разработки и передача образца
-- на склад.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Сейчас после завершения разработки карточка остаётся
-- в колонке „Финальный этап" со статусом „Готовы к серии". Понятного действия,
-- которое завершает работу экспериментального цеха и передаёт готовый образец
-- на склад, нет… После подтверждения завершения разработки автоматически
-- создать задачу на складе на приём готового образца и передать заказ
-- в складской контур… убрать карточку из активной колонки „Финальный этап"
-- и присвоить разработке статус „Передано на склад"».
--
-- ── Решение 1: МОМЕНТ, А НЕ ВТОРОЙ СТАТУС ────────────────────────────────────
--
-- Заводится колонка `handed_to_warehouse_at timestamptz`, а не новое значение
-- `outcome`. Исход разработки уже отвечает на вопрос «чем всё кончилось»
-- («Готово к серии»), и «Передано на склад» — не другой исход, а ФАКТ
-- передачи, случившийся после него. Второе значение исхода заставило бы
-- выбирать между ними и потеряло бы первое: разработка, уехавшая на склад,
-- перестала бы числиться готовой к серии.
--
-- Подпись состояния при этом НЕ ХРАНИТСЯ — она выводится из колонки, как
-- и положено по правилу проекта.
--
-- ── Решение 2: СУЩЕСТВУЮЩИЙ ТИП ЗАДАЧИ `fg_receipt` ──────────────────────────
--
-- «Приёмка готовой продукции» — ровно то, что просит документ («задача
-- на складе на приём готового образца»). Новый тип складской задачи стоит
-- двенадцати точек касания (тип, CHECK, подписи, иконка, TERMINAL, TYPE_ORDER,
-- карточка, зеркало в `orderHelpers`…), и забытая среди них выдаёт задачу
-- в статусе, которого интерфейс не знает, — карточку без единой кнопки.
--
-- Дальше работает действующая логика склада без изменений, как документ
-- и просит: приёмка ГП открывает упаковку триггером `erp_warehouse_fg_accepted`.
--
-- ── Решение 3: ЧЕТВЁРТЫЙ ПИСАТЕЛЬ СКЛАДСКОЙ ЗАДАЧИ ───────────────────────────
--
-- Их теперь четыре: `erp_warehouse_task_derive` (по этапам),
-- `erp_warehouse_fg_accepted` (упаковка после приёмки), клиентский путь
-- подряда «под ключ» и этот триггер. Все обязаны заводить строку ОДИНАКОВО:
-- вставка идёт через `where not exists`, а не `on conflict` — уникальный
-- индекс частичный (`where stage_id is not null`), и голый ON CONFLICT
-- отвечает 42P10.
--
-- Условие `t.stage_id is null` в проверке существования дословно повторяет
-- то, что стоит у обоих серверных писателей: задача приёмки ГП принадлежит
-- ЗАКАЗУ, а не этапу.
--
-- `security definer` обязателен: закрывает разработку технолог
-- (`experimental.manage`), а RLS `erp_warehouse_tasks` на вставку требует
-- `warehouse.manage` либо `order.manage`. С `invoker` завершение разработки
-- падало бы 42501 внутри собственной транзакции — то есть кнопка «Завершить
-- разработку» не работала бы вовсе.

alter table public.erp_experimental
  add column if not exists handed_to_warehouse_at timestamptz;

comment on column public.erp_experimental.handed_to_warehouse_at is
  'Момент передачи образца на склад (правка 30.08, п. 4). Ставится триггером при появлении исхода «Готово к серии» вместе со складской задачей приёмки ГП. Состояние «Передано на склад» выводится из этой колонки и не хранится вторым статусом.';

create or replace function public.erp_dev_handoff_to_warehouse()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
begin
  -- Только переход В «готово к серии», и только один раз
  if new.outcome is distinct from 'ready_for_serial'
     or old.outcome is not distinct from new.outcome then
    return new;
  end if;
  if new.handed_to_warehouse_at is not null then
    return new;
  end if;

  select e.order_id into v_order_id
    from public.erp_experimental e where e.id = new.id;
  if v_order_id is null then
    return new;
  end if;

  insert into public.erp_warehouse_tasks (order_id, task_type, status)
  select v_order_id, 'fg_receipt', 'awaiting'
   where not exists (
     select 1 from public.erp_warehouse_tasks t
      where t.order_id = v_order_id
        and t.task_type = 'fg_receipt'
        and t.stage_id is null);

  -- Пишем в NEW, а не отдельным UPDATE: триггер BEFORE, и повторная запись
  -- в ту же строку из AFTER-триггера снова подняла бы этот же триггер.
  new.handed_to_warehouse_at := now();
  return new;
end $$;

-- Триггерная функция через REST не вызывается: обход
-- `20260812160000_erp_revoke_trigger_functions_sweep` закрыл то, что было
-- НА ТОТ МОМЕНТ, а у заведённой позже обязан быть свой полный revoke —
-- иначе право приходит от PUBLIC и наследуется `anon`. Сторожит
-- `triggerFunctionsRevoked.test.ts`.
revoke execute on function public.erp_dev_handoff_to_warehouse()
  from public, anon, authenticated;

comment on function public.erp_dev_handoff_to_warehouse() is
  'Завершение разработки передаёт образец на склад: задача приёмки ГП по заказу + отметка handed_to_warehouse_at (правка 30.08, п. 4).';

drop trigger if exists erp_dev_handoff_to_warehouse_trg on public.erp_experimental;

-- ПОСЛЕ стража пакета (`erp_dev_package_guard`, тоже BEFORE UPDATE): имя
-- триггера решает порядок, а `erp_dev_h…` идёт после `erp_dev_p…` по алфавиту
-- — то есть страж успевает отклонить неполный пакет ДО того, как мы заведём
-- складскую задачу. Порядок здесь не косметика: задача, созданная перед
-- отказом стража, откатилась бы вместе с транзакцией, но полагаться на это
-- значит зависеть от того, что страж бросает исключение, а не возвращает NULL.
create trigger erp_dev_handoff_to_warehouse_trg
  before update on public.erp_experimental
  for each row execute function public.erp_dev_handoff_to_warehouse();
