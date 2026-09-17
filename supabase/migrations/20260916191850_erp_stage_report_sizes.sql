-- РАЗМЕРНЫЙ РЕЗУЛЬТАТ ЭТАПА (правки заказчика 16.09, пп. 1, 4, 6).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. Три разных правки просят одно и то же — результат
-- этапа В РАЗРЕЗЕ РАЗМЕРОВ: склад принимает изделие «XS 10 / S 20 / M 15»
-- и вправе принять меньше заказанного (п. 1); закрой сдаёт раскрой по
-- размерам с каждого рулона (п. 4); швейка отчитывается таблицей «размер ×
-- сшито/брак/переделка» и не может сдать больше принятого из закроя (п. 6).
--
-- ОДНА ТАБЛИЦА НА ВСЕ ТРИ, а не jsonb у склада, таблица у закроя и колонки
-- у швейки. По этим числам считаются пять показателей будущего раздела
-- «Аналитика» и проверка «сшито+брак+переделка ≤ принято из закроя ПО ЭТОМУ
-- РАЗМЕРУ». Проверка считается СУММОЙ ПО ЖУРНАЛУ: отчётов у этапа много
-- (append-only, «сегодня 40, завтра 60»), и сравнивать надо накопленное.
-- Тремя разными хранилищами это стало бы тремя несходящимися ответами
-- на один вопрос.
--
-- ПОЧЕМУ НЕ `erp_stage_reports.extra`. Колонка уже занята другим смыслом —
-- «поля участка, которым не нашлось места в колонках» (схема `result_fields`,
-- target `extra`). Класть туда количества значит завести второй дом для
-- чисел, за которыми уже следят колонки. Плюс агрегация по размеру
-- разворачивала бы массив на каждый запрос, без индекса.
--
-- СТРОКА НЕСЁТ ЦВЕТ, а не только размер. `erp_order_items.size_grid` — это
-- `[{color, sizes:{...}}]`, то есть у позиции с двумя цветами «XS» само по
-- себе не адресует строку сетки. Цвет по умолчанию `'—'` — то же значение,
-- которым форма заказа заполняет сетку без цветового деления.

-- ── Сумма размерной сетки ──────────────────────────────────────────────────
/**
 * Итог по сетке `[{color, sizes:{XS:10,...}}]`.
 *
 * Заводится здесь, а не при первом использовании: тираж по сетке считают
 * и закупка готового изделия (следующая миграция), и аналитика. Формула
 * короткая и потому особенно охотно копируется по месту — а разойтись ей
 * достаточно в одном слагаемом.
 */
create or replace function public.erp_size_grid_total(p_grid jsonb)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  /*
    Проверка вида ДО разбора, а не в `where`: `jsonb_array_elements` падает
    на объекте и на строке раньше, чем условие успевает сработать, — то есть
    сетка, приехавшая объектом из старых данных, роняла бы сдачу результата
    вместо того, чтобы читаться нулём.
  */
  select coalesce(sum((v.value)::int), 0)::int
    from jsonb_array_elements(
           case when jsonb_typeof(coalesce(p_grid, '[]'::jsonb)) = 'array'
                then coalesce(p_grid, '[]'::jsonb) else '[]'::jsonb end) as row_el
    cross join lateral jsonb_each(
           case when jsonb_typeof(coalesce(row_el->'sizes', '{}'::jsonb)) = 'object'
                then row_el->'sizes' else '{}'::jsonb end) as v
   where jsonb_typeof(v.value) = 'number';
$$;

comment on function public.erp_size_grid_total(jsonb) is
  'Тираж по размерной сетке [{color, sizes}] — один источник для закупки и аналитики';

-- ── Строки размерного результата ───────────────────────────────────────────
create table if not exists public.erp_stage_report_sizes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.erp_stage_reports(id) on delete cascade,
  -- Цвет строки сетки. `'—'` — позиция без цветового деления
  color text not null default '—',
  size text not null,
  qty_good int not null default 0 check (qty_good >= 0),
  qty_defect int not null default 0 check (qty_defect >= 0),
  qty_rework int not null default 0 check (qty_rework >= 0),
  qty_extra int not null default 0 check (qty_extra >= 0),
  created_at timestamptz not null default now(),
  -- Пустая строка — это отсутствие строки, а не ноль по всем колонкам
  constraint erp_stage_report_sizes_not_empty
    check (qty_good + qty_defect + qty_rework + qty_extra > 0),
  constraint erp_stage_report_sizes_size_not_blank
    check (length(btrim(size)) > 0),
  unique (report_id, color, size)
);

create index if not exists erp_stage_report_sizes_report_idx
  on public.erp_stage_report_sizes (report_id);

comment on table public.erp_stage_report_sizes is
  'Результат этапа по размерам: строка = отчёт × цвет × размер (правки 16.09, пп. 1, 4, 6)';

alter table public.erp_stage_report_sizes enable row level security;

/**
 * Политики ЗЕРКАЛЯТ родительский журнал `erp_stage_reports`: читает участник
 * производства, пишет он же, а UPDATE и DELETE не открыты никому — журнал
 * append-only, и строка размера живёт ровно столько, сколько её отчёт
 * (`on delete cascade`).
 *
 * Политика пишется НА КОМАНДУ, а `auth`-вызовов в предикате нет вовсе:
 * `erp_is_member()` сама читает вызывающего.
 */
create policy erp_stage_report_sizes_read on public.erp_stage_report_sizes
  for select to authenticated
  using (public.erp_is_member());

create policy erp_stage_report_sizes_insert on public.erp_stage_report_sizes
  for insert to authenticated
  with check (public.erp_is_member());

-- ── Отчёт этапа принимает размерную разбивку ───────────────────────────────
/**
 * DROP + CREATE, А НЕ `create or replace` С ЛИШНИМ АРГУМЕНТОМ.
 *
 * `create or replace function` с ДРУГИМ числом аргументов создаёт ПЕРЕГРУЗКУ,
 * а не замену: две функции с дефолтами дают PostgREST неоднозначность
 * (`PGRST203`) — то есть цех перестаёт сдавать работу, а ни один тест этого
 * не видит (настоящего PostgREST не видит ни юнит, ни e2e).
 *
 * Обратная сторона известна и учтена: `drop` + `create` СБРАСЫВАЕТ
 * привилегии, и дыра вернулась бы МОЛЧА (правило сессии 62). Поэтому права
 * выставляются здесь же и явно, тем же набором, что стоял на бою:
 * postgres + authenticated + service_role, без PUBLIC и без `anon`.
 */
drop function if exists public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb);

create or replace function public.erp_stage_submit_report(
  p_stage_id uuid,
  p_qty_in integer,
  p_qty_good integer,
  p_qty_defect integer default 0,
  p_qty_rework integer default 0,
  p_qty_extra integer default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb,
  p_sizes jsonb default '[]'::jsonb
)
returns erp_item_stages
language plpgsql
set search_path to 'public'
as $function$
declare
  v_total  int;
  v_row    public.erp_item_stages;
  v_block  text;
  v_report uuid;
  v_sized  boolean;
  v_good   int;
  v_defect int;
  v_rework int;
  v_extra  int;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  v_sized := jsonb_typeof(p_sizes) = 'array' and jsonb_array_length(p_sizes) > 0;

  /**
   * КОГДА ЕСТЬ РАЗБИВКА, ЗАГОЛОВОЧНЫЕ ЧИСЛА СЧИТАЮТСЯ ИЗ НЕЁ.
   *
   * Иначе у `qty_good` два писателя — форма и сумма строк, — и разойдутся
   * они на первой же опечатке, причём молча: этап покажет одно, аналитика
   * по размерам другое. Скалярный путь остаётся для участков без сетки,
   * он не удаляется.
   */
  if v_sized then
    select coalesce(sum(r.qty_good), 0), coalesce(sum(r.qty_defect), 0),
           coalesce(sum(r.qty_rework), 0), coalesce(sum(r.qty_extra), 0)
      into v_good, v_defect, v_rework, v_extra
      from jsonb_to_recordset(p_sizes)
        as r(color text, size text, qty_good int, qty_defect int, qty_rework int, qty_extra int);
  else
    v_good   := coalesce(p_qty_good, 0);
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  end if;

  -- Гейт закупки: отчёт, добирающий тираж, закрывает этап (см. update ниже)
  v_block := public.erp_stage_completion_block(p_stage_id, v_good);
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system'),
     nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid)
  returning id into v_report;

  if v_sized then
    insert into public.erp_stage_report_sizes
      (report_id, color, size, qty_good, qty_defect, qty_rework, qty_extra)
    select v_report,
           coalesce(nullif(btrim(r.color), ''), '—'),
           btrim(r.size),
           coalesce(r.qty_good, 0), coalesce(r.qty_defect, 0),
           coalesce(r.qty_rework, 0), coalesce(r.qty_extra, 0)
      from jsonb_to_recordset(p_sizes)
        as r(color text, size text, qty_good int, qty_defect int, qty_rework int, qty_extra int)
     where btrim(coalesce(r.size, '')) <> ''
       and coalesce(r.qty_good, 0) + coalesce(r.qty_defect, 0)
         + coalesce(r.qty_rework, 0) + coalesce(r.qty_extra, 0) > 0;
  end if;

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, v_good, v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, v_rework),
         status = case
           when public.erp_clamp_done(s.qty_done, v_good, v_total) >= v_total
             then 'done' else s.status end,
         finished_at = case
           when public.erp_clamp_done(s.qty_done, v_good, v_total) >= v_total
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $function$;

comment on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb) is
  'Сдача результата этапа одной транзакцией: журнал + размерные строки + счётчики этапа';

/**
 * Права после DROP — явно и тем же набором, что был.
 *
 * `revoke … from anon` в одиночку НЕ РАБОТАЕТ: право приходит от PUBLIC,
 * и `anon` наследует его. Отзываем у обоих и следом возвращаем тем, кто
 * функцию действительно зовёт.
 */
revoke execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb)
  from public, anon;
grant execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb)
  to authenticated, service_role;
