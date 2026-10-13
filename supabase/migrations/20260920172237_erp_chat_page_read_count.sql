-- «ПРОЧИТАЛИ N» ТРЕБУЕТ ЧИСЛА ПРЯМО В ЛЕНТЕ (правка заказчика 20.09, п. 4).
--
-- «После прочтения другим сотрудником показывать „Прочитали N". По нажатию —
-- имена и время прочтения». Имена грузятся отдельно и по требованию
-- (`erp_chat_read_receipts`), а вот САМО ЧИСЛО нужно сразу у каждого своего
-- сообщения: без него отправитель не знает, есть ли на что нажимать.
--
-- Считается подзапросом по `erp_chat_message_reads`: отдельный вызов на
-- сообщение означал бы полсотни запросов на страницу ленты.

CREATE OR REPLACE FUNCTION public.erp_chat_page(p_order_id uuid, p_stage_id uuid DEFAULT NULL::uuid, p_item_id uuid DEFAULT NULL::uuid, p_experimental_id uuid DEFAULT NULL::uuid, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with lim as (
    select least(greatest(coalesce(p_limit, 50), 1), 200) as n
  ),
  th as (
    select t.id from public.erp_chat_threads t where t.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where e.order_id = p_order_id
  ),
  picked as (
    select m.*
      from public.erp_chat_messages m
     where m.thread_id in (select id from th)
       and (p_stage_id is null or m.stage_id = p_stage_id)
       and (p_item_id is null or m.item_id = p_item_id)
       and (p_experimental_id is null or m.experimental_id = p_experimental_id)
       -- Курсор по паре (момент, id): `created_at` не уникален, и страница
       -- по одному лишь моменту теряла бы соседние сообщения
       and (p_before_at is null
            or (m.created_at, m.id)
                 < (p_before_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by m.created_at desc, m.id desc
     limit (select n + 1 from lim)
  ),
  page as (
    select * from picked order by created_at desc, id desc limit (select n from lim)
  )
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',              p.id,
        'thread_id',       p.thread_id,
        'author_id',       p.author_id,
        'body',            p.body,
        'item_id',         p.item_id,
        'stage_id',        p.stage_id,
        'experimental_id', p.experimental_id,
        'reply_to',        p.reply_to,
        'created_at',      p.created_at,
        'mentions', coalesce((
          select jsonb_agg(x.user_id) from public.erp_chat_mentions x
           where x.message_id = p.id), '[]'::jsonb),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'file_path', a.file_path, 'file_name', a.file_name)
                 order by a.created_at)
            from public.erp_order_attachments a
           where a.message_id = p.id), '[]'::jsonb),
        -- Цитата короткая и СНИМАЕТСЯ ЗДЕСЬ: иначе клиент искал бы исходное
        -- сообщение в уже выгруженной ленте, а оно может быть выше страницы
        'reply', (
          select jsonb_build_object('id', r.id, 'author_id', r.author_id,
                                    'body', left(r.body, 140))
            from public.erp_chat_messages r where r.id = p.reply_to),
        'read_count', (select count(*) from public.erp_chat_message_reads rr
                        where rr.message_id = p.id)
      ) order by p.created_at, p.id)
      from page p), '[]'::jsonb),
    'has_more', (select count(*) from picked) > (select n from lim)
  );
$function$
