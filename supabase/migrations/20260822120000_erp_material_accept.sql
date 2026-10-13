-- Приёмка материала: журнал и статус одной транзакцией.
--
-- ЧТО НАШЛОСЬ НА БОЕВОЙ БАЗЕ (22.08):
--   · материалов со статусом `received`/`accepted_full` — 9
--   · задач склада `material_receipt` в статусе `accepted` — 6
--   · строк в `erp_material_receipts` — 0
--   · материалов с непустым `qty_received` — 0 из 19
--
-- То есть журнал приходов, заведённый волной 3.3 как ЕДИНСТВЕННЫЙ писатель
-- количества, не получил ни одной записи, а приёмки при этом происходили.
--
-- Причина в том, что журнал был необязательным вторым шагом: `acceptMaterial`
-- писал статус материала, строку истории склада и закрытие задачи, а строку
-- журнала — нет; за ней отправляли в отдельную форму «Записать приход».
-- Никто туда не ходил.
--
-- ЧЕМ ЭТО ЛОМАЕТ ЭКРАНЫ (колонку ведёт триггер от журнала, журнал пуст →
-- колонка null всегда):
--   · экран закупки в графе «принято» показывает пусто у КАЖДОГО принятого
--     материала — то есть утверждает, что не принято ничего;
--   · «сколько осталось принять» в карточке склада считает от нуля, поэтому
--     ЧАСТИЧНАЯ ПРИЁМКА не работает вовсе: второй приход не знает о первом,
--     ради чего журнал и заводили;
--   · сортировка по «принято» молча падает на дату.
--
-- Почему не заметили: материальный гейт цеха смотрит `status` +
-- `accept_status`, а не `qty_received`. Производство не встало, ошибок не было,
-- всё «работает». Тот же профиль отказа, что у `stage_id` подряда («2 строки,
-- обе null, ветка rollup не срабатывала ни разу») и у `addSubcontractMove`
-- («жил с волны 3.5 без единой точки вызова»).
--
-- РЕШЕНИЕ — ровно то, которое проект уже принял для подряда 20.08:
-- «селект хранимого статуса рядом с величиной, которую ведёт журнал, — это
-- разрешение соврать; движение — ДЕЙСТВИЯ, и то, что меняет количества, пишет
-- журнал той же транзакцией». Здесь буквально та же конструкция: статус
-- «Принято полностью» можно было выставить, не записав ни одной единицы.
--
-- `security invoker` осознанно: «одним запросом» не значит «мимо RLS». Политики
-- `erp_material_receipts`, `erp_materials` и страж `erp_material_guard`
-- (право `material.receive`) исполняются от лица вызывающего, как и раньше.

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
  p_actor         text    default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_unit     text;
  v_received numeric;
  v_rows     int;
begin
  -- Перечень дословно повторяет CHECK обеих таблиц (accept_status) и
  -- MATERIAL_ACCEPT_LABELS в types.ts. Пропущенное здесь значение не упало бы
  -- на CHECK, а получило бы отказ раньше и с чужим объяснением.
  if p_accept_status not in
     ('accepted_full', 'accepted_partial', 'shortage', 'mismatch', 'rejected') then
    raise exception 'erp_material_accept: неизвестный статус приёмки «%»', p_accept_status
      using errcode = '22023';
  end if;

  -- То же требование, что у CHECK `erp_material_receipts_deviation_needs_comment`,
  -- но названное словами: без него отклонение падало бы сырым 23514, и человек
  -- читал бы «violates check constraint» вместо «объясните расхождение».
  if p_accept_status not in ('accepted_full', 'accepted_partial')
     and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'erp_material_accept: расхождение нужно объяснить — заполните комментарий'
      using errcode = '22023';
  end if;

  select unit into v_unit from public.erp_materials where id = p_material_id;
  if not found then
    raise exception 'erp_material_accept: материал не найден' using errcode = 'P0002';
  end if;

  -- Приход, если он есть. Единица берётся у материала: спрашивать её второй раз
  -- значит позволить журналу и позиции разойтись в единицах измерения.
  if p_qty is not null then
    if p_qty <= 0 then
      raise exception 'erp_material_accept: количество прихода должно быть больше нуля'
        using errcode = '22023';
    end if;
    insert into public.erp_material_receipts
      (material_id, qty, unit, accept_status, invoice, comment, received_on, author)
    values
      (p_material_id, p_qty, v_unit, p_accept_status, nullif(btrim(coalesce(p_invoice, '')), ''),
       nullif(btrim(coalesce(p_comment, '')), ''),
       coalesce(p_received_on, public.erp_local_date()), p_actor);
  end if;

  -- Статус приёмки самого материала. `qty_received` и `received_at` здесь
  -- НЕ трогаются: их ведёт триггер `erp_material_receipts_rollup` — один
  -- писатель на величину, иначе приход затирал бы приход.
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
  -- RLS на UPDATE запрещает через `USING`, то есть отдаёт «0 строк», а не ошибку.
  -- Без этой проверки функция вернула бы зелёное «принято» на запрете прав.
  if v_rows = 0 then
    raise exception 'erp_material_accept: приёмка материала не разрешена'
      using errcode = '42501';
  end if;

  select coalesce(qty_received, 0) into v_received
    from public.erp_materials where id = p_material_id;

  -- ГЕЙТ: приёмку нельзя объявить, не записав ни одной единицы.
  -- Именно это и происходило: девять материалов «приняты», журнал пуст.
  -- `shortage`, `mismatch` и `rejected` под гейт не подпадают — они как раз
  -- и означают, что пришло не то, не всё или не пришло вовсе, и требовать
  -- от них положительного прихода значило бы запретить сказать правду.
  if p_accept_status in ('accepted_full', 'accepted_partial') and v_received <= 0 then
    raise exception 'erp_material_accept: приёмка без записанного прихода — укажите, сколько пришло'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'material_id',  p_material_id,
    'qty_received', v_received,
    'accept_status', p_accept_status
  );
end $$;

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text) from public, anon;
grant  execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text) to authenticated;

comment on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text) is
  'Приёмка материала одной транзакцией: строка журнала erp_material_receipts (её сумму кладёт в qty_received триггер) плюс статус приёмки самой позиции. Гейт: accepted_full/accepted_partial невозможны при нулевом qty_received — статус рядом с величиной, которую ведёт журнал, иначе разрешает соврать. security invoker: RLS и erp_material_guard работают как обычно.';
