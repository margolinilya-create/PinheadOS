-- РУЛОНЫ ПРИ ПРИЁМКЕ: ОБЯЗАТЕЛЬНОСТЬ И СОЗДАНИЕ (правка заказчика 16.09, п. 5).
--
-- «Если материал учитывается в кг, под полем „Пришло сейчас, килограммы"
-- добавить дополнительное ОБЯЗАТЕЛЬНОЕ поле „Количество рулонов, шт."…
-- После сохранения приёмки ERP должна создать внутри принятой партии
-- соответствующее количество рулонов: „Рулон №1", „Рулон №2", „Рулон №3"».
--
-- ОБЯЗАТЕЛЬНОСТЬ СТОИТ И НА СЕРВЕРЕ, И В ФОРМЕ — одним коммитом, как требует
-- правило раздела: страж разрешает ровно то, что разрешает интерфейс.
-- Условие «учитывается в кг» считает `erp_unit_tracks_rolls` — зеркало
-- клиентской `utils/materialUnit.ts`: единица это свободный текст, и на бою
-- в ней разнобой («кг» и «Килограммы» — код и имя одного значения справочника).
--
-- РУЛОНЫ СОЗДАЮТСЯ ТОЛЬКО НА ВЕТКЕ «ПРИХОД РЕАЛЬНО ВСТАВИЛСЯ» (`not v_dup`).
-- Приёмка идемпотентна по `client_key` — это условие офлайн-очереди, которая
-- по определению повторяет отправку. Повтор на цеховом Wi-Fi не должен
-- удваивать рулоны так же, как не должен удваивать килограммы.
--
-- НУМЕРАЦИЯ ПРОДОЛЖАЕТСЯ, А НЕ НАЧИНАЕТСЯ ЗАНОВО: `max(seq)` по материалу.
-- Документ требует, чтобы вторая поставка дала «Рулон №3…№5» — в цеху эти
-- номера произносят вслух, и два разных рулона с одним номером означают
-- перепутанную ткань.
--
-- ПОТОЛОК 500 РУЛОНОВ — защита от опечатки: «3000» вместо «3» создало бы три
-- тысячи строк, которые потом выбирать закройщику в селекте.
--
-- DROP+CREATE с явными правами по той же причине, что в 20260916191850:
-- лишний аргумент при `create or replace` дал бы ПЕРЕГРУЗКУ и неоднозначность
-- PostgREST на действии, которым склад живёт каждый день.
--
-- ⚠️ У ЭТОЙ РЕДАКЦИИ БЫЛ ДЕФЕКТ: `select max(seq) … for update` — Postgres
-- не допускает `FOR UPDATE` с агрегатом (0A000), и приёмка падала. Поймано
-- проверкой на живой базе в той же сессии, исправлено следующей миграцией
-- (`20260916202527`): блокируется строка МАТЕРИАЛА, а максимум читается
-- обычным запросом. Файл сохраняет то, что было применено, — репозиторий
-- обязан описывать прод, а не намерение.

drop function if exists public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb);

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
      select coalesce(max(seq), 0) into v_seq
        from public.erp_material_rolls
       where material_id = p_material_id
         for update;

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
