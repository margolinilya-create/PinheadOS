-- ОТКАТ миграции 20261020100000_erp_biz_tasks_rpc.sql (правки 19.10, часть B:
-- писатели бизнес-задач T2 + диалог задачи и напоминания T3). Выполняет
-- владелец в SQL Editor — ПОСЛЕ отката фронта части B (клиент зовёт
-- `erp_biz_task_*` и `erp_chat_send(…, p_task_id)`), одной транзакцией.
--
-- Порядок: снять расписание напоминаний → снять новые функции чата →
-- вернуть прежние подписи `erp_chat_send` (9 аргументов) и `erp_chat_page`
-- (7 аргументов), `erp_chat_edit`/`erp_chat_delete` → снять писателей T2 →
-- `notify pgrst`.
--
-- ТЕЛА ЧАТА — НЕ ДОСЛОВНО СТАРЫЕ. Это прежние по смыслу тела без ветки задач
-- (20261001190924 — отправка, 20260920184144 — лента, 20260920182703 — правка
-- и удаление), записанные заново: `set search_path = public`, без длинных
-- комментариев. Схема T1 откатом НЕ снимается — треды задач (`task_id`,
-- `order_id is null`) в базе остаются, но ни одна функция чата их больше
-- не адресует: лента и счётчики сделки ищут тред по `order_id`.
-- Уведомления и события задач остаются (их снимает только откат T1).

begin;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'erp-biz-task-reminders') then
    perform cron.unschedule('erp-biz-task-reminders');
  end if;
end $cron$;

drop function if exists public.erp_biz_task_reminders_run();
drop function if exists public.erp_chat_unread_tasks(uuid[]);
drop function if exists public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb, uuid);
drop function if exists public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer, uuid);

-- ── Отправка: прежняя подпись, только сделка ──────────────────────────────
create or replace function public.erp_chat_send(p_order_id uuid, p_body text, p_client_key uuid, p_item_id uuid default null::uuid, p_stage_id uuid default null::uuid, p_experimental_id uuid default null::uuid, p_reply_to uuid default null::uuid, p_mentions uuid[] default '{}'::uuid[], p_attachments jsonb default '[]'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
as $function$
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


  insert into public.erp_notifications (user_id, kind, order_id, title, body, link, message_id)
  select u, 'chat_mention', p_order_id,
         'Вас упомянули — сделка ' || v_label, v_snippet, v_link, v_id
    from unnest(v_mentions) u
   where u is distinct from v_me
  union all
  select v_replyto, 'chat_reply', p_order_id,
         'Ответ на ваше сообщение — сделка ' || v_label, v_snippet, v_link, v_id
   where v_replyto is not null
     and v_replyto is distinct from v_me
     and not (v_replyto = any (v_mentions))
  union all
  -- Режим «Все сообщения» (правка 20.09, п. 4). Раньше уведомление получали
  -- только упомянутые и автор цитируемого — то есть режим «Упоминания
  -- и ответы» был зашит в код, и выбрать другой человек не мог ничем.
  select s.user_id, 'chat_message', p_order_id,
         'Новое сообщение — сделка ' || v_label, v_snippet, v_link, v_id
    from public.erp_chat_subscriptions s
   where s.thread_id = v_thread
     and s.mode = 'all'
     and s.user_id is distinct from v_me
     and not (s.user_id = any (v_mentions))
     and s.user_id is distinct from v_replyto
  on conflict (user_id, message_id) where message_id is not null do nothing;

  return jsonb_build_object(
    'message_id', v_id,
    'thread_id',  v_thread,
    'duplicate',  false,
    'mentioned',  to_jsonb(v_mentions));
end $function$;

revoke execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) to authenticated;

-- ── Лента: прежняя подпись, тред сделки и её разработок ──────────────────
create or replace function public.erp_chat_page(
  p_order_id uuid,
  p_stage_id uuid default null::uuid,
  p_item_id uuid default null::uuid,
  p_experimental_id uuid default null::uuid,
  p_before_at timestamp with time zone default null::timestamp with time zone,
  p_before_id uuid default null::uuid,
  p_limit integer default 50
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
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
        'edited_at',       p.edited_at,
        'deleted_at',      p.deleted_at,
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
                                    'body', left(r.body, 140),
                                    'deleted', r.deleted_at is not null)
            from public.erp_chat_messages r where r.id = p.reply_to),
        'read_count', (select count(*) from public.erp_chat_message_reads rr
                        where rr.message_id = p.id),
        'reactions', coalesce((
          select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine)
                 order by g.n desc, g.emoji)
            from (
              select rx.emoji,
                     count(*) as n,
                     bool_or(rx.user_id = (select auth.uid())) as mine
                from public.erp_chat_reactions rx
               where rx.message_id = p.id
               group by rx.emoji) g), '[]'::jsonb)
      ) order by p.created_at, p.id)
      from page p), '[]'::jsonb),
    'has_more', (select count(*) from picked) > (select n from lim)
  );
$fn$;

revoke execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) to authenticated;

-- ── Правка и удаление: без фильтра участников и следа результата ─────────
create or replace function public.erp_chat_edit(
  p_message_id uuid,
  p_body       text,
  p_mentions   uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me       uuid := (select auth.uid());
  v_body     text := btrim(coalesce(p_body, ''));
  v_row      public.erp_chat_messages%rowtype;
  v_files    int;
  v_mentions uuid[];
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_edit: править обсуждение может только участник'
      using errcode = '42501';
  end if;

  select * into v_row from public.erp_chat_messages m where m.id = p_message_id;
  if not found then
    raise exception 'erp_chat_edit: сообщение не найдено' using errcode = 'P0002';
  end if;

  -- Только своё. Право «править чужое» не заводится даже директору: это
  -- переписка, и возможность переписать чужую реплику обесценивает её целиком
  if v_row.author_id <> v_me then
    raise exception 'erp_chat_edit: править можно только своё сообщение'
      using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'erp_chat_edit: сообщение удалено' using errcode = '22023';
  end if;

  select count(*) into v_files
    from public.erp_order_attachments a where a.message_id = p_message_id;

  -- Те же границы, что у отправки: пустое сообщение без файла — не сообщение
  if v_body = '' and v_files = 0 then
    raise exception 'erp_chat_edit: сообщение пустое' using errcode = '22023';
  end if;
  if char_length(v_body) > 10000 then
    raise exception 'erp_chat_edit: сообщение длиннее 10000 символов'
      using errcode = '22023';
  end if;

  -- Текст не изменился — не ставим «изменено». Иначе подпись появлялась бы
  -- от того, что человек открыл форму правки и закрыл её кнопкой «Сохранить»
  if v_body = v_row.body then
    return jsonb_build_object('message_id', p_message_id, 'changed', false);
  end if;

  update public.erp_chat_messages
     set body = v_body, edited_at = now()
   where id = p_message_id;


  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
    into v_mentions
    from public.profiles p
   where p.id = any (coalesce(p_mentions, '{}'::uuid[]))
     and p.active is true and p.approved is true
     and p.id <> v_me;

  delete from public.erp_chat_mentions x
   where x.message_id = p_message_id
     and not (x.user_id = any (v_mentions));

  insert into public.erp_chat_mentions (message_id, user_id)
  select p_message_id, u from unnest(v_mentions) u
  on conflict (message_id, user_id) do nothing;



  return jsonb_build_object(
    'message_id', p_message_id,
    'changed',    true,
    'mentioned',  to_jsonb(v_mentions));
end $fn$;

create or replace function public.erp_chat_delete(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me  uuid := (select auth.uid());
  v_row public.erp_chat_messages%rowtype;
begin
  if v_me is null or not public.erp_is_member() then
    raise exception 'erp_chat_delete: удалять в обсуждении может только участник'
      using errcode = '42501';
  end if;

  select * into v_row from public.erp_chat_messages m where m.id = p_message_id;
  if not found then
    raise exception 'erp_chat_delete: сообщение не найдено' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_me then
    raise exception 'erp_chat_delete: удалять можно только своё сообщение'
      using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    return jsonb_build_object('message_id', p_message_id, 'deleted', true);
  end if;

  update public.erp_chat_messages
     set body = '', deleted_at = now()
   where id = p_message_id;

  -- Упоминание в удалённом сообщении зовёт в пустоту и продолжало бы
  -- считаться счётчиком «Упоминания»
  delete from public.erp_chat_mentions x where x.message_id = p_message_id;


  delete from public.erp_order_attachments a where a.message_id = p_message_id;

  -- Уведомление о сообщении, которого больше нет, ведёт на пустое место
  delete from public.erp_notifications n where n.message_id = p_message_id;

  return jsonb_build_object('message_id', p_message_id, 'deleted', true);
end $fn$;

revoke execute on function public.erp_chat_edit(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.erp_chat_edit(uuid, text, uuid[]) to authenticated;
revoke execute on function public.erp_chat_delete(uuid) from public, anon, authenticated;
grant execute on function public.erp_chat_delete(uuid) to authenticated;

-- ── Писатели T2: сначала выставленные клиенту, затем помощники ────────────
drop function if exists public.erp_biz_task_create(jsonb, uuid);
drop function if exists public.erp_biz_task_transition(uuid, text, text, timestamptz);
drop function if exists public.erp_biz_task_update(uuid, jsonb, timestamptz);
drop function if exists public.erp_biz_task_set_result(uuid, text, uuid);
drop function if exists public.erp_biz_task_checklist_op(uuid, text, jsonb);
drop function if exists public.erp_biz_task_attach(uuid, jsonb);
drop function if exists public.erp_biz_task_mark_seen(uuid);
drop function if exists public.erp_biz_task_seen_by(uuid);
drop function if exists public.erp_biz_task_counts(uuid);
drop function if exists public.erp_biz_task_notify(uuid, bigint, text, uuid[], text, text);
drop function if exists public.erp_biz_task_log(uuid, text, jsonb);
drop function if exists public.erp_biz_task_is_participant(uuid, uuid);
drop function if exists public.erp_biz_task_gate();
drop function if exists public.erp_biz_task_can_manage();
drop function if exists public.erp_profile_is_staff(uuid);

commit;

notify pgrst, 'reload schema';
