-- Повтор приёмки не удваивает приход.
--
-- ЗАЧЕМ. `erp_material_accept` пишет строку журнала, и сумма журнала — это
-- `qty_received`, на которой держатся материальный гейт цеха, «сколько осталось
-- принять» и графа «принято» в закупке. Значит, ДВЕ строки на одну поставку —
-- это молча удвоенное количество материала на фабрике.
--
-- Сегодня такое возможно ровно одним способом, и он не редкий: запрос ушёл,
-- сервер его закоммитил, ответ не вернулся (цеховой Wi-Fi моргнул) — человек
-- видит ошибку и жмёт «Принять» второй раз. Клиентский `saving` от этого
-- не защищает: он гасит кнопку на время ОДНОГО запроса, а здесь их два,
-- и оба «настоящие». Повтора мутаций в `erpQuery` нет намеренно
-- («повторяется только чтение»), но человек-то повторяет.
--
-- Ключ идемпотентности генерирует КЛИЕНТ и держит его на всё время попытки:
-- повтор той же попытки несёт тот же ключ, новая приёмка — новый. Сервер
-- отличает одно от другого по уникальному индексу, а не по догадке
-- «похоже на дубль».
--
-- Это же ключ, без которого нельзя делать офлайн-очередь: очередь по
-- определению повторяет отправку, и без идемпотентности она превращает
-- потерю связи в удвоенный приход — дефект хуже того, который она лечит.

alter table public.erp_material_receipts
  add column if not exists client_key uuid;

comment on column public.erp_material_receipts.client_key is
  'Ключ идемпотентности от клиента: повтор той же попытки приёмки (обрыв ответа, офлайн-очередь) не создаёт вторую строку журнала и не удваивает qty_received.';

-- Частичный: у строк, заведённых до 22.08, ключа нет, и NULL-ы не должны
-- мешать друг другу. `on conflict` по нему не используется — функция проверяет
-- существование явно, поэтому 42P10 здесь не грозит.
create unique index if not exists erp_material_receipts_client_key_idx
  on public.erp_material_receipts (client_key)
  where client_key is not null;

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

  -- Тот же ключ уже приходил: приход записан, второй раз его писать нельзя.
  -- Статус позиции при этом всё равно приводится к запрошенному — повтор
  -- обязан оставить систему в том же состоянии, а не в половинчатом.
  if p_client_key is not null then
    select exists (
      select 1 from public.erp_material_receipts where client_key = p_client_key
    ) into v_dup;
  end if;

  -- Приход, если он есть. Единица берётся у материала: спрашивать её второй раз
  -- значит позволить журналу и позиции разойтись в единицах измерения.
  if p_qty is not null and not v_dup then
    if p_qty <= 0 then
      raise exception 'erp_material_accept: количество прихода должно быть больше нуля'
        using errcode = '22023';
    end if;
    insert into public.erp_material_receipts
      (material_id, qty, unit, accept_status, invoice, comment, received_on, author, client_key)
    values
      (p_material_id, p_qty, v_unit, p_accept_status, nullif(btrim(coalesce(p_invoice, '')), ''),
       nullif(btrim(coalesce(p_comment, '')), ''),
       coalesce(p_received_on, public.erp_local_date()), p_actor, p_client_key);
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
    'material_id',   p_material_id,
    'qty_received',  v_received,
    'accept_status', p_accept_status,
    -- Клиенту важно отличить «записали» от «уже было записано»: во втором
    -- случае повторное сообщение «приёмка записана» было бы неправдой
    'duplicate',     v_dup
  );
end $$;

revoke execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid) from public, anon;
grant  execute on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid) to authenticated;

-- Прежняя сигнатура (без ключа) больше не нужна: единственный её вызывающий —
-- наш клиент, и он уходит на новую тем же коммитом. Оставленная рядом, она
-- стала бы вторым путём записи журнала — без идемпотентности.
drop function if exists public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text);

comment on function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid) is
  'Приёмка материала одной транзакцией: строка журнала erp_material_receipts (её сумму кладёт в qty_received триггер) плюс статус приёмки самой позиции. Идемпотентна по p_client_key: повтор той же попытки не создаёт вторую строку и не удваивает количество. Гейт: accepted_full/accepted_partial невозможны при нулевом qty_received. security invoker: RLS и erp_material_guard работают как обычно.';
