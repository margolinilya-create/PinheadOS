# Правки 19.10, часть B — «Бизнес-задачи» к заказам (п. 7) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** поручения по заказу (доставка, закупка, другое) с ответственным, сроком, статусами, наблюдателями, чек-листом, результатом, своим диалогом, файлами, историей и уведомлениями — во вкладке заказа и в общем разделе.

**Architecture:** новые таблицы `erp_biz_task*`; клиент только читает (RLS SELECT), пишет только `security definer` RPC — один писатель на задачу, событие истории и уведомления одной транзакцией. Диалог — тред существующего чата ERP с третьим якорем `task_id` (цитаты, упоминания, `client_key`, правка/удаление, прочтение — даром). Файлы — `erp_order_attachments` (новый вид `biz_task`, колонка `task_id`) в бакете `erp-attachments`, 30 МБ (часть A). Напоминания — `pg_cron` по образцу `erp_overdue_requests_run`. Экраны — ленивые чанки; оболочка ERP меняется только маршрутом и пунктом меню.

**Tech Stack:** React 19 + Zustand 5 (доменный слайс), Supabase (plpgsql, RLS, pg_cron, realtime-«звонок»), Vitest, Playwright.

**Spec:** снимок `docs/erp/2026-10-19-pravki-19-10.md` (часть A, Task 0), раздел 7.

## Global Constraints

- **Зависит от части A:** лимит 30 МБ (A Task 6) на бою; миграции A применены (иначе > 5 неприменённых — сторож журнала).
- ERP заморожен: «да» владельца на план → правки → `npm run erp:freeze` в коммите задачи; правка `ErpApp.jsx`/`Sidebar.jsx` → `npm run bundle:budget -- --write-baseline` с причиной в `src/orderstudio/design/README.md`.
- Типы задачи — ровно «Доставка», «Закупка», «Другое» (`delivery|purchase|other`); статусы — «Новая», «В работе», «Приостановлена», «На проверке», «Завершена», «Отменена» (`new|in_progress|paused|review|done|cancelled`); отметка «Просрочена» — рядом со статусом, не статус.
- Обязательные поля формы: название, заказ, тип, один ответственный, крайний срок (дата + время). Необязательные (свёрнуты): описание, наблюдатели, файлы, чек-лист, «Проверка постановщиком» (по умолчанию выключено).
- Часовой пояс — `Europe/Moscow` (`FACTORY_TIMEZONE`, `erp_local_date()`); срок — `timestamptz`.
- Удаления задачи нет — только «Отменить» с причиной. Удаление сообщения — отметка «Сообщение удалено».
- Внешние каналы уведомлений не добавлять. Подзадачи, повторы, учёт времени, внешние участники, автоматические задачи и блокировки маршрута — вне объёма.
- Маршрут раздела — `/biz-tasks`, `/biz-tasks/:taskId` (`/task/:stageId` занят производственным заданием); вкладка заказа — `?tab=tasks`.
- Realtime — только «звонок» в существующем канале (таблицы в `REALTIME_TABLES`), второго канала нет.

## Review Focus

1. **Человек в нескольких ролях** (постановщик = менеджер заказа = наблюдатель): одно уведомление на событие и одна запись в участниках — тест в Task 2 (проба) и Task 4.
2. **Возврат в работу после истёкшего срока** и сдача на проверку до срока с проверкой после: «Просрочена» считается по `submitted_at`, при возврате снова горит — тест в Task 4 (`isOverdue`).
3. **Повторная отправка сообщения / двойной клик «Создать задачу»**: один ряд (`client_key`) — тест в Task 2 и Task 8.
4. **Наблюдатель пробует завершить, сменить срок или ответственного** прямым вызовом RPC: `42501` — тест в Task 2 (проба).
5. **Удаление сообщения, отмеченного результатом**: результат остаётся в блоке «Результат» и в истории — тест в Task 3.

---

## Решения «за владельца» (подтвердить при одобрении)

- **Р1. Видимость.** Задачи и их диалог читают все активные одобренные сотрудники ERP (`erp_is_member()`), как заказы и чат сделки сейчас. Действовать — по ролям в задаче и праву. Экономика и файлы заказа остаются под прежними правами — задача их не открывает (файлы заказа прикладываются ссылкой только тем, кто их видит).
- **Р2. Право `biz_task.manage`** («Управлять бизнес-задачами»): admin, director, production_head, manager (ERP). Создавать задачу может любой сотрудник ERP; менять чужую — постановщик или `biz_task.manage`.
- **Р3. Менеджер заказа.** Сейчас `erp_orders.manager` — текст, человека по нему не найти. Добавляем `erp_orders.manager_id uuid references profiles(id) on delete set null`: для заказов из «Оформления заказа» заполняется автором заказа v4 при запуске (мост), в карточке — выбор из справочника сотрудников рядом с текстовым полем. Пока не заполнен — менеджер не добавляется наблюдателем и не уведомляется. *(Альтернатива — брать `erp_orders.created_by`; не рекомендую: заказ часто заводит не менеджер.)*
- **Р4. Сообщения задачи не создают уведомлений** — только счётчик непрочитанного; адресное уведомление — при @упоминании.
- **Р5. Напоминание «за 24 часа» и «просрочено»** — задание `pg_cron` раз в 15 минут; точность — до 15 минут.

---

### Task 1: Схема (миграция T1)

**Files:**
- Create: `supabase/migrations/20261020090000_erp_biz_tasks_schema.sql`
- Test: `pinhead-react/src/erp/utils/bizTasksSchema.test.ts` (node, читает миграцию)
- Modify: `supabase/migrations/FK_SNAPSHOT.md` (новые FK)

**Interfaces — Produces (таблицы):**
- `erp_biz_tasks`: `id uuid pk`, `order_id uuid not null → erp_orders on delete cascade`, `title text (1..200)`, `kind text check in ('delivery','purchase','other')`, `description text (≤ 10000)`, `assignee_id uuid not null → profiles`, `creator_id uuid not null → profiles`, `due_at timestamptz not null`, `status text check in (6 статусов) default 'new'`, `review_required bool default false`, `pause_reason`, `cancel_reason`, `return_reason text`, `result_text text`, `result_message_id uuid → erp_chat_messages on delete set null`, `submitted_at`, `reviewed_at`, `completed_at`, `cancelled_at timestamptz`, `client_key uuid not null unique`, `created_at`, `updated_at`. Индексы: `(order_id)`, `(assignee_id, status)`, `(creator_id, status)`, `(status, due_at)`.
- `erp_biz_task_watchers (task_id → cascade, user_id → profiles, added_by, added_at, pk(task_id,user_id))`.
- `erp_biz_task_checklist (id, task_id → cascade, text (1..500), done bool, sort int, done_by, done_at)`.
- `erp_biz_task_events (id bigint identity, task_id → cascade, kind text check in ('created','started','paused','resumed','submitted','accepted','returned','completed','cancelled','reopened','assignee_changed','due_changed','watchers_changed','edited','result_changed','due_soon','overdue'), actor uuid null, payload jsonb, due_at timestamptz null, at timestamptz default now())`; уникальный частичный индекс `(task_id, kind, due_at) where kind in ('due_soon','overdue')`.
- `erp_biz_task_seen (task_id, user_id, first_seen_at, pk)` — «прочитано» ≠ «в работе».
- `erp_orders.manager_id uuid null → profiles on delete set null` + классификация в `erp_order_guard` (правка — `order.manage`).
- `erp_chat_threads.task_id uuid null → erp_biz_tasks on delete cascade`; CHECK `erp_chat_thread_anchor` — ровно один из `order_id`/`experimental_id`/`task_id`… **но** тред задачи несёт и `order_id` для контекста: якорь = `task_id is not null` ИЛИ прежние правила; частичный уникальный индекс `(task_id) where task_id is not null`; уникальность «один тред на сделку» — `where task_id is null`.
- `erp_order_attachments.task_id uuid null → erp_biz_tasks on delete cascade`; вид `'biz_task'` в CHECK + `ErpAttachmentKind` (сторож `attachmentKinds.test.ts`) — классификация колонки в `erp_attachment_guard`.
- `erp_notifications`: `task_id uuid null → cascade`, `task_event_id bigint null`; уникальный `(user_id, task_event_id) where task_event_id is not null`; CHECK `kind` + `'task_assigned','task_unassigned','task_status','task_review','task_returned','task_due_soon','task_overdue','task_mention'`; исключения `erp_notification_guard` не меняются (правится только `read_at`).
- RLS: на все новые таблицы — только `select` для `(select public.erp_is_member())`; INSERT/UPDATE/DELETE-политик нет; `revoke all … from public, anon; grant select … to authenticated`.
- Право: `insert into erp_role_permissions (role, permission, allowed) values ('admin','biz_task.manage',true), ('director',…), ('production_head',…), ('manager',…) on conflict do nothing`.

- [ ] **Step 1: Failing test** `bizTasksSchema.test.ts`: `it('у новых таблиц нет политик записи')`, `it('CHECK статусов и типов совпадает с BIZ_TASK_STATUSES / BIZ_TASK_KINDS')` (сверка с `src/erp/utils/bizTasks.ts`, Task 4), `it('kind уведомлений совпадает с ErpNotificationKind')`, `it('один тред на задачу')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция. **Step 4:** `npx vitest run src/erp/utils/bizTasksSchema.test.ts src/erp/utils/attachmentKinds.test.ts src/erp/utils/guardSetNull.test.ts src/erp/utils/permissionsCoverage.test.ts` — PASS (последний требует гейт в коде — после Task 4; до тех пор тест помечается в коммите Task 4).
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp-db): схема бизнес-задач`.

---

### Task 2: Писатели задачи (миграция T2)

**Files:**
- Create: `supabase/migrations/20261020100000_erp_biz_tasks_rpc.sql`
- Create: `supabase/probes/erp_biz_tasks.sql`
- Test: `pinhead-react/src/erp/utils/bizTasksRpc.test.ts` (node)

**Interfaces — Produces (все `security definer`, `set search_path = public`, `revoke … from public, anon`, `grant execute … to authenticated`; каждая проверяет `erp_is_member()`; каждая пишет `erp_biz_task_events` и уведомления в одной транзакции; ответ — строка задачи с `updated_at`):**
- `erp_biz_task_create(p_task jsonb, p_client_key uuid) returns erp_biz_tasks` — поля из Global Constraints; `creator_id = auth.uid()`; наблюдатели = переданные ∪ `erp_orders.manager_id`, минус постановщик и ответственный, без дублей; чек-лист — массив строк; повтор `client_key` → прежняя строка. Уведомление `task_assigned` ответственному (если не он сам).
- `erp_biz_task_transition(p_id uuid, p_action text, p_text text, p_expected_updated_at timestamptz) returns erp_biz_tasks` — таблица переходов (кто → что):

  | action | из | в | кто | текст |
  |---|---|---|---|---|
  | `start` | new | in_progress | ответственный | — |
  | `pause` | in_progress | paused | ответственный | причина обяз. |
  | `resume` | paused | in_progress | ответственный | — |
  | `submit` | in_progress | review (если `review_required`) | ответственный | результат обяз., `submitted_at = now()` |
  | `complete` | in_progress | done (если не `review_required`) | ответственный | результат обяз., `completed_at` |
  | `accept` | review | done | постановщик / manage | — |
  | `return` | review, done | in_progress | постановщик / manage | что исправить обяз. |
  | `cancel` | new, in_progress, paused, review | cancelled | постановщик / manage | причина обяз. |
  | `reopen` | cancelled | in_progress | постановщик / manage | комментарий обяз. |

  Неверный переход → `22023`; чужая роль → `42501`; устаревший `p_expected_updated_at` → `P0001` «Задача изменена — обновите карточку». Уведомления: start/pause/submit/complete/cancel → постановщику и менеджеру заказа (кроме автора); submit → `task_review` постановщику; return → `task_returned` ответственному.
- `erp_biz_task_update(p_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)` — ключи `title, description, kind, assignee_id, due_at (+ due_reason обяз.), watchers` — постановщик / manage, не у `done`/`cancelled` (кроме `watchers`); смена ответственного → `task_assigned` новому, `task_unassigned` прежнему, `task_status` постановщику; `due_changed` с `{from, to, reason}`; при смене `due_at` старые `due_soon`/`overdue` не мешают новым (ключ содержит `due_at`).
- `erp_biz_task_set_result(p_id uuid, p_text text, p_message_id uuid)` — ответственный в `in_progress`/`review`; сообщение — только из треда этой задачи и от ответственного; копия текста в `result_text`, событие `result_changed`.
- `erp_biz_task_checklist(p_id uuid, p_op text, p_item jsonb)` — `add|toggle|remove|rename`; add/remove/rename — постановщик / manage; toggle — ответственный, постановщик, manage.
- `erp_biz_task_seen(p_id uuid)` — upsert `first_seen_at` (не меняет статус).
- `erp_biz_task_counts(p_order_id uuid) returns table(open int, overdue int, done int)`.
- Одно событие → одно уведомление на человека: адресаты собираются `select distinct` и исключают автора.

- [ ] **Step 1: Failing test** `bizTasksRpc.test.ts`: `it('все писатели — security definer с revoke от anon')`, `it('таблица переходов в SQL совпадает с BIZ_TASK_TRANSITIONS клиента')` (разбор `case` по меткам `-- transition:<action>:<from>-><to>`), `it('уведомления собираются distinct без автора')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция.
- [ ] **Step 4:** проба (`set local role authenticated` + `request.jwt.claims` трёх людей): создание с тем же `client_key` дважды → одна задача; постановщик = менеджер → одно уведомление; наблюдатель `complete` → `42501`; наблюдатель `update due_at` → `42501`; `submit` без результата → `22023`; review → `return` → `in_progress`; `cancel` без причины → `22023`; прямой `insert into erp_biz_tasks` → отказ RLS; `PROBE_RESULT total=N`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/bizTasksRpc.test.ts src/erp/utils/rpcContract.test.ts` — PASS. `npm run erp:freeze`; commit `feat(erp-db): писатели бизнес-задач — статусы, участники, уведомления`.

---

### Task 3: Диалог задачи и напоминания (миграция T3)

**Files:**
- Create: `supabase/migrations/20261020110000_erp_biz_tasks_chat_cron.sql`
- Test: `pinhead-react/src/erp/utils/bizTasksChat.test.ts`, `src/erp/utils/chatServer.test.ts` (обновить)

**Interfaces — Produces:**
- `erp_chat_send(…, p_task_id uuid default null)` — пересоздание с новым параметром (старая подпись удаляется в той же миграции; применение — владельцем в SQL Editor): при `p_task_id` тред — задачи (`order_id` = заказ задачи), упоминания фильтруются до участников задачи (постановщик, ответственный, наблюдатели), уведомление — только `task_mention` упомянутым; `chat_message`/`chat_reply` по подписке сделки не пишутся.
- `erp_chat_page`, `erp_chat_unread_many`, `erp_chat_mark_seen` — `p_task_id uuid default null` тем же способом.
- `erp_chat_delete`: если сообщение — `result_message_id` задачи, текст затирается как обычно, а `result_text` и событие остаются (Review Focus 5).
- `erp_biz_task_reminders_run()` (EXECUTE только `service_role`): `due_soon` — статусы `new|in_progress|paused`, `due_at − now() ≤ 24 h`, `created_at < due_at − 24 h`; `overdue` — те же статусы, `due_at < now()`; адресаты overdue — ответственный, постановщик, менеджер заказа; `review`/`done`/`cancelled` пропускаются; запись через уникальный индекс событий (`on conflict do nothing`) — ровно один раз на срок.
- `cron.schedule('erp-biz-task-reminders', '*/15 * * * *', 'select public.erp_biz_task_reminders_run()')`.

- [ ] **Step 1: Failing test:** `bizTasksChat.test.ts`: `it('упоминания в треде задачи фильтруются по участникам')`, `it('сообщение задачи не пишет chat_message')`, `it('напоминания: только активные статусы и уникальный ключ срока')`, `it('удаление сообщения-результата не трогает result_text')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция. **Step 4:** проба: два вызова `reminders_run` подряд → по одному `due_soon`/`overdue`; перенос срока → новый `overdue` возможен; упоминание не-участника — отброшено.
- [ ] **Step 5:** `npx vitest run src/erp/utils/bizTasksChat.test.ts src/erp/utils/chatServer.test.ts` — PASS. `npm run erp:freeze`; commit `feat(erp-db): диалог задачи и напоминания по сроку`.

---

### Task 4: Клиент — типы, права, модель, стор

**Files:**
- Create: `pinhead-react/src/erp/utils/bizTasks.ts` — константы и чистая модель
- Create: `pinhead-react/src/erp/store/slices/bizTasksSlice.ts` — доменный слайс (в `store/domainSlices.ts` + `domainState.ts`)
- Modify: `pinhead-react/src/erp/types.ts` (`ErpBizTask`, `ErpBizTaskEvent`, `ErpBizTaskChecklistItem`, `ErpNotificationKind`, `ErpAttachmentKind`, `ERP_PERMISSION_LABELS['biz_task.manage'] = 'Управлять бизнес-задачами'`), `permissionKeys.ts`, `utils/permissions.ts` (`DEFAULT_PERMISSIONS`, явные исключения у dispatcher/production_head), `store/slices/realtimeSlice.ts:50-88` (`erp_biz_tasks`, `erp_biz_task_events` → `schedulePing`)
- Modify: `pinhead-react/src/utils/date.ts` — `factoryDateTimeToIso(local: string): string`, `isoToFactoryInput(iso: string): string`
- Test: `utils/bizTasks.test.ts`, `store/slices/bizTasksSlice.test.ts`, `store/realtimeCoverage.test.ts`, `utils/permissionsCoverage.test.ts`, `src/utils/date.test.ts`

**Interfaces — Produces:**
- `BIZ_TASK_KINDS`, `BIZ_TASK_STATUSES`, `BIZ_TASK_KIND_LABELS`, `BIZ_TASK_STATUS_LABELS`, `BIZ_TASK_TRANSITIONS: Record<BizTaskAction, { from: BizTaskStatus[]; to: BizTaskStatus; who: 'assignee' | 'creator'; text: 'reason' | 'result' | 'fix' | null }>`
- `bizTaskRoleOf(task, userId, watchers): 'creator' | 'assignee' | 'watcher' | 'none'` (несколько ролей → массив `BizTaskRole[]`)
- `bizTaskActions(task, roles: BizTaskRole[], canManage: boolean): BizTaskAction[]`
- `isOverdue(task, now: Date): boolean` — `new|in_progress|paused` и `due_at < now`; `review` — по `submitted_at > due_at`; `done` — нет
- `kindHints(kind): string[]` — подсказки описания (доставка: «Откуда», «Куда», «Контакт», «Груз», «Время»; закупка: «Материал», «Количество», «Единица», «Поставщик», «Нужная дата»)
- Стор: `loadBizTasks(filter: BizTaskFilter)`, `loadOrderBizTasks(orderId)`, `loadBizTask(id)`, `createBizTask(input, clientKey)`, `bizTaskTransition(id, action, text)`, `updateBizTask(id, patch)`, `setBizTaskResult(id, text, messageId)`, `bizTaskChecklist(id, op, item)`, `markBizTaskSeen(id)` — каждый: `toast.error` + `null` при ошибке, без оптимистики, ответ кладётся целиком.

- [ ] **Step 1: Failing tests:** `bizTasks.test.ts`: `it('наблюдатель не получает complete/change_due/assignee')`, `it('постановщик-он-же-ответственный видит действия обеих ролей')`, `it('review_required: complete заменён submit')`, `it('isOverdue: сдано до срока, проверено после — не просрочена')`, `it('isOverdue: возврат после срока — просрочена')` (Review Focus 2), `it('BIZ_TASK_TRANSITIONS — 9 действий из таблицы')`; `date.test.ts`: `factoryDateTimeToIso('2026-10-20T18:00') === '2026-10-20T15:00:00.000Z'`; слайс: `it('createBizTask передаёт clientKey и не дублирует при повторе')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/utils/bizTasks.test.ts src/erp/store src/utils/date.test.ts src/erp/utils/permissionsCoverage.test.ts src/erp/utils/serverPermissions.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): модель и стор бизнес-задач`.

---

### Task 5: Вкладка «Бизнес-задачи» в заказе + форма создания

**Files:**
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskList.jsx` (+ `.module.css`) — общий список (используется и в разделе)
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskCreateForm.jsx` (+ `.module.css`) — раскрывается по «Создать задачу»; обязательные поля сверху, «Описание», «Наблюдатели», «Файлы», «Чек-лист», «Проверка постановщиком» — раскрывающиеся; выбор людей — `MentionPicker` на `erp_chat_directory()`; файлы — `useAttachmentUploads('biz_task')` (пачка, 30 МБ)
- Create: `pinhead-react/src/erp/screens/orderCard/OrderBizTasksTab.jsx` — счётчики «Открытые / Просроченные / Завершённые», фильтр завершённых и отменённых
- Modify: `pinhead-react/src/erp/screens/OrderCard.jsx:145-176, 330-437` — вкладка `tasks` (ленивая), счётчик открытых в названии
- Test: `screens/bizTasks/BizTaskCreateForm.test.jsx`, `screens/orderCard/OrderBizTasksTab.test.jsx`

- [ ] **Step 1: Failing tests:** `it('без названия/типа/ответственного/срока — «Создать» aria-disabled с перечнем')`; `it('заказ подставлен и не меняется во вкладке заказа')`; `it('тип «Доставка» показывает подсказки «Откуда, Куда…»')`; `it('двойной клик «Создать» — один вызов')` (Review Focus 3); `it('строка: название, тип, ответственный, срок, статус, «Просрочена», непрочитанные')`; `it('счётчики открытых, просроченных, завершённых')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/bizTasks src/erp/screens/orderCard src/erp/screens/OrderCard.test.jsx` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): вкладка бизнес-задач в заказе и форма создания`.

---

### Task 6: Общий раздел «Бизнес-задачи»

**Files:**
- Create: `pinhead-react/src/erp/screens/BizTasksScreen.jsx` — вкладки «Мне», «Поставленные мной», «Наблюдаю» (по умолчанию — активные, где я ответственный); колонки + «Заказ», «Постановщик»; поиск по названию и номеру заказа; фильтры тип / ответственный / статус / срок / «есть непрочитанные» — в адресе (`?tab=&q=&kind=&…`); создание с выбором заказа
- Modify: `pinhead-react/src/erp/ErpApp.jsx:28-51,142-207` — `lazyScreen` + маршруты `/biz-tasks`, `/biz-tasks/:taskId`
- Modify: `pinhead-react/src/erp/layout/Sidebar.jsx:19-78` — пункт «Бизнес-задачи» в «Операции»
- Create: `pinhead-react/src/erp/hooks/useListScroll.js` — `useListScroll(key: string)`: сохранить/вернуть позицию прокрутки в `sessionStorage` (try/catch)
- Modify: `scripts/bundle-baseline.json` (перезапись), `src/orderstudio/design/README.md` (причина)
- Test: `screens/BizTasksScreen.test.jsx`, `hooks/useListScroll.test.js`, `layout/shellStatic.test.ts`

- [ ] **Step 1: Failing tests:** `it('по умолчанию — активные, где я ответственный')`; `it('фильтры в адресе переживают переход в карточку и назад')`; `it('поиск по номеру PH-1234')`; `useListScroll`: `it('возвращает позицию после размонтирования')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/BizTasksScreen.test.jsx src/erp/hooks src/erp/layout` && `npm run build && npm run bundle:budget` — PASS после `--write-baseline`.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): общий раздел бизнес-задач`.

---

### Task 7: Карточка задачи — действия, чек-лист, результат, срок, история, файлы

**Files:**
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskCard.jsx` (+ `.module.css`) — слева: «← Заказ PH-…», название, статус + «Просрочена», ответственный, срок, постановщик, наблюдатели, описание, чек-лист, блок «Результат», кнопки по `bizTaskActions`; справа — диалог (Task 8); ≤ 760 px — вкладки «Задача» / «Обсуждение»; вкладки «История», «Файлы»
- Create: `bizTasks/BizTaskActionDialog.jsx` — причина / результат / что исправить (обязательный текст), предупреждение о невыполненных пунктах чек-листа перед завершением
- Create: `bizTasks/BizTaskDueDialog.jsx` — новый срок + причина
- Create: `bizTasks/BizTaskHistory.jsx`, `bizTasks/BizTaskFiles.jsx` (файлы описания, диалога и результата: автор, время, ссылка на сообщение)
- Test: `screens/bizTasks/BizTaskCard.test.jsx`, `BizTaskActionDialog.test.jsx`

- [ ] **Step 1: Failing tests:** `it('ответственный в «Новая» видит «Взять в работу»; открытие карточки зовёт markBizTaskSeen и не меняет статус')`; `it('«Приостановить» требует причину')`; `it('при проверке постановщиком — «Сдать на проверку», у постановщика «Принять» / «Вернуть в работу»')`; `it('завершение с невыполненным пунктом — предупреждение')`; `it('наблюдатель не видит «Завершить», «Перенести срок», «Сменить ответственного»')`; `it('перенос срока пишет прежний и новый срок с причиной в историю')`; `it('ссылка на заказ ведёт в /orders/:id?tab=tasks')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/bizTasks` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): карточка бизнес-задачи`.

---

### Task 8: Диалог в карточке

**Files:**
- Modify: `pinhead-react/src/erp/store/slices/chatSlice.ts` — якорь `{ orderId } | { taskId }` во всех вызовах (`openChat`, `refreshChat`, `sendChatMessage`, `markSeen`, `unread`)
- Modify: `pinhead-react/src/erp/components/chat/ChatPanel.jsx:35`, `ChatComposer.jsx`, `ChatMessage.jsx` — проп `taskId`; упоминания — участники задачи; кнопка «Отметить как результат» у своих сообщений ответственного; разделение по датам и граница «Новые» (существующие `chatFeed`)
- Modify: `pinhead-react/src/erp/utils/chatContext.ts` — ключ черновика «человек × задача»
- Test: `components/chat/ChatPanel.test.jsx`, `store/slices/chatSlice.test.ts`

- [ ] **Step 1: Failing tests:** `it('тред задачи не смешивается с чатом сделки')`; `it('повторная отправка после ошибки — тот же clientKey, текст не теряется')` (Review Focus 3); `it('открытие списка задач не отмечает диалог прочитанным')`; `it('в упоминаниях только участники задачи')`; `it('«Отметить как результат» зовёт setBizTaskResult')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/components/chat src/erp/store` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): диалог внутри бизнес-задачи`.

---

### Task 9: Уведомления, менеджер заказа, предупреждение при закрытии

**Files:**
- Modify: `pinhead-react/src/erp/layout/NotificationCenter.jsx:50-51,193` — новые виды, переход по `link` (`/biz-tasks/<id>` или `#m-<messageId>`)
- Modify: `pinhead-react/src/erp/screens/OrderCard.jsx:259-262` — выбор «Менеджер заказа (сотрудник)» → `manager_id` (право `order.manage`)
- Modify: `pinhead-react/src/orderstudio/bridge/…` — **нет**: заполнение `manager_id` при запуске идёт серверной веткой в `erp_create_order` (T1) из `orders.created_by` по `tz_order_id`
- Modify: `pinhead-react/src/erp/screens/OrdersScreen.jsx:413-429`, `screens/warehouse/PackShipCard.jsx:88` — перед отгрузкой: «Открытые бизнес-задачи: N» + список; отгрузка не блокируется
- Test: `layout/NotificationCenter.test.jsx`, `screens/OrdersScreen.test.jsx`, `screens/warehouse/PackShipCard.test.jsx`

- [ ] **Step 1: Failing tests:** `it('уведомление task_overdue открывает карточку задачи')`; `it('отгрузка заказа с открытыми задачами показывает их список и продолжается по «Отгрузить»')`; `it('без открытых задач — прежний текст подтверждения')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/layout src/erp/screens/OrdersScreen.test.jsx src/erp/screens/warehouse` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): уведомления задач и предупреждение при закрытии заказа`.

---

### Task 10: Проверка, e2e, документы, выкатка

**Files:**
- Create: `pinhead-react/e2e/erp-biz-tasks.spec.ts` (моки RPC): создание из заказа → взять в работу → сообщение с @ → сдать на проверку → вернуть → принять; телефон 375 px — вкладки «Задача» / «Обсуждение»
- Modify: `e2e/erp-axe.spec.ts` (+ `/biz-tasks`, карточка), визуальные эталоны `erp-biz-tasks-*`
- Modify: `CLAUDE.md` (таблица маршрутов ERP, схема, правило «задачи пишут только RPC»), `pinhead-react/CLAUDE.md`, `docs/rules/pravila-biznes-zadach-19-10.md` + `INDEX.md`, `docs/rules/react/INDEX.md`, `docs/DESIGN.md`, `docs/changelog/2026-10.md`, `SESSION-STATE.md`
- Create: `supabase/rollout/r1910b/README.md` — T1 → T2 → T3 (SQL Editor владельцем, сухой прогон), проверка `cron.job`, потом фронт; откат — фронт, затем `…_rollback.sql` (снять cron, прежние тела `erp_chat_*`; таблицы не удалять — данные)

- [ ] **Step 1:** `npm run lint && npm run typecheck && npx vitest run --maxWorkers=3` — зелёное.
- [ ] **Step 2:** `npm run build && npm run bundle:budget` — PASS.
- [ ] **Step 3:** `npx playwright test e2e/erp-biz-tasks.spec.ts e2e/erp-axe.spec.ts` — PASS.
- [ ] **Step 4:** обход `pinhead-qa`: менеджер (ставит задачу на доставку), снабженец (ответственный, приостановка «ждём поставщика»), директор (наблюдатель, попытка завершить), постановщик (проверка, возврат).
- [ ] **Step 5:** документы; commit `docs: правки 19.10 — бизнес-задачи`; push.
