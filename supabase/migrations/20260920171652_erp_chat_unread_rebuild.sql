-- СЧЁТЧИК НЕПРОЧИТАННОГО СЧИТАЕТСЯ ПО ФАКТУ ПРОСМОТРА (правка 20.09, п. 4).
--
-- Что меняется. Раньше непрочитанным считалось всё, что пришло позже водяной
-- отметки. Теперь — то, что позже отметки И НЕ ОТМЕЧЕНО просмотренным
-- (`erp_chat_message_reads`). Документ требует именно этого: «открытие заказа,
-- уведомления или фоновой вкладки само по себе не означает прочтение».
--
-- ОБЕ ПОЛОВИНЫ ФОРМУЛЫ ОБЯЗАТЕЛЬНЫ, И ЭТО УСЛОВИЕ ВЫКАТА. На момент правки
-- строк просмотра нет ни одной: «нет строки = не прочитано» в одиночку
-- вывалило бы цеху всю историю переписки как непрочитанную в первое же утро.
-- Водяная отметка остаётся нижней границей и отвечает за всё, что прочитано
-- до перехода.
--
-- ЧТО ДОБАВЛЯЕТСЯ В ОТВЕТ:
--   · `mentions` — непрочитанные УПОМИНАНИЯ отдельно: документ просит
--     «упоминания дополнительно выделять значком @», а значок без числа
--     не отвечает на «сколько их»;
--   · `first_unread_id` / `first_unread_at` — якорь черты «Непрочитанные
--     сообщения». Считает СЕРВЕР, потому что он же считает и сам счётчик:
--     два ответа на «что именно не прочитано» разошлись бы на первой же
--     странице ленты.
--
-- Сигнатура меняется (аргументов стало больше) ⇒ drop + create: лишний
-- аргумент при `create or replace` даёт перегрузку и неоднозначность
-- PostgREST. Все вызовы клиента правятся тем же коммитом — их сверяет
-- `utils/rpcContract.test.ts`.

drop function if exists public.erp_chat_unread(uuid);

create or replace function public.erp_chat_unread(
  p_order_id uuid,
  p_stage_id uuid default null,
  p_item_id  uuid default null,
  p_experimental_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
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
    -- Своё сообщение непрочитанным не бывает
    select m.id, m.thread_id, m.stage_id, m.created_at
      from public.erp_chat_messages m
     where m.thread_id in (select id from th)
       and m.author_id is distinct from (select auth.uid())
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
$$;

comment on function public.erp_chat_unread(uuid, uuid, uuid, uuid) is
  'Непрочитанное сделки: общее число, разбивка по этапам, упоминания и якорь черты «Непрочитанные сообщения». Непрочитано = позже водяной отметки И без строки просмотра (правка 20.09, п. 4); вторая половина одна вывалила бы всю историю в день выката.';

-- ── Счётчики для СПИСКА заказов ──────────────────────────────────────────
--
-- Документ: «на вкладке и кнопке чата, а также в списке заказов показывать
-- число непрочитанных сообщений для текущего пользователя». Список — это
-- полсотни строк на странице, и вызов на строку означал бы полсотни запросов
-- на открытие раздела. Та же причина, по которой в разделе живут
-- `erp_bootstrap` и сводки аналитики одним вызовом.
create or replace function public.erp_chat_unread_many(p_order_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with src as (
    select t.id as thread_id, t.order_id
      from public.erp_chat_threads t
     where t.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
    union
    select t.id, e.order_id
      from public.erp_chat_threads t
      join public.erp_experimental e on e.id = t.experimental_id
     where e.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
  ),
  wm as (
    select r.thread_id, r.last_read_at from public.erp_chat_reads r
     where r.user_id = (select auth.uid()) and r.stage_id is null
  ),
  unread as (
    select s.order_id, m.id
      from public.erp_chat_messages m
      join src s on s.thread_id = m.thread_id
      left join wm on wm.thread_id = m.thread_id
     where m.author_id is distinct from (select auth.uid())
       and m.created_at > coalesce(wm.last_read_at, '-infinity'::timestamptz)
       and not exists (
         select 1 from public.erp_chat_message_reads rr
          where rr.message_id = m.id and rr.user_id = (select auth.uid())
       )
  )
  select coalesce(jsonb_object_agg(u.order_id::text, u.n), '{}'::jsonb)
    from (select order_id, count(*) as n from unread group by order_id) u;
$$;

comment on function public.erp_chat_unread_many(uuid[]) is
  'Непрочитанное по списку заказов одним вызовом (правка 20.09, п. 4): в списке полсотни строк, и запрос на строку — полсотни запросов на открытие раздела.';

revoke execute on function public.erp_chat_unread(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.erp_chat_unread_many(uuid[]) from public, anon;
grant execute on function public.erp_chat_unread(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.erp_chat_unread_many(uuid[]) to authenticated;
