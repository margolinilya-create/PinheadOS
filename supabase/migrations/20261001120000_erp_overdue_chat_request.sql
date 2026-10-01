/**
 * ЗАПРОС ПРИЧИНЫ ПРОСРОЧКИ В ЧАТЕ ЗАКАЗА (правка заказчика 01.10, п. 5).
 *
 * «Если прошёл срок клиента, а заказ ещё не отгружен и не закрыт, ERP один
 * раз пишет в чат этого заказа: „@Иванова Марийка, заказ №… просрочен.
 * Укажите, пожалуйста, причину задержки и ожидаемую дату отгрузки".
 * Отмечать всегда именно Иванову Марийку, аккаунт marika252002@gmail.com,
 * независимо от менеджера. Упоминание рабочее и даёт ей личное уведомление.
 * Не повторять каждый день. Если срок перенесли на будущую дату и заказ
 * снова просрочился — новый запрос. Для отгруженных, закрытых и отменённых
 * заказов сообщения не создавать».
 *
 * СИСТЕМНЫЙ АВТОР (решение владельца 01.10). Сообщение пишет «ERP», а не
 * человек: у системного сообщения `author_id` пуст. Подставить менеджера
 * значило бы приписать ему слова, которых он не писал. Поэтому:
 *  - `author_id` перестаёт быть обязательным; пустой автор = «ERP»;
 *  - счётчики непрочитанного уже сравнивают автора null-безопасно
 *    (`is distinct from`) — системное сообщение непрочитано у всех;
 *  - правка и удаление сверяли автора через `<>`, и для пустого автора
 *    проверка молча ПРОПУСКАЛА любого участника. Ниже обе функции заново,
 *    с `is distinct from` — системное сообщение не правит и не удаляет никто.
 *  - отвечать на него можно: `erp_chat_send` уведомляет автора цитаты,
 *    только если он есть.
 */

alter table public.erp_chat_messages alter column author_id drop not null;

-- ── Правка и удаление: тела из 20260920182703, null-безопасная сверка автора ──
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
  if v_row.author_id is distinct from v_me then
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
  if v_row.author_id is distinct from v_me then
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

-- ── Журнал запросов: «по этому сроку уже спросили» ─────────────────────────
--
-- Отдельная таблица, а не колонка `erp_orders`: запись в заказ будила бы
-- аудит (`erp_orders_audit`) и `updated_at` у каждого просроченного заказа
-- каждый день. Ключ (заказ, срок): тот же срок — уже спросили; срок
-- перенесли и он снова прошёл — новый ключ, новый запрос.
create table if not exists public.erp_overdue_requests (
  order_id   uuid not null references public.erp_orders(id) on delete cascade,
  due_date   date not null,
  message_id uuid references public.erp_chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (order_id, due_date)
);

alter table public.erp_overdue_requests enable row level security;

-- Читают участники (для отладки и отчёта); пишет только функция ниже
create policy erp_overdue_requests_select on public.erp_overdue_requests
  for select to authenticated using ((select public.erp_is_member()));

revoke all on public.erp_overdue_requests from public, anon;
grant select on public.erp_overdue_requests to authenticated;

/**
 * Один проход: всем просроченным заказам без запроса по ТЕКУЩЕМУ сроку —
 * системное сообщение, упоминание и личное уведомление адресату.
 *
 * «Просрочен» — то же правило, что в интерфейсе (`stageUi`): статус
 * `active` (все `done*` — сданные, `cancelled` — отменённые), срок клиента
 * раньше сегодняшнего дня по Москве (`erp_local_date`), заказ не отгружен
 * полностью.
 *
 * Адресат ищется по почте: его нет или он отключён — функция ничего
 * не пишет (запрос, упоминание которого никому не приходит, хуже
 * отсутствующего) и возвращает причину.
 *
 * Зовёт только планировщик (`pg_cron`) и service_role: через REST
 * функцию не вызвать.
 */
create or replace function public.erp_overdue_requests_run()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_email   constant text := 'marika252002@gmail.com';
  v_user    uuid;
  v_name    text;
  v_today   date := public.erp_local_date();
  v_order   record;
  v_thread  uuid;
  v_id      uuid;
  v_label   text;
  v_body    text;
  v_link    text;
  v_sent    int := 0;
begin
  select p.id,
         coalesce(nullif(btrim(e.full_name), ''), nullif(btrim(p.name), ''), p.email)
    into v_user, v_name
    from public.profiles p
    left join lateral (
      select em.full_name from public.erp_employees em
       where em.profile_id = p.id and em.active
       order by em.updated_at desc limit 1
    ) e on true
   where lower(p.email) = c_email and p.active is true and p.approved is true;
  if v_user is null then
    return jsonb_build_object('sent', 0, 'skipped', 'адресат не найден или отключён');
  end if;

  for v_order in
    select o.id, o.due_date, coalesce(nullif(btrim(o.bitrix_id), ''), o.title) as label
      from public.erp_orders o
     where o.status = 'active'
       and o.due_date is not null
       and o.due_date < v_today
       and coalesce(o.shipped_status, 'not_shipped') <> 'shipped'
       and not exists (
         select 1 from public.erp_overdue_requests r
          where r.order_id = o.id and r.due_date = o.due_date)
     order by o.due_date, o.id
  loop
    -- Заявка на ключ (заказ, срок) — первой: параллельный прогон её не получит
    insert into public.erp_overdue_requests (order_id, due_date)
    values (v_order.id, v_order.due_date)
    on conflict do nothing;
    if not found then continue; end if;

    select t.id into v_thread from public.erp_chat_threads t where t.order_id = v_order.id;
    if v_thread is null then
      insert into public.erp_chat_threads (order_id) values (v_order.id)
        on conflict (order_id) where order_id is not null do nothing
        returning id into v_thread;
      if v_thread is null then
        select t.id into v_thread from public.erp_chat_threads t where t.order_id = v_order.id;
      end if;
    end if;

    v_label := v_order.label;
    v_body  := '@' || v_name || ', заказ №' || v_label || ' просрочен. '
            || 'Укажите, пожалуйста, причину задержки и ожидаемую дату отгрузки.';

    insert into public.erp_chat_messages (thread_id, author_id, body, client_key)
    values (v_thread, null, v_body, gen_random_uuid())
    returning id into v_id;

    insert into public.erp_chat_mentions (message_id, user_id) values (v_id, v_user);

    v_link := '/orders/' || v_order.id::text || '?tab=chat&msg=' || v_id::text;
    insert into public.erp_notifications (user_id, kind, order_id, title, body, link, message_id)
    values (v_user, 'chat_mention', v_order.id,
            'Заказ просрочен — сделка ' || v_label, left(v_body, 200), v_link, v_id)
    on conflict (user_id, message_id) where message_id is not null do nothing;

    update public.erp_overdue_requests set message_id = v_id
     where order_id = v_order.id and due_date = v_order.due_date;
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent, 'date', v_today);
end $function$;

revoke execute on function public.erp_overdue_requests_run() from public, anon, authenticated;
grant execute on function public.erp_overdue_requests_run() to service_role;

-- Ежедневно в 09:00 по Москве (06:00 UTC): к началу рабочего дня
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'erp-overdue-requests') then
    perform cron.unschedule('erp-overdue-requests');
  end if;
  perform cron.schedule('erp-overdue-requests', '0 6 * * *',
                        'select public.erp_overdue_requests_run()');
end $cron$;
