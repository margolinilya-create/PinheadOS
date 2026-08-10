-- Обязательный цифровой результат каждого этапа (правки заказчика 10.08, P2).
--
-- Документ: «Каждый этап должен завершаться внесением количественного
-- результата: сколько принято, сколько сделано, сколько брака, сколько
-- передано дальше. Набор полей у разных участков разный».
--
-- ЖУРНАЛ, А НЕ СНИМОК. `erp_stage_reports` пишется только вставками: цех
-- сдаёт работу частями («сегодня 40, завтра 60»), и каждая сдача — своя строка
-- со своим автором и временем. Агрегат остаётся в `erp_item_stages.qty_done`
-- и `qty_rework` — их продолжают читать очередь, канбан, прогресс и гейты.
-- Второго источника правды нет: журнал хранит ПРИРАЩЕНИЯ, этап — ИТОГ.
--
-- ПОЧЕМУ НЕ КОЛОНКИ НА ЭТАПЕ. Двенадцать-пятнадцать полей на самой горячей
-- таблице: каждое пришлось бы вносить в страж, в `ORDER_LIST_SELECT` по 443
-- этапам и в миграцию при заведении нового участка. И один снимок вместо
-- множественных сдач — то есть «сдал 40, потом 60» стало бы «сдал 60».
--
-- ПОЧЕМУ НЕ ОДИН jsonb НА ЭТАПЕ. Абсолютная запись с клиента (правило проекта
-- прямо запрещает: два планшета в цехе затирают запись друг друга) плюс тот же
-- один снимок вместо журнала.
--
-- СХЕМА ПОЛЕЙ — ИЗ ДАННЫХ, а не из кода: `erp_departments.result_fields`.
-- Пусто = участок отчёта не требует (fail-open, ровно как `gate_material_kinds`).
-- Константа «у закроя такие-то поля» в коде не держится — именно это правило
-- уже спасло материальный гейт, когда участок, заведённый директором, не попал
-- бы ни под одну проверку.
--
-- ЯКОРЬ — ЭТАП ИЛИ СКЛАДСКАЯ ЗАДАЧА. Приёмка готовой продукции складом
-- (волна 3.4) считается в тех же штуках изделий и обязана попадать в тот же
-- журнал: иначе «сколько пришло на склад ГП» пришлось бы собирать из двух мест.
-- Материалы туда НЕ идут — граница проведена по единице измерения: штуки
-- изделий сюда, кг/м/уп — в журнал приёмки материалов (волна 3.3).

-- ── Схема полей участка ──

alter table public.erp_departments
  add column if not exists result_fields jsonb not null default '[]'::jsonb;

comment on column public.erp_departments.result_fields is
  'Какие числа участок вносит по завершении работы: [{code,label,unit,required,target}]. target: qty_good|qty_defect|qty_rework|qty_extra|extra. Пусто — отчёт не требуется (fail-open).';

-- ── Журнал результатов ──

create table if not exists public.erp_stage_reports (
  id uuid primary key default gen_random_uuid(),
  -- Ровно один якорь: этап производства ИЛИ задача склада
  stage_id uuid references public.erp_item_stages(id) on delete cascade,
  warehouse_task_id uuid references public.erp_warehouse_tasks(id) on delete cascade,
  -- Снимок входа на момент сдачи: сколько цех видел принятым. Считает клиент
  -- (`utils/stageInput`), потому что обход `depends_on` живёт там и второй
  -- реализации на SQL быть не должно. Это аудит, а не расчёт.
  qty_in int,
  qty_good int not null default 0 check (qty_good >= 0),
  qty_defect int not null default 0 check (qty_defect >= 0),
  qty_rework int not null default 0 check (qty_rework >= 0),
  -- Сверх тиража: пересорт, довложение, найденное на складе
  qty_extra int not null default 0 check (qty_extra >= 0),
  comment text,
  -- Поля участка, которым не нашлось места в колонках (по схеме result_fields)
  extra jsonb not null default '{}'::jsonb,
  author text,
  author_id uuid,
  created_at timestamptz not null default now(),

  constraint erp_stage_reports_anchor check (
    (stage_id is not null and warehouse_task_id is null)
    or (stage_id is null and warehouse_task_id is not null)
  ),
  -- Отклонение обязано быть объяснено. CHECK, а не проверка в коде: правило
  -- одно, и оно должно действовать одинаково из интерфейса, из RPC и из SQL.
  constraint erp_stage_reports_defect_needs_comment check (
    (qty_defect = 0 and qty_rework = 0)
    or (comment is not null and length(btrim(comment)) > 0)
  ),
  -- Пустой отчёт не отчёт
  constraint erp_stage_reports_not_empty check (
    qty_good + qty_defect + qty_rework + qty_extra > 0
  )
);

create index if not exists erp_stage_reports_stage_idx
  on public.erp_stage_reports (stage_id, created_at desc);
create index if not exists erp_stage_reports_task_idx
  on public.erp_stage_reports (warehouse_task_id, created_at desc);

alter table public.erp_stage_reports enable row level security;

-- Читают все участники: цифры участка видит и следующий цех, и менеджер.
drop policy if exists "erp_stage_reports_read" on public.erp_stage_reports;
create policy "erp_stage_reports_read" on public.erp_stage_reports
  for select to authenticated using (public.erp_is_member());

-- Пишет только RPC (см. ниже): прямую вставку не открываем, иначе счётчик
-- этапа и журнал разойдутся — а именно их единство и есть смысл затеи.
-- UPDATE/DELETE не открыты никому: журнал append-only.

-- ── Запись отчёта ──
--
-- Одна транзакция: строка журнала + приращение счётчиков этапа общим правилом
-- (`erp_clamp_done`/`erp_clamp_rework` из 20260810180000). Разделить нельзя:
-- журнал без счётчика — цифры, которых не видит производство; счётчик без
-- журнала — число без объяснения.
--
-- НОВОГО ПРАВА НЕ ЗАВОДИМ (правило: право обязано что-то выключать). UPDATE
-- этапа и так идёт через `erp_stage_guard`, где `qty_done` под `stage.progress`,
-- а `qty_rework` под `stage.defect`. Функция SECURITY INVOKER — «одним
-- запросом» не означает «мимо RLS»: страж сработает от лица вызывающего.
create or replace function public.erp_stage_submit_report(
  p_stage_id uuid,
  p_qty_in int,
  p_qty_good int,
  p_qty_defect int default 0,
  p_qty_rework int default 0,
  p_qty_extra int default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.erp_item_stages
language plpgsql security invoker set search_path = public as $$
declare
  v_total int;
  v_row   public.erp_item_stages;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id)
  values
    (p_stage_id, p_qty_in, coalesce(p_qty_good, 0), coalesce(p_qty_defect, 0),
     coalesce(p_qty_rework, 0), coalesce(p_qty_extra, 0), nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid);

  -- ОДИН update: счётчики меняются вместе, поэтому страж разбирает изменение
  -- как одно целое (то же правило, что в 20260810180000).
  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, coalesce(p_qty_rework, 0)),
         status = case
           when public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total) >= v_total
             then 'done' else s.status end,
         finished_at = case
           when public.erp_clamp_done(s.qty_done, coalesce(p_qty_good, 0), v_total) >= v_total
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb)
  from public, anon;
grant execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb)
  to authenticated;

comment on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb) is
  'Отчёт цеха одной транзакцией: строка журнала + приращение счётчиков этапа. SECURITY INVOKER — страж этапов проверяет права от лица вызывающего.';

-- Вставка идёт только через RPC, но политика нужна: функция SECURITY INVOKER,
-- то есть RLS применяется к ней так же, как к прямому запросу.
drop policy if exists "erp_stage_reports_insert" on public.erp_stage_reports;
create policy "erp_stage_reports_insert" on public.erp_stage_reports
  for insert to authenticated with check (public.erp_is_member());

-- ── Сид полей по документу заказчика ──
--
-- Заполняем только пустые: если участок уже настроили в админке, миграция
-- не должна затирать настройку.
update public.erp_departments d
   set result_fields = v.fields
  from (values
    ('supply',       '[{"code":"received","label":"Пришло","unit":"ед.","required":true,"target":"qty_good"},{"code":"defect","label":"Брак при приёмке","unit":"ед.","required":false,"target":"qty_defect"}]'::jsonb),
    ('warehouse',    '[{"code":"accepted","label":"Принято","unit":"ед.","required":true,"target":"qty_good"},{"code":"short","label":"Недостача","unit":"ед.","required":false,"target":"qty_defect"}]'::jsonb),
    ('cutting',      '[{"code":"cut","label":"Скроено","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"}]'::jsonb),
    ('sewing',       '[{"code":"sewn","label":"Сшито","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"},{"code":"rework","label":"В переделку","unit":"шт","required":false,"target":"qty_rework"}]'::jsonb),
    ('silkscreen',   '[{"code":"printed","label":"Нанесено","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"}]'::jsonb),
    ('dtf',          '[{"code":"printed","label":"Нанесено","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"}]'::jsonb),
    ('embroidery',   '[{"code":"printed","label":"Вышито","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"}]'::jsonb),
    ('vto',          '[{"code":"pressed","label":"Отутюжено","unit":"шт","required":true,"target":"qty_good"},{"code":"defect","label":"Брак","unit":"шт","required":false,"target":"qty_defect"}]'::jsonb),
    ('warehouse_fg', '[{"code":"accepted","label":"Принято на склад","unit":"шт","required":true,"target":"qty_good"},{"code":"packed","label":"Упаковано","unit":"шт","required":false,"target":"qty_extra"}]'::jsonb)
  ) as v(code, fields)
 where d.code = v.code
   and (d.result_fields is null or d.result_fields = '[]'::jsonb);

-- Realtime НЕ публикуем: журнал пишется часто, а подписанная и необработанная
-- таблица роняет всё в `scheduleFullReload()` — полная перезагрузка заказов
-- на каждую строку. Отчёты приезжают вместе с пакетом карточки заказа.
