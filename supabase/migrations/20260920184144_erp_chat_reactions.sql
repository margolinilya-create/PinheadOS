-- РЕАКЦИИ НА СООБЩЕНИЯ (вторая очередь чата, документ 20.09, п. 4).
--
-- ЗАЧЕМ ТАБЛИЦА, А НЕ ПОЛЕ В СООБЩЕНИИ. Реакция принадлежит ПАРЕ
-- «сообщение + человек»: только так работает переключение (нажал второй раз —
-- снял) и только так считается «кто именно поставил». Счётчиком в jsonb
-- у сообщения это не выражается — двое, нажавшие одновременно, затёрли бы
-- друг друга, а снять свою реакцию было бы нечем.
--
-- НАБОР СМАЙЛОВ ЗАДАЁТ КЛИЕНТ, А НЕ CHECK. Список «какие реакции показывать»
-- меняется от желания людей, а CHECK на него означал бы миграцию на каждое
-- новое лицо. Сервер ограничивает ДЛИНУ (реакция — не сообщение), остальное
-- решает интерфейс.

create table if not exists public.erp_chat_reactions (
  message_id uuid not null references public.erp_chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

comment on table public.erp_chat_reactions is
  'Реакции на сообщения чата. Ключ — тройка (сообщение, человек, смайл): одна и та же реакция дважды невозможна на уровне базы, а не проверкой в коде.';

create index if not exists erp_chat_reactions_message_idx
  on public.erp_chat_reactions (message_id);

alter table public.erp_chat_reactions enable row level security;

/**
 * ЧИТАЮТ ВСЕ УЧАСТНИКИ — иначе «кто поставил» не собрать: реакция
 * и существует для того, чтобы её видели остальные. Это то же решение,
 * что у `erp_chat_message_reads`, и по той же причине.
 */
create policy erp_chat_reactions_read on public.erp_chat_reactions
  for select to authenticated
  using (public.erp_is_member());

/**
 * ПИШЕТ ЧЕЛОВЕК ТОЛЬКО СЕБЕ. Здесь политика уместна, в отличие от самих
 * сообщений: строка реакции не несёт ни текста, ни адресата, ни контекста —
 * подделать ею можно ровно одно, «Иван поставил палец», и это закрывается
 * условием `user_id = auth.uid()`. Заводить ради двух строк ещё одну
 * `security definer`-функцию значило бы платить сложностью без выигрыша.
 */
create policy erp_chat_reactions_insert on public.erp_chat_reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.erp_is_member());

create policy erp_chat_reactions_delete on public.erp_chat_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

/**
 * ПЕРЕКЛЮЧЕНИЕ ОДНИМ ВЫЗОВОМ.
 *
 * Клиент не знает наверняка, стоит ли уже его реакция: лента могла устареть
 * на секунду. Два запроса («посмотреть» и «поставить») дали бы гонку, в которой
 * два быстрых нажатия оставляют реакцию включённой через раз. Здесь решает
 * САМ delete: удалил строку — значит реакция была, и её сняли; не удалил —
 * ставим.
 */
create or replace function public.erp_chat_react(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $fn$
declare
  v_me    uuid := (select auth.uid());
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_rows  int;
begin
  if v_me is null then
    raise exception 'erp_chat_react: нет сессии' using errcode = '42501';
  end if;
  if v_emoji = '' then
    raise exception 'erp_chat_react: пустая реакция' using errcode = '22023';
  end if;

  delete from public.erp_chat_reactions r
   where r.message_id = p_message_id and r.user_id = v_me and r.emoji = v_emoji;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    return jsonb_build_object('emoji', v_emoji, 'mine', false);
  end if;

  -- Реакция на удалённое сообщение — реакция на пустое место
  if exists (select 1 from public.erp_chat_messages m
              where m.id = p_message_id and m.deleted_at is not null) then
    raise exception 'erp_chat_react: сообщение удалено' using errcode = '22023';
  end if;

  insert into public.erp_chat_reactions (message_id, user_id, emoji)
  values (p_message_id, v_me, v_emoji)
  on conflict do nothing;

  return jsonb_build_object('emoji', v_emoji, 'mine', true);
end $fn$;

revoke execute on function public.erp_chat_react(uuid, text) from public, anon;
grant execute on function public.erp_chat_react(uuid, text) to authenticated;

/**
 * КТО ПОСТАВИЛ — отдельным вызовом, по требованию.
 *
 * `security definer` по той же причине, что у `erp_chat_read_receipts`:
 * `profiles_select` показывает участнику только свою строку, и имена
 * иначе не собрать. Гейт участника — внутри.
 */
create or replace function public.erp_chat_reaction_people(p_message_id uuid)
returns table (emoji text, user_id uuid, name text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select r.emoji, r.user_id,
         coalesce(nullif(btrim(p.name), ''), nullif(btrim(p.email), ''), 'Сотрудник')
    from public.erp_chat_reactions r
    left join public.profiles p on p.id = r.user_id
   where public.erp_is_member()
     and r.message_id = p_message_id
   order by r.emoji, r.created_at;
$fn$;

revoke execute on function public.erp_chat_reaction_people(uuid) from public, anon;
grant execute on function public.erp_chat_reaction_people(uuid) to authenticated;

/**
 * ЛЕНТА ВЕЗЁТ СВОДКУ РЕАКЦИЙ.
 *
 * Тело подлинное; добавлен один ключ `reactions` — массив
 * `{emoji, count, mine}`. Сводка, а не список людей: имена нужны по наведению,
 * а страница ленты это полсотни сообщений, и список читателей у каждого
 * означал бы полсотни лишних выборок (то же решение, что у «Прочитали N»).
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

revoke execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.erp_chat_page(uuid, uuid, uuid, uuid, timestamptz, uuid, integer) to authenticated;

-- Реакция — единственное в чате, что видно сразу и МЕНЯЕТСЯ ЧУЖИМИ РУКАМИ
-- без нового сообщения: без подписки палец, поставленный коллегой, доезжал бы
-- только со следующим сообщением. Строк мало, событий — по одному на нажатие.
alter publication supabase_realtime add table public.erp_chat_reactions;
