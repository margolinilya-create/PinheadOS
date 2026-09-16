-- РАСХОД ТКАНИ ПО РУЛОНАМ В ОТЧЁТЕ ЗАКРОЯ (правка заказчика 16.09, п. 4).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «В истории результата необходимо сохранять связь
-- конкретного рулона/партии с фактическим расходом материала и количеством
-- полученных изделий каждого размера. Эти данные в дальнейшем должны быть
-- доступны для расчёта фактического выхода изделий с рулона, анализа расхода
-- ткани, отклонений от норматива и сравнения партий материала».
--
-- ДВЕ ТАБЛИЦЫ, А НЕ ОДНА. `erp_stage_report_rolls` отвечает на вопрос
-- «сколько ткани ушло с рулона», `erp_stage_report_sizes.report_roll_id` —
-- «какие изделия из неё вышли». Складывать их в одну строку нельзя: расход
-- у рулона ОДИН, а размеров с него несколько, и «19,4 кг» повторилось бы
-- в каждой размерной строке — то есть при первом же `sum()` расход вырос бы
-- впятеро. Ровно этот вид ошибки и ловит правило про двух писателей.
--
-- УНИКАЛЬНОСТЬ РАЗМЕРНОЙ СТРОКИ ПЕРЕСОБРАНА. Прежнее ограничение
-- `(report_id, color, size)` запрещало один размер дважды в одном отчёте —
-- а закрой сдаёт «M» с двух рулонов сразу, и это разные строки. Теперь ключ
-- включает рулон, а `coalesce(..., нулевой uuid)` держит прежнее правило для
-- отчётов БЕЗ рулонов (склад, швейка): там строка размера по-прежнему одна.
--
-- СТАТУС РУЛОНА ПИШЕТ ОТЧЁТ, и UPDATE открывается ТЕМ ЖЕ правам, что и сдача
-- результата (`stage.progress`/`stage.complete`). Это не «право про запас»:
-- клиентский гейт кнопки «Сдать результат» стоит на них же, и ставятся оба
-- одним коммитом — правило раздела про стража и интерфейс.
--
-- `result_detail` — ПРИЗНАК УЧАСТКА В ДАННЫХ, а не `code === 'cutting'`
-- в коде. Рядом уже живут `result_fields`, `gate_material_kinds`
-- и `allows_over_plan`; константа вида «рулоны → закрой» прямо запрещена
-- правилом проекта. Значения засеяны закрою (`rolls`) и швейке (`sizes`).

create table if not exists public.erp_stage_report_rolls (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.erp_stage_reports(id) on delete cascade,
  -- Рулон мог быть снят вместе с приёмкой: расход и выход изделий остаются
  -- фактом истории, поэтому связь обнуляется, а строка живёт
  roll_id uuid references public.erp_material_rolls(id) on delete set null,
  material_id uuid references public.erp_materials(id) on delete set null,
  qty_used numeric not null check (qty_used > 0),
  unit text,
  roll_finished boolean not null default false,
  created_at timestamptz not null default now(),
  unique (report_id, roll_id)
);

create index if not exists erp_stage_report_rolls_report_idx
  on public.erp_stage_report_rolls (report_id);
create index if not exists erp_stage_report_rolls_roll_idx
  on public.erp_stage_report_rolls (roll_id);

comment on table public.erp_stage_report_rolls is
  'Расход ткани по рулонам в отчёте закроя (правка 16.09, п. 4): рулон × фактический расход';

alter table public.erp_stage_report_rolls enable row level security;

create policy erp_stage_report_rolls_read on public.erp_stage_report_rolls
  for select to authenticated
  using (public.erp_is_member());

create policy erp_stage_report_rolls_insert on public.erp_stage_report_rolls
  for insert to authenticated
  with check (public.erp_has_permission('stage.progress')
              or public.erp_has_permission('stage.complete'));

alter table public.erp_stage_report_sizes
  add column if not exists report_roll_id uuid
    references public.erp_stage_report_rolls(id) on delete cascade;

comment on column public.erp_stage_report_sizes.report_roll_id is
  'С какого рулона скроены эти изделия; NULL — результат без разбивки по рулонам';

alter table public.erp_stage_report_sizes
  drop constraint if exists erp_stage_report_sizes_report_id_color_size_key;

create unique index if not exists erp_stage_report_sizes_uniq
  on public.erp_stage_report_sizes
     (report_id, coalesce(report_roll_id, '00000000-0000-0000-0000-000000000000'::uuid), color, size);

create policy erp_material_rolls_update on public.erp_material_rolls
  for update to authenticated
  using (public.erp_has_permission('stage.progress')
         or public.erp_has_permission('stage.complete'))
  with check (public.erp_has_permission('stage.progress')
              or public.erp_has_permission('stage.complete'));

alter table public.erp_departments
  add column if not exists result_detail text
    check (result_detail is null or result_detail in ('rolls', 'sizes'));

comment on column public.erp_departments.result_detail is
  'Детализация результата участка: rolls — по рулонам и размерам, sizes — по размерам, NULL — числом';

update public.erp_departments set result_detail = 'rolls' where code = 'cutting';
update public.erp_departments set result_detail = 'sizes' where code = 'sewing';
