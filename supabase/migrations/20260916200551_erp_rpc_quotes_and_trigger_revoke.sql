-- ДВЕ ПРАВКИ ПО СЛЕДАМ СТОРОЖЕЙ (к миграциям 20260916191850 и 20260916191916).
--
-- 1. ТЕЛО ФУНКЦИИ ОБЯЗАНО БЫТЬ В `$$`, А НЕ В `$function$`.
--
-- Обе пересозданные RPC были записаны так, как их печатает
-- `pg_get_functiondef` — в долларовых кавычках с меткой `$function$`. Для
-- Postgres это всё равно, а для репозитория нет: `functionBody`
-- (`utils/migrations.testutil.ts`) вырезает тело между `$$`, и сторожа
-- приёмки материалов молча получили ПУСТУЮ строку вместо тела. То есть семь
-- проверок «RPC пишет журнал», «статус нельзя объявить при пустом журнале»,
-- «отказ RLS — это не успех» перестали проверять что-либо вообще.
--
-- Это ровно тот отказ, о котором предупреждает раздел «сторожа и тесты»:
-- сторож, зелёный на сломанном коде, — не сторож. Здесь он оказался честнее
-- и упал, но упал ФОРМОЙ, а не существом; чинится форма.
--
-- 2. ТРИГГЕРНАЯ ФУНКЦИЯ НЕ ДОЛЖНА ВЫЗЫВАТЬСЯ ЧЕРЕЗ REST.
--
-- `erp_material_grid_qty()` создавалась без отзыва прав, а EXECUTE приходит
-- от PUBLIC — значит её мог позвать любой вошедший через `/rest/v1/rpc/`.
-- Правило проекта: отзывать `from public, anon`, потому что один только
-- `from anon` не делает ничего (право наследуется от PUBLIC).

-- ── 1. Пересоздание тел в `$$` ─────────────────────────────────────────────
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
security invoker
set search_path to 'public'
as $$
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

  -- Когда разбивка есть, заголовочные числа считаются ИЗ НЕЁ: иначе у
  -- `qty_good` два писателя (форма и сумма строк), и разойдутся они молча
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
end $$;

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

  -- При разбивке количество считается ПО НЕЙ — тот же довод, что у отчёта
  -- этапа: сумма по размерам и «сколько пришло» это одно число
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
end $$;

-- ── 2. Триггерная функция закрыта для REST ─────────────────────────────────
revoke execute on function public.erp_material_grid_qty() from public, anon;
