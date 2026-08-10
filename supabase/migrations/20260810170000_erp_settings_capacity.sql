-- Общая мощность производства (правки заказчика 10.08, волна 2).
--
-- Документ: «Добавить настройку общей мощности производства — 10 000 единиц
-- в месяц. Дневная и недельная доступная мощность должны считаться из числа
-- рабочих дней, а не задаваться фиксированным числом на день».
--
-- ЕДИНИЦА СЧЁТА — ИЗДЕЛИЯ, А НЕ ЭТАПЫ. Это главное, что здесь легко испортить
-- позже. Одна футболка проходит закрой → нанесение → швейку → ВТО, и сумма по
-- этапам даёт четыре «единицы» вместо одной. Поэтому 10 000 сравнивается с
-- объёмом ЗАКАЗОВ месяца (сумма тиражей позиций по сроку сдачи), а поцеховая
-- сетка `/load` остаётся отдельной величиной и с мощностью не складывается.
-- Нормы отдельных цехов — следующая задача, и они лягут колонкой на
-- `erp_departments`, а не сюда.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ `erp_dictionaries`. Справочник — это список
-- значений-подсказок («причины блокировок»), у него kind/value/label и признак
-- активности. Настройка — одно значение на всю систему; складывать её в
-- справочник значит завести строку, которую нельзя «отключить» по смыслу.
--
-- ЗНАЧЕНИЕ — jsonb, а его форма живёт в `erp/utils/capacity.ts` вместе с
-- разбором. Разбор fail-open: нераспознанное или отсутствующее значение = «не
-- задано», и интерфейс показывает «—», а не выдуманный процент (правило
-- проекта: ноль в знаменателе — это «неизвестно», а не «готово»).

create table if not exists public.erp_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_by_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.erp_settings enable row level security;

-- Читают все участники: доступная мощность и процент загрузки показываются
-- цеху и менеджеру, а не только тому, кто настройку правит.
drop policy if exists "erp_settings_read" on public.erp_settings;
create policy "erp_settings_read" on public.erp_settings
  for select to authenticated using (public.erp_is_member());

-- Пишет тот же, кто ведёт план: мощность — часть планирования производства,
-- а не отдельная сущность. Нового права не заводим — оно бы ничего не выключало
-- сверх `plan.manage` (правило проекта против декоративных прав).
drop policy if exists "erp_settings_insert" on public.erp_settings;
create policy "erp_settings_insert" on public.erp_settings
  for insert to authenticated with check (public.erp_has_permission('plan.manage'));

drop policy if exists "erp_settings_update" on public.erp_settings;
create policy "erp_settings_update" on public.erp_settings
  for update to authenticated
  using (public.erp_has_permission('plan.manage'))
  with check (public.erp_has_permission('plan.manage'));

-- DELETE никому: настройка не удаляется, а перезаписывается. Пустое значение
-- выражается самим содержимым (`monthly_units: null`), и тогда интерфейс честно
-- говорит «мощность не задана».

-- Стартовое значение из документа. `do nothing` — чтобы повторный прогон
-- миграции не затирал то, что заказчик уже поправил в админке.
insert into public.erp_settings (key, value)
values ('production_capacity', '{"monthly_units": 10000, "work_days_per_week": 5}'::jsonb)
on conflict (key) do nothing;

-- В realtime НЕ публикуем: настройка меняется раз в месяц, а подписка на неё
-- стоила бы каждому открытому экрану постоянного канала. Значение приезжает
-- вместе с остальной оболочкой и обновляется при перезагрузке.
