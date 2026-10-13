-- Разовая чистка маршрутов образцов, заведённых до правок 02.09.
-- Решение владельца.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Если заказ отмечен как „образец“, закрой, пошив
-- и остальные внутренние этапы изготовления образца должны выполняться только
-- внутри экспериментального цеха. Отдельные задачи в обычных цехах „Закрой“,
-- „Швейка“, „ВТО“ и других не связанных с нанесениями цехах создаваться
-- и отображаться не должны».
--
-- ЧТО ЧИНИТ КОД, А ЧТО — ЭТА МИГРАЦИЯ. Маршрут строит КЛИЕНТ
-- (`utils/routes.buildItemRoute` → секция `stages` payload `erp_create_order`),
-- поэтому новые образцы поедут правильно от одной правки `BASE_CHAIN`.
-- Заведённые этапы правка кода не трогает, и это не косметика: приёмка готовой
-- продукции заводится, только когда у заказа НЕ ОСТАЛОСЬ этапов вне
-- `done/skipped`, а незакрытый крой образца, которого никто не делает,
-- не закроется никогда — заказ встанет молча.
--
-- ── ЧТО НЕ УДАЛЯЕТСЯ И ПОЧЕМУ ────────────────────────────────────────────────
--
-- Этап с ФАКТОМ — это работа, которая была сделана: `qty_done`, `qty_rework`,
-- `started_at`, `finished_at`. Удалить его значит стереть, кто и когда сдал
-- крой. Предикат дословно повторяет RLS `erp_item_stages_delete` — там та же
-- граница, и расходиться им нельзя.
--
-- Этап с ПРИВЯЗАННОЙ ЗАДАЧЕЙ РАЗРАБОТКИ — это законное нанесение (п. 6
-- документа): его туда отправил технолог, войдя в шаг «Нанесения», и цех эту
-- работу видит. Этап нанесения БЕЗ задачи означает обратное — технолог
-- в «Нанесения» ещё не входил, и такой этап заведётся заново сам,
-- когда войдёт (`erp_experimental_task_send`).
--
-- Заодно исключены этапы, на которые ссылается хоть что-то ещё: журнал
-- (`erp_stage_events`), производственный план (`erp_calendar_slots`), складские
-- задачи и карточка подрядчика. Ни у одного кандидата таких ссылок нет —
-- проверка стоит не ради сегодняшних данных, а ради повторного прогона.
--
-- ── `depends_on` ЧИСТИТСЯ, И ЭТИМ ЧИСТКА ОТЛИЧАЕТСЯ ОТ 01.09 ────────────────
--
-- Там зависимых было ноль, и шага не было вовсе. Здесь на кандидатов ссылаются
-- 15 этапов: снятое нанесение ждало кроя, швейка ждала нанесения. Оставленный
-- «висячий» id читается гейтом как выполненная зависимость (`isStageReady`
-- fail-open по отсутствующей строке), то есть работал бы как надо, — но
-- это совпадение, а не правило, и первая же выборка по `depends_on` начнёт
-- врать. Чистим ДО удаления: обратный порядок не даст найти, что вычищать.
--
-- СТАТУСЫ НЕ ПЕРЕПИСЫВАЮТСЯ. У сохранённого нанесения `depends_on` опустеет,
-- и `isStageReady` сама отдаст его цеху как готовое к работе. Проставлять
-- `ready` руками значило бы решать за граф зависимостей — то же правило,
-- что записано в чистке 01.09.
--
-- ИДЕМПОТЕНТНО: повторный прогон не находит ни одной строки.
--
-- Замер перед применением (02.09): 24 кандидата — 9 «Закрой», 11 «Швейка»,
-- 3 «Вышивка», 1 «Шелкография»; 15 зависимостей. Остаются 5 кроёв, 3 швейки,
-- 1 ВТО и 7 нанесений — все с фактом либо с задачей разработки.

create temporary table erp_sample_route_orphans on commit drop as
select s.id
  from public.erp_item_stages s
  join public.erp_order_items i on i.id = s.item_id
  join public.erp_departments d on d.id = s.department_id
 where i.production_type = 'samples'
   and d.is_production
   and s.status not in ('done', 'skipped')
   and coalesce(s.qty_done, 0) = 0
   and coalesce(s.qty_rework, 0) = 0
   and s.started_at is null
   and s.finished_at is null
   and not exists (select 1 from public.erp_experimental_tasks t where t.stage_id = s.id)
   and not exists (select 1 from public.erp_stage_events e where e.stage_id = s.id)
   and not exists (select 1 from public.erp_calendar_slots c where c.stage_id = s.id)
   and not exists (select 1 from public.erp_warehouse_tasks w where w.stage_id = s.id)
   and not exists (select 1 from public.erp_subcontracting sc where sc.stage_id = s.id);

-- 1. Зависимости — ДО удаления
update public.erp_item_stages s
   set depends_on = (
     select coalesce(array_agg(x), '{}')
       from unnest(s.depends_on) as x
      where x not in (select id from erp_sample_route_orphans))
 where exists (
   select 1 from erp_sample_route_orphans o where o.id = any (s.depends_on));

-- 2. Сами этапы
delete from public.erp_item_stages s
 where s.id in (select id from erp_sample_route_orphans);
