/**
 * ПРИЁМКА ТКАНИ БЕЗ РУЛОНОВ (правка заказчика 01.10, п. 1).
 *
 * «У склада при приёмке материалов пропали пункты по количеству рулонов
 * и ширине полотна, из-за этого дальше заказ багается. К уже закрытому
 * приходу нужно разрешить добавить рулоны без повторного поступления
 * и удвоения остатка. После этого рулоны должны появиться в закройке».
 *
 * ПРИЧИНА — В ДАННЫХ, А НЕ В ФОРМЕ. Поля рулонов показывает признак единицы
 * (`erp_unit_tracks_rolls`): «кг» в справочнике рулонная, всё прочее — нет.
 * На бою 01.10 у четырёх тканей единица ПУСТАЯ (форма закупки по умолчанию
 * пишет `''`), и все четыре приняты без единого рулона. Закрой отчитывается
 * только рулонами, поэтому такой заказ дальше закроя не идёт.
 *
 * ПРАВИЛО. Ткань без единицы учитывается так же, как ткань в кг: закупка
 * ткани ведётся в килограммах, а пустая единица — недосмотр формы, а не
 * решение закупщика. Ткань в явной НЕрулонной единице («шт», «м») остаётся
 * как была: на бою так заведены «Джоггеры» и «Дой-пакет» — это по сути
 * не полотно, и требовать с них рулоны значило бы запереть их приёмку.
 * Клиентское зеркало — `materialTracksRolls` (`utils/materialUnit.ts`),
 * сторож `materialRollsAdd.test.ts`.
 */
create or replace function public.erp_material_tracks_rolls(p_kind text, p_unit text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select public.erp_unit_tracks_rolls(p_unit)
      or (p_kind = 'fabric' and coalesce(btrim(p_unit), '') = '');
$function$;

revoke execute on function public.erp_material_tracks_rolls(text, text) from public, anon;
grant execute on function public.erp_material_tracks_rolls(text, text) to authenticated, service_role;

-- ── Приёмка: тот же текст, что в 20260928131459, кроме признака рулонов ──
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
  v_kind     text;
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

  select unit, price_per_unit, kind into v_unit, v_price, v_kind
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

    -- Правка 01.10, п. 1: ткань без единицы учитывается рулонами (как кг)
    if public.erp_material_tracks_rolls(v_kind, v_unit) and coalesce(p_rolls, 0) <= 0 then
      raise exception 'erp_material_accept: ткань учитывается рулонами — укажите количество рулонов'
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

-- ── Добавление рулонов к уже принятому материалу ──────────────────────────
--
-- Ключ попытки у рулона: повтор после оборванного ответа не заведёт рулоны
-- второй раз (на цеховом Wi-Fi это обычное дело).
alter table public.erp_material_rolls add column if not exists add_key uuid;
create index if not exists erp_material_rolls_add_key_idx
  on public.erp_material_rolls (material_id, add_key) where add_key is not null;

/**
 * Рулоны к ПРИНЯТОМУ материалу — без новой строки журнала приходов.
 *
 * Принятое количество (`qty_received`) — сумма журнала, и второй приход
 * удвоил бы остаток. Поэтому здесь журнал не трогается вовсе: рулоны
 * раскладывают уже принятые килограммы. Сумма весов всех рулонов
 * материала (прежних и новых) должна совпасть с принятым — то же правило
 * и тот же допуск 0.01, что у `erp_material_accept`.
 *
 * `security definer` с гейтом внутри: INSERT-политика рулонов открыта
 * под `material.receive`, но пересчёт метража и блокировка материала
 * идут мимо RLS одной транзакцией.
 */
create or replace function public.erp_material_rolls_add(
  p_material_id uuid,
  p_roll_params jsonb,
  p_client_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mat      public.erp_materials;
  v_count    int;
  v_existing numeric;
  v_sum      numeric;
  v_seq      int;
  v_receipt  uuid;
  v_new      record;
begin
  if not public.erp_has_permission('material.receive') then
    raise exception 'erp_material_rolls_add: нужно право material.receive'
      using errcode = '42501';
  end if;

  select * into v_mat from public.erp_materials where id = p_material_id for update;
  if not found then
    raise exception 'erp_material_rolls_add: материал не найден' using errcode = 'P0002';
  end if;

  -- Повтор той же попытки: рулоны уже заведены, второй раз не заводим
  if p_client_key is not null and exists (
    select 1 from public.erp_material_rolls
     where material_id = p_material_id and add_key = p_client_key
  ) then
    return jsonb_build_object(
      'material_id', p_material_id, 'duplicate', true,
      'rolls_total', (select count(*) from public.erp_material_rolls where material_id = p_material_id));
  end if;

  if not public.erp_material_tracks_rolls(v_mat.kind, v_mat.unit) then
    raise exception 'erp_material_rolls_add: материал не учитывается рулонами'
      using errcode = '22023';
  end if;

  if v_mat.accept_status not in ('accepted_full', 'accepted_partial')
     or coalesce(v_mat.qty_received, 0) <= 0 then
    raise exception 'erp_material_rolls_add: рулоны добавляются к принятому материалу — сначала примите приход'
      using errcode = '22023';
  end if;

  if p_roll_params is null or jsonb_typeof(p_roll_params) <> 'array'
     or jsonb_array_length(p_roll_params) = 0 then
    raise exception 'erp_material_rolls_add: укажите хотя бы один рулон'
      using errcode = '22023';
  end if;
  v_count := least(jsonb_array_length(p_roll_params), 500);

  if exists (
    select 1 from jsonb_array_elements(p_roll_params) v
     where nullif(v->>'weight_kg', '') is null or (v->>'weight_kg')::numeric <= 0
  ) then
    raise exception 'erp_material_rolls_add: вес рулона должен быть больше нуля'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_roll_params) v
     where nullif(v->>'length_source', '') is not null
       and v->>'length_source' not in ('supplier', 'measured')
  ) then
    raise exception 'erp_material_rolls_add: источник метража — supplier или measured'
      using errcode = '22023';
  end if;

  -- Рулон без веса (принят до 21.09) в сумму не входит: его вес склад
  -- проставит отдельно, и тогда сверка суммы пройдёт уже там
  if exists (select 1 from public.erp_material_rolls
              where material_id = p_material_id and qty is null) then
    raise exception 'erp_material_rolls_add: у принятых рулонов не указан вес — сначала заполните его'
      using errcode = '22023';
  end if;

  select coalesce(sum(qty), 0) into v_existing
    from public.erp_material_rolls where material_id = p_material_id;
  select sum((v->>'weight_kg')::numeric) into v_sum
    from jsonb_array_elements(p_roll_params) v;

  if abs(v_existing + v_sum - v_mat.qty_received) > 0.01 then
    raise exception 'erp_material_rolls_add: сумма весов рулонов % не сходится с принятым количеством %',
      v_existing + v_sum, v_mat.qty_received using errcode = '22023';
  end if;

  select coalesce(max(seq), 0) into v_seq
    from public.erp_material_rolls where material_id = p_material_id;
  -- Рулоны принадлежат последнему приходу: отдельной партии у них нет
  select id into v_receipt from public.erp_material_receipts
   where material_id = p_material_id order by created_at desc limit 1;

  insert into public.erp_material_rolls
    (material_id, receipt_id, seq, label, unit, qty, qty_left, price_per_unit,
     width_cm, density_gsm, length_m, length_source, add_key)
  select p_material_id, v_receipt, v_seq + g, 'Рулон №' || (v_seq + g)::text, v_mat.unit,
         (p_roll_params->(g - 1)->>'weight_kg')::numeric,
         (p_roll_params->(g - 1)->>'weight_kg')::numeric,
         v_mat.price_per_unit,
         nullif(p_roll_params->(g - 1)->>'width_cm', '')::numeric,
         nullif(p_roll_params->(g - 1)->>'density_gsm', '')::numeric,
         nullif(p_roll_params->(g - 1)->>'length_m', '')::numeric,
         case when nullif(p_roll_params->(g - 1)->>'length_m', '')::numeric > 0
              then coalesce(nullif(p_roll_params->(g - 1)->>'length_source', ''), 'supplier') end,
         p_client_key
    from generate_series(1, v_count) as g;

  for v_new in
    select id from public.erp_material_rolls
     where material_id = p_material_id and seq > v_seq
  loop
    perform public.erp_roll_recalc(v_new.id);
  end loop;

  return jsonb_build_object(
    'material_id', p_material_id,
    'duplicate',   false,
    'added',       v_count,
    'rolls_total', (select count(*) from public.erp_material_rolls where material_id = p_material_id)
  );
end $function$;

revoke execute on function public.erp_material_rolls_add(uuid, jsonb, uuid) from public, anon;
grant execute on function public.erp_material_rolls_add(uuid, jsonb, uuid) to authenticated, service_role;
