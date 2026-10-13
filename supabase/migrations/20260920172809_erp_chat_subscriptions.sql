-- РЕЖИМЫ УВЕДОМЛЕНИЙ ПО ЗАКАЗУ (правка заказчика 20.09, п. 4).
--
-- «Режимы на заказ: „Все сообщения", „Упоминания и ответы", „Без
-- уведомлений". Последний отключает и персональные уведомления, но не учёт
-- непрочитанных сообщений».
--
-- ЧТО БЫЛО. Уведомление получали только упомянутые и автор цитируемого
-- сообщения — то есть режим «Упоминания и ответы» был зашит в код
-- `erp_chat_send`, и выбрать другой человек не мог ничем.
--
-- УМОЛЧАНИЕ ПРИ ОТСУТСТВИИ СТРОКИ — `mentions`, то есть РОВНО СЕГОДНЯШНЕЕ
-- поведение. Иначе выкат молча переключил бы всех: при умолчании `all` цех
-- получил бы уведомление о каждом сообщении каждой сделки, при `none` —
-- перестал бы получать упоминания вовсе.
--
-- ⚠️ АВТОПОДПИСКА МЕНЕДЖЕРА, КАК ЕЁ ПРОСИТ ДОКУМЕНТ, СЕЙЧАС НЕВЫПОЛНИМА,
-- и это надо сказать прямо, а не сделать вид, что требование закрыто.
-- «Автоматически подписывать менеджера заказа и назначенных ответственных»
-- предполагает, что их можно назвать по идентификатору. Но
-- `erp_orders.manager` — свободный текст (на бою там «Никита», «никита»,
-- «игорь», «Александ», «=»), и `erp_item_stages.assignee` — тоже текст.
-- Подписать по имени нельзя: совпадение строки с сотрудником — догадка,
-- а ценой ошибки будет чужая переписка в чужом колоколе.
--
-- Поэтому здесь автоподписка сделана по ДЕЙСТВИЮ: `all` получает тот, кто
-- в этот тред написал. Это работает с первого дня, не требует бэкфилла
-- и не зависит от того, как написано имя. Настоящая автоподписка менеджера
-- требует `erp_orders.manager_id uuid references profiles(id)` — отдельной
-- правки, нужной не одному чату.

create table if not exists public.erp_chat_subscriptions (
  thread_id  uuid not null references public.erp_chat_threads(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  mode       text not null default 'mentions'
    check (mode in ('all', 'mentions', 'none')),
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

comment on table public.erp_chat_subscriptions is
  'Режим уведомлений человека по переписке сделки (правка 20.09, п. 4). Нет строки = mentions, то есть сегодняшнее поведение: умолчание all залило бы цех, none отняло бы упоминания.';

alter table public.erp_chat_subscriptions enable row level security;

-- Политики НА КОМАНДУ (правило раздела). Свой режим человек и читает,
-- и ставит; чужой ему не нужен ни для чего.
drop policy if exists erp_chat_subscriptions_read on public.erp_chat_subscriptions;
create policy erp_chat_subscriptions_read on public.erp_chat_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists erp_chat_subscriptions_insert on public.erp_chat_subscriptions;
create policy erp_chat_subscriptions_insert on public.erp_chat_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists erp_chat_subscriptions_update on public.erp_chat_subscriptions;
create policy erp_chat_subscriptions_update on public.erp_chat_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Третий вид уведомления ───────────────────────────────────────────────
--
-- Применённую миграцию правят новой: CHECK пересобирается целиком.
-- `chat_message` — это «в подписанной сделке написали», в отличие
-- от `chat_mention` («позвали») и `chat_reply` («ответили мне»).
alter table public.erp_notifications
  drop constraint if exists erp_notifications_kind_check;
alter table public.erp_notifications
  add constraint erp_notifications_kind_check
  check (kind in ('chat_mention', 'chat_reply', 'chat_message'));

-- ── Поставить режим по заказу ────────────────────────────────────────────
--
-- Клиент не знает `thread_id` — он живёт внутри чата и заводится первым
-- сообщением. Человек же выбирает режим у ЗАКАЗА, поэтому функция сама
-- находит (или создаёт) тред сделки.
create or replace function public.erp_chat_set_mode(p_order_id uuid, p_mode text)
returns text
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_me     uuid := (select auth.uid());
  v_thread uuid;
begin
  if v_me is null then
    raise exception 'erp_chat_set_mode: нужна учётная запись' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('all', 'mentions', 'none') then
    raise exception 'erp_chat_set_mode: неизвестный режим %', p_mode using errcode = '22023';
  end if;

  select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
  if v_thread is null then
    -- Режим можно выбрать ДО первого сообщения: «подписаться на чат» —
    -- это решение о будущем разговоре, а не о существующем
    insert into public.erp_chat_threads (order_id) values (p_order_id)
    on conflict do nothing
    returning id into v_thread;
    if v_thread is null then
      select t.id into v_thread from public.erp_chat_threads t where t.order_id = p_order_id;
    end if;
  end if;

  insert into public.erp_chat_subscriptions (thread_id, user_id, mode)
  values (v_thread, v_me, p_mode)
  on conflict (thread_id, user_id)
  do update set mode = excluded.mode, updated_at = now();

  return p_mode;
end $$;

comment on function public.erp_chat_set_mode(uuid, text) is
  'Режим уведомлений по переписке заказа (правка 20.09, п. 4). Клиент знает заказ, а не тред: тред заводится первым сообщением, а выбрать режим можно и до него.';

-- ── Узнать свой режим ────────────────────────────────────────────────────
create or replace function public.erp_chat_mode(p_order_id uuid)
returns text
language sql
stable
security invoker
set search_path to 'public'
as $$
  select coalesce((
    select s.mode
      from public.erp_chat_subscriptions s
      join public.erp_chat_threads t on t.id = s.thread_id
     where t.order_id = p_order_id and s.user_id = (select auth.uid())
  ), 'mentions');
$$;

comment on function public.erp_chat_mode(uuid) is
  'Текущий режим уведомлений человека по заказу; нет строки — mentions (сегодняшнее поведение).';

revoke execute on function public.erp_chat_set_mode(uuid, text) from public, anon;
revoke execute on function public.erp_chat_mode(uuid) from public, anon;
grant execute on function public.erp_chat_set_mode(uuid, text) to authenticated;
grant execute on function public.erp_chat_mode(uuid) to authenticated;
