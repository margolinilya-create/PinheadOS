-- Вес рулона, его цена и остаток (правки заказчика 21.09, пп. 1, 2, 5).
--
-- ЧТО БЫЛО НЕ ТАК. Приёмка создавала рулоны ОДНОЙ строкой `generate_series`,
-- без веса вообще: на бою 21.09 `erp_material_rolls.qty` пуст у всех сорока
-- одного рулона. Поэтому «закройка не получает рулоны с собственным весом»
-- (п. 2) и остаток посчитать не из чего (п. 5) — вычитать не из чего.
--
-- ЧТО ДОБАВЛЯЕТСЯ.
--
-- `qty_left` — остаток рулона, ВЕДЁТ СЕРВЕР при сдаче закроя (первоначальный
-- вес минус фактический расход). Хранимое поле, а не вычисление на лету:
-- по нему отбирается складской остаток, а условие вида «qty минус сумма
-- расходов» в каждом читателе разошлось бы на первом же изменении.
--
-- `leftover_kind` — решение закройщика по остатку: `usable` («остаток
-- пригоден») или `scrap` («малый остаток, не учитывать»). Документ прямо
-- просит РУЧНОЙ выбор и запрещает автоматический порог: «автоматический
-- порог в килограммах пока не задавать». NULL — по рулону ещё не решали.
--
-- `price_per_unit` — СНИМОК закупочной цены на момент приёмки. Документ
-- просит «сохранять эту цену вместе с закупкой и конкретной партией/
-- рулонами» (п. 1) и считать стоимость остатка «по закупочной цене
-- конкретного рулона» (п. 5). Ссылаться на текущую цену материала нельзя:
-- правка цены задним числом переписала бы себестоимость закрытых заказов.

alter table public.erp_material_rolls
  add column if not exists qty_left numeric,
  add column if not exists leftover_kind text,
  add column if not exists price_per_unit numeric;

alter table public.erp_material_rolls
  drop constraint if exists erp_material_rolls_leftover_kind_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_leftover_kind_check
  check (leftover_kind is null or leftover_kind in ('usable', 'scrap'));

alter table public.erp_material_rolls
  drop constraint if exists erp_material_rolls_qty_left_check;
alter table public.erp_material_rolls
  add constraint erp_material_rolls_qty_left_check
  check (qty_left is null or qty_left >= 0);

comment on column public.erp_material_rolls.qty
  is 'Первоначальный вес рулона, введён при приёмке. NULL — рулон принят до правки 21.09';
comment on column public.erp_material_rolls.qty_left
  is 'Остаток рулона: первоначальный вес минус расход закроя. Ведёт erp_stage_submit_report';
comment on column public.erp_material_rolls.leftover_kind
  is 'Решение закройщика по остатку: usable (пригоден) / scrap (малый, не учитывать). NULL — не решали';
comment on column public.erp_material_rolls.price_per_unit
  is 'Снимок закупочной цены материала на момент приёмки — по ней считается стоимость остатка';

-- Приёмка заводит рулоны С ВЕСАМИ.
--
-- `p_roll_weights` — массив весов по порядку создаваемых рулонов. Необязателен
-- НАМЕРЕННО: офлайн-очередь склада хранит уже собранные вызовы, и обязательный
-- параметр уронил бы в день выката всё, что накопилось на планшетах. Без него
-- поведение прежнее — рулоны без веса, дозаполняются отдельным действием.
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
  p_roll_weights jsonb default null
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
  v_receipt  uuid;
  v_seq      int;
  v_rolls    int;
  v_weights  numeric[];
  v_sum      numeric;
  v_price    numeric;
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
     * ВЕСА РУЛОНОВ (правка 21.09, п. 2): «после указания количества рулонов
     * раскрывать строки для ввода фактического веса каждого рулона. Сумма
     * веса всех рулонов должна совпадать с общим фактически принятым
     * количеством ткани. Если сумма не совпадает, не давать завершить
     * приёмку и показать понятную ошибку».
     *
     * Допуск 0.01 — на округление ввода в килограммах: требовать побитового
     * совпадения от чисел с десятыми значило бы ловить кладовщика на «99.99».
     */
    if p_roll_weights is not null and jsonb_typeof(p_roll_weights) = 'array' then
      select array_agg((value #>> '{}')::numeric order by ord)
        into v_weights
        from jsonb_array_elements(p_roll_weights) with ordinality as t(value, ord);

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
        (material_id, receipt_id, seq, label, unit, qty, qty_left, price_per_unit)
      select p_material_id, v_receipt, v_seq + g, 'Рулон №' || (v_seq + g)::text, v_unit,
             -- Вес по порядку; без весов рулон заводится как раньше, пустым
             case when v_weights is not null then v_weights[g] end,
             case when v_weights is not null then v_weights[g] end,
             v_price
        from generate_series(1, v_rolls) as g;
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

/**
 * ДОЗАПОЛНЕНИЕ ВЕСА У РУЛОНОВ, ПРИНЯТЫХ ДО ПРАВКИ (решение заказчика 21.09).
 *
 * Сорок один рулон на бою заведён без веса, и «остаток ткани» по ним посчитать
 * нельзя. Разложить принятое поровну нельзя тем более: это выдуманные цифры
 * в учётных данных, и остаток по ним был бы неверным. Поэтому вес указывает
 * склад — тем же действием и с той же проверкой суммы, что при приёмке.
 *
 * `security definer`: право на это действие — `material.receive` (приёмка),
 * а UPDATE-политика рулонов открыта под права ЭТАПА (`stage.progress`),
 * потому что расход по рулону пишет цех. Кладовщику их не выдают, и без
 * definer он получил бы отказ на своей же приёмке.
 */
create or replace function public.erp_material_rolls_set_weights(
  p_material_id uuid,
  p_weights jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qty      numeric;
  v_sum      numeric;
  v_touched  int;
  v_bad      int;
  v_unknown  int;
begin
  if not public.erp_has_permission('material.receive') then
    raise exception 'erp_material_rolls_set_weights: нужно право material.receive'
      using errcode = '42501';
  end if;

  if p_weights is null or jsonb_typeof(p_weights) <> 'array'
     or jsonb_array_length(p_weights) = 0 then
    raise exception 'erp_material_rolls_set_weights: не переданы веса рулонов'
      using errcode = '22023';
  end if;

  select coalesce(qty_received, 0) into v_qty
    from public.erp_materials where id = p_material_id;
  if not found then
    raise exception 'erp_material_rolls_set_weights: материал не найден' using errcode = 'P0002';
  end if;

  -- Веса приходят парами «рулон → вес»: сопоставлять их порядком в массиве
  -- значило бы зависеть от сортировки на клиенте
  select count(*) into v_bad
    from jsonb_array_elements(p_weights) w
   where nullif(w->>'roll_id', '') is null
      or nullif(w->>'qty', '') is null
      or (w->>'qty')::numeric <= 0;
  if v_bad > 0 then
    raise exception 'erp_material_rolls_set_weights: вес рулона должен быть больше нуля'
      using errcode = '22023';
  end if;

  select count(*) into v_unknown
    from jsonb_array_elements(p_weights) w
   where not exists (
     select 1 from public.erp_material_rolls r
      where r.id = (w->>'roll_id')::uuid and r.material_id = p_material_id);
  if v_unknown > 0 then
    raise exception 'erp_material_rolls_set_weights: % рулонов не принадлежат этому материалу', v_unknown
      using errcode = '22023';
  end if;

  -- Сумма сверяется со ВСЕМИ рулонами материала: те, у кого вес уже есть,
  -- входят в неё наравне с проставляемыми — иначе частичное дозаполнение
  -- проходило бы с любой цифрой
  select coalesce(sum(coalesce(t.qty, r.qty)), 0) into v_sum
    from public.erp_material_rolls r
    left join lateral (
      select (w->>'qty')::numeric as qty
        from jsonb_array_elements(p_weights) w
       where (w->>'roll_id')::uuid = r.id
       limit 1
    ) t on true
   where r.material_id = p_material_id;

  if abs(v_sum - v_qty) > 0.01 then
    raise exception 'erp_material_rolls_set_weights: сумма весов % не сходится с принятым количеством %',
      v_sum, v_qty using errcode = '22023';
  end if;

  with weights as (
    select (w->>'roll_id')::uuid as roll_id, (w->>'qty')::numeric as qty
      from jsonb_array_elements(p_weights) w
  )
  update public.erp_material_rolls r
     set qty = t.qty,
         -- Остаток проставляется только у нетронутого рулона: у того, с кого
         -- уже кроили, он посчитан по расходу и перезаписывать его нельзя
         qty_left = case when r.status = 'in_stock' and r.qty_left is null
                         then t.qty else r.qty_left end,
         price_per_unit = coalesce(r.price_per_unit, m.price_per_unit)
    from weights t
    join public.erp_materials m on m.id = p_material_id
   where r.id = t.roll_id and r.material_id = p_material_id;
  get diagnostics v_touched = row_count;

  return jsonb_build_object('material_id', p_material_id, 'updated', v_touched, 'total', v_sum);
end $function$;

revoke execute on function public.erp_material_rolls_set_weights(uuid, jsonb) from public, anon;
grant execute on function public.erp_material_rolls_set_weights(uuid, jsonb) to authenticated;

-- СТАРАЯ ПЕРЕГРУЗКА СНИМАЕТСЯ. `create or replace` с новым параметром создаёт
-- ВТОРУЮ функцию, а не заменяет прежнюю: PostgREST на именованных аргументах
-- получил бы «не могу выбрать между двумя erp_material_accept» — приёмка
-- склада упала бы целиком. Гранты выдаются заново: у новой сигнатуры свой ACL.
drop function if exists public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer);

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb)
  from public, anon;
grant execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb)
  to authenticated, service_role;
