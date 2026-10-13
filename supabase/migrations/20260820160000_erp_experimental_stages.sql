-- Экспериментальный цех по ЭТАПАМ (правки заказчика 20.08), ч.1: схема.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Главный экран экспериментального цеха должен быть
-- построен по этапам… Колонки: Построение лекал · Крой · Нанесения · Пошив ·
-- Финальный этап». И отдельно: «задача на построение лекал должна создаваться
-- СРАЗУ после запуска разработки. Приход материалов не должен блокировать этот
-- этап»; «крой можно начать только когда лекала готовы И материалы физически
-- приняты складом»; «после сборки образца должна быть возможность
-- зафиксировать результат: образец утверждён / требуется доработка».
--
-- ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Колонки `phase` (или её двойника под другим именем)
-- не появляется: этап разработки ВЫЧИСЛЯЕТСЯ из её задач
-- (`utils/experimentalBoard`). Линейную фазовую модель убрали 12.08 осознанно,
-- и второй источник правды рядом с задачами разъехался бы в первую же неделю.
--
-- ЧТО ХРАНИТСЯ. Ровно одно решение, которого из задач не вывести:
-- «образец утверждён». Закрытая примерка одинаково означает и «принято»,
-- и «не принято» — сегодня разница живёт в свободном тексте `result`, то есть
-- не читается ничем.

-- ── 1. Утверждение образца ───────────────────────────────────────────────────
alter table public.erp_experimental
  add column if not exists sample_approved_at   timestamptz,
  add column if not exists sample_approved_by   text,
  add column if not exists sample_approved_note text;

comment on column public.erp_experimental.sample_approved_at is
  'Образец утверждён. Решение человека, а не производная от статусов задач: закрытая примерка означает и «принято», и «не принято».';

-- ── 2. Типы задач под шаги доски ─────────────────────────────────────────────
--
-- `cutting` не было вовсе — крой экс-цеха заводили как «проработку образца»,
-- и отделить его от пошива было нечем. `dtg` — новый участок нанесения.
insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'experimental_task_type', v.code, v.name, v.ord, true
from (values ('cutting', 'Крой', 35), ('dtg', 'DTG', 65)) as v(code, name, ord)
where not exists (
  select 1 from public.erp_dictionaries d
   where d.kind = 'experimental_task_type' and d.code = v.code);

-- ── 3. Материальный гейт кроя — ИЗ ДАННЫХ ────────────────────────────────────
--
-- Крой экс-цеха «является собственным этапом экс цеха и не должен смешиваться
-- с очередью серийной закройки» — значит и настройка гейта у него своя.
-- Брать `gate_material_kinds` у цеха `cutting` было бы враньём о том, чей это
-- участок: админ, поменяв настройку серийного кроя, молча поменял бы ЭКС.
-- Ставим только если пусто: настройка правится в админке, и затирать
-- сделанный человеком выбор нельзя.
update public.erp_departments
   set gate_material_kinds = array['fabric']
 where code = 'experimental'
   and (gate_material_kinds is null or cardinality(gate_material_kinds) = 0);

-- ── 4. Стартовая задача заводится ТОЙ ЖЕ транзакцией ─────────────────────────
--
-- Разработка создавалась обычным INSERT и БЕЗ ЕДИНОЙ ЗАДАЧИ: доска по этапам
-- у такой разработки пуста, а документ требует задачу на лекала сразу.
-- Два запроса подряд («создать разработку», потом «добавить задачу») — это
-- действие из нескольких записей без транзакции: при сбое второго получилась
-- бы разработка без обязательной задачи, и никто бы не заметил.
--
-- Автоматически заводится ТОЛЬКО задача лекал. Крой, нанесения и пошив
-- документ создаёт по потребности («после кроя создаётся задача на вышивку»),
-- а четыре пустые задачи по умолчанию вернули бы линейный план, от которого
-- отказались 12.08. Пустой шаг доска показывает и без задачи.
create or replace function public.erp_experimental_create(
  p_order_id  uuid,
  p_item_id   uuid,
  p_tech_name text default null,
  p_tasks     jsonb default null
)
returns public.erp_experimental
language plpgsql security invoker set search_path = public as $$
declare
  v_dev public.erp_experimental;
begin
  insert into public.erp_experimental (order_id, item_id, tech_name)
  values (p_order_id, p_item_id, nullif(btrim(coalesce(p_tech_name, '')), ''))
  returning * into v_dev;

  perform public.erp_experimental_add_tasks(
    v_dev.id,
    coalesce(p_tasks, '[{"task_type":"patterns","title":"Построение лекал"}]'::jsonb)
  );

  return v_dev;
end $$;

grant execute on function public.erp_experimental_create(uuid, uuid, text, jsonb)
  to authenticated;

comment on function public.erp_experimental_create(uuid, uuid, text, jsonb) is
  'Создание разработки вместе со стартовыми задачами одной транзакцией. По умолчанию заводится задача лекал: документ требует её сразу после запуска разработки.';

-- ── 5. Ловушка прав, из-за которой стартовая задача не создалась бы ──────────
--
-- INSERT в `erp_experimental` разрешён под `experimental.manage` ИЛИ
-- `order.manage` (20260812130000 — иначе менеджер, заводящий заказ-образец,
-- получал 42501 молча, и 15 позиций из 21 остались без разработки).
-- А INSERT в `erp_experimental_tasks` стоит ТОЛЬКО под `experimental.manage`:
-- та же самая транзакция упала бы на стартовой задаче — теперь уже с заказом,
-- который создан. Расширяем ровно одну дверь; UPDATE и DELETE не трогаем.
drop policy if exists erp_experimental_tasks_insert on public.erp_experimental_tasks;
create policy erp_experimental_tasks_insert on public.erp_experimental_tasks
  for insert to authenticated
  with check (
    public.erp_has_permission('experimental.manage')
    or public.erp_has_permission('order.manage')
  );
