-- УВЕДОМЛЕНИЯ ЧАТА: ПРОЧТЕНИЕ, АДРЕСАТЫ, НАСТРОЙКИ СОТРУДНИКА
-- (правка заказчика 01.10, п. 4 «Уведомления чата»).
--
-- Документ: «@Упоминание даёт личное уведомление отмеченному сотруднику,
-- ответ — автору исходного сообщения… Открытие колокольчика не отмечает
-- сообщение прочитанным: это происходит, когда сотрудник увидел его в чате.
-- Состояние должно сохраняться после обновления страницы и на другом
-- устройстве… Звук и уведомления браузера работают по настройкам сотрудника».
--
-- Три изменения, каждое — ответ на расхождение с этими словами:
--
--   1. `erp_chat_mark_seen` гасит И уведомления о показанных сообщениях.
--      До сих пор уведомление гасилось нажатием в колоколе (клиент), а
--      сообщение — показом в ленте (сервер): две прочитанности одного
--      события, и «увидел в чате» не гасило колокол вовсе. Теперь
--      источник один — показ сообщения, — и пишет его сервер, значит
--      состояние одинаково после F5 и на другом устройстве.
--   2. `erp_chat_send`: режим «Без уведомлений» больше НЕ глушит упоминание
--      и ответ. Решение 20.09 («отключает и персональные») отменено
--      владельцем 01.10: личное уведомление — это «вас позвали», а режим
--      подписки отвечает на «хочу ли я знать про ВСЕ сообщения сделки».
--      Режим по-прежнему управляет общими `chat_message`.
--   3. `erp_user_settings` — звук и уведомления браузера В БАЗЕ, а не
--      в localStorage устройства: «по настройкам сотрудника», а сотрудник
--      ходит с планшета цеха и с ноутбука.
--
-- Автор сообщения может стать NULL (системные сообщения — соседняя миграция
-- 20261001120000). Поэтому каждое сравнение с автором здесь null-безопасно:
-- `is distinct from`, а не `<>` — `null <> v_me` даёт NULL, и строка молча
-- выпала бы из отбора.

-- ── 1. Показ сообщения гасит и уведомление о нём ─────────────────────────
--
-- Тело — из 20260920171621 (последнее определение) без изменений; добавлен
-- второй оператор. `security invoker` сохранён НАМЕРЕННО: правка `read_at`
-- идёт под политикой `erp_notifications_update` (своя строка) и стражем
-- `erp_notification_guard` (меняется ровно `read_at`) — definer обошёл бы
-- и то и другое ради того, что и так разрешено.
create or replace function public.erp_chat_mark_seen(p_message_ids uuid[])
returns int
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_me  uuid := (select auth.uid());
  v_ins int := 0;
begin
  if v_me is null or p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  -- Своё сообщение автор не «прочитывает»: иначе «Прочитали 1» появилось бы
  -- у каждого отправленного, и число перестало бы значить что-либо
  insert into public.erp_chat_message_reads (message_id, user_id)
  select m.id, v_me
    from public.erp_chat_messages m
   where m.id = any(p_message_ids)
     and m.author_id is distinct from v_me
  on conflict do nothing;

  get diagnostics v_ins = row_count;

  -- УВЕДОМЛЕНИЕ ГАСИТ ПОКАЗ СООБЩЕНИЯ (правка 01.10, п. 4), а не нажатие
  -- в колоколе: «открытие колокольчика не отмечает сообщение прочитанным».
  -- Отдельно от вставки выше и НЕ по её `row_count`: строка просмотра могла
  -- появиться раньше (сообщение показали до выката этой миграции), а
  -- уведомление о нём осталось бы гореть навсегда. Уже прочитанные
  -- не трогаются — повторная отметка соврала бы, КОГДА человек увидел.
  update public.erp_notifications n
     set read_at = now()
   where n.user_id = v_me
     and n.message_id = any(p_message_ids)
     and n.read_at is null;

  return v_ins;
end $$;

comment on function public.erp_chat_mark_seen(uuid[]) is
  'Отметить показанные сообщения прочитанными (правка 20.09, п. 4) и погасить личные уведомления о них (правка 01.10, п. 4). Возвращает число новых строк просмотра. Invoker: уведомления правятся под политикой адресата и стражем read_at.';

revoke execute on function public.erp_chat_mark_seen(uuid[]) from public, anon;
grant execute on function public.erp_chat_mark_seen(uuid[]) to authenticated;

-- ── 2. Упоминание и ответ не зависят от режима подписки ──────────────────
--
-- Тело — подлинное из 20260920172959 (снято с прода `pg_get_functiondef`).
-- Изменено ровно одно: из веток `chat_mention` и `chat_reply` убран фильтр
-- `mode = 'none'`; сравнения с автором переведены на `is distinct from`.
-- Подпись, `security definer`, порядок проверок и ранний возврат повтора —
-- без изменений.
create or replace function public.erp_chat_send(p_order_id uuid, p_body text, p_client_key uuid, p_item_id uuid default null::uuid, p_stage_id uuid default null::uuid, p_experimental_id uuid default null::uuid, p_reply_to uuid default null::uuid, p_mentions uuid[] default '{}'::uuid[], p_attachments jsonb default '[]'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
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
   *
   * РЕЖИМ ПОДПИСКИ ЗДЕСЬ НЕ СПРАШИВАЕТСЯ (правка 01.10, п. 4): «@Упоминание
   * даёт личное уведомление отмеченному сотруднику, ответ — автору
   * исходного сообщения» — без оговорок. «Без уведомлений» глушит только
   * общий поток `chat_message` ниже.
   */
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

revoke execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) to authenticated;

-- ── 3. Настройки уведомлений сотрудника ──────────────────────────────────
--
-- Строка на учётную запись, а не на карточку сотрудника: уведомления
-- адресуются по `profiles.id` (как `erp_notifications.user_id`), и настройка
-- обязана быть у того же адресата.
--
-- Звук по умолчанию ВКЛЮЧЁН, уведомления браузера — ВЫКЛЮЧЕНЫ. Первому
-- нужен только жест человека где-нибудь на странице; второму — разрешение
-- браузера, которое спрашивается ТОЛЬКО по нажатию переключателя (отказ,
-- полученный при входе, браузер помнит навсегда), поэтому «включено» без
-- разрешения было бы обещанием, которое нечем выполнить.
create table if not exists public.erp_user_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  chat_sound   boolean not null default true,
  chat_desktop boolean not null default false,
  updated_at   timestamptz default now()
);

comment on table public.erp_user_settings is
  'Личные настройки уведомлений ERP (правка 01.10, п. 4): звук и уведомления браузера. Одна строка на учётную запись; пишет и читает только её владелец.';

drop trigger if exists erp_user_settings_updated_at on public.erp_user_settings;
create trigger erp_user_settings_updated_at
  before update on public.erp_user_settings
  for each row execute function public.erp_set_updated_at();

alter table public.erp_user_settings enable row level security;

/*
  ПОЛИТИКИ НА КОМАНДУ (правило раздела), и все три — «только своя строка».
  Чужую настройку незачем даже читать: она ничего не говорит о работе,
  а «у кого выключен звук» — сведение о человеке, а не о производстве.
  DELETE-политики нет: настройку выключают, а не удаляют, и отсутствие
  строки уже значит «умолчание» — удалять нечего.
*/
drop policy if exists erp_user_settings_select on public.erp_user_settings;
create policy erp_user_settings_select on public.erp_user_settings
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists erp_user_settings_insert on public.erp_user_settings;
create policy erp_user_settings_insert on public.erp_user_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists erp_user_settings_update on public.erp_user_settings;
create policy erp_user_settings_update on public.erp_user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Умолчания Supabase выдают новой таблице всё и `anon` тоже; отзываем
-- у public и anon, выдаём `authenticated` ровно то, что покрыто политиками
revoke all on table public.erp_user_settings from public, anon;
revoke all on table public.erp_user_settings from authenticated;
grant select, insert, update on table public.erp_user_settings to authenticated;

-- ── 4. Счётчик колокола ──────────────────────────────────────────────────
--
-- Отдельной функции не заводится: клиент спрашивает `count` с `head: true`
-- по `read_at is null`, и его ограничивает та же политика чтения
-- `erp_notifications_read` (`user_id = (select auth.uid())`), что и ленту.
-- Индекс `(user_id, read_at, created_at desc)` из 20260914214651 покрывает
-- этот запрос. Второй путь к той же величине (definer-функция) значил бы
-- вторую формулу «чьи уведомления», а в разделе они расходились не раз.
