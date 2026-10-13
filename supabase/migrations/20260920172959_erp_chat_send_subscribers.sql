-- РАССЫЛКА УВЕДОМЛЕНИЙ УЧИТЫВАЕТ РЕЖИМ ПОДПИСКИ (правка 20.09, п. 4).
--
-- Тело взято подлинным с прода (pg_get_functiondef); изменены ровно два
-- места: автоподписка автора на тред и четвёртая группа адресатов —
-- подписчики с режимом «Все сообщения». Плюс фильтр «Без уведомлений»,
-- который отключает и персональные уведомления тоже.

CREATE OR REPLACE FUNCTION public.erp_chat_send(p_order_id uuid, p_body text, p_client_key uuid, p_item_id uuid DEFAULT NULL::uuid, p_stage_id uuid DEFAULT NULL::uuid, p_experimental_id uuid DEFAULT NULL::uuid, p_reply_to uuid DEFAULT NULL::uuid, p_mentions uuid[] DEFAULT '{}'::uuid[], p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me       uuid := (select auth.uid());
  v_body     text := btrim(coalesce(p_body, ''));
  v_files    int  := coalesce(jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)), 0);
  v_thread   uuid;
  v_id       uuid;
  v_rows     int;
  v_mentions uuid[];
  v_replyto  uuid;
  v_label    text;
  v_link     text;
  v_snippet  text;
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_send: писать в обсуждение может только участник'
      using errcode = '42501';
  end if;

  -- Ключ попытки обязателен: без него повтор отправки после оборванного
  -- ответа создаёт второе сообщение и второе уведомление
  if p_client_key is null then
    raise exception 'erp_chat_send: не передан ключ попытки отправки'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(o.bitrix_id), ''), o.title) into v_label
    from public.erp_orders o where o.id = p_order_id;
  if not found then
    raise exception 'erp_chat_send: сделка не найдена' using errcode = 'P0002';
  end if;

  -- Пустое сообщение без файла — не сообщение. Файл без текста — сообщение
  if v_body = '' and v_files = 0 then
    raise exception 'erp_chat_send: сообщение пустое' using errcode = '22023';
  end if;
  if char_length(v_body) > 10000 then
    raise exception 'erp_chat_send: сообщение длиннее 10000 символов' using errcode = '22023';
  end if;

  /**
   * КОНТЕКСТ ОБЯЗАН ПРИНАДЛЕЖАТЬ ЭТОЙ СДЕЛКЕ. Иначе сообщение, помеченное
   * чужим этапом, всплывало бы в переписке чужой задачи — при том что
   * видимость самой сделки ему никто не давал.
   */
  if p_item_id is not null and not exists (
       select 1 from public.erp_order_items i
        where i.id = p_item_id and i.order_id = p_order_id) then
    raise exception 'erp_chat_send: позиция не из этой сделки' using errcode = '22023';
  end if;
  if p_stage_id is not null and not exists (
       select 1 from public.erp_item_stages s
         join public.erp_order_items i on i.id = s.item_id
        where s.id = p_stage_id and i.order_id = p_order_id) then
    raise exception 'erp_chat_send: этап не из этой сделки' using errcode = '22023';
  end if;
  if p_experimental_id is not null and not exists (
       select 1 from public.erp_experimental e
        where e.id = p_experimental_id and e.order_id = p_order_id) then
    raise exception 'erp_chat_send: разработка не из этой сделки' using errcode = '22023';
  end if;

  -- Тред заводится первым сообщением. `on conflict` — не педантизм: двое,
  -- открывшие чат одновременно, иначе завели бы сделке два обсуждения
  select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
  if v_thread is null then
    insert into public.erp_chat_threads (order_id) values (p_order_id)
      on conflict (order_id) where order_id is not null do nothing
      returning id into v_thread;
    if v_thread is null then
      select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
    end if;
  end if;

  -- Цитировать можно только сообщение ЭТОГО обсуждения: иначе ответ
  -- на чужое сообщение показал бы его текст тому, кто чужую сделку не видит
  if p_reply_to is not null then
    select m.author_id into v_replyto
      from public.erp_chat_messages m
     where m.id = p_reply_to and m.thread_id = v_thread;
    if not found then
      raise exception 'erp_chat_send: ответ на сообщение из другого обсуждения'
        using errcode = '22023';
    end if;
  end if;

  /**
   * УПОМИНАНИЯ ФИЛЬТРУЕТ СЕРВЕР. Подсказка на клиенте — удобство; вписать
   * можно только того, кто и так читает обсуждение. Отфильтрованные
   * возвращаются в ответе, а не отбрасываются молча: интерфейс обязан
   * сказать, что человек не позван, — иначе отправитель считает, что позвал.
   */
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into v_mentions
    from public.profiles p
   where p.id = any (coalesce(p_mentions, '{}'::uuid[]))
     and p.active is true and p.approved is true
     and p.id <> v_me;

  insert into public.erp_chat_messages
    (thread_id, author_id, body, item_id, stage_id, experimental_id, reply_to, client_key)
  values
    (v_thread, v_me, v_body, p_item_id, p_stage_id, p_experimental_id, p_reply_to, p_client_key)
  on conflict (author_id, client_key) do nothing
  returning id into v_id;
  get diagnostics v_rows = row_count;

  -- Повтор той же попытки: ни второго сообщения, ни второго уведомления
  if v_rows = 0 then
    select m.id into v_id from public.erp_chat_messages m
     where m.author_id = v_me and m.client_key = p_client_key;
    return jsonb_build_object(
      'message_id', v_id, 'thread_id', v_thread, 'duplicate', true,
      'mentioned', coalesce((select jsonb_agg(x.user_id) from public.erp_chat_mentions x
                              where x.message_id = v_id), '[]'::jsonb));
  end if;

  insert into public.erp_chat_mentions (message_id, user_id)
  select v_id, u from unnest(v_mentions) u;

  -- АВТОПОДПИСКА ПО ДЕЙСТВИЮ (правка 20.09, п. 4): кто в тред написал,
  -- тот дальше получает все сообщения. Ручной выбор не затирается —
  -- `do nothing`. Подписать менеджера заказа нельзя: `erp_orders.manager`
  -- это свободный текст, и совпадение строки с сотрудником было бы
  -- догадкой ценой в чужую переписку в чужом колоколе.
  insert into public.erp_chat_subscriptions (thread_id, user_id, mode)
  values (v_thread, v_me, 'all')
  on conflict (thread_id, user_id) do nothing;

  /**
   * Файл уже лежит в бакете — он уходит туда ПРИ ВЫБОРЕ (правило проекта:
   * приложенным показывается только то, что в Storage есть). Здесь заводится
   * строка-носитель, и заводится она вместе с сообщением: файл без сообщения
   * был бы «ничьим» и попал бы под уборку `storage-gc`.
   *
   * `uploaded_by` (имя ТЕКСТОМ) намеренно не заполняется: у сообщения есть
   * постоянный `author_id`, и второе, стареющее написание автора рядом
   * с ним — ровно то, от чего чат и отличается от комментариев.
   */
  insert into public.erp_order_attachments
    (order_id, file_path, file_name, kind, item_id, stage_id, message_id)
  select p_order_id,
         btrim(a->>'file_path'),
         nullif(btrim(coalesce(a->>'file_name', '')), ''),
         'chat',
         p_item_id,
         p_stage_id,
         v_id
    from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) a
   where nullif(btrim(coalesce(a->>'file_path', '')), '') is not null;

  v_link    := '/orders/' || p_order_id::text || '?tab=chat&msg=' || v_id::text;
  v_snippet := left(coalesce(nullif(v_body, ''), 'Файл в обсуждении'), 200);

  /**
   * АДРЕСАТЫ = упомянутые ∪ автор цитируемого, МИНУС сам автор. Человек,
   * ответивший сам себе или упомянувший себя, уведомления не получает:
   * это не событие, а собственное действие.
   *
   * Ветка ответа пропускает того, кто уже упомянут, — «упоминание и ответ
   * одному человеку это одно уведомление». То же самое сторожит
   * `erp_notifications_msg_uniq`; здесь это выражено отбором, чтобы
   * уведомление об упоминании (оно точнее) не проигрывало ответу порядком
   * строк.
   */
  insert into public.erp_notifications (user_id, kind, order_id, title, body, link, message_id)
  select u, 'chat_mention', p_order_id,
         'Вас упомянули — сделка ' || v_label, v_snippet, v_link, v_id
    from unnest(v_mentions) u
    -- «Без уведомлений» отключает и персональные — прямое требование
    -- документа; учёт непрочитанных при этом остаётся.
   where not exists (
           select 1 from public.erp_chat_subscriptions s
            where s.thread_id = v_thread and s.user_id = u and s.mode = 'none')
  union all
  select v_replyto, 'chat_reply', p_order_id,
         'Ответ на ваше сообщение — сделка ' || v_label, v_snippet, v_link, v_id
   where v_replyto is not null
     and v_replyto <> v_me
     and not (v_replyto = any (v_mentions))
     -- «Без уведомлений» отключает и персональные — прямое требование
     -- документа; учёт непрочитанных при этом остаётся.
     and not exists (
           select 1 from public.erp_chat_subscriptions s
            where s.thread_id = v_thread and s.user_id = v_replyto and s.mode = 'none')
  union all
  -- Режим «Все сообщения» (правка 20.09, п. 4). Раньше уведомление получали
  -- только упомянутые и автор цитируемого — то есть режим «Упоминания
  -- и ответы» был зашит в код, и выбрать другой человек не мог ничем.
  select s.user_id, 'chat_message', p_order_id,
         'Новое сообщение — сделка ' || v_label, v_snippet, v_link, v_id
    from public.erp_chat_subscriptions s
   where s.thread_id = v_thread
     and s.mode = 'all'
     and s.user_id <> v_me
     and not (s.user_id = any (v_mentions))
     and (v_replyto is null or s.user_id <> v_replyto)
  on conflict (user_id, message_id) where message_id is not null do nothing;

  return jsonb_build_object(
    'message_id', v_id,
    'thread_id',  v_thread,
    'duplicate',  false,
    'mentioned',  to_jsonb(v_mentions));
end $function$;
