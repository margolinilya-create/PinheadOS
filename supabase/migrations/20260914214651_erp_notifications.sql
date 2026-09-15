-- ПЕРСОНАЛЬНЫЕ УВЕДОМЛЕНИЯ: ТАБЛИЦА, КОТОРОЙ В СИСТЕМЕ НЕ БЫЛО
-- (подготовка к правке 14.09 «чат внутри сделки»).
--
-- ЧТО ЕСТЬ СЕЙЧАС. «Центр уведомлений ERP», на который ссылается документ,
-- — это ЧИСТАЯ ФУНКЦИЯ `src/erp/utils/notifications.ts`: она пересчитывает
-- из загруженных заказов три повода вмешаться (остановленный этап, просрочка,
-- дозакупка). Хранимых уведомлений нет вовсе, адресата у них нет тоже —
-- они одинаковы для всех, кто открыл раздел.
--
-- ПОЧЕМУ ЭТОГО НЕ ХВАТИТ ЧАТУ. «При упоминании отправлять уведомление
-- выбранному пользователю по его ID» нельзя вычислить из заказов: это факт
-- («вас позвали»), а не состояние производства. Его надо ХРАНИТЬ — иначе
-- прочитанность не отличить от непрочитанности, а сам повод исчезает,
-- как только сообщение уезжает вверх ленты.
--
-- ПОЧЕМУ У ТАБЛИЦЫ ПОКА НЕТ ПИСАТЕЛЯ, И ЭТО НЕ НЕДОДЕЛКА. Проверено
-- на живой базе 14.09: в ERP нет НИ ОДНОГО адресного события, которое можно
-- было бы привязать к учётной записи. Все «ответственные» и «исполнители»
-- (`erp_item_stages.assignee`, `erp_experimental_tasks.responsible`,
-- `erp_materials.responsible`, `erp_subcontracting.responsible`,
-- `erp_calendar_slots.assignee`) хранятся ТЕКСТОМ — именем, а не `profiles.id`,
-- и переименование сотрудника рвёт связь. Первым писателем станет
-- `erp_chat_send` в правке чата: там автор и упомянутые — постоянные ID.
--
-- Таблица заводится отдельно от чата НАМЕРЕННО: центр уведомлений — общий
-- механизм раздела, и собирать его внутри правки про переписку значило бы
-- смешать «где люди разговаривают» с «как система зовёт человека».

create table if not exists public.erp_notifications (
  id uuid primary key default gen_random_uuid(),
  -- АДРЕСАТ. Не сотрудник (`erp_employees`), а учётная запись: уведомление
  -- читает тот, кто вошёл, и связь не должна зависеть от того, заведена ли
  -- у человека цеховая карточка.
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('chat_mention', 'chat_reply')),
  -- Заказ, о котором речь. NULL — уведомление вне заказа (появится, когда
  -- появится такой источник): колонка есть, чтобы центр мог показать номер
  -- сделки, не спрашивая источник.
  order_id uuid references public.erp_orders(id) on delete cascade,
  /**
   * Что показать в строке центра. Текст ЗАМОРОЖЕН в момент события — это
   * снимок, а не ссылка на живые данные: сообщение чата редактировать нельзя,
   * но заказ переименовать можно, и уведомление «вас упомянули в сделке X»
   * обязано остаться правдой о том, что произошло тогда.
   */
  title text not null,
  body text,
  /**
   * Куда ведёт нажатие — путь внутри раздела (`/orders/<id>?tab=chat&msg=<id>`).
   * Готовый путь, а не пара «сущность + id»: источников уведомлений будет
   * несколько, и разбирать их на клиенте значило бы завести второе место,
   * где решается, где живёт та или иная сущность.
   */
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Лента адресата: непрочитанные сверху всего списка, поэтому индекс несёт
-- и `read_at` — счётчик колокола спрашивает именно его
create index if not exists erp_notifications_inbox_idx
  on public.erp_notifications (user_id, read_at, created_at desc);

comment on table public.erp_notifications is
  'Персональные уведомления ERP: факт «система позвала конкретного человека». Дополняют вычисляемые уведомления (utils/notifications.ts), а не заменяют их. Пишутся только серверными функциями — INSERT-политики нет по построению.';

alter table public.erp_notifications enable row level security;

-- ЧИТАЕТ ТОЛЬКО АДРЕСАТ. Не `erp_is_member()`: уведомление — личное, и «все
-- участники видят все уведомления» означало бы, что счётчик непрочитанного
-- считается по чужим строкам.
create policy erp_notifications_read on public.erp_notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

/**
 * INSERT-ПОЛИТИКИ НЕТ ВОВСЕ, и это решение, а не пропуск.
 *
 * Уведомление — следствие события, а не самостоятельное действие: писать его
 * вправе только тот, кто это событие совершил, и одной транзакцией с ним.
 * Разрешить вставку клиенту значило бы разрешить прислать человеку
 * уведомление о том, чего не было. Единственным писателем станет
 * `erp_chat_send` (`security definer`) в правке чата.
 */

-- Прочитанность отмечает САМ адресат. Разделение по колонкам — страж ниже:
-- RLS работает на уровне строки и не видит, что именно изменилось.
create policy erp_notifications_update on public.erp_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

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

  /**
   * Меняется РОВНО `read_at`. Без этого право «отметить своё уведомление
   * прочитанным» означало бы право переписать себе `link` и `order_id` —
   * то есть увести собственное уведомление на чужую сделку и открыть её
   * «на нужном месте». Для самого адресата это бессмысленно, но уведомления
   * будут приходить и тем, у кого доступ ограничен.
   */
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.order_id is distinct from old.order_id
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.link is distinct from old.link
     or new.created_at is distinct from old.created_at then
    raise exception 'erp_notification_guard: у уведомления правится только отметка о прочтении'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_notification_guard() is
  'UPDATE erp_notifications: меняется только read_at. Прочее неизменно — иначе адресат мог бы переписать себе ссылку и открыть чужую сделку «на нужном месте».';

drop trigger if exists erp_notifications_guard on public.erp_notifications;
create trigger erp_notifications_guard
  before update on public.erp_notifications
  for each row execute function public.erp_notification_guard();

-- Функции-триггеры клиенту не нужны никогда (правило миграции 20260803250000)
revoke execute on function public.erp_notification_guard() from anon, authenticated, public;

-- Уведомление обязано доехать до открытой вкладки САМО: человека зовут
-- сейчас, а не «когда он перезагрузит страницу»
alter publication supabase_realtime add table public.erp_notifications;
