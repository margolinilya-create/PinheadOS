-- ПОЧИНКА НУМЕРАЦИИ РУЛОНОВ (к 20260916202447).
--
-- ЧТО СЛОМАЛОСЬ. Блокировка от гонки была записана как
-- `select coalesce(max(seq), 0) … for update`, а Postgres не допускает
-- `FOR UPDATE` с агрегатной функцией: приёмка падала с 0A000, то есть
-- склад не мог принять НИ ОДНУ партию ткани.
--
-- Поймано проверкой на живой базе — транзакцией с откатом, по сценарию
-- из самого документа (40 кг / 2 рулона, затем 60 кг / 3 рулона). Ни один
-- юнит-тест этого бы не увидел: настоящего Postgres не видит ни vitest,
-- ни e2e с мок-ключами.
--
-- ЧЕМ ЗАМЕНЕНО. Блокируется строка МАТЕРИАЛА (`erp_materials … for update`) —
-- именно она общая для двух параллельных приёмок, и именно её удержание
-- не даёт обеим взять один и тот же максимум. Максимум после этого читается
-- обычным запросом.
--
-- DROP здесь не нужен: сигнатура не менялась, а `create or replace`
-- привилегии НЕ сбрасывает (в отличие от `drop` + `create`).

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
  p_rolls integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
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
      insert into public.erp_material_rolls (material_id, receipt_id, seq, label, unit)
      select p_material_id, v_receipt, v_seq + g, 'Рулон №' || (v_seq + g)::text, v_unit
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
end $$;

comment on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer) is
  'Приёмка материала одной транзакцией: приход, разбивка по размерам и рулоны партии';

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer)
  from public, anon;
grant execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer)
  to authenticated, service_role;
