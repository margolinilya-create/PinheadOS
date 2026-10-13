-- УЧЁТ ПОЛОТНА В ПОГОННЫХ МЕТРАХ (правка заказчика 27.09, п. 4).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Перевести ввод расхода и остатка в закройке
-- на погонные метры. В закупке всегда указываются вес в кг и цена за кг.
-- Стоимость за метр система рассчитывает автоматически… Пересчёт выполнять
-- при приёмке каждого рулона на склад; недостающие параметры разрешить
-- заполнить в закройке до записи расхода».
--
-- ЭТО ОТМЕНЯЕТ ПРАВИЛО СЕССИИ 64 «пересчёта единиц система не делает».
-- Тогда у единицы не было коэффициента, и «61 кг + 120 м» было выдумкой.
-- Теперь коэффициент кг/м есть — у КАЖДОГО РУЛОНА свой (плотность у каждого
-- артикула своя), и метры связаны с килограммами через него. Общего курса
-- «кг → м» по-прежнему не существует; комментарий у `price_per_unit`
-- («НЕ коэффициент») остаётся верным про цену — коэффициент лежит рядом.
--
-- ФОРМУЛЫ ДОКУМЕНТА (те же на клиенте — `utils/fabricMetres.ts`):
--   расчётный метраж = вес, кг × 1000 / (ширина, м × плотность, г/м²);
--   коэффициент кг/м = ширина, м × плотность / 1000, либо вес / метраж при замере;
--   цена за метр     = цена за кг × коэффициент;
--   вес расхода      = метры × коэффициент (расчётный, не взвешенный).
-- Пример: 20 кг, 180 см, 240 г/м² → 46,296… м; 0,432 кг/м; 950 ₽/кг →
-- 410,40 ₽/м; 10 м → 4,320 кг, 4 104 ₽. Точность в расчётах полная,
-- округление — только в показе (метры 0,01; кг 0,001).
--
-- ЧТО ДОБАВЛЯЕТСЯ.
--   · `erp_materials.width_cm`, `.density_gsm` — параметры ткани в карточке
--     закупки, подставляются в рулоны при приёмке;
--   · у рулона: параметры (уточняемые для партии), расчётный и рабочий метраж
--     с источником, коэффициент с источником, остаток в метрах, цена за метр;
--   · у строки расхода: метры, коэффициент, источник, цена и стоимость
--     СНИМКОМ — «изменение справочника материала не должно менять закрытые
--     операции». `qty_used` (кг) остаётся: у старых строк — введённое,
--     у новых — расчётное (`qty_source`);
--   · `erp_material_roll_adjustments` — корректировки метража с причиной,
--     автором и датой: «расхождение с расчётом сохранять отдельной
--     корректировкой… не добавлять его автоматически в расход или брак»;
--   · `erp_roll_recalc` — пересчёт производных рулона (внутренняя);
--   · `erp_material_accept(… p_roll_params)` — приёмка с параметрами каждого
--     рулона; `p_roll_weights` ОСТАЁТСЯ: офлайн-очередь склада хранит уже
--     собранные вызовы, и снять параметр значило бы уронить их в день выката;
--   · `erp_material_roll_set_params` — дозаполнение и уточнение (склад
--     и закрой): до первого расхода пересчитывает цену метра из стоимости
--     рулона; после — пишет корректировку и новые коэффициенты
--     «остаточная стоимость / уточнённый остаток» (расчётные);
--   · `erp_stage_submit_report` — расход в метрах: потолок по доступному
--     метражу, отказ без рабочего метража, замер остатка отдельной
--     корректировкой, списание малого остатка отдельной записью;
--   · `erp_stage_rolls_fate_block` — остаток называется в метрах.
--
-- СТАРЫЕ ДАННЫЕ. На бою 82 рулона, вес есть у 41, расход по рулонам записан
-- у 8 строк — всё в кг. Метраж у них пуст: закрой дозаполнит параметры
-- до первого расхода в метрах; старые строки расхода НЕ переписываются —
-- их пересчёт (экономика, аналитика) идёт на чтении по коэффициенту рулона
-- и помечается «Расчёт», а без коэффициента строка исключается с отметкой
-- о неполноте данных.

-- ── Параметры ткани в закупке ────────────────────────────────────────────────
alter table public.erp_materials
  add column if not exists width_cm numeric,
  add column if not exists density_gsm numeric;
alter table public.erp_materials drop constraint if exists erp_materials_width_cm_check;
alter table public.erp_materials
  add constraint erp_materials_width_cm_check check (width_cm is null or width_cm > 0);
alter table public.erp_materials drop constraint if exists erp_materials_density_gsm_check;
alter table public.erp_materials
  add constraint erp_materials_density_gsm_check check (density_gsm is null or density_gsm > 0);
comment on column public.erp_materials.width_cm
  is 'Полная ширина полотна, см (не полезная ширина раскладки) — для пересчёта веса в метры';
comment on column public.erp_materials.density_gsm
  is 'Плотность полотна, г/м² — для пересчёта веса в метры';

-- ── Рулон: параметры, метраж, коэффициент, остаток в метрах, цена за метр ──
alter table public.erp_material_rolls
  add column if not exists width_cm numeric,
  add column if not exists density_gsm numeric,
  add column if not exists length_calc_m numeric,
  add column if not exists length_m numeric,
  add column if not exists length_source text,
  add column if not exists kg_per_m numeric,
  add column if not exists kg_per_m_source text,
  add column if not exists length_left_m numeric,
  add column if not exists length_left_source text,
  add column if not exists price_per_m numeric;

alter table public.erp_material_rolls drop constraint if exists erp_material_rolls_length_source_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_length_source_check
  check (length_source is null or length_source in ('calc', 'supplier', 'measured'));
alter table public.erp_material_rolls drop constraint if exists erp_material_rolls_kg_per_m_source_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_kg_per_m_source_check
  check (kg_per_m_source is null or kg_per_m_source in ('params', 'measured', 'refined'));
alter table public.erp_material_rolls drop constraint if exists erp_material_rolls_length_left_source_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_length_left_source_check
  check (length_left_source is null or length_left_source in ('calc', 'supplier', 'measured'));
alter table public.erp_material_rolls drop constraint if exists erp_material_rolls_length_left_m_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_length_left_m_check
  check (length_left_m is null or length_left_m >= 0);

comment on column public.erp_material_rolls.width_cm
  is 'Ширина полотна рулона, см — снимок с материала при приёмке, уточняется для партии';
comment on column public.erp_material_rolls.density_gsm
  is 'Плотность рулона, г/м² — снимок с материала при приёмке, уточняется для партии';
comment on column public.erp_material_rolls.length_calc_m
  is 'Расчётный метраж по весу и параметрам; хранится всегда и уточнением не стирается';
comment on column public.erp_material_rolls.length_m
  is 'Рабочий метраж: расчёт (calc), по данным поставщика (supplier) или замер (measured)';
comment on column public.erp_material_rolls.kg_per_m
  is 'Коэффициент кг/м этого рулона: по параметрам (params), по замеру (measured), после сверки остатка (refined)';
comment on column public.erp_material_rolls.length_left_m
  is 'Остаток в метрах: доступно на начало работы − расход; ведёт erp_stage_submit_report';
comment on column public.erp_material_rolls.price_per_m
  is 'Цена за метр = цена за кг × коэффициент. Только чтение: считает erp_roll_recalc / erp_material_roll_set_params';

-- ── Строка расхода: снимки операции ───────────────────────────────────────
alter table public.erp_stage_report_rolls
  add column if not exists length_used_m numeric,
  add column if not exists kg_per_m numeric,
  add column if not exists kg_per_m_source text,
  add column if not exists qty_source text,
  add column if not exists price_per_m numeric,
  add column if not exists cost numeric;

/**
 * `qty_used` (кг) перестаёт быть обязательным: у расхода в метрах вес
 * РАСЧЁТНЫЙ, и у рулона без коэффициента его нет вовсе — ноль здесь был бы
 * ложью в колонке, по которой считалась аналитика. Одно из двух чисел
 * обязано быть: либо метры, либо (у старых строк) килограммы.
 */
alter table public.erp_stage_report_rolls alter column qty_used drop not null;
alter table public.erp_stage_report_rolls drop constraint if exists erp_stage_report_rolls_qty_used_check;
alter table public.erp_stage_report_rolls
  add constraint erp_stage_report_rolls_qty_used_check
  check (qty_used is null or qty_used > 0);
alter table public.erp_stage_report_rolls drop constraint if exists erp_stage_report_rolls_usage_check;
alter table public.erp_stage_report_rolls
  add constraint erp_stage_report_rolls_usage_check
  check (coalesce(length_used_m, 0) > 0 or coalesce(qty_used, 0) > 0);
alter table public.erp_stage_report_rolls drop constraint if exists erp_stage_report_rolls_qty_source_check;
alter table public.erp_stage_report_rolls
  add constraint erp_stage_report_rolls_qty_source_check
  check (qty_source is null or qty_source in ('entered', 'calc'));
alter table public.erp_stage_report_rolls drop constraint if exists erp_stage_report_rolls_kg_per_m_source_check;
alter table public.erp_stage_report_rolls
  add constraint erp_stage_report_rolls_kg_per_m_source_check
  check (kg_per_m_source is null or kg_per_m_source in ('params', 'measured', 'refined'));

-- Строки до правки вводились в килограммах руками — так и помечаются
update public.erp_stage_report_rolls
   set qty_source = 'entered'
 where qty_source is null and qty_used is not null;

comment on column public.erp_stage_report_rolls.length_used_m
  is 'Расход в погонных метрах полной ширины, включая отходы раскладки в этом отрезе';
comment on column public.erp_stage_report_rolls.qty_used
  is 'Расход в кг: введённый (qty_source = entered, до 27.09) или расчётный из метров (calc)';
comment on column public.erp_stage_report_rolls.cost
  is 'Стоимость операции = метры × цена за метр рулона на момент операции (снимок)';

-- ── Корректировки метража ─────────────────────────────────────────────────
create table if not exists public.erp_material_roll_adjustments (
  id uuid primary key default gen_random_uuid(),
  roll_id uuid not null references public.erp_material_rolls(id) on delete cascade,
  /**
   * `length_refine` — уточнение полного метража (замер, данные поставщика,
   *   изменение параметров после начала расхода);
   * `leftover_measure` — измеренный остаток при завершении работы;
   * `scrap_writeoff` — списание малого остатка как непригодного;
   * `cost_residual` — остаточная стоимость при нулевом фактическом остатке,
   *   вынесенная на подтверждение (делить на ноль нельзя).
   */
  kind text not null check (kind in ('length_refine', 'leftover_measure', 'scrap_writeoff', 'cost_residual')),
  before_m numeric,
  after_m numeric,
  delta_m numeric,
  cost numeric,
  reason text,
  report_id uuid references public.erp_stage_reports(id) on delete set null,
  item_id uuid references public.erp_order_items(id) on delete set null,
  author text,
  author_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists erp_material_roll_adjustments_roll_idx
  on public.erp_material_roll_adjustments (roll_id);
create index if not exists erp_material_roll_adjustments_item_idx
  on public.erp_material_roll_adjustments (item_id) where item_id is not null;

comment on table public.erp_material_roll_adjustments is
  'Корректировки метража рулона с причиной, автором и датой. Не прибавляются к расходу и браку; пишет только сервер (RPC)';

alter table public.erp_material_roll_adjustments enable row level security;

/**
 * Политика — ТОЛЬКО ЧТЕНИЕ участником. Ни INSERT, ни UPDATE, ни DELETE:
 * корректировку пишут RPC под `security definer` вместе с операцией, которая
 * её вызвала, и открывать таблицу руками значило бы завести второго писателя
 * остатка. Тот же приём, что у `erp_chat_messages`.
 */
drop policy if exists erp_material_roll_adjustments_read on public.erp_material_roll_adjustments;
create policy erp_material_roll_adjustments_read on public.erp_material_roll_adjustments
  for select to authenticated
  using ((select public.erp_is_member()));

grant select on public.erp_material_roll_adjustments to authenticated;

-- ── Коэффициент по ширине и плотности ─────────────────────────────────────
create or replace function public.erp_fabric_kg_per_m(p_width_cm numeric, p_density_gsm numeric)
returns numeric
language sql
immutable
set search_path = public as $$
  select case
    when coalesce(p_width_cm, 0) > 0 and coalesce(p_density_gsm, 0) > 0
      then (p_width_cm / 100.0) * p_density_gsm / 1000.0
  end;
$$;
comment on function public.erp_fabric_kg_per_m(numeric, numeric) is
  'Коэффициент кг/м полотна: ширина, м × плотность, г/м² / 1000 (правка 27.09, п. 4). NULL — параметров нет';
revoke execute on function public.erp_fabric_kg_per_m(numeric, numeric) from public, anon;
grant execute on function public.erp_fabric_kg_per_m(numeric, numeric) to authenticated;

-- ── Пересчёт производных рулона ДО первого расхода ──────────────────────────
--
-- Внутренняя: её зовут приёмка и уточнение параметров. `security definer`,
-- потому что UPDATE-политика рулонов открыта под права ЭТАПА (расход пишет
-- цех), а пересчёт запускает КЛАДОВЩИК своей приёмкой — без definer он
-- получил бы 42501 на собственном действии (тот же довод, что
-- у `erp_material_rolls_set_weights`). Через REST не зовётся: отозвана.
--
-- ПОСЛЕ НАЧАЛА РАСХОДА не зовётся: «после начала расходования сохранять
-- прошлые операции» — уточнение тогда идёт через корректировку
-- (`erp_material_roll_set_params`), а не через пересчёт.
create or replace function public.erp_roll_recalc(p_roll_id uuid)
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  r        public.erp_material_rolls;
  v_mat    public.erp_materials;
  v_w      numeric;
  v_d      numeric;
  v_calc   numeric;
  v_len    numeric;
  v_src    text;
  v_k      numeric;
  v_ksrc   text;
  v_price  numeric;
begin
  select * into r from public.erp_material_rolls where id = p_roll_id;
  if not found then
    return;
  end if;
  -- Расход уже был — производные не переписываются (см. шапку)
  if exists (select 1 from public.erp_stage_report_rolls rr where rr.roll_id = p_roll_id) then
    return;
  end if;
  select * into v_mat from public.erp_materials where id = r.material_id;

  -- Параметры партии: свои у рулона, иначе снимок с материала
  v_w := coalesce(r.width_cm, v_mat.width_cm);
  v_d := coalesce(r.density_gsm, v_mat.density_gsm);

  v_calc := case when coalesce(r.qty, 0) > 0 and public.erp_fabric_kg_per_m(v_w, v_d) is not null
                 then r.qty / public.erp_fabric_kg_per_m(v_w, v_d) end;

  if r.length_source in ('supplier', 'measured') and coalesce(r.length_m, 0) > 0 then
    v_len := r.length_m;
    v_src := r.length_source;
  else
    v_len := v_calc;
    v_src := case when v_calc is not null then 'calc' end;
  end if;

  /**
   * Коэффициент: по параметрам, когда метраж расчётный; по замеру —
   * вес / метраж («если известны чистый вес и полный метраж того же рулона,
   * использовать вес / метраж»). Без веса при известном метраже коэффициента
   * нет — метры учитываются, связи с закупкой в кг нет (документ разрешает).
   */
  if v_src = 'calc' then
    v_k := public.erp_fabric_kg_per_m(v_w, v_d);
    v_ksrc := 'params';
  elsif v_src is not null and coalesce(r.qty, 0) > 0 then
    v_k := r.qty / v_len;
    v_ksrc := 'measured';
  else
    v_k := null;
    v_ksrc := null;
  end if;

  v_price := coalesce(r.price_per_unit, v_mat.price_per_unit);

  update public.erp_material_rolls
     set width_cm = v_w,
         density_gsm = v_d,
         length_calc_m = v_calc,
         length_m = v_len,
         length_source = v_src,
         kg_per_m = v_k,
         kg_per_m_source = v_ksrc,
         length_left_m = v_len,
         length_left_source = v_src,
         price_per_m = case when v_price is not null and v_k is not null then v_price * v_k end,
         price_per_unit = coalesce(price_per_unit, v_mat.price_per_unit)
   where id = p_roll_id;
end $$;

comment on function public.erp_roll_recalc(uuid) is
  'Пересчёт метража, коэффициента, остатка и цены за метр рулона по весу и параметрам (правка 27.09, п. 4). Только до первого расхода; через REST не зовётся';
revoke execute on function public.erp_roll_recalc(uuid) from public, anon, authenticated;

-- ── Приёмка: параметры каждого рулона ──────────────────────────────────────
--
-- `p_roll_params` — массив по порядку создаваемых рулонов:
--   [{ "weight_kg": 20, "width_cm": 180, "density_gsm": 240,
--      "length_m": 45, "length_source": "supplier" }, …]
-- `weight_kg` обязателен и сверяется суммой с приходом (правило 21.09);
-- ширина и плотность — по умолчанию из материала; метраж поставщика или
-- замер — необязательны. Черновик приёмки без параметров разрешён:
-- рулон заводится, метража у него нет, и закрой дозаполнит до расхода.
--
-- `p_roll_weights` СОХРАНЯЕТСЯ рядом: офлайн-очередь склада повторяет уже
-- собранные вызовы, и убрать параметр значило бы уронить их в день выката.
-- Приходят оба — побеждают параметры (они полнее).
--
-- Прежняя сигнатура снимается: `create or replace` с новым параметром создаёт
-- ПЕРЕГРУЗКУ, и PostgREST ответил бы «не могу выбрать между двумя» (урок 21.09).
drop function if exists public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb);

create or replace function public.erp_material_accept(
  p_material_id uuid,
  p_accept_status text,
  p_qty numeric default null,
  p_comment text default null,
  p_invoice text default null,
  p_received_on date default null,
  p_fact_name text default null,
  p_fact_color text default null,
  p_fact_article text default null,
  p_actor text default null,
  p_client_key uuid default null,
  p_size_grid jsonb default null,
  p_rolls integer default null,
  p_roll_weights jsonb default null,
  p_roll_params jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_unit     text;
  v_received numeric;
  v_rows     int;
  v_dup      boolean := false;
  v_qty      numeric := p_qty;
  v_sized    boolean;
  v_receipt  uuid;
  v_seq      int;
  v_rolls    int;
  v_weights  numeric[];
  v_sum      numeric;
  v_price    numeric;
  v_params   jsonb := null;
  v_new      record;
begin
  if p_accept_status not in
     ('accepted_full', 'accepted_partial', 'shortage', 'mismatch', 'rejected') then
    raise exception 'erp_material_accept: неизвестный статус приёмки «%»', p_accept_status
      using errcode = '22023';
  end if;

  if p_accept_status not in ('accepted_full', 'accepted_partial')
     and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'erp_material_accept: расхождение нужно объяснить — заполните комментарий'
      using errcode = '22023';
  end if;

  select unit, price_per_unit into v_unit, v_price
    from public.erp_materials where id = p_material_id;
  if not found then
    raise exception 'erp_material_accept: материал не найден' using errcode = 'P0002';
  end if;

  v_sized := p_size_grid is not null and jsonb_typeof(p_size_grid) = 'array'
             and jsonb_array_length(p_size_grid) > 0;
  if v_sized then
    v_qty := public.erp_size_grid_total(p_size_grid);
  end if;

  if v_qty is not null then
    if v_qty <= 0 then
      raise exception 'erp_material_accept: количество прихода должно быть больше нуля'
        using errcode = '22023';
    end if;

    if public.erp_unit_tracks_rolls(v_unit) and coalesce(p_rolls, 0) <= 0 then
      raise exception 'erp_material_accept: материал учитывается в % — укажите количество рулонов', v_unit
        using errcode = '22023';
    end if;

    /**
     * ПАРАМЕТРЫ РУЛОНОВ (правка 27.09, п. 4) — вес каждого, ширина, плотность,
     * метраж поставщика или замер. Вес из них становится тем же массивом
     * весов, что и `p_roll_weights`, и проходит ту же проверку суммы.
     */
    if p_roll_params is not null and jsonb_typeof(p_roll_params) = 'array'
       and jsonb_array_length(p_roll_params) > 0 then
      v_params := p_roll_params;
      select array_agg(nullif(value->>'weight_kg', '')::numeric order by ord)
        into v_weights
        from jsonb_array_elements(p_roll_params) with ordinality as t(value, ord);
      if exists (
        select 1 from jsonb_array_elements(p_roll_params) v
         where nullif(v->>'length_source', '') is not null
           and v->>'length_source' not in ('supplier', 'measured')
      ) then
        raise exception 'erp_material_accept: источник метража — supplier или measured'
          using errcode = '22023';
      end if;
    elsif p_roll_weights is not null and jsonb_typeof(p_roll_weights) = 'array' then
      select array_agg((value #>> '{}')::numeric order by ord)
        into v_weights
        from jsonb_array_elements(p_roll_weights) with ordinality as t(value, ord);
    end if;

    /**
     * ВЕСА РУЛОНОВ (правка 21.09, п. 2): «после указания количества рулонов
     * раскрывать строки для ввода фактического веса каждого рулона. Сумма
     * веса всех рулонов должна совпадать с общим фактически принятым
     * количеством ткани. Если сумма не совпадает, не давать завершить
     * приёмку и показать понятную ошибку».
     *
     * Допуск 0.01 — на округление ввода в килограммах: требовать побитового
     * совпадения от чисел с десятыми значило бы ловить кладовщика на «99.99».
     */
    if v_weights is not null then
      if coalesce(array_length(v_weights, 1), 0) <> coalesce(p_rolls, 0) then
        raise exception 'erp_material_accept: весов % при % рулонах — укажите вес каждого рулона',
          coalesce(array_length(v_weights, 1), 0), coalesce(p_rolls, 0)
          using errcode = '22023';
      end if;
      if exists (select 1 from unnest(v_weights) w where w is null or w <= 0) then
        raise exception 'erp_material_accept: вес рулона должен быть больше нуля'
          using errcode = '22023';
      end if;
      select sum(w) into v_sum from unnest(v_weights) w;
      if abs(v_sum - v_qty) > 0.01 then
        raise exception 'erp_material_accept: сумма весов рулонов % не сходится с принятым количеством %',
          v_sum, v_qty using errcode = '22023';
      end if;
    end if;

    insert into public.erp_material_receipts
      (material_id, qty, unit, accept_status, invoice, comment, received_on, author,
       client_key, size_grid)
    values
      (p_material_id, v_qty, v_unit, p_accept_status, nullif(btrim(coalesce(p_invoice, '')), ''),
       nullif(btrim(coalesce(p_comment, '')), ''),
       coalesce(p_received_on, public.erp_local_date()), p_actor, p_client_key,
       case when v_sized then p_size_grid else null end)
    on conflict (client_key) where client_key is not null do nothing
    returning id into v_receipt;
    get diagnostics v_rows = row_count;
    v_dup := (v_rows = 0);

    if not v_dup and coalesce(p_rolls, 0) > 0 then
      perform 1 from public.erp_materials where id = p_material_id for update;

      select coalesce(max(seq), 0) into v_seq
        from public.erp_material_rolls
       where material_id = p_material_id;

      v_rolls := least(p_rolls, 500);
      insert into public.erp_material_rolls
        (material_id, receipt_id, seq, label, unit, qty, qty_left, price_per_unit,
         width_cm, density_gsm, length_m, length_source)
      select p_material_id, v_receipt, v_seq + g, 'Рулон №' || (v_seq + g)::text, v_unit,
             -- Вес по порядку; без весов рулон заводится как раньше, пустым
             case when v_weights is not null then v_weights[g] end,
             case when v_weights is not null then v_weights[g] end,
             v_price,
             -- Параметры партии (правка 27.09, п. 4): свои у рулона, иначе
             -- их подставит пересчёт из материала
             nullif(v_params->(g - 1)->>'width_cm', '')::numeric,
             nullif(v_params->(g - 1)->>'density_gsm', '')::numeric,
             nullif(v_params->(g - 1)->>'length_m', '')::numeric,
             case when nullif(v_params->(g - 1)->>'length_m', '')::numeric > 0
                  then coalesce(nullif(v_params->(g - 1)->>'length_source', ''), 'supplier') end
        from generate_series(1, v_rolls) as g;

      -- Пересчёт каждого нового рулона: метраж, коэффициент, цена за метр
      for v_new in
        select id from public.erp_material_rolls
         where material_id = p_material_id and receipt_id = v_receipt
      loop
        perform public.erp_roll_recalc(v_new.id);
      end loop;
    end if;
  end if;

  update public.erp_materials
     set status         = 'received',
         accept_status  = p_accept_status,
         accepted_at    = public.erp_local_date(),
         accepted_by    = p_actor,
         accept_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         fact_name      = coalesce(nullif(btrim(coalesce(p_fact_name, '')), ''), fact_name),
         fact_color     = coalesce(nullif(btrim(coalesce(p_fact_color, '')), ''), fact_color),
         fact_article   = coalesce(nullif(btrim(coalesce(p_fact_article, '')), ''), fact_article),
         updated_at     = now()
   where id = p_material_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'erp_material_accept: приёмка материала не разрешена'
      using errcode = '42501';
  end if;

  select coalesce(qty_received, 0) into v_received
    from public.erp_materials where id = p_material_id;

  if p_accept_status in ('accepted_full', 'accepted_partial') and v_received <= 0 then
    raise exception 'erp_material_accept: приёмка без записанного прихода — укажите, сколько пришло'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'material_id',   p_material_id,
    'qty_received',  v_received,
    'accept_status', p_accept_status,
    'duplicate',     v_dup,
    'rolls_total',   (select count(*) from public.erp_material_rolls where material_id = p_material_id)
  );
end $function$;

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb, jsonb)
  from public, anon;
grant execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb, jsonb)
  to authenticated, service_role;

-- ── Дозаполнение и уточнение параметров рулона ─────────────────────────────
--
-- «Недостающие параметры разрешить заполнить в закройке до записи расхода».
-- Зовут и склад (`material.receive`), и закрой (`stage.progress`), поэтому
-- `security definer` с гейтом внутри: UPDATE-политика рулонов открыта только
-- под права этапа, и кладовщик своим дозаполнением получил бы 42501.
--
-- ДО ПЕРВОГО РАСХОДА — пересчёт: «при уточнении полного метража до первого
-- расхода пересчитать цену метра из стоимости рулона и уточнённой длины».
-- ПОСЛЕ — корректировка `length_refine` с причиной, автором и датой и новые
-- коэффициенты для СЛЕДУЮЩИХ операций: «остаточная стоимость / уточнённый
-- остаток в метрах; учётный остаток кг / уточнённый остаток в метрах» —
-- оба расчётные (`refined`). При нулевом уточнённом остатке остаточная
-- стоимость выносится корректировкой `cost_residual` — делить на ноль нельзя.
-- Прошлые операции не трогаются ни в одном из случаев.
create or replace function public.erp_material_roll_set_params(
  p_roll_id uuid,
  p_width_cm numeric default null,
  p_density_gsm numeric default null,
  p_length_m numeric default null,
  p_length_source text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r          public.erp_material_rolls;
  v_mat      public.erp_materials;
  v_ops      int;
  v_spent_m  numeric;
  v_spent_kg numeric;
  v_cost_ops numeric;
  v_cost_unknown int;
  v_src      text;
  v_new_len  numeric;
  v_new_left numeric;
  v_before   numeric;
  v_left_kg  numeric;
  v_residual numeric;
  v_actor    text;
  v_actor_id uuid;
  v_calc     numeric;
begin
  if not (public.erp_has_permission('material.receive')
          or public.erp_has_permission('stage.progress')
          or public.erp_has_permission('stage.complete')) then
    raise exception 'erp_material_roll_set_params: нужно право material.receive или stage.progress'
      using errcode = '42501';
  end if;

  select * into r from public.erp_material_rolls where id = p_roll_id for update;
  if not found then
    raise exception 'erp_material_roll_set_params: рулон не найден' using errcode = 'P0002';
  end if;
  select * into v_mat from public.erp_materials where id = r.material_id;

  if p_width_cm is not null and p_width_cm <= 0 then
    raise exception 'erp_material_roll_set_params: ширина должна быть больше нуля' using errcode = '22023';
  end if;
  if p_density_gsm is not null and p_density_gsm <= 0 then
    raise exception 'erp_material_roll_set_params: плотность должна быть больше нуля' using errcode = '22023';
  end if;
  if p_length_m is not null and p_length_m <= 0 then
    raise exception 'erp_material_roll_set_params: метраж должен быть больше нуля' using errcode = '22023';
  end if;
  v_src := coalesce(nullif(btrim(coalesce(p_length_source, '')), ''), 'measured');
  if p_length_m is not null and v_src not in ('supplier', 'measured') then
    raise exception 'erp_material_roll_set_params: источник метража — supplier или measured'
      using errcode = '22023';
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;

  -- Параметры партии: переданные побеждают, остальное как было
  update public.erp_material_rolls
     set width_cm = coalesce(p_width_cm, width_cm),
         density_gsm = coalesce(p_density_gsm, density_gsm)
   where id = p_roll_id;

  select count(*), coalesce(sum(rr.length_used_m), 0), coalesce(sum(rr.qty_used), 0),
         coalesce(sum(rr.cost), 0), count(*) filter (where rr.cost is null)
    into v_ops, v_spent_m, v_spent_kg, v_cost_ops, v_cost_unknown
    from public.erp_stage_report_rolls rr
   where rr.roll_id = p_roll_id;

  if v_ops = 0 then
    -- До первого расхода: метраж переписывается, всё производное пересчитывается
    if p_length_m is not null then
      update public.erp_material_rolls
         set length_m = p_length_m, length_source = v_src
       where id = p_roll_id;
    end if;
    perform public.erp_roll_recalc(p_roll_id);
    select * into r from public.erp_material_rolls where id = p_roll_id;
    return jsonb_build_object(
      'roll_id', r.id, 'length_m', r.length_m, 'length_source', r.length_source,
      'kg_per_m', r.kg_per_m, 'price_per_m', r.price_per_m, 'length_left_m', r.length_left_m,
      'refined', false);
  end if;

  /**
   * ПОСЛЕ НАЧАЛА РАСХОДА. Новый полный метраж — переданный, либо (если
   * поменяли параметры у расчётного метража) пересчитанный по новым
   * параметрам. Прошлые операции остаются как записаны.
   */
  select * into r from public.erp_material_rolls where id = p_roll_id;
  if p_length_m is not null then
    v_new_len := p_length_m;
  elsif coalesce(r.length_source, 'calc') = 'calc' then
    v_calc := case when coalesce(r.qty, 0) > 0
                     and public.erp_fabric_kg_per_m(r.width_cm, r.density_gsm) is not null
                   then r.qty / public.erp_fabric_kg_per_m(r.width_cm, r.density_gsm) end;
    if v_calc is null then
      return jsonb_build_object('roll_id', r.id, 'refined', false);
    end if;
    v_new_len := v_calc;
    v_src := 'calc';
  else
    return jsonb_build_object('roll_id', r.id, 'refined', false);
  end if;

  v_new_left := v_new_len - v_spent_m;
  if v_new_left < -0.005 then
    raise exception 'erp_material_roll_set_params: уточнённый метраж % м меньше уже израсходованного % м',
      round(v_new_len, 2), round(v_spent_m, 2) using errcode = '22023';
  end if;
  v_new_left := greatest(v_new_left, 0);
  v_before := coalesce(r.length_left_m, coalesce(r.length_m, 0) - v_spent_m);

  insert into public.erp_material_roll_adjustments
    (roll_id, kind, before_m, after_m, delta_m, reason, author, author_id)
  values
    (p_roll_id, 'length_refine', v_before, v_new_left, v_new_left - v_before,
     nullif(btrim(coalesce(p_reason, '')), ''), v_actor, v_actor_id);

  -- Учётный остаток кг и остаточная стоимость (известна, если у всех операций есть стоимость)
  v_left_kg := case when r.qty is not null then greatest(r.qty - v_spent_kg, 0) end;
  v_residual := case
    when v_cost_unknown = 0 and coalesce(r.price_per_unit, v_mat.price_per_unit) is not null
         and r.qty is not null
      then r.qty * coalesce(r.price_per_unit, v_mat.price_per_unit) - v_cost_ops
  end;

  if v_new_left > 0 then
    update public.erp_material_rolls
       set length_m = v_new_len,
           length_source = v_src,
           length_calc_m = case when v_src = 'calc' then v_new_len else length_calc_m end,
           length_left_m = v_new_left,
           length_left_source = v_src,
           kg_per_m = case when v_left_kg is not null then v_left_kg / v_new_left else kg_per_m end,
           kg_per_m_source = case when v_left_kg is not null then 'refined' else kg_per_m_source end,
           price_per_m = case when v_residual is not null then greatest(v_residual, 0) / v_new_left
                              else price_per_m end,
           qty_left = coalesce(v_left_kg, qty_left)
     where id = p_roll_id;
  else
    -- Нулевой фактический остаток: остаточная стоимость — отдельной корректировкой
    update public.erp_material_rolls
       set length_m = v_new_len,
           length_source = v_src,
           length_calc_m = case when v_src = 'calc' then v_new_len else length_calc_m end,
           length_left_m = 0,
           length_left_source = v_src,
           qty_left = coalesce(v_left_kg, qty_left)
     where id = p_roll_id;
    if v_residual is not null and abs(v_residual) > 0.005 then
      insert into public.erp_material_roll_adjustments
        (roll_id, kind, before_m, after_m, delta_m, cost, reason, author, author_id)
      values
        (p_roll_id, 'cost_residual', v_before, 0, -v_before, v_residual,
         'Остаточная стоимость при нулевом остатке — на подтверждение', v_actor, v_actor_id);
    end if;
  end if;

  select * into r from public.erp_material_rolls where id = p_roll_id;
  return jsonb_build_object(
    'roll_id', r.id, 'length_m', r.length_m, 'length_source', r.length_source,
    'kg_per_m', r.kg_per_m, 'price_per_m', r.price_per_m, 'length_left_m', r.length_left_m,
    'refined', true);
end $function$;

comment on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text) is
  'Дозаполнение и уточнение ширины, плотности и метража рулона (правка 27.09, п. 4). До первого расхода — пересчёт; после — корректировка length_refine и коэффициенты «остаточная стоимость / уточнённый остаток» (refined)';
revoke execute on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.erp_material_roll_set_params(uuid, numeric, numeric, numeric, text, text) to authenticated;

-- ── Судьба остатка — в метрах, где они есть ─────────────────────────────────
create or replace function public.erp_stage_rolls_fate_block(p_stage_id uuid)
returns text
language sql
stable
set search_path = public as $$
  with me as (
    select s.id, s.department_id, i.order_id, d.result_detail
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
      left join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id
  ),
  others_open as (
    select 1
      from me
      join public.erp_order_items i2 on i2.order_id = me.order_id
      join public.erp_item_stages s2 on s2.item_id = i2.id
     where s2.department_id = me.department_id
       and s2.id <> me.id
       and s2.status not in ('done', 'skipped')
     limit 1
  ),
  pending as (
    select r.label, r.qty_left, r.length_left_m, coalesce(r.unit, m.unit) as unit, r.seq
      from me
      join public.erp_materials m on m.order_id = me.order_id
      join public.erp_material_rolls r on r.material_id = m.id
     where me.result_detail = 'rolls'
       and not exists (select 1 from others_open)
       and r.status = 'in_use'
       -- Остаток в метрах, а у рулона без метража — в килограммах (до правки)
       and coalesce(r.length_left_m, r.qty_left, 0) > 0
       and r.leftover_kind is null
  )
  select case when count(*) = 0 then null else
    'Не решена судьба остатка: '
    || string_agg(label || ' ('
         || case when length_left_m is not null
                 then replace(round(length_left_m, 2)::text, '.', ',') || ' м'
                 else qty_left::text || coalesce(' ' || unit, '') end
         || ')', ', ' order by seq)
    || ' — отметьте «Остаток пригоден» или «Малый остаток, не учитывать».'
  end
  from pending;
$$;

comment on function public.erp_stage_rolls_fate_block(uuid) is
  'Почему закрой нельзя закрыть по рулонам, или NULL: рулоны заказа «в работе» с остатком (в метрах, у старых — в кг) и без вида, когда других открытых этапов участка в заказе нет. Зеркало клиентского cutRolls.rollsFateBlock (правки 27.09, пп. 2 и 4).';

-- ── Сдача результата: расход в метрах и ключ попытки ────────────────────────
-- Подлинный текст `20260928083145` с правками в ветке рулонов и ключом
-- идемпотентности (см. шапку).
--
-- КЛЮЧ ПОПЫТКИ. «Повторное сохранение результата не должно списывать
-- материал ещё раз». Обрыв ответа при закоммиченной сдаче на цеховом Wi-Fi —
-- обычное дело, и второе нажатие списывало бы метры с рулона дважды. Тот же
-- приём, что у приёмки склада (`erp_material_receipts.client_key`): повтор
-- с тем же ключом не пишет второй отчёт и возвращает этап как есть.
alter table public.erp_stage_reports add column if not exists client_key uuid;
create unique index if not exists erp_stage_reports_client_key_idx
  on public.erp_stage_reports (client_key) where client_key is not null;
comment on column public.erp_stage_reports.client_key
  is 'Ключ попытки сдачи: повтор с тем же ключом не пишет второй отчёт (правка 27.09, п. 4)';

-- Прежняя сигнатура снимается: `create or replace` с новым параметром создал бы
-- перегрузку, и PostgREST на именованных аргументах не выбрал бы между двумя
drop function if exists public.erp_stage_submit_report(
  uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric);

create or replace function public.erp_stage_submit_report(
  p_stage_id uuid,
  p_qty_in integer,
  p_qty_good integer,
  p_qty_defect integer default 0,
  p_qty_rework integer default 0,
  p_qty_extra integer default 0,
  p_comment text default null,
  p_extra jsonb default '{}'::jsonb,
  p_sizes jsonb default '[]'::jsonb,
  p_rolls jsonb default '[]'::jsonb,
  p_assembly_cost numeric default null,
  p_client_key uuid default null
)
returns erp_item_stages
language plpgsql
set search_path to 'public'
as $function$
declare
  v_total   int;
  v_row     public.erp_item_stages;
  v_block   text;
  v_report  uuid;
  v_sized   boolean;
  v_rolled  boolean;
  v_good    int;
  v_defect  int;
  v_rework  int;
  v_extra   int;
  v_roll    jsonb;
  v_rr      uuid;
  v_item    uuid;
  v_grid    jsonb;
  v_roll_id uuid;
  v_used    numeric;
  v_cap     numeric;
  v_spent   numeric;
  v_left    numeric;
  v_kind    text;
  v_fin     boolean;
  v_over    boolean;
  v_input   jsonb;
  v_cell    record;
  v_cap_cell int;
  v_prior   int;
  v_label   text;
  -- Учёт в метрах (правка 27.09, п. 4)
  v_metres  boolean;
  v_len     numeric;
  v_meas    numeric;
  v_avail_m numeric;
  v_left_m  numeric;
  v_kpm     numeric;
  v_kpm_src text;
  v_ppm     numeric;
  v_cost    numeric;
  v_rollrec record;
  v_actor   text;
  v_actor_id uuid;
begin
  v_total := public.erp_stage_item_qty(p_stage_id);
  if v_total is null then
    raise exception 'erp_stage_submit_report: этап не найден' using errcode = 'P0002';
  end if;

  -- Повтор той же попытки: отчёт уже записан, материал уже списан — этап как есть
  if p_client_key is not null and exists (
    select 1 from public.erp_stage_reports r where r.client_key = p_client_key
  ) then
    select * into v_row from public.erp_item_stages where id = p_stage_id;
    return v_row;
  end if;

  v_sized  := jsonb_typeof(p_sizes) = 'array' and jsonb_array_length(p_sizes) > 0;
  v_rolled := jsonb_typeof(p_rolls) = 'array' and jsonb_array_length(p_rolls) > 0;

  if v_rolled then
    select coalesce(sum((s->>'qty_good')::int), 0) into v_good
      from jsonb_array_elements(p_rolls) as r
      cross join lateral jsonb_array_elements(coalesce(r->'sizes', '[]'::jsonb)) as s;
    v_defect := coalesce(p_qty_defect, 0);
    v_rework := coalesce(p_qty_rework, 0);
    v_extra  := coalesce(p_qty_extra, 0);
  elsif v_sized then
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

  v_block := public.erp_stage_completion_block(p_stage_id, v_good);
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;

  /**
   * ПОТОЛОК ПО РАЗМЕРУ — ОСТАТОК ИЗ ПРИНЯТЫХ (правка 27.09, п. 7).
   *
   * «Не давать сдать по размеру больше доступного остатка». Остаток =
   * принято по размеру (зеркало клиентского `sizeInputFor`: закрой сквозь
   * нанесение) − уже сдано годных − уже списано в брак СВОИМИ отчётами.
   * Текущая сдача считается целиком — сшито + брак + переделка: больше
   * изделий, чем есть на участке, тронуть нельзя.
   *
   * Закрой (`allows_over_plan`) под потолок не попадает — «плюсы» рождаются
   * там. Fail-open: без размерных данных во всей цепочке потолка нет —
   * тот же принцип, что у гейта ТЗ.
   */
  if v_sized and not v_rolled then
    select coalesce(d.allows_over_plan, false) into v_over
      from public.erp_item_stages s
      join public.erp_departments d on d.id = s.department_id
     where s.id = p_stage_id;
    if not coalesce(v_over, false) then
      v_input := public.erp_stage_size_input(p_stage_id);
      if v_input is not null then
        for v_cell in
          select coalesce(nullif(btrim(r.color), ''), '—') as color,
                 btrim(r.size) as size,
                 coalesce(r.qty_good, 0) + coalesce(r.qty_defect, 0)
                   + coalesce(r.qty_rework, 0) as now_qty
            from jsonb_to_recordset(p_sizes)
              as r(color text, size text, qty_good int, qty_defect int, qty_rework int)
           where btrim(coalesce(r.size, '')) <> ''
        loop
          select coalesce((
            select (c->>'qty')::int
              from jsonb_array_elements(v_input) c
             where coalesce(nullif(btrim(c->>'color'), ''), '—') = v_cell.color
               and btrim(c->>'size') = v_cell.size
             limit 1), 0)
            into v_cap_cell;
          select coalesce(sum(z.qty_good + z.qty_defect), 0)
            into v_prior
            from public.erp_stage_report_sizes z
            join public.erp_stage_reports rp on rp.id = z.report_id
           where rp.stage_id = p_stage_id
             and coalesce(nullif(btrim(z.color), ''), '—') = v_cell.color
             and btrim(z.size) = v_cell.size;
          if v_prior + v_cell.now_qty > v_cap_cell then
            raise exception '%: больше % шт сдать нельзя — столько осталось из принятых (введено %)',
              case when v_cell.color = '—' then v_cell.size
                   else v_cell.size || ' · ' || v_cell.color end,
              greatest(v_cap_cell - v_prior, 0), v_cell.now_qty
              using errcode = 'check_violation';
          end if;
        end loop;
      end if;
    end if;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'system');
  v_actor_id := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;

  insert into public.erp_stage_reports
    (stage_id, qty_in, qty_good, qty_defect, qty_rework, qty_extra, comment, extra,
     author, author_id, assembly_cost_per_unit, client_key)
  values
    (p_stage_id, p_qty_in, v_good, v_defect, v_rework, v_extra,
     nullif(btrim(p_comment), ''),
     coalesce(p_extra, '{}'::jsonb),
     v_actor, v_actor_id,
     p_assembly_cost, p_client_key)
  returning id into v_report;

  if v_rolled then
    select item_id into v_item from public.erp_item_stages where id = p_stage_id;

    for v_roll in select value from jsonb_array_elements(p_rolls) loop
      v_roll_id := nullif(v_roll->>'roll_id', '')::uuid;
      /**
       * ДВА ПУТИ ЗАПИСИ РАСХОДА. Новый клиент шлёт `length_used_m` (правка
       * 27.09, п. 4) — расход в погонных метрах полной ширины; прежний бандл
       * и офлайн-очередь — `qty_used` в килограммах. Второй путь сохранён
       * без изменений: убрать его значило бы уронить накопленное на планшетах
       * в день выката, а старые строки в кг документ велит хранить.
       */
      v_len     := nullif(v_roll->>'length_used_m', '')::numeric;
      v_meas    := nullif(v_roll->>'leftover_measured_m', '')::numeric;
      v_metres  := v_len is not null;
      v_used    := case when v_metres then null else coalesce((v_roll->>'qty_used')::numeric, 0) end;
      v_fin     := coalesce((v_roll->>'finished')::boolean, false);
      v_kind    := nullif(v_roll->>'leftover', '');
      v_kpm := null; v_kpm_src := null; v_ppm := null; v_cost := null;
      v_left_m := null; v_avail_m := null; v_cap := null; v_label := null; v_spent := 0;

      if v_kind is not null and v_kind not in ('usable', 'scrap') then
        raise exception 'erp_stage_submit_report: неизвестный вид остатка «%»', v_kind
          using errcode = '22023';
      end if;

      if v_roll_id is not null then
        select r.qty, r.label, r.length_m, r.length_left_m, r.length_source,
               r.length_left_source, r.kg_per_m, r.kg_per_m_source, r.price_per_m,
               coalesce(r.price_per_unit, m.price_per_unit) as price_kg,
               coalesce((select sum(rr.qty_used) from public.erp_stage_report_rolls rr
                          where rr.roll_id = r.id), 0) as spent_kg,
               coalesce((select sum(rr.length_used_m) from public.erp_stage_report_rolls rr
                          where rr.roll_id = r.id), 0) as spent_m
          into v_rollrec
          from public.erp_material_rolls r
          left join public.erp_materials m on m.id = r.material_id
         where r.id = v_roll_id;
        v_cap   := v_rollrec.qty;
        v_label := v_rollrec.label;
        v_spent := v_rollrec.spent_kg;
      end if;

      if v_roll_id is not null and v_metres then
        /**
         * РАСХОД В МЕТРАХ (правка 27.09, п. 4). Без рабочего метража расход
         * не записывается: «пока нет рабочего метража, показывать „Не заполнены
         * данные для учёта в метрах" и не давать записать расход в метрах».
         * Это НЕ fail-open, как у веса в килограммах: там поле было
         * необязательным по решению документа, здесь документ требует
         * обратного, а закрой может дозаполнить параметры сам
         * (`erp_material_roll_set_params`).
         */
        if v_len <= 0 then
          raise exception 'erp_stage_submit_report: расход в метрах должен быть больше нуля'
            using errcode = '22023';
        end if;
        if v_rollrec.length_m is null then
          raise exception
            '%: Не заполнены данные для учёта в метрах — укажите ширину и плотность полотна или метраж рулона',
            coalesce(v_label, 'рулон') using errcode = '22023';
        end if;

        /**
         * ПОТОЛОК — ДОСТУПНЫЙ МЕТРАЖ, накопительно: «если рулон используется
         * в нескольких заказах, каждый следующий заказ получает только его
         * доступный остаток». Превышение — не молчаливая обрезка и не минус:
         * «предложить уточнить метраж рулона и подтвердить корректировку,
         * затем сохранить расход; отрицательный остаток не допускать».
         * Уточнение делает `erp_material_roll_set_params`, после него расход
         * проходит. Допуск 0.005 — округление ввода до сотых.
         */
        v_avail_m := coalesce(v_rollrec.length_left_m,
                              greatest(v_rollrec.length_m - v_rollrec.spent_m, 0));
        if v_len > v_avail_m + 0.005 then
          raise exception
            '%: доступно % м, а списывается % м — уточните метраж рулона или уменьшите расход',
            coalesce(v_label, 'рулон'),
            replace(round(v_avail_m, 2)::text, '.', ','),
            replace(round(v_len, 2)::text, '.', ',')
            using errcode = '22023';
        end if;

        -- Снимки операции: коэффициент, цена за метр и стоимость на момент сдачи
        v_kpm     := v_rollrec.kg_per_m;
        v_kpm_src := v_rollrec.kg_per_m_source;
        v_ppm     := coalesce(v_rollrec.price_per_m,
                              case when v_rollrec.price_kg is not null and v_kpm is not null
                                   then v_rollrec.price_kg * v_kpm end);
        v_used    := case when v_kpm is not null then v_len * v_kpm end;
        v_cost    := case when v_ppm is not null then v_len * v_ppm end;
        v_left_m  := greatest(v_avail_m - v_len, 0);

        if v_meas is not null then
          if v_meas < 0 then
            raise exception 'erp_stage_submit_report: измеренный остаток не может быть отрицательным'
              using errcode = '22023';
          end if;
          if not v_fin then
            raise exception '%: измеренный остаток указывается при завершении работы по рулону',
              coalesce(v_label, 'рулон') using errcode = '22023';
          end if;
        end if;

        /**
         * У ЗАКОНЧЕННОГО РУЛОНА С ОСТАТКОМ ВИД ОБЯЗАТЕЛЕН (правка 27.09, п. 2),
         * теперь в метрах: «при положительном остатке обязательно выбрать
         * „Остаток пригоден" или „Малый остаток, не учитывать"… При нуле
         * выбор не нужен». Остаток — измеренный, если его замерили.
         */
        if v_fin and v_kind is null and coalesce(v_meas, v_left_m) > 0.0005 then
          raise exception
            '%: остался % м — выберите «Остаток пригоден» или «Малый остаток, не учитывать»',
            coalesce(v_label, 'рулон'),
            replace(round(coalesce(v_meas, v_left_m), 2)::text, '.', ',')
            using errcode = '22023';
        end if;
      elsif v_roll_id is not null then
        /**
         * РАСХОД НЕ БОЛЬШЕ ПРИНЯТОГО ВЕСА (правка 21.09, п. 2): «фактический
         * расход не может быть больше принятого веса рулона». Считается
         * НАКОПИТЕЛЬНО: с рулона кроят в несколько заходов, и проверка
         * «эта сдача ≤ вес» пропустила бы 20 + 20 при рулоне в 25 кг.
         *
         * FAIL-OPEN у рулона без веса: сорок один рулон принят до правки,
         * и у них вес пуст. Останавливать на этом закрой значило бы остановить
         * цех из-за отсутствующего поля — то же правило, что у гейта ТЗ.
         */
        if v_cap is not null and v_spent + v_used > v_cap + 0.01 then
          raise exception
            'erp_stage_submit_report: с рулона уже израсходовано %, в нём %, а вы списываете ещё %',
            v_spent, v_cap, v_used using errcode = '22023';
        end if;

        /**
         * У ЗАКОНЧЕННОГО РУЛОНА С ОСТАТКОМ ВИД ОБЯЗАТЕЛЕН (правка 27.09, п. 2).
         * Клиент это требовал с 21.09, сервер — нет: через REST рулон
         * закрывался с остатком без судьбы, и на бою 27.09 вид не выбран
         * ни у одного из 60 рулонов. Fail-open у рулона без веса — остатка
         * у него не существует.
         */
        if v_fin and v_kind is null and v_cap is not null
           and v_cap - (v_spent + v_used) > 0.0005 then
          raise exception
            '%: остался % — выберите «Остаток пригоден» или «Малый остаток, не учитывать»',
            coalesce(v_label, 'рулон'),
            round(v_cap - (v_spent + v_used), 3)
            using errcode = '22023';
        end if;
      end if;

      insert into public.erp_stage_report_rolls
        (report_id, roll_id, material_id, qty_used, qty_source, unit, roll_finished,
         length_used_m, kg_per_m, kg_per_m_source, price_per_m, cost)
      values
        (v_report, v_roll_id,
         nullif(v_roll->>'material_id', '')::uuid,
         v_used,
         case when v_metres then 'calc' else 'entered' end,
         nullif(v_roll->>'unit', ''),
         v_fin,
         v_len, v_kpm, v_kpm_src, v_ppm, v_cost)
      returning id into v_rr;

      insert into public.erp_stage_report_sizes
        (report_id, report_roll_id, color, size, qty_good)
      select v_report, v_rr,
             coalesce(nullif(btrim(s->>'color'), ''), '—'),
             btrim(s->>'size'),
             coalesce((s->>'qty_good')::int, 0)
        from jsonb_array_elements(coalesce(v_roll->'sizes', '[]'::jsonb)) as s
       where btrim(coalesce(s->>'size', '')) <> ''
         and coalesce((s->>'qty_good')::int, 0) > 0;

      /**
       * Вид остатка ставит закройщик («остаток пригоден» / «малый остаток,
       * не учитывать»), автоматического порога НЕТ ни в килограммах, ни
       * в метрах: документ прямо просит его не задавать. Нулевой остаток
       * вида не получает — решать нечего.
       */
      if v_roll_id is not null and v_metres then
        /**
         * ОСТАТОК В МЕТРАХ: «доступно на начало работы − расход по текущей
         * работе. Пока исходный метраж расчётный, остаток тоже обозначать
         * как расчётный. При завершении работы разрешить указать измеренный
         * остаток». Расхождение замера с расчётом — ОТДЕЛЬНОЙ корректировкой
         * с причиной, автором и датой: в расход и брак оно не попадает.
         * Килограммы остатка — расчётные (метры × коэффициент).
         */
        if v_meas is not null then
          insert into public.erp_material_roll_adjustments
            (roll_id, kind, before_m, after_m, delta_m, reason, report_id, item_id, author, author_id)
          values
            (v_roll_id, 'leftover_measure', v_left_m, v_meas, v_meas - v_left_m,
             'Замер остатка при завершении работы по рулону', v_report, v_item, v_actor, v_actor_id);
          v_left_m := v_meas;
        end if;

        update public.erp_material_rolls r
           set length_left_m = v_left_m,
               length_left_source = case when v_meas is not null then 'measured'
                                         else coalesce(r.length_left_source, r.length_source) end,
               qty_left = case when v_kpm is not null then v_left_m * v_kpm else r.qty_left end,
               leftover_kind = case
                 when v_fin and v_left_m > 0.0005 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status = 'in_stock' then 'in_use'
                             else r.status end
         where r.id = v_roll_id;

        /**
         * МАЛЫЙ ОСТАТОК «списывается отдельно как непригодный, а не исчезает
         * из учёта»: запись списания с ценой рулона относится к ТОЙ позиции,
         * к которой оформлена (правка 27.09, п. 8: «стоимость отдельно
         * списанного малого остатка относить на ту позицию, к которой
         * оформлено списание»). Сам рулон остаётся с остатком и видом `scrap`.
         */
        if v_fin and v_kind = 'scrap' and v_left_m > 0.0005 then
          insert into public.erp_material_roll_adjustments
            (roll_id, kind, before_m, after_m, delta_m, cost, reason, report_id, item_id, author, author_id)
          values
            (v_roll_id, 'scrap_writeoff', v_left_m, v_left_m, 0,
             case when v_ppm is not null then v_left_m * v_ppm end,
             'Малый остаток списан как непригодный', v_report, v_item, v_actor, v_actor_id);
        end if;
      elsif v_roll_id is not null then
        /**
         * ОСТАТОК РУЛОНА В КИЛОГРАММАХ (правка 21.09, п. 5) — прежний путь
         * для расхода, записанного в кг: «первоначальный вес минус
         * фактический расход». Считает СЕРВЕР — расход и остаток это одна
         * величина с двух сторон, и второй писатель развёл бы их молча.
         */
        v_left := case when v_cap is null then null
                       else greatest(v_cap - (v_spent + v_used), 0) end;

        update public.erp_material_rolls r
           set qty_left = coalesce(v_left, r.qty_left),
               leftover_kind = case
                 when v_fin and coalesce(v_left, 0) > 0 then coalesce(v_kind, r.leftover_kind)
                 when v_fin then null
                 else r.leftover_kind end,
               status = case when v_fin then 'used'
                             when r.status = 'in_stock' then 'in_use'
                             else r.status end
         where r.id = v_roll_id;
      end if;
    end loop;

    /**
     * ПЛЮСЫ (правка 21.09, п. 3) — по строкам ТОЛЬКО ЧТО записанного отчёта.
     * Превышение считается от суммы сданного этим этапом против плана
     * позиции, а в строки попадает ПРИРОСТ превышения. Внутри ячейки плюс
     * достаётся тому рулону, на котором план кончился (порядок — по сквозному
     * номеру рулона). Размер вне сетки плюсом не считается.
     */
    select i.size_grid into v_grid
      from public.erp_item_stages s
      join public.erp_order_items i on i.id = s.item_id
     where s.id = p_stage_id;

    if v_grid is not null and jsonb_typeof(v_grid) = 'array' then
      with plan as (
        select c.color, c.size, c.qty::numeric as qty
          from public.erp_size_grid_cells(v_grid) c
      ), prev as (
        select z.color, z.size, sum(z.qty_good)::numeric as qty
          from public.erp_stage_report_sizes z
          join public.erp_stage_reports r on r.id = z.report_id
         where r.stage_id = p_stage_id and r.id <> v_report
         group by 1, 2
      ), src as (
        select z.id, z.color, z.size, z.qty_good::numeric as qty, mr.seq
          from public.erp_stage_report_sizes z
          left join public.erp_stage_report_rolls rr on rr.id = z.report_roll_id
          left join public.erp_material_rolls mr on mr.id = rr.roll_id
         where z.report_id = v_report
      ), rows_now as (
        select s.id, s.color, s.size, s.qty,
               sum(s.qty) over (
                 partition by s.color, s.size order by s.seq nulls last, s.id
                 rows between unbounded preceding and current row
               ) as cum,
               sum(s.qty) over (partition by s.color, s.size) as cell_total
          from src s
      ), calc as (
        select
          n.id,
          greatest(coalesce(p.qty, 0) + n.cell_total - pl.qty, 0)
            - greatest(coalesce(p.qty, 0) - pl.qty, 0) as cell_extra,
          n.cum, n.qty, n.cell_total
          from rows_now n
          join plan pl on pl.color = n.color and pl.size = n.size
          left join prev p on p.color = n.color and p.size = n.size
      )
      update public.erp_stage_report_sizes z
         set qty_extra = greatest(
               least(c.cum, c.cell_total)
                 - greatest(c.cum - c.qty, c.cell_total - c.cell_extra), 0)
        from calc c
       where z.id = c.id and c.cell_extra > 0;

      update public.erp_stage_reports r
         set qty_extra = coalesce((
               select sum(z.qty_extra) from public.erp_stage_report_sizes z
                where z.report_id = v_report), 0)
       where r.id = v_report;
    end if;
  elsif v_sized then
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

  if p_assembly_cost is not null then
    if p_assembly_cost < 0 then
      raise exception 'erp_stage_submit_report: стоимость сборки не может быть отрицательной'
        using errcode = '22023';
    end if;
    select item_id into v_item from public.erp_item_stages where id = p_stage_id;
    perform set_config('erp.assembly_cost', 'on', true);
    update public.erp_order_items
       set assembly_cost_per_unit = p_assembly_cost,
           assembly_cost_set_at = now(),
           assembly_cost_by = nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
     where id = v_item;
    perform set_config('erp.assembly_cost', 'off', true);
  end if;

  /**
   * ЗАКРЫТИЕ — ПО УЧТЁННОМУ, А НЕ ПО ТИРАЖУ (правка 27.09, п. 7).
   *
   * Прежнее `qty_done >= тираж` закрывало швейку на 368 сданных при 472
   * принятых (тираж 350 + плюс закроя): 104 изделия исчезали из учёта.
   * Теперь этап закрыт, когда не учтённых изделий не осталось:
   * `greatest(тираж, принято) − сдано годных − списано в брак ≤ 0`
   * (`erp_stage_unaccounted`; брак этого отчёта уже в журнале, поэтому
   * приращение — только годные). Переделка остаток не уменьшает —
   * она вернётся годными или браком в следующих сдачах.
   */
  /**
   * ЗАКРЫТИЕ ЗАКРОЯ ТРЕБУЕТ СУДЬБЫ КАЖДОГО ОСТАТКА (правка 27.09, п. 2):
   * рулон, оставленный «в работе» прежней сдачей, с остатком и без вида
   * не попадает ни в «Остатки ткани», ни в экономику. Проверяется только
   * когда эта сдача закрывает этап и в заказе не осталось других открытых
   * этапов того же участка (рулон мог ждать соседнюю позицию).
   */
  if public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0 then
    v_block := public.erp_stage_rolls_fate_block(p_stage_id);
    if v_block is not null then
      raise exception '%', v_block using errcode = 'P0001';
    end if;
  end if;

  update public.erp_item_stages s
     set qty_done = public.erp_clamp_done(s.qty_done, v_good, v_total),
         qty_rework = public.erp_clamp_rework(s.qty_rework, v_rework),
         -- Незавершённая программа вышивки НЕ закрывает этап (правка 27.09,
         -- п. 3): факт записывается, статус остаётся — запрещён переход
         status = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
             then 'done' else s.status end,
         finished_at = case
           when public.erp_stage_unaccounted(p_stage_id, v_good, 0) <= 0
                and public.erp_stage_program_block(p_stage_id) is null
             then now() else s.finished_at end
   where s.id = p_stage_id
  returning * into v_row;

  return v_row;
end $function$;

revoke execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) from public, anon;
grant execute on function public.erp_stage_submit_report(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid) to authenticated;
