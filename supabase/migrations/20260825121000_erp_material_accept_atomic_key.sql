-- Идемпотентность приёмки материала — АТОМАРНАЯ, а не «проверил и вставил».
--
-- ЧТО БЫЛО. Ключ `client_key` защищает от удвоенного прихода: очередь по
-- определению повторяет отправку, да и человек жмёт «Принять» второй раз,
-- когда ответ оборвался. Проверка стояла так:
--
--     select exists (… where client_key = p_client_key) into v_dup;
--     if p_qty is not null and not v_dup then insert … end if;
--
-- Между `select` и `insert` нет ни блокировки, ни `on conflict`. Два
-- одновременных вызова с ОДНИМ ключом оба видят «дубля нет» и оба вставляют;
-- второй падает на частичном уникальном индексе с 23505.
--
-- Одновременность здесь не теоретическая. `flushQueue()` не защищён
-- от повторного входа, а зовётся из `resyncRealtime()`, на который подписаны
-- сразу ТРИ события — `online`, `focus` и `visibilitychange`. Планшет,
-- вернувшийся из сна, обычно даёт два из них подряд.
--
-- Данные при этом целы: индекс делает свою работу. Ломается объяснение —
-- кладовщик видит «Отправлено действий: 1» и рядом красное «Не удалось
-- отправить» про ту же самую приёмку, которая на самом деле прошла.
--
-- ЧТО СТАЛО. Дубль определяет САМ INSERT: `on conflict … do nothing` плюс
-- `row_count`. Гонки не остаётся по построению — арбитром работает тот же
-- частичный индекс, а решение принимает не наш `select`, а сам Postgres.
--
-- ПОЧЕМУ ЗДЕСЬ МОЖНО ЧАСТИЧНЫЙ ИНДЕКС. Правило проекта «индекс под
-- `onConflict` не может быть частичным» — про PostgREST: он шлёт голый
-- `ON CONFLICT (col)`, а вывести из него частичный индекс Postgres не умеет.
-- Внутри plpgsql предикат пишется руками (`where client_key is not null`),
-- и арбитр находится однозначно. Строка с `client_key is null` предикату
-- не удовлетворяет, конфликта по этому индексу для неё быть не может —
-- вставка идёт как обычно, то есть приёмка без ключа работает по-прежнему.
--
-- ПОДЛИННЫЙ ТЕКСТ снят с действующего определения в базе
-- (`pg_get_functiondef`, 25.08) и приведён к виду миграций проекта.
-- Комментарии тела восстановлены из файла 20260822130000. Изменений два:
-- убран предварительный `select exists`, дубль считается из `row_count`.

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
security invoker
set search_path = public
as $$
declare
  v_unit     text;
  v_received numeric;
  v_rows     int;
  v_dup      boolean := false;
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

  /*
   * Приход, если он есть. Единица берётся у материала: спрашивать её второй раз
   * значит позволить журналу и позиции разойтись в единицах измерения.
   *
   * Повтор той же попытки не создаёт вторую строку и не удваивает
   * `qty_received` — решает это САМ INSERT, а не предварительная проверка:
   * между `select exists` и `insert` помещались два параллельных вызова,
   * и второй падал 23505 на приёмке, которая прошла.
   */
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
    -- Ноль строк здесь означает ровно одно: такой ключ уже приходил
    v_dup := (v_rows = 0);
  end if;

  -- Статус приёмки самого материала. `qty_received` и `received_at` здесь
  -- НЕ трогаются: их ведёт триггер `erp_material_receipts_rollup` — один
  -- писатель на величину, иначе приход затирал бы приход.
  --
  -- Выполняется и при повторе: повтор обязан оставить систему в том же
  -- состоянии, а не в половинчатом.
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

comment on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid
) is
  'Приёмка материала ОДНИМ действием: журнал erp_material_receipts и статус '
  'позиции одной транзакцией. Идемпотентна по client_key — дубль определяет '
  'сам INSERT через on conflict do nothing, а не предварительная проверка: '
  'между select и insert помещались два параллельных вызова очереди.';
