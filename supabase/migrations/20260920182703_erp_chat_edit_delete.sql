-- ПРАВКА И УДАЛЕНИЕ СВОИХ СООБЩЕНИЙ (вторая очередь чата, документ 20.09, п. 4).
--
-- ДЕЛАЕТСЯ ФУНКЦИЯМИ, А НЕ ПОЛИТИКАМИ. У `erp_chat_messages` нет ни INSERT-,
-- ни UPDATE-, ни DELETE-политики по построению, и это сторожит
-- `utils/chatServer.test.ts`. Появись UPDATE-политика — и через REST можно
-- было бы переписать ЛЮБОЕ поле: автора, тред, контекст, момент отправки.
-- Поэтому правка и удаление — две узкие `security definer`-функции, каждая
-- со своим гейтом.
--
-- УДАЛЕНИЕ ЗАТИРАЕТ ТЕКСТ. Иначе «Сообщение удалено» — косметика: строка
-- остаётся в таблице, и тело достаётся обычным select'ом тому же участнику.
-- Сама строка при этом НЕ удаляется: на неё ссылаются цитаты и по ней стоит
-- порядок ленты — исчезнувшее сообщение оставило бы в переписке дыру
-- и оборванный ответ.

alter table public.erp_chat_messages
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.erp_chat_messages.edited_at is
  'Момент последней правки автором; null — сообщение не правили. Видно в ленте подписью «изменено»: правка задним числом без следа вводила бы в заблуждение тех, кто читал прежний текст.';
comment on column public.erp_chat_messages.deleted_at is
  'Момент удаления автором; текст при этом затирается. Строка остаётся ради цитат и порядка ленты.';

/**
 * ПРАВКА СВОЕГО СООБЩЕНИЯ.
 *
 * Окна по времени нет намеренно: документ его не просит, а «через 48 часов
 * нельзя» означало бы, что опечатку в номере артикула исправить уже нечем.
 * Взамен правка ВИДНА — `edited_at` показывается в ленте.
 */
create or replace function public.erp_chat_edit(
  p_message_id uuid,
  p_body       text,
  p_mentions   uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  /**
   * УПОМИНАНИЯ ПЕРЕСОБИРАЮТСЯ: `@имя` — свойство ТЕКСТА, и если правка его
   * убрала, строка упоминания врала бы счётчику «Упоминания» в колоколе.
   * Фильтр тот же, что в `erp_chat_send`: вписать можно только активного
   * и одобренного, себя не зовут.
   */
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

  /**
   * УВЕДОМЛЕНИЯ ПРАВКА НЕ ТРОГАЕТ — ни старые, ни новые.
   *
   * Старое остаётся правдой: человека позвали, и он это видел. Стирать
   * запись о событии у него в колоколе значит переписывать его прошлое.
   * Нового не шлём: иначе правкой текста можно звать людей столько раз,
   * сколько хватит терпения, — а уникальность `(user_id, message_id)`
   * гасит только повтор ОДНОМУ и тому же.
   */

  return jsonb_build_object(
    'message_id', p_message_id,
    'changed',    true,
    'mentioned',  to_jsonb(v_mentions));
end $fn$;

/**
 * УДАЛЕНИЕ СВОЕГО СООБЩЕНИЯ.
 *
 * Идемпотентно: повторный вызов на уже удалённом не ошибка, а тот же ответ.
 * Удаление — необратимое действие, и второй клик по кнопке (или повтор
 * после оборванного ответа) не должен отвечать отказом.
 */
create or replace function public.erp_chat_delete(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  /**
   * ФАЙЛЫ УХОДЯТ ВМЕСТЕ С СООБЩЕНИЕМ. Оставить их значило бы «удалить»
   * разговор, оставив на виду то, о чём он был. Удаляется строка-носитель;
   * объект в бакете становится ничьим, и его уберёт `storage-gc` — та же
   * дорога, что у остальных вложений раздела.
   *
   * DELETE-политики у вложений вида `chat` при этом по-прежнему нет:
   * через REST файл сообщения не удалить, только этой функцией.
   */
  delete from public.erp_order_attachments a where a.message_id = p_message_id;

  -- Уведомление о сообщении, которого больше нет, ведёт на пустое место
  delete from public.erp_notifications n where n.message_id = p_message_id;

  return jsonb_build_object('message_id', p_message_id, 'deleted', true);
end $fn$;

revoke execute on function public.erp_chat_edit(uuid, text, uuid[]) from public, anon;
revoke execute on function public.erp_chat_delete(uuid) from public, anon;
grant execute on function public.erp_chat_edit(uuid, text, uuid[]) to authenticated;
grant execute on function public.erp_chat_delete(uuid) to authenticated;

/**
 * ЛЕНТА ОТДАЁТ ПРИЗНАКИ ПРАВКИ И УДАЛЕНИЯ.
 *
 * Тело взято подлинным с прода; изменены ровно три вещи: добавлены
 * `edited_at` и `deleted_at` у сообщения, и в цитате появился признак
 * удаления — иначе ответ на удалённое показывал бы пустую полоску вместо
 * «Сообщение удалено».
 */
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
set search_path to 'public'
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
                        where rr.message_id = p.id)
      ) order by p.created_at, p.id)
      from page p), '[]'::jsonb),
    'has_more', (select count(*) from picked) > (select n from lim)
  );
$fn$;

/**
 * УДАЛЁННОЕ НЕ СЧИТАЕТСЯ НЕПРОЧИТАННЫМ.
 *
 * Тело подлинное с прода, изменена одна строка: в `base` добавлено
 * `m.deleted_at is null`. Без этого бейдж звал бы человека прочитать пустое
 * место — и не гас бы, потому что читать там нечего.
 */
create or replace function public.erp_chat_unread(
  p_order_id uuid,
  p_stage_id uuid default null::uuid,
  p_item_id uuid default null::uuid,
  p_experimental_id uuid default null::uuid
) returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $fn$
  with th as (
    select t.id from public.erp_chat_threads t where t.order_id = p_order_id
    union
    select t.id from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where e.order_id = p_order_id
  ),
  wm as (
    select r.thread_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is null
  ),
  swm as (
    select r.thread_id, r.stage_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is not null
  ),
  base as (
    -- Своё сообщение непрочитанным не бывает; удалённое — тоже: читать нечего
    select m.id, m.thread_id, m.stage_id, m.created_at
      from public.erp_chat_messages m
     where m.thread_id in (select id from th)
       and m.author_id is distinct from (select auth.uid())
       and m.deleted_at is null
  ),
  unread as (
    select b.*
      from base b
      left join wm on wm.thread_id = b.thread_id
     where b.created_at > coalesce(wm.last_read_at, '-infinity'::timestamptz)
       and not exists (
         select 1 from public.erp_chat_message_reads rr
          where rr.message_id = b.id and rr.user_id = (select auth.uid())
       )
  ),
  scoped as (
    -- Контекст, в котором открыто окно: по нему считается якорь черты.
    -- Пусто — вся сделка, и тогда годится любое непрочитанное.
    select u.* from unread u
     where (p_stage_id is null or u.stage_id = p_stage_id)
       and (p_item_id is null or exists (
             select 1 from public.erp_chat_messages m2
              where m2.id = u.id and m2.item_id = p_item_id))
       and (p_experimental_id is null or exists (
             select 1 from public.erp_chat_messages m3
              where m3.id = u.id and m3.experimental_id = p_experimental_id))
  )
  select jsonb_build_object(
    'total', (select count(*) from unread),
    'by_stage', coalesce((
      select jsonb_object_agg(s.stage_id::text, s.n) from (
        select u.stage_id, count(*) as n
          from unread u
          left join wm  on wm.thread_id = u.thread_id
          left join swm on swm.thread_id = u.thread_id and swm.stage_id = u.stage_id
         where u.stage_id is not null
           and u.created_at > greatest(coalesce(wm.last_read_at,  '-infinity'::timestamptz),
                                       coalesce(swm.last_read_at, '-infinity'::timestamptz))
         group by u.stage_id) s), '{}'::jsonb),
    'mentions', (
      select count(*) from unread u
        join public.erp_chat_mentions mm
          on mm.message_id = u.id and mm.user_id = (select auth.uid())),
    'first_unread_id', (select u.id from scoped u order by u.created_at, u.id limit 1),
    'first_unread_at', (select u.created_at from scoped u order by u.created_at, u.id limit 1)
  );
$fn$;

revoke execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon;
revoke execute on function public.erp_chat_unread(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.erp_chat_unread(uuid, uuid, uuid, uuid) to authenticated;
