-- Разовая чистка маршрутов образцов, заведённых до правок 01.09.
-- Правка заказчика 01.09 (вторая итерация), пп. 2 и 4 — у уже созданных заказов.
--
-- ЗАЧЕМ ЧИСТКА, А НЕ ТОЛЬКО ПРАВКА КОДА. Дубль нанесения — не косметика:
-- этап маршрута навсегда остаётся `waiting`, а работа идёт на втором этапе,
-- поэтому швейка после него не откроется и заказ не закроется НИКОГДА.
-- Оставить это «разобрать руками» значило бы оставить семь заказов в тупике.
--
-- ИДЕМПОТЕНТНО: повторный прогон не находит ни одной строки под условия
-- и ничего не меняет.
--
-- ПРОВЕРЕНО ПЕРЕД НАПИСАНИЕМ: ни на этапы ВТО образцов, ни на дубли никто
-- не ссылается через `depends_on` (0 и 0), поэтому удаление не оставляет
-- висячих зависимостей. На дублях висят 7 задач разработки — они
-- перепривязываются ДО удаления: FK объявлен `on delete set null`,
-- и обратный порядок молча оборвал бы связь.

-- ── 1. Дубли нанесения ────────────────────────────────────────────────────
-- Пары «этап маршрута + экспериментальный этап того же цеха у той же позиции».
-- Сохраняем ЭТАП МАРШРУТА: он стоит в графе (`depends_on` у швейки указывает
-- на него), а дубль заведён вне маршрута с пустыми зависимостями.

-- 1.1 Задачи разработки переезжают на этап маршрута
update public.erp_experimental_tasks t
   set stage_id = p.id
  from public.erp_item_stages e
  join public.erp_item_stages p
    on p.item_id = e.item_id
   and p.department_id = e.department_id
   and p.origin = 'production'
   and p.id <> e.id
 where t.stage_id = e.id
   and e.origin = 'experimental';

-- 1.2 Факт переезжает туда же.
-- Статус переносим ТОЛЬКО `done`: `ready`/`in_progress` у этапа маршрута
-- означали бы, что предыдущий этап пройден, а это решает граф зависимостей,
-- а не мы. Готовность пересчитается сама, когда крой закроют.
update public.erp_item_stages p
   set qty_done   = greatest(coalesce(p.qty_done, 0), coalesce(e.qty_done, 0)),
       qty_rework = greatest(coalesce(p.qty_rework, 0), coalesce(e.qty_rework, 0)),
       started_at = coalesce(p.started_at, e.started_at),
       status     = case when e.status = 'done' then 'done' else p.status end,
       finished_at = case when e.status = 'done'
                          then coalesce(p.finished_at, e.finished_at, now())
                          else p.finished_at end
  from public.erp_item_stages e
 where e.origin = 'experimental'
   and e.item_id = p.item_id
   and e.department_id = p.department_id
   and p.origin = 'production'
   and p.id <> e.id;

-- 1.3 Дубль удаляется
delete from public.erp_item_stages e
 where e.origin = 'experimental'
   and exists (
     select 1 from public.erp_item_stages p
      where p.item_id = e.item_id
        and p.department_id = e.department_id
        and p.origin = 'production'
        and p.id <> e.id);

-- ── 2. ВТО у образцов ─────────────────────────────────────────────────────
-- «ВТО не должно автоматически добавляться в маршрут экспериментального цеха».
-- Убираем ТОЛЬКО не начатые: этап, который цех уже трогал, — это факт работы,
-- и стирать его задним числом нельзя (на проде такой один, он `done`).
delete from public.erp_item_stages s
 using public.erp_departments d, public.erp_order_items i
 where d.id = s.department_id
   and d.code = 'vto'
   and i.id = s.item_id
   and i.production_type = 'samples'
   and s.status = 'waiting'
   and coalesce(s.qty_done, 0) = 0
   and s.started_at is null;
