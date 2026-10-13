-- Дубль приёмки определяет САМ INSERT, а не предварительная проверка.
--
-- ФАЙЛ ВОССТАНОВЛЕН ЗАДНИМ ЧИСЛОМ 31.08. Миграция применена к проду 25.08
-- (`20260825192628 erp_material_accept_atomic_key`), файла в репозитории
-- не завели. Расхождение прожило шесть дней и было хуже, чем «нет файла»:
-- в репозитории оставался не только СТАРЫЙ код, но и комментарий,
-- утверждающий обратное действующему поведению — «`on conflict` по нему
-- не используется, функция проверяет». Следующий, кто взял бы «подлинный
-- текст прежней миграции», получил бы текст, которого в базе нет.
--
-- Текст ПОДЛИННЫЙ: снят с действующего определения (`pg_get_functiondef`)
-- и приведён к виду миграций проекта. Совпадение проверено по `pg_proc.prosrc`:
-- md5 тела функции из файла равен md5 тела в проде.
--
-- ЧТО ЧИНИТ САМА ПРАВКА. Идемпотентность приёмки держалась на
-- `select exists (…) into v_dup` перед вставкой. Между проверкой и `insert`
-- помещались два параллельных вызова очереди: первый вставлял строку, второй
-- проходил проверку до неё и падал на 23505 — то есть очередь сообщала
-- об ошибке приёмки, которая на самом деле прошла. Дубль теперь определяет
-- сама вставка (`on conflict (client_key) where client_key is not null
-- do nothing` + `get diagnostics`), а окна между проверкой и записью
-- не существует по построению.

create or replace function public.erp_material_accept(
  p_material_id   uuid,
  p_accept_status text,
  p_qty           numeric default null,
  p_comment       text    default null,
  p_invoice       text    default null,
  p_received_on   date    default null,
  p_fact_name     text    default null,
  p_fact_color    text    default null,
  p_fact_article  text    default null,
  p_actor         text    default null,
  p_client_key    uuid    default null
)
returns jsonb
language plpgsql
-- `security invoker` ЯВНО, хотя это и умолчание: `pg_get_functiondef` его
-- не печатает, и восстановленный дословно файл терял бы слово, которое
-- сторож `materialReceipts.test.ts` требует по делу — приёмка обязана идти
-- от лица вызывающего, иначе RLS материала перестаёт что-либо значить.
-- На само определение не влияет: ключевое слово в заголовке, а не в теле
security invoker
set search_path to 'public'
as $$
declare
  v_unit     text;
  v_received numeric;
  v_rows     int;
  v_dup      boolean := false;
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

  -- Дубль определяет САМ INSERT, а не предварительная проверка: между
  -- `select exists` и `insert` помещались два параллельных вызова очереди,
  -- и второй падал 23505 на приёмке, которая прошла
  if p_qty is not null then
    if p_qty <= 0 then
      raise exception 'erp_material_accept: количество прихода должно быть больше нуля'
        using errcode = '22023';
    end if;
    insert into public.erp_material_receipts
      (material_id, qty, unit, accept_status, invoice, comment, received_on, author, client_key)
    values
      (p_material_id, p_qty, v_unit, p_accept_status, nullif(btrim(coalesce(p_invoice, '')), ''),
       nullif(btrim(coalesce(p_comment, '')), ''),
       coalesce(p_received_on, public.erp_local_date()), p_actor, p_client_key)
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
