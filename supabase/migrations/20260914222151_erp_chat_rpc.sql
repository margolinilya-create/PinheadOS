-- ЧАТ ВНУТРИ СДЕЛКИ: ПИСАТЕЛЬ И ЧИТАТЕЛИ (правка заказчика 14.09).
--
-- Схема — в `20260914220000_erp_chat_core`; там же объяснено, почему
-- у переписки нет ни INSERT-, ни UPDATE-, ни DELETE-политики. Здесь —
-- единственный вход и три чтения.
--
-- ПОЧЕМУ ВХОД ОДИН И `security definer`. Отправка сообщения это не одна
-- запись, а четыре в одной транзакции: сообщение, упоминания, вложения
-- и уведомления. Разреши вставку клиенту — и каждая из четырёх станет
-- отдельным решением клиента: сообщение без уведомления («вас упомянули»
-- не пришло), уведомление без сообщения, упоминание человека, которого
-- в системе нет, сообщение, пришпиленное к задаче ЧУЖОЙ сделки. Гейт живёт
-- у писателя, и писатель здесь ровно один.
--
-- ЧТО СПРОСИЛИ У ЖИВОЙ БАЗЫ 14.09, И ЧТО ЭТО ИЗМЕНИЛО:
--   · `profiles` виден участнику ТОЛЬКО свой (`profiles_select`:
--     `auth.uid() = id or is_admin()`). Значит ни имя автора сообщения,
--     ни поиск по email из документа обычным запросом недостижимы —
--     отсюда `erp_chat_directory()` (`definer` с гейтом `erp_is_member()`),
--     и она же единственный источник имён для ленты и для подсказки
--     упоминаний: два источника разошлись бы в первую же правку.
--   · `erp_employees` виден участнику весь, но там нет email и есть люди
--     БЕЗ учётной записи (`profile_id is null` — на бою такой один).
--     Такой человек не может быть ни автором, ни адресатом: справочник
--     строится от `profiles`, а карточка сотрудника лишь уточняет имя и цех.
--   · `erp_order_attachments.order_id` — NOT NULL. Значит файл в сообщении
--     возможен только у обсуждения СДЕЛКИ; у обсуждения разработки без
--     сделки (отложено) его не будет, пока колонка не станет обнуляемой.

-- ── Уведомление знает своё сообщение ──────────────────────────────────────
/**
 * «Упоминание и ответ одному человеку — ОДНО уведомление» становится
 * ограничением базы, а не свойством кода. Внутри `erp_chat_send` это и так
 * один оператор, но писателей у уведомлений со временем станет больше,
 * а ограничение переживёт их всех.
 */
alter table public.erp_notifications
  add column if not exists message_id uuid
  references public.erp_chat_messages(id) on delete cascade;

create unique index if not exists erp_notifications_msg_uniq
  on public.erp_notifications (user_id, message_id) where message_id is not null;

/**
 * СТРАЖ ПЕРЕСОБИРАЕТСЯ ТЕМ ЖЕ КОММИТОМ, ЧТО И КОЛОНКА. Он перечисляет
 * неизменяемые колонки поимённо, и колонка, дописанная мимо перечисления,
 * оказывается единственной, которую адресат вправе переписать себе сам, —
 * то есть увести своё уведомление на чужое сообщение. Ровно то правило,
 * по которому колонка `erp_item_stages` попадает в `v_guarded`.
 */
create or replace function public.erp_notification_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Пустой auth.uid() — service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.order_id is distinct from old.order_id
     or new.message_id is distinct from old.message_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.link is distinct from old.link
     or new.created_at is distinct from old.created_at then
    raise exception 'erp_notification_guard: у уведомления правится только отметка о прочтении'
      using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.erp_notification_guard() from anon, authenticated, public;

-- ── Справочник адресатов ──────────────────────────────────────────────────
create or replace function public.erp_chat_directory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.erp_is_member() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id',       p.id,
      -- ОДНА формула имени на весь чат: карточка сотрудника, затем имя
      -- учётной записи, затем адрес. Иначе автор в ленте и человек
      -- в подсказке упоминаний назывались бы по-разному
      'name',          coalesce(nullif(btrim(e.full_name), ''), nullif(btrim(p.name), ''), p.email),
      'email',         p.email,
      'role',          e.role,
      'department_id', e.department_id
    ) order by coalesce(nullif(btrim(e.full_name), ''), nullif(btrim(p.name), ''), p.email))
    from public.profiles p
    left join lateral (
      select em.full_name, em.role, em.department_id
        from public.erp_employees em
       where em.profile_id = p.id and em.active
       order by em.updated_at desc
       limit 1
    ) e on true
    -- Ровно те, кто проходит `erp_is_member()`: кого можно упомянуть — тот
    -- и прочтёт. Разные множества «кому пишут» и «кто читает» означали бы
    -- упоминание, которое никогда не дойдёт
    where p.active is true and p.approved is true
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

comment on function public.erp_chat_directory() is
  'Кого можно упомянуть и как называть автора сообщения. security definer, потому что profiles виден участнику только свой, а документ требует поиска по имени И email.';

-- ── Отправка ──────────────────────────────────────────────────────────────
create or replace function public.erp_chat_send(
  p_order_id        uuid,
  p_body            text,
  p_client_key      uuid,
  p_item_id         uuid    default null,
  p_stage_id        uuid    default null,
  p_experimental_id uuid    default null,
  p_reply_to        uuid    default null,
  p_mentions        uuid[]  default '{}',
  p_attachments     jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  union all
  select v_replyto, 'chat_reply', p_order_id,
         'Ответ на ваше сообщение — сделка ' || v_label, v_snippet, v_link, v_id
   where v_replyto is not null
     and v_replyto <> v_me
     and not (v_replyto = any (v_mentions))
  on conflict (user_id, message_id) where message_id is not null do nothing;

  return jsonb_build_object(
    'message_id', v_id,
    'thread_id',  v_thread,
    'duplicate',  false,
    'mentioned',  to_jsonb(v_mentions));
end $$;

comment on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) is
  'Единственный вход в переписку: сообщение, упоминания, вложения и уведомления одной транзакцией. Повтор с тем же ключом попытки возвращает то же сообщение и НЕ рассылает уведомления второй раз.';

-- ── Чтение ленты ──────────────────────────────────────────────────────────
/**
 * `security invoker` (умолчание, но написано явно): «одним запросом»
 * не означает «мимо RLS» — видимость решает политика самих сообщений,
 * а не эта функция. Автор возвращается ИДЕНТИФИКАТОРОМ: имя живёт
 * в `erp_chat_directory()`, и повторять его в каждой строке значило бы
 * заморозить написание автора в ленте.
 *
 * Тред сделки ∪ треды её разработок — это и есть «переписка разработки
 * видна из чата сделки БЕЗ копирования».
 */
create or replace function public.erp_chat_page(
  p_order_id        uuid,
  p_stage_id        uuid        default null,
  p_item_id         uuid        default null,
  p_experimental_id uuid        default null,
  p_before_at       timestamptz default null,
  p_before_id       uuid        default null,
  p_limit           int         default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
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
            from public.erp_chat_messages r where r.id = p.reply_to)
      ) order by p.created_at, p.id)
      from page p), '[]'::jsonb),
    'has_more', (select count(*) from picked) > (select n from lim)
  );
$$;

comment on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, int) is
  'Страница переписки сделки (последние N до курсора). Пустой контекст — вся сделка; заданный этап, позиция или разработка — её переписка. Треды разработок сделки входят в ленту без копирования сообщений.';

-- ── Непрочитанное ─────────────────────────────────────────────────────────
/**
 * ОДНА ФОРМУЛА НА ДВА СЧЁТЧИКА — и вкладку «Чат», и кнопку у задачи.
 * Разные формулы разошлись бы, и первым это заметил бы цех: «в сделке
 * непрочитанных нет, а в задаче есть».
 *
 * `total` считается ТОЛЬКО по отметке треда, а счётчик задачи — по поздней
 * из двух отметок. Отсюда прямо следует требование документа: просмотр
 * переписки задачи не гасит непрочитанное сделки, а просмотр всей сделки
 * гасит и задачи — человек эти сообщения видел.
 */
create or replace function public.erp_chat_unread(p_order_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with th as (
    select t.id from public.erp_chat_threads t where t.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where e.order_id = p_order_id
  ),
  base as (
    -- Своё сообщение непрочитанным не бывает
    select m.thread_id, m.stage_id, m.created_at
      from public.erp_chat_messages m
     where m.thread_id in (select id from th)
       and m.author_id is distinct from (select auth.uid())
  ),
  wm as (
    select r.thread_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is null
  ),
  swm as (
    select r.thread_id, r.stage_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is not null
  )
  select jsonb_build_object(
    'total', (
      select count(*) from base b
        left join wm on wm.thread_id = b.thread_id
       where b.created_at > coalesce(wm.last_read_at, '-infinity'::timestamptz)),
    'by_stage', coalesce((
      select jsonb_object_agg(s.stage_id::text, s.n) from (
        select b.stage_id, count(*) as n
          from base b
          left join wm  on wm.thread_id = b.thread_id
          left join swm on swm.thread_id = b.thread_id and swm.stage_id = b.stage_id
         where b.stage_id is not null
           and b.created_at > greatest(coalesce(wm.last_read_at,  '-infinity'::timestamptz),
                                       coalesce(swm.last_read_at, '-infinity'::timestamptz))
         group by b.stage_id) s), '{}'::jsonb)
  );
$$;

comment on function public.erp_chat_unread(uuid) is
  'Непрочитанное сделки: общее число и разбивка по этапам. Одна формула на вкладку и на кнопку задачи.';

-- ── Отметка прочтения ─────────────────────────────────────────────────────
create or replace function public.erp_chat_mark_read(
  p_order_id uuid,
  p_stage_id uuid        default null,
  p_at       timestamptz default null
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_me uuid        := (select auth.uid());
  v_at timestamptz := coalesce(p_at, now());
begin
  if v_me is null then
    return null;
  end if;

  /**
   * ОТМЕТКА МОНОТОННА (`greatest`). Иначе прокрутка ленты вверх — а это
   * обычное действие — отодвигала бы её назад, и уже прочитанное снова
   * становилось бы непрочитанным.
   */
  if p_stage_id is null then
    insert into public.erp_chat_reads (thread_id, user_id, stage_id, last_read_at)
    select t.id, v_me, null, v_at
      from public.erp_chat_threads t
      left join public.erp_experimental e on e.id = t.experimental_id
     where t.order_id = p_order_id or e.order_id = p_order_id
    on conflict (thread_id, user_id) where stage_id is null
      do update set last_read_at = greatest(erp_chat_reads.last_read_at, excluded.last_read_at);
  else
    insert into public.erp_chat_reads (thread_id, user_id, stage_id, last_read_at)
    select t.id, v_me, p_stage_id, v_at
      from public.erp_chat_threads t
      left join public.erp_experimental e on e.id = t.experimental_id
     where t.order_id = p_order_id or e.order_id = p_order_id
    on conflict (thread_id, user_id, stage_id) where stage_id is not null
      do update set last_read_at = greatest(erp_chat_reads.last_read_at, excluded.last_read_at);
  end if;

  return v_at;
end $$;

comment on function public.erp_chat_mark_read(uuid, uuid, timestamptz) is
  'До какого момента человек дочитал обсуждение сделки (или её задачи). Монотонна: назад отметка не едет.';

-- ── Права на вызов ────────────────────────────────────────────────────────
-- Отзыв идёт `from public, anon`: право приходит от PUBLIC, и отзыв у одного
-- `anon` не делает ничего (правило проекта). `authenticated` выдаётся явно —
-- без него PostgREST не покажет функцию в /rest/v1/rpc
revoke execute on function public.erp_chat_directory() from public, anon;
revoke execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) from public, anon;
revoke execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, int) from public, anon;
revoke execute on function public.erp_chat_unread(uuid) from public, anon;
revoke execute on function public.erp_chat_mark_read(uuid, uuid, timestamptz) from public, anon;

grant execute on function public.erp_chat_directory() to authenticated;
grant execute on function public.erp_chat_send(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) to authenticated;
grant execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, int) to authenticated;
grant execute on function public.erp_chat_unread(uuid) to authenticated;
grant execute on function public.erp_chat_mark_read(uuid, uuid, timestamptz) to authenticated;
