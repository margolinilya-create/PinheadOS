-- ЗАКУПКА ГОТОВОГО ИЗДЕЛИЯ ОДНОЙ СТРОКОЙ (правка заказчика 16.09, п. 2).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Если нужно закупить готовое изделие с размерной
-- сеткой, для каждого размера приходится создавать отдельную закупку…
-- В закупке это должна быть ОДНА закупка на 100 футболок с разбивкой внутри,
-- а не отдельная закупка на каждый размер». Область — все готовые изделия
-- независимо от категории: одежда, головные уборы, аксессуары, сувенирка.
--
-- РАСШИРЯЕМ `erp_materials`, А НЕ ЗАВОДИМ ВТОРУЮ СУЩНОСТЬ. На строку закупки
-- завязаны экран закупки, позиционная задача склада `material_receipt`
-- (`material_id`), материальный гейт участков, автозакрытие этапа «Закупка»,
-- журнал приходов и триггер `qty_received`. Параллельная сущность потребовала
-- бы копии всех шести, и первое же расхождение между ними было бы молчаливым.
--
-- ВИД, А НЕ ФЛАГ. `kind = 'finished_good'` встаёт в один ряд с `fabric`
-- и `hardware`, потому что специализация участков уже выражена этим языком
-- (`erp_departments.gate_material_kinds`). Флаг рядом с видом означал бы, что
-- гейт склада придётся описывать константой в коде — а правило проекта прямо
-- запрещает держать в коде «ткань → закрой».
--
-- РАЗБИВКА — jsonb, И ЭТО НЕ ПРОТИВОРЕЧИТ СОСЕДНЕЙ МИГРАЦИИ, где размерный
-- результат этапа заведён ТАБЛИЦЕЙ строк. Там величина, по которой считают
-- агрегаты за период и сверяют накопленное по журналу; здесь СНИМОК, который
-- читают целиком — карточка закупки, приёмка, преднаполнение окна склада.
-- Формат тот же, что у `erp_order_items.size_grid` (`[{color, sizes}]`),
-- поэтому утилиты разбора одни на все три места.

-- ── Вид «готовое изделие» ──────────────────────────────────────────────────
alter table public.erp_materials drop constraint if exists erp_materials_kind_check;
alter table public.erp_materials add constraint erp_materials_kind_check
  check (kind = any (array['fabric', 'hardware', 'labels', 'packaging', 'other', 'finished_good']));

-- ── Размерная разбивка: план закупки и факт прихода ────────────────────────
alter table public.erp_materials
  add column if not exists size_grid jsonb;

comment on column public.erp_materials.size_grid is
  'Разбивка закупки по размерам [{color, sizes}] — тот же формат, что у позиции заказа';

/**
 * ФАКТ ПРИХОДА ПО РАЗМЕРАМ ЖИВЁТ В ЖУРНАЛЕ, А НЕ В СТРОКЕ ЗАКУПКИ.
 *
 * Поставка бывает частичной, и вторая приёмка ДОБАВЛЯЕТ, а не перезаписывает —
 * то же правило, по которому `qty_received` считается суммой журнала, а не
 * пишется поверх. Разбивка обязана складываться ровно так же, иначе «принято
 * 40 + 60» показало бы 60.
 */
alter table public.erp_material_receipts
  add column if not exists size_grid jsonb;

comment on column public.erp_material_receipts.size_grid is
  'Фактически принято по размерам в ЭТОТ приход; итог — сумма журнала';

-- ── Тираж закупки считается по сетке ───────────────────────────────────────
/**
 * ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ `qty_expected` ПРИ НЕПУСТОЙ СЕТКЕ.
 *
 * Сумма по размерам и «общая потребность» — одно число, названное дважды.
 * Оставить его на форме значит завести второго писателя: закупщик правит
 * размер, а итог остаётся прежним, и склад принимает по старому плану.
 * Поэтому при сетке число считает триггер, а поле в интерфейсе становится
 * только для чтения с подписью «считается по сетке».
 */
create or replace function public.erp_material_grid_qty()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.size_grid is not null and jsonb_typeof(new.size_grid) = 'array'
     and jsonb_array_length(new.size_grid) > 0 then
    new.qty_expected := public.erp_size_grid_total(new.size_grid);
  end if;
  return new;
end $$;

comment on function public.erp_material_grid_qty() is
  'qty_expected закупки с размерной сеткой считается по сетке — второй писатель запрещён';

drop trigger if exists erp_material_grid_qty on public.erp_materials;
create trigger erp_material_grid_qty
  before insert or update of size_grid, qty_expected on public.erp_materials
  for each row execute function public.erp_material_grid_qty();

-- ── Приёмка принимает разбивку ─────────────────────────────────────────────
/**
 * DROP + CREATE по той же причине, что у `erp_stage_submit_report`: лишний
 * аргумент при `create or replace` создал бы ПЕРЕГРУЗКУ, а не замену, и
 * PostgREST ответил бы неоднозначностью на действии, которым склад живёт
 * каждый день. Права после DROP выставляются явно — их набор `drop` сбросил.
 */
drop function if exists public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid);

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
  p_size_grid jsonb default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_unit     text;
  v_received numeric;
  v_rows     int;
  v_dup      boolean := false;
  v_qty      numeric := p_qty;
  v_sized    boolean;
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

  select unit into v_unit from public.erp_materials where id = p_material_id;
  if not found then
    raise exception 'erp_material_accept: материал не найден' using errcode = 'P0002';
  end if;

  /**
   * ПРИ РАЗБИВКЕ КОЛИЧЕСТВО СЧИТАЕТСЯ ПО НЕЙ — тот же довод, что у отчёта
   * этапа: сумма по размерам и «сколько пришло» это одно число, и два
   * писателя разошлись бы на первой опечатке.
   */
  v_sized := p_size_grid is not null and jsonb_typeof(p_size_grid) = 'array'
             and jsonb_array_length(p_size_grid) > 0;
  if v_sized then
    v_qty := public.erp_size_grid_total(p_size_grid);
  end if;

  -- Дубль определяет САМ INSERT, а не предварительная проверка: между
  -- `select exists` и `insert` помещались два параллельных вызова очереди,
  -- и второй падал 23505 на приёмке, которая прошла
  if v_qty is not null then
    if v_qty <= 0 then
      raise exception 'erp_material_accept: количество прихода должно быть больше нуля'
        using errcode = '22023';
    end if;
    insert into public.erp_material_receipts
      (material_id, qty, unit, accept_status, invoice, comment, received_on, author,
       client_key, size_grid)
    values
      (p_material_id, v_qty, v_unit, p_accept_status, nullif(btrim(coalesce(p_invoice, '')), ''),
       nullif(btrim(coalesce(p_comment, '')), ''),
       coalesce(p_received_on, public.erp_local_date()), p_actor, p_client_key,
       case when v_sized then p_size_grid else null end)
    on conflict (client_key) where client_key is not null do nothing;
    get diagnostics v_rows = row_count;
    v_dup := (v_rows = 0);
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
    'duplicate',     v_dup
  );
end $function$;

comment on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb) is
  'Приёмка материала одной транзакцией: приход в журнал (+ разбивка по размерам) и статус позиции';

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb)
  to authenticated, service_role;
