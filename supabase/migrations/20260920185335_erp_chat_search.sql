-- ПОИСК ПО ПЕРЕПИСКЕ СДЕЛКИ (вторая очередь чата, документ 20.09, п. 4).
--
-- ПОЧЕМУ `pg_trgm`, А НЕ ПОЛНОТЕКСТОВЫЙ ПОИСК. В цеховой переписке ищут
-- по обрывку: артикул «PH-4821», «ромашк», «47 кг». `to_tsvector` режет текст
-- на слова и по словоформам русского языка ищет хорошо, но по ЧАСТИ слова
-- и по строке с цифрами и дефисом — нет; `ILIKE '%...%'` же без индекса
-- сканирует таблицу целиком. Триграммы отвечают на оба вопроса сразу
-- и индексируются.
create extension if not exists pg_trgm with schema extensions;

-- GIN по триграммам тела. `gin_trgm_ops` живёт в схеме расширения, поэтому
-- имя пишем полным: `search_path` в миграции не гарантирован
create index if not exists erp_chat_messages_body_trgm_idx
  on public.erp_chat_messages using gin (body extensions.gin_trgm_ops);

/**
 * ПОИСК ПО СДЕЛКЕ.
 *
 * `security invoker` — видимость решает RLS сообщений («участник раздела»),
 * и второй раз её тут решать нельзя: две формулы одной величины расходятся.
 *
 * Отдельная функция, а не ветка `erp_chat_page`: у поиска другой ответ
 * (совпадения по всей переписке, а не страница ленты), другой порядок
 * (сначала свежие) и другой курсор. Ветка внутри страницы означала бы
 * функцию, которая отвечает на два вопроса сразу, — и каждый следующий
 * правящий ломал бы один, правя другой.
 *
 * УДАЛЁННЫЕ НЕ ИЩУТСЯ: их тело затёрто, и находка вела бы в пустоту.
 */
create or replace function public.erp_chat_search(
  p_order_id uuid,
  p_query    text,
  p_limit    integer default 30
) returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'extensions'
as $fn$
  with lim as (
    select least(greatest(coalesce(p_limit, 30), 1), 100) as n
  ),
  q as (
    select btrim(coalesce(p_query, '')) as text
  ),
  th as (
    select t.id from public.erp_chat_threads t where t.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where e.order_id = p_order_id
  ),
  hits as (
    select m.id, m.author_id, m.body, m.created_at,
           m.item_id, m.stage_id, m.experimental_id
      from public.erp_chat_messages m, q
     where m.thread_id in (select id from th)
       and m.deleted_at is null
       and char_length(q.text) >= 2
       and m.body ilike '%' || q.text || '%'
     -- Свежие выше: в переписке ищут то, что обсуждали недавно
     order by m.created_at desc, m.id desc
     limit (select n from lim)
  )
  select jsonb_build_object(
    'query', (select text from q),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',              h.id,
        'author_id',       h.author_id,
        -- Тело целиком: подсветку и обрезку делает клиент, и он же знает,
        -- сколько места у него есть. Обрезать здесь значило бы однажды
        -- отдать кусок БЕЗ найденного слова
        'body',            h.body,
        'created_at',      h.created_at,
        'item_id',         h.item_id,
        'stage_id',        h.stage_id,
        'experimental_id', h.experimental_id
      ) order by h.created_at desc, h.id desc)
      from hits h), '[]'::jsonb)
  );
$fn$;

revoke execute on function public.erp_chat_search(uuid, text, integer) from public, anon;
grant execute on function public.erp_chat_search(uuid, text, integer) to authenticated;
