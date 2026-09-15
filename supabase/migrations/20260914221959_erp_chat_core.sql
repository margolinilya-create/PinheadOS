-- ЧАТ ВНУТРИ СДЕЛКИ: СХЕМА (правка заказчика 14.09).
--
-- Документ: «добавить в ERP чат для обсуждения производственных вопросов
-- внутри сделки… У каждой сделки одно обсуждение, привязанное к её уникальному
-- ID… Для разработки без сделки обсуждение привязывать к ID разработки. После
-- привязки к сделке её переписка должна быть доступна из чата сделки БЕЗ
-- копирования сообщений».
--
-- ПОЧЕМУ СООБЩЕНИЕ ПРИНАДЛЕЖИТ ТРЕДУ, А НЕ ЗАКАЗУ. Последнее требование
-- и решает: держи `order_id` прямо в сообщении — и привязка разработки
-- к сделке потребовала бы массового UPDATE переписки, то есть копирования
-- и UPDATE-политики, которой у сообщений быть не должно вовсе. Тред — якорь:
-- он переезжает целиком, сообщения не трогаются ни одной командой.
--
-- КОММЕНТАРИИ ЗАКАЗА НЕ ТРОГАЮТСЯ (прямое требование документа). Это разные
-- сущности с разными правилами: комментарий хранит автора ТЕКСТОМ, не знает
-- ни вложений, ни ответов, ни прочитанности. На бою их ноль, то есть чат
-- не отнимает живую переписку — но и не заменяет вкладку.

-- ── Тред: якорь обсуждения ────────────────────────────────────────────────
create table if not exists public.erp_chat_threads (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.erp_orders(id) on delete cascade,
  experimental_id uuid references public.erp_experimental(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- РОВНО ОДИН якорь: тред либо сделки, либо разработки. Оба сразу означали бы
  -- две принадлежности у одной переписки, и «где она живёт» решалось бы
  -- по-разному в разных местах
  constraint erp_chat_thread_anchor check (
    (order_id is not null)::int + (experimental_id is not null)::int = 1)
);

-- «Одно обсуждение на сделку» — ОГРАНИЧЕНИЕ БАЗЫ, а не соглашение кода:
-- открытие чата из разных экранов не должно заводить вторую переписку
create unique index if not exists erp_chat_thread_order_uniq
  on public.erp_chat_threads (order_id) where order_id is not null;
create unique index if not exists erp_chat_thread_dev_uniq
  on public.erp_chat_threads (experimental_id) where experimental_id is not null;

comment on table public.erp_chat_threads is
  'Обсуждение: одно на сделку либо на разработку без сделки. Сообщения принадлежат ТРЕДУ — тогда привязка разработки к сделке не требует копирования переписки.';

-- ── Сообщение ─────────────────────────────────────────────────────────────
create table if not exists public.erp_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.erp_chat_threads(id) on delete cascade,
  -- ПОСТОЯННЫЙ ID, а не имя: «изменение имени или email не должно нарушать
  -- привязку сообщений, упоминаний и уведомлений» (требование документа).
  -- Именно этим чат отличается от комментариев, где автор — текст
  author_id uuid not null references public.profiles(id),
  body text not null default '' check (char_length(body) <= 10000),
  -- Контекст внутри сделки; пусто — сообщение «всей сделки»
  item_id uuid references public.erp_order_items(id) on delete set null,
  stage_id uuid references public.erp_item_stages(id) on delete set null,
  experimental_id uuid references public.erp_experimental(id) on delete set null,
  -- Ответ: «сохранять связь по ID исходного сообщения»
  reply_to uuid references public.erp_chat_messages(id) on delete set null,
  /**
   * Ключ попытки отправки. «Повторное нажатие „Отправить" или повтор запроса
   * после сбоя не должны создавать дубликаты сообщений и уведомлений» —
   * тот же приём, что у приёмки материала и отгрузки (`utils/attemptKey`).
   */
  client_key uuid not null,
  created_at timestamptz not null default now(),
  unique (author_id, client_key)
);

create index if not exists erp_chat_messages_feed_idx
  on public.erp_chat_messages (thread_id, created_at desc);
create index if not exists erp_chat_messages_reply_idx
  on public.erp_chat_messages (reply_to) where reply_to is not null;
-- Непрочитанные считаются по контексту задачи — отбор идёт по этапу
create index if not exists erp_chat_messages_stage_idx
  on public.erp_chat_messages (stage_id) where stage_id is not null;

comment on table public.erp_chat_messages is
  'Сообщение чата. Редактирования и удаления НЕТ (решение документа): у таблицы нет ни UPDATE-, ни DELETE-политики, и это выражено отсутствием команды, а не отсутствием кнопки.';

-- ── Упоминания ────────────────────────────────────────────────────────────
-- Отдельной строкой, а не разбором текста: «просто введённый текст „@Имя"
-- без выбора сотрудника из списка не считается упоминанием»
create table if not exists public.erp_chat_mentions (
  message_id uuid not null references public.erp_chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id, user_id)
);

-- ── Прочтение: водяная отметка на (тред × человек) ────────────────────────
/**
 * ПОЧЕМУ ОТМЕТКА, А НЕ СТРОКА НА КАЖДОЕ СООБЩЕНИЕ. Вторая модель — это
 * N×M строк на растущую ленту и вторая формула счётчика. «Прочитано» здесь
 * одна величина: момент, до которого человек всё видел.
 *
 * ОТМЕТОК ДВЕ, и это не дубль. Документ требует РАЗНЫХ счётчиков: «на кнопке
 * „Чат" в сделке — общее количество непрочитанных этой сделки; на кнопке
 * открытия из задачи — количество по её контексту», и добавляет: «просмотр
 * переписки отдельной задачи не отмечает прочитанными сообщения других
 * задач». Одна отметка на тред этого выразить не может: прочитав задачу,
 * человек погасил бы счётчик всей сделки.
 */
create table if not exists public.erp_chat_reads (
  thread_id uuid not null references public.erp_chat_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Контекст: этап задачи либо NULL — «вся сделка»
  stage_id uuid references public.erp_item_stages(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  -- NULL в первичном ключе невозможен, поэтому ключ строится выражением ниже
  created_at timestamptz not null default now()
);

-- Уникальность с NULL-контекстом: обычный UNIQUE считает NULL-ы разными,
-- и у человека накопилось бы по строке на каждое открытие «всей сделки»
create unique index if not exists erp_chat_reads_thread_uniq
  on public.erp_chat_reads (thread_id, user_id) where stage_id is null;
create unique index if not exists erp_chat_reads_stage_uniq
  on public.erp_chat_reads (thread_id, user_id, stage_id) where stage_id is not null;

comment on table public.erp_chat_reads is
  'До какого момента человек дочитал обсуждение. Своя отметка у каждого контекста: просмотр переписки задачи не гасит непрочитанное всей сделки (требование документа).';

-- ── Вложения ──────────────────────────────────────────────────────────────
-- Своей таблицы у файлов чата нет: «использовать существующее хранилище
-- и ограничения файлов ERP». Вид заводится В ДВУХ местах одним коммитом —
-- CHECK и `ErpAttachmentKind`; в проекте на этом уже ловились (23514
-- на создании заказа).
alter table public.erp_order_attachments
  add column if not exists message_id uuid
  references public.erp_chat_messages(id) on delete cascade;

create index if not exists erp_att_message_idx
  on public.erp_order_attachments (message_id) where message_id is not null;

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;

alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'print', 'label', 'note',
                  'dev_pattern', 'dev_passport', 'dev_photo', 'dev_task',
                  'stage_result', 'production',
                  -- Файл сообщения чата. В сводную DELETE-политику НЕ входит:
                  -- удаления сообщений нет, значит и удаления их файлов быть
                  -- не должно — иначе в переписке остался бы разговор
                  -- о приложенном файле, которого больше нет
                  'chat'));

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.erp_chat_threads enable row level security;
alter table public.erp_chat_messages enable row level security;
alter table public.erp_chat_mentions enable row level security;
alter table public.erp_chat_reads enable row level security;

/**
 * ВИДИМОСТЬ — «КТО ВИДИТ СДЕЛКУ, ТОТ ВИДИТ ЕЁ ОБСУЖДЕНИЕ» (решение владельца
 * 14.09).
 *
 * Документ просит «если доступ ограничен задачей или этапом, показывать
 * только разрешённый контекст». Опереть это не на что: прав «доступ к части
 * заказа» в ERP нет — карточку заказа цех видит целиком, и заводить для
 * переписки более строгое правило, чем для самого заказа, значило бы
 * различать то, что система нигде больше не различает. Переключатель
 * «выбранный контекст / вся сделка» остаётся ВИДОМ, а не правом.
 */
create policy erp_chat_threads_read on public.erp_chat_threads
  for select to authenticated using (public.erp_is_member());
create policy erp_chat_messages_read on public.erp_chat_messages
  for select to authenticated using (public.erp_is_member());
create policy erp_chat_mentions_read on public.erp_chat_mentions
  for select to authenticated using (public.erp_is_member());

/**
 * INSERT-ПОЛИТИК У ПЕРЕПИСКИ НЕТ — единственный вход это `erp_chat_send`
 * (`security definer`, следующая миграция). Это и есть «гейт живёт
 * у писателя»: прямой вставки через REST не существует, значит невозможны
 * сообщение от чужого имени, сообщение мимо длины и контекста и сообщение
 * без уведомлений, которые обязаны уйти той же транзакцией.
 *
 * UPDATE и DELETE не заводятся вовсе: «редактирование и удаление сообщений
 * в первую версию не включать». Требование выражено отсутствием КОМАНДЫ,
 * а не отсутствием кнопки — так же, как у комментариев заказа.
 */

-- Отметка прочтения — своя у каждого, и пишет её сам человек
create policy erp_chat_reads_read on public.erp_chat_reads
  for select to authenticated using (user_id = (select auth.uid()));
create policy erp_chat_reads_insert on public.erp_chat_reads
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy erp_chat_reads_update on public.erp_chat_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Realtime ──────────────────────────────────────────────────────────────
-- «Новые сообщения должны появляться без перезагрузки страницы не позднее
-- чем через 10 секунд». Подписка есть только у сообщений: упоминания
-- и вложения приезжают вместе с ними, отметка прочтения личная
alter publication supabase_realtime add table public.erp_chat_messages;
