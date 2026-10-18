# Правки 19.10, часть B — «Бизнес-задачи» к заказам (п. 7) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** поручения по заказу (доставка, закупка, другое) с ответственным, сроком, статусами, наблюдателями, чек-листом, результатом, своим диалогом, файлами, историей и уведомлениями — во вкладке заказа и в общем разделе.

**Architecture:** новые таблицы `erp_biz_task*`; клиент только читает (RLS SELECT), пишут только `security definer` RPC — событие истории и уведомления одной транзакцией с изменением. Диалог — тред существующего чата ERP с якорем `task_id` и **`order_id = null`** (тред задачи не попадает ни в один поиск треда сделки; заказ — через `erp_biz_tasks`). Файлы — `erp_order_attachments` (вид `biz_task`, колонка `task_id`), пишутся только RPC. Напоминания — `pg_cron` по образцу `erp_overdue_requests_run`. Экраны — ленивые чанки.

**Tech Stack:** React 19 + Zustand 5 (доменный слайс), Supabase (plpgsql, RLS, pg_cron, realtime-«звонок»), Vitest, Playwright.

**Spec:** снимок `docs/erp/2026-10-19-pravki-19-10.md` (часть A, Task 0), раздел 7.

## Global Constraints

- **Старт только после выкатки части A:** миграции A применены и в `APPLIED.json` (иначе > 5 неприменённых), лимит 30 МБ на бою.
- ERP заморожен: «да» владельца → правки → `npm run erp:freeze && npx vitest run src/orderstudio/erpFrozen.test.ts` в коммите задачи.
- **Бюджет оболочки ERP:** жёсткий потолок `shellJs 195 000` Б gzip, запас ~200 Б; `--write-baseline` потолок не поднимает. Маршрут, пункт меню, права и подписка realtime растят оболочку — см. Р6.
- Применение миграций — владелец в SQL Editor (сухой прогон с пробой → применение → `notify pgrst, 'reload schema'`); контроллер — SELECT и `APPLIED.json`.
- Типы — ровно «Доставка», «Закупка», «Другое» (`delivery|purchase|other`); статусы — «Новая», «В работе», «Приостановлена», «На проверке», «Завершена», «Отменена» (`new|in_progress|paused|review|done|cancelled`); «Просрочена» — бейдж рядом со статусом (иконка + текст, входит в доступное имя строки).
- Обязательные поля: название, заказ, тип, один ответственный, срок (дата + время, «до 20.10, 18:00 МСК»). Необязательные (свёрнуты): описание, наблюдатели, файлы, чек-лист, «Проверка постановщиком» (по умолчанию выкл.).
- Пояс — `Europe/Moscow`; срок — `timestamptz`.
- Удаления задачи нет — только «Отменить задачу» с причиной. Удалённое сообщение — отметка «Сообщение удалено».
- Внешние каналы, подзадачи, повторы, учёт времени, внешние участники, автоматические задачи и блокировки маршрута/закрытия — вне объёма.
- Маршруты — `/biz-tasks`, `/biz-tasks/:taskId` (`/task/:stageId` занят); вкладка заказа — `?tab=tasks`.
- Realtime — только «звонок» в существующем канале; второго канала нет.
- Ратчет размера: `OrdersScreen.jsx` 793/793, `realtimeSlice.ts` 498/500, `OrderCard.jsx` — сверить; новый код — в новые модули.
- Каждая новая функция миграции — `revoke execute … from public, anon, authenticated`; `grant … to authenticated` — только писателям из белого списка (сторож); служебные помощники и `reminders_run` — никому / `service_role`.

## Review Focus

1. **Человек в нескольких ролях** (постановщик = менеджер заказа = наблюдатель): одно уведомление на событие, одна запись в участниках — Task 2 (проба), Task 4.
2. **Возврат в работу после истёкшего срока; сдача до срока, проверка после:** «Просрочена» по `submitted_at`, после возврата горит снова; повторного уведомления «просрочена» нет до переноса срока — Task 3 (проба), Task 4 (`isOverdue`).
3. **Повторная отправка сообщения / двойной клик «Создать задачу»:** один ряд (`client_key`) — Task 2, Task 5, Task 8.
4. **Наблюдатель или посторонний пробует завершить, сменить срок/ответственного, написать в тред, подкинуть файл** прямым вызовом: `42501` — Task 2, Task 3 (пробы).
5. **Удаление сообщения, отмеченного результатом:** результат остаётся в блоке «Результат» и в истории — Task 3.

---

## Решения «за владельца» (подтвердить при одобрении)

- **Р1. Видимость.** Читать задачи и их диалог может любой, кто проходит `erp_is_member()`. **Внимание: это любой активный одобренный профиль — включая продажи и дизайнеров**, как сейчас у заказов и чата сделки. Писать в тред — только участники задачи и `biz_task.manage`. Экономика и файлы заказа задачей не открываются. *Альтернатива — читать только участникам и `biz_task.manage` (строже, но задача пропадёт у остальных цехов).*
- **Р2. Право `biz_task.manage`** — роли ERP admin, director, production_head, manager — **только по должности из `erp_employees`**, не по запасной роли профиля (иначе любой менеджер продаж управляет всеми задачами завода). Создавать задачу может любой сотрудник ERP с записью в `erp_employees`; менять чужую — постановщик или `biz_task.manage`.
- **Р3. Менеджер заказа** — новая колонка `erp_orders.manager_id uuid → profiles on delete set null`. Заполняется: при подлинном запуске из «Оформления заказа» — автором заказа v4 (только если `orders.erp_order_id = new.id` и метка запуска свежая); вручную в карточке — `order.manage`, только сотрудником ERP. Пока пусто — менеджер не наблюдатель и не получатель.
- **Р4. Сообщения задачи не создают уведомлений** (в т. ч. ответ на ваше сообщение) — только счётчик непрочитанного; адресное уведомление — при @упоминании.
- **Р5. Напоминания** — `pg_cron` раз в 15 минут; точность до 15 минут.
- **Р6. Бюджет оболочки:** поднять потолок `shellJs` до `196 000` Б решением вслух (запись в `scripts/bundle-budget-limits.mjs` и причина в `src/orderstudio/design/README.md`), рост — ≤ 1 000 Б; иначе раздел придётся открывать только из карточки заказа.
- **Р7. Файлы задач** лежат в публичном бакете `erp-attachments` (как все файлы ERP): кто знает ссылку — открывает, в т. ч. уволенный. Квот на пользователя нет. Отдельный приватный бакет — не в этой версии.
- **Р8. Лимиты от злоупотреблений:** наблюдателей ≤ 20, пунктов чек-листа ≤ 100, задач ≤ 30 в час на постановщика; у заказа в статусе `done*`/`cancelled` новые задачи не создаются.

---

### Task 1: Схема (миграция T1) + константы клиента

**Files:**
- Create: `supabase/migrations/20261020090000_erp_biz_tasks_schema.sql`
- Create: `pinhead-react/src/erp/utils/bizTasks.ts` — только константы и типы (модель — Task 4)
- Modify: `pinhead-react/src/erp/types.ts` (`ErpBizTask`, `ErpBizTaskEvent`, `ErpBizTaskChecklistItem`, `ErpNotificationKind`, `ErpAttachmentKind` + `'biz_task'`, `ERP_PERMISSION_LABELS['biz_task.manage'] = 'Управлять бизнес-задачами'`), `permissionKeys.ts`, `utils/permissions.ts` (`DEFAULT_PERMISSIONS` + явные исключения у dispatcher/production_head)
- Modify: `supabase/migrations/FK_SNAPSHOT.md`, `src/erp/utils/guardSetNull.test.ts` (ветка «родитель удалён» для `manager_id`)
- Test: `utils/bizTasksSchema.test.ts`, `utils/notificationsGuard.test.ts`, `utils/attachmentKinds.test.ts`, `utils/permissionsCoverage.test.ts`, `utils/serverPermissions.test.ts`, `store/realtimeCoverage.test.ts`

**Interfaces — Produces:**
- `BIZ_TASK_KINDS`, `BIZ_TASK_STATUSES`, `BIZ_TASK_KIND_LABELS`, `BIZ_TASK_STATUS_LABELS`, `type BizTaskAction = 'start'|'pause'|'resume'|'submit'|'complete'|'accept'|'return'|'cancel'|'reopen'`, `BIZ_TASK_TRANSITIONS: Record<BizTaskAction, { from: BizTaskStatus[]; to: BizTaskStatus; who: 'assignee'|'creator'; text: 'reason'|'result'|'fix'|null }>` (таблица Task 2).
- Таблицы:
  - `erp_biz_tasks`: `id`, `order_id → erp_orders on delete cascade`, `title (1..200)`, `kind`, `description (≤ 10000)`, `assignee_id → profiles`, `creator_id → profiles`, `due_at timestamptz`, `status default 'new'`, `review_required bool default false`, `pause_reason`, `cancel_reason`, `return_reason`, `result_text`, `result_message_id → erp_chat_messages on delete set null`, `submitted_at`, `reviewed_at`, `completed_at`, `cancelled_at`, `client_key uuid unique`, `created_at`, `updated_at`; индексы `(order_id)`, `(assignee_id, status)`, `(creator_id, status)`, `(status, due_at)`.
  - `erp_biz_task_watchers (task_id → cascade, user_id → profiles, added_by, added_at, pk)`.
  - `erp_biz_task_checklist (id, task_id → cascade, text (1..500), done, sort, done_by, done_at)`.
  - `erp_biz_task_events (id bigint identity, task_id → cascade, kind check in (created, started, paused, resumed, submitted, accepted, returned, completed, cancelled, reopened, assignee_changed, due_changed, watchers_changed, edited, result_changed, checklist_changed, due_soon, overdue), actor uuid null, payload jsonb, due_at timestamptz null, at)`; уникальный `(task_id, kind, due_at) where kind in ('due_soon','overdue')`.
  - `erp_biz_task_seen (task_id, user_id, first_seen_at, pk)`.
  - `erp_orders.manager_id uuid null → profiles on delete set null`; классификация в `erp_order_guard` (`order.manage`) + ветка «родитель удалён».
  - `erp_create_order` — полное тело из `20260907203932_erp_garment_source.sql` (последняя редакция — сверить `latestDefining`) + заполнение `manager_id` по Р3; `erp_orders` AFTER-ветка не нужна.
  - `erp_chat_threads.task_id uuid null → erp_biz_tasks on delete cascade`; CHECK `erp_chat_thread_anchor` — ровно один из `order_id`/`experimental_id`/`task_id`; частичный уникальный `(task_id) where task_id is not null`; прежний `erp_chat_thread_order_uniq` не меняется (у треда задачи `order_id` null).
  - `erp_order_attachments.task_id uuid null → erp_biz_tasks on delete cascade`; вид `'biz_task'` в CHECK; классификация в `erp_attachment_guard`; RESTRICTIVE INSERT-политика: прямая вставка `kind = 'biz_task'` или `task_id is not null` запрещена (пишет только RPC).
  - `erp_notifications`: `task_id uuid null → cascade`, `task_event_id bigint null`, уникальный `(user_id, task_event_id) where task_event_id is not null`; CHECK `kind` (форма `check (kind in (`) + `task_assigned`, `task_unassigned`, `task_status`, `task_review`, `task_returned`, `task_due_soon`, `task_overdue`, `task_mention`.
  - RLS новых таблиц: только `select` для `(select public.erp_is_member())`; записи нет; `revoke all … from public, anon; grant select … to authenticated`.
  - `alter publication supabase_realtime add table erp_biz_tasks, erp_biz_task_events`.
  - Право: `insert into erp_role_permissions … ('admin'|'director'|'production_head'|'manager', 'biz_task.manage', true) on conflict do nothing`.
- `realtimeSlice`: `erp_biz_task_watchers`, `_checklist`, `_seen` — в `NO_REALTIME` с причиной («меняются только вместе с событием задачи»).

- [ ] **Step 1: Failing tests:** `bizTasksSchema.test.ts`: `it('у новых таблиц ровно одна политика select и нет политик записи')`; `it('CHECK статусов/типов = BIZ_TASK_STATUSES/BIZ_TASK_KINDS')`; `it('якорь треда — ровно один из трёх')`; `it('прямая вставка biz_task запрещена restrictive-политикой')`; `it('publication содержит erp_biz_tasks и erp_biz_task_events')`; `it('erp_create_order берёт manager_id только при подлинном запуске')`. `notificationsGuard.test.ts` (уже сверяет CHECK с `ErpNotificationKind`) — расширить.
- [ ] **Step 2:** FAIL. **Step 3:** миграция + константы, типы, права.
- [ ] **Step 4:** проба: прямой `insert` в любую новую таблицу → отказ; прямая вставка вложения `biz_task` → отказ; запуск v4 → `manager_id = created_by`; заказ из ERP → `null`; подставной `tz_order_id` → `null`; `pg_publication_tables` по двум таблицам = 2; регресс `order_v4_launch.sql` зелёный. `npx vitest run src/erp/utils/bizTasksSchema.test.ts src/erp/utils/notificationsGuard.test.ts src/erp/utils/attachmentKinds.test.ts src/erp/utils/guardSetNull.test.ts src/erp/utils/permissionsCoverage.test.ts src/erp/utils/serverPermissions.test.ts src/erp/utils/rpcContract.test.ts src/erp/store/realtimeCoverage.test.ts` — PASS (гейт `can('biz_task.manage')` для `permissionsCoverage` — в `bizTasks.ts`, функция `canManageBizTasks`).
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp-db): схема бизнес-задач`.

---

### Task 2: Писатели задачи (миграция T2)

**Files:**
- Create: `supabase/migrations/20261020100000_erp_biz_tasks_rpc.sql`
- Create: `supabase/probes/erp_biz_tasks.sql` + генератор матрицы `supabase/probes/gen-biz-task-matrix.mjs` (из `BIZ_TASK_TRANSITIONS`)
- Test: `pinhead-react/src/erp/utils/bizTasksRpc.test.ts` (node)

**Interfaces — Produces** (все `security definer`, `set search_path = public`; проверка `erp_is_member()` и записи в `erp_employees` у вызывающего; ответ — строка задачи с `updated_at`):
- Помощник `erp_profile_is_staff(p_user uuid) returns boolean` — active, approved, есть `erp_employees`; проверяет `assignee_id`, наблюдателей, `manager_id`. EXECUTE — никому.
- `erp_biz_task_create(p_task jsonb, p_client_key uuid)` — белый список ключей `order_id, title, kind, description, assignee_id, due_at, review_required, watchers, checklist`; прочие (`creator_id`, `status`, `id`, `result_*`…) → `22023`; `creator_id = auth.uid()`; заказ не `done*`/`cancelled`; лимиты Р8; наблюдатели = переданные ∪ `manager_id` минус постановщик и ответственный, `distinct`; повтор `client_key` → прежняя строка; `task_assigned` ответственному (если не сам).
- `erp_biz_task_transition(p_id uuid, p_action text, p_text text, p_expected_updated_at timestamptz)`:

  | action | из | в | кто | текст |
  |---|---|---|---|---|
  | `start` | new | in_progress | ответственный | — |
  | `pause` | in_progress | paused | ответственный | причина |
  | `resume` | paused | in_progress | ответственный | — |
  | `submit` | in_progress | review (только `review_required`) | ответственный | результат; `submitted_at` |
  | `complete` | in_progress | done (только без проверки) | ответственный | результат; `completed_at` |
  | `accept` | review | done | постановщик / manage | — |
  | `return` | review, done | in_progress | постановщик / manage | что исправить |
  | `cancel` | new, in_progress, paused, review | cancelled | постановщик / manage | причина |
  | `reopen` | cancelled | in_progress | постановщик / manage | комментарий |

  Неверный переход → `22023`; чужая роль → `42501`; устаревшая версия → `P0001` «Задача изменена — обновите карточку». Уведомления: start/pause/submit/complete/cancel → постановщику и менеджеру (кроме автора); submit → `task_review` постановщику; return → `task_returned` ответственному.
- `erp_biz_task_update(p_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)` — белый список `title, description, kind, assignee_id, due_at, due_reason, watchers`; постановщик / manage; не у `done`/`cancelled` (кроме `watchers`); смена ответственного → `task_assigned` новому, `task_unassigned` прежнему, `task_status` постановщику; `due_changed` `{from, to, reason}` (причина обязательна).
- `erp_biz_task_set_result(p_id uuid, p_text text, p_message_id uuid)` — ответственный в `in_progress`/`review`; сообщение: тред этой задачи, автор — ответственный, не удалено; копия в `result_text`, событие `result_changed`.
- `erp_biz_task_checklist_op(p_id uuid, p_op text, p_item jsonb)` — `add|toggle|remove|rename`; пункт обязан принадлежать `p_id`; add/remove/rename — постановщик / manage; toggle — ответственный, постановщик, manage.
- `erp_biz_task_attach(p_id uuid, p_files jsonb)` — участник / manage; каждый `file_path` — объект `storage.objects` бакета `erp-attachments` с `owner = auth.uid()` и префиксом `att/<order_id>/biz_task/`; вставка `erp_order_attachments(kind 'biz_task', task_id, order_id задачи)`.
- `erp_biz_task_mark_seen(p_id uuid)` — upsert `first_seen_at`, статус не трогает.
- `erp_biz_task_counts(p_order_id uuid) returns table(open int, overdue int, done int)` (invoker).
- Адресаты любого события — `select distinct`, без автора, только `erp_profile_is_staff`.

- [ ] **Step 1: Failing test** `bizTasksRpc.test.ts`: `it('писатели — definer, revoke у public/anon/authenticated, grant — только белому списку')`; `it('матрица пробы совпадает с BIZ_TASK_TRANSITIONS')` (генератор — паритет по образцу `FLATS_CASES` в `catalogKeys.test.ts`); `it('белый список ключей create/update')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция.
- [ ] **Step 4:** проба (три человека + профиль `manager` без `erp_employees` + продавец): матрица (action × from × роль) — разрешено/`22023`/`42501`; двойной `create` с одним `client_key` → одна задача; постановщик = менеджер → одно уведомление; наблюдатель `complete`/`update due_at`/`assignee` → `42501`; профиль manager без `erp_employees` → `cancel` чужой → `42501`; `create` с `creator_id` другого → `22023`; ответственный — неактивный профиль → `22023`; `toggle` пункта чужой задачи → `22023`; `attach` чужого пути → `42501`; 31-я задача за час → `22023`; задача у сданного заказа → `22023`. `PROBE_RESULT total=N fails=0`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/bizTasksRpc.test.ts src/erp/utils/rpcContract.test.ts` — PASS; мутация (снять проверку роли у `complete`) → проба красная → вернуть. `npm run erp:freeze`; commit `feat(erp-db): писатели бизнес-задач — статусы, участники, уведомления`.

---

### Task 3: Диалог задачи и напоминания (миграция T3)

**Files:**
- Create: `supabase/migrations/20261020110000_erp_biz_tasks_chat_cron.sql` + `_rollback.sql` (новые тела без ветки задач — не дословно старые; `cron.unschedule` в `exists`)
- Test: `pinhead-react/src/erp/utils/bizTasksChat.test.ts`, `utils/chatServer.test.ts`, `utils/chatNotifyRead.test.ts`

**Interfaces — Produces:**
- `erp_chat_send(…, p_task_id uuid default null)` — в одной транзакции миграции: `drop function` старой 9-аргументной подписи (`20261001190924:93`), `create`, `revoke`/`grant`, `notify pgrst, 'reload schema'`. При `p_task_id`: `p_order_id` должен быть `null`, иначе `22023`; автор — участник или manage (иначе `42501`); тред — задачи; `p_item_id`/`p_stage_id` — против заказа задачи; упоминания — только участники; вложения — только свои объекты с префиксом `att/<order>/chat/`; уведомление — только `task_mention`.
- `erp_chat_page(…, p_task_id uuid default null)` — то же пересоздание; ветка задачи.
- `erp_chat_unread_tasks(p_task_ids uuid[]) returns table(task_id uuid, unread int)` — новая функция (сделочную `erp_chat_unread_many` не трогаем).
- `erp_chat_edit` — фильтр упоминаний по участникам для треда задачи.
- `erp_chat_delete` — сообщение-результат: текст затирается, `result_text` и событие остаются.
- `erp_chat_mark_seen(p_message_ids)` — без изменений (ключ — сообщения).
- `erp_biz_task_reminders_run()` — EXECUTE только `service_role`; `due_soon`: статусы `new|in_progress|paused`, `due_at − now() ≤ 24 h`, `created_at < due_at − 24 h`; `overdue`: те же статусы, `due_at < now()`, адресаты — ответственный, постановщик, менеджер; запись через уникальный индекс событий (`on conflict do nothing`).
- `cron`: `if exists (select 1 from cron.job where jobname = 'erp-biz-task-reminders') then perform cron.unschedule(…)`, затем `cron.schedule('erp-biz-task-reminders', '*/15 * * * *', 'select public.erp_biz_task_reminders_run()')`.

- [ ] **Step 1: Failing tests:** `bizTasksChat.test.ts`: `it('ветка задачи требует p_order_id null и участника')`; `it('упоминания треда задачи — участники')`; `it('сообщение задачи не пишет chat_message/chat_reply')`; `it('reminders_run: только service_role, активные статусы, ключ срока')`; `it('delete сообщения-результата не трогает result_text')`; `it('одна перегрузка erp_chat_send и erp_chat_page')`; `it('rollback-файл — тела без ветки задач')`.
- [ ] **Step 2:** FAIL. **Step 3:** миграция.
- [ ] **Step 4:** проба: старый вызов `erp_chat_send` с 9 именованными аргументами работает; постороннее сообщение в тред задачи → `42501`; `p_task_id` + чужой `p_order_id` → `22023`; упоминание не-участника отброшено; два `reminders_run` подряд → по одному `due_soon`/`overdue` (`due_at = now() ± interval`); после возврата просроченной задачи повторного `overdue` нет; перенос срока → новый `overdue` возможен; `reminders_run` от authenticated → `42501`.
- [ ] **Step 5:** `npx vitest run src/erp/utils/bizTasksChat.test.ts src/erp/utils/chatServer.test.ts src/erp/utils/chatNotifyRead.test.ts src/erp/utils/rpcContract.test.ts src/erp/store/realtimeCoverage.test.ts` — PASS; `database.generated.ts` перегенерировать. `npm run erp:freeze`; commit `feat(erp-db): диалог задачи и напоминания по сроку`.

---

### Task 4: Клиент — модель, стор, дата

**Files:**
- Modify: `pinhead-react/src/erp/utils/bizTasks.ts` — модель
- Create: `pinhead-react/src/erp/store/slices/bizTasksSlice.ts` (в `store/domainSlices.ts` + `domainState.ts`)
- Modify: `pinhead-react/src/erp/store/slices/realtimeSlice.ts:50-88` — `erp_biz_tasks`, `erp_biz_task_events` → `schedulePing` (ратчет 498/500: обработчик — одной строкой через общий хелпер)
- Modify: `pinhead-react/src/utils/date.ts` — `factoryDateTimeToIso(local: string): string`, `isoToFactoryInput(iso: string): string`, `formatDue(iso: string): string` → «до 20.10, 18:00 МСК»
- Test: `utils/bizTasks.test.ts`, `store/slices/bizTasksSlice.test.ts` (Create), `src/utils/date.test.ts`

**Interfaces — Produces:**
- `bizTaskRolesOf(task, userId, watchers): BizTaskRole[]` (`'creator'|'assignee'|'watcher'`)
- `bizTaskActions(task, roles: BizTaskRole[], canManage: boolean): BizTaskAction[]`
- `isOverdue(task, now: Date): boolean` — `new|in_progress|paused`: `due_at < now`; `review`/`done`: `submitted_at`/`completed_at` > `due_at`; `cancelled` — нет
- `kindHints(kind): string[]` — доставка: «Откуда», «Куда», «Контакт», «Груз», «Время»; закупка: «Материал», «Количество», «Единица», «Поставщик», «Нужная дата»
- `canManageBizTasks(can: (p: ErpPermission) => boolean): boolean`
- Стор: `loadBizTasks(filter: BizTaskFilter)`, `loadOrderBizTasks(orderId)`, `loadBizTask(id)`, `createBizTask(input, clientKey)`, `bizTaskTransition(id, action, text)`, `updateBizTask(id, patch)`, `setBizTaskResult(id, text, messageId)`, `bizTaskChecklistOp(id, op, item)`, `attachBizTaskFiles(id, files)`, `markBizTaskSeen(id)` — `toast.error` + `null`, без оптимистики, ответ кладётся целиком.

- [ ] **Step 1: Failing tests:** `bizTasks.test.ts`: `it('наблюдатель не получает complete/change_due/assignee')`; `it('постановщик-он-же-ответственный — действия обеих ролей')`; `it('review_required: complete заменён submit')`; `it('isOverdue: сдано до срока, проверено после — нет')`; `it('isOverdue: возврат после срока — да')`; `it('BIZ_TASK_TRANSITIONS — 9 действий')`. `date.test.ts`: `factoryDateTimeToIso('2026-10-20T18:00') === '2026-10-20T15:00:00.000Z'`, `formatDue(...) === 'до 20.10, 18:00 МСК'`. Слайс: `it('createBizTask передаёт clientKey, повтор не дублирует')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать.
- [ ] **Step 4:** `npx vitest run src/erp/utils/bizTasks.test.ts src/erp/store src/utils/date.test.ts src/fileSizeRatchet.test.ts` и `TZ=America/New_York npx vitest run src/utils/date.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): модель и стор бизнес-задач`.

---

### Task 5: Вкладка заказа + форма создания

**Files:**
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskList.jsx` (+ `.module.css`)
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskCreateForm.jsx` (+ `.module.css`) — выбор людей: `MentionPicker` на `erp_chat_directory()`; файлы — `useAttachmentUploads('biz_task')` → `attachBizTaskFiles`
- Create: `pinhead-react/src/erp/screens/orderCard/OrderBizTasksTab.jsx`
- Modify: `pinhead-react/src/erp/screens/OrderCard.jsx:145-176,330-437` — вкладка `tasks` (ленивая); подпись «Бизнес-задачи · 3», доступное имя «Бизнес-задачи, открытых: 3»
- Test: `screens/bizTasks/BizTaskCreateForm.test.jsx`, `BizTaskList.test.jsx`, `screens/orderCard/OrderBizTasksTab.test.jsx`

**Тексты:** кнопка «Создать задачу»; незаполнено — `aria-disabled` с причиной «Заполните: <только незаполненное>»; срок в прошлом — предупреждение «Срок уже прошёл» (не блок); после создания — toast «Задача создана», фокус на новую строку; пусто — «По заказу нет задач. Поручите доставку, закупку или другое дело.» + «Создать задачу».

- [ ] **Step 1: Failing tests:** `it('незаполненные поля — aria-disabled и перечень только незаполненного')`; `it('заказ подставлен и не меняется во вкладке заказа')`; `it('«Доставка» — подсказки «Откуда, Куда…»')`; `it('двойной клик «Создать задачу» — один вызов')`; `it('строка: название, тип, ответственный, срок, статус, «Просрочена» текстом, непрочитанные')`; `it('счётчики открытых, просроченных, завершённых; завершённые и отменённые — фильтром')`; `it('пустое состояние')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/bizTasks src/erp/screens/orderCard src/erp/screens/OrderCard.test.jsx src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): вкладка бизнес-задач в заказе и форма создания`.

---

### Task 6: Общий раздел «Бизнес-задачи»

**Files:**
- Create: `pinhead-react/src/erp/screens/BizTasksScreen.jsx` — вкладки «Мне» (по умолчанию: активные, где я ответственный), «Поставленные мной», «Наблюдаю»; колонки + «Заказ», «Постановщик»; поиск по названию и номеру; фильтры тип / ответственный / статус / срок / «есть непрочитанные» — в адресе; создание с выбором заказа
- Create: `pinhead-react/src/erp/hooks/useListScroll.js` — `useListScroll(key: string)` (sessionStorage в try/catch)
- Modify: `pinhead-react/src/erp/ErpApp.jsx:28-51,142-207` — `lazyScreen` + `/biz-tasks`, `/biz-tasks/:taskId`
- Modify: `pinhead-react/src/erp/layout/Sidebar.jsx:19-78` — «Бизнес-задачи» в «Операции»
- Modify: `scripts/bundle-budget-limits.mjs` (Р6), `scripts/bundle-baseline.json`, `src/orderstudio/design/README.md`
- Test: `screens/BizTasksScreen.test.jsx`, `hooks/useListScroll.test.js`, `layout/shellStatic.test.ts`

**Тексты пустых состояний:** «Вам ничего не поручено. Задачи, где вы ответственный, появятся здесь.»; фильтры — «Ничего не нашлось» + «Сбросить фильтры».

- [ ] **Step 1: Failing tests:** `it('по умолчанию — активные, где я ответственный')`; `it('фильтры в адресе переживают карточку и «назад»')`; `it('поиск по PH-1234')`; `useListScroll`: `it('возвращает позицию после размонтирования')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/BizTasksScreen.test.jsx src/erp/hooks src/erp/layout` && `npm run build && npm run bundle:budget` — PASS (рост оболочки ≤ 1 000 Б, записан).
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): общий раздел бизнес-задач`.

---

### Task 7: Карточка задачи

**Files:**
- Create: `pinhead-react/src/erp/screens/bizTasks/BizTaskCard.jsx` (+ `.module.css`) — слева: «← Заказ PH-…», название, статус + «Просрочена», ответственный, срок, постановщик, наблюдатели, описание, чек-лист, «Результат», кнопки по `bizTaskActions`; справа — диалог (Task 8); на компьютере «История» и «Файлы» — под левой колонкой; **≤ 760 px — один ряд вкладок «Задача · Обсуждение · История · Файлы»**, поле ввода сообщения закреплено
- Create: `bizTasks/BizTaskActionDialog.jsx`, `bizTasks/BizTaskDueDialog.jsx`, `bizTasks/BizTaskHistory.jsx` (системные события отделены от сообщений), `bizTasks/BizTaskFiles.jsx` (файлы описания, диалога и результата: автор, время, ссылка на сообщение)
- Test: `screens/bizTasks/BizTaskCard.test.jsx`, `BizTaskActionDialog.test.jsx`

**Тексты диалогов:** «Приостановить задачу?» / поле «Причина» / «Приостановить»; «Вернуть в работу?» / «Что исправить» / «Вернуть в работу»; «Отменить задачу?» / «Причина» / «Отменить задачу» / «Не отменять»; «Не выполнено 2 пункта чек-листа из 5. Завершить?» / «Завершить» / «Вернуться к чек-листу»; перенос — «Новый срок», «Причина переноса»; с проверкой — «Сдать на проверку», у постановщика — «Принять» / «Вернуть в работу».

- [ ] **Step 1: Failing tests:** `it('ответственный в «Новая» видит «Взять в работу»; открытие зовёт markBizTaskSeen, статус не меняется')`; `it('«Приостановить» требует причину')`; `it('проверка постановщиком: «Сдать на проверку», у постановщика «Принять»/«Вернуть в работу»')`; `it('завершение с невыполненными пунктами — предупреждение')`; `it('наблюдатель не видит «Завершить», «Перенести срок», «Сменить ответственного»')`; `it('перенос срока — прежний и новый срок с причиной в истории')`; `it('ссылка на заказ — /orders/:id?tab=tasks')`; `it('375 px — один ряд из четырёх вкладок')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/screens/bizTasks` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): карточка бизнес-задачи`.

---

### Task 8: Диалог в карточке

**Files:**
- Modify: `pinhead-react/src/erp/store/slices/chatSlice.ts` — якорь `{ orderId } | { taskId }` (`openChat`, `refreshChat`, `sendChatMessage`; непрочитанное задач — `erp_chat_unread_tasks`); обработчик realtime `erp_chat_messages` направляет «звонок» по `thread_id`
- Modify: `pinhead-react/src/erp/components/chat/ChatPanel.jsx:35`, `ChatComposer.jsx`, `ChatMessage.jsx` — проп `taskId`; упоминания — участники задачи; «Отметить как результат» у сообщений ответственного (status «Сообщение отмечено результатом»)
- Modify: `pinhead-react/src/erp/utils/chatContext.ts` — ключ черновика «человек × задача»
- Modify: `pinhead-react/e2e/support/mock/mockSupabase.ts:1261` + Create `e2e/support/mock/bizTasksRpc.ts`
- Test: `components/chat/ChatPanel.test.jsx`, `store/slices/chatSlice.test.ts` (Create)

- [ ] **Step 1: Failing tests:** `it('тред задачи не смешивается с чатом сделки и его счётчиком')`; `it('повтор после ошибки — тот же clientKey, текст не теряется')`; `it('открытие списка задач не отмечает диалог прочитанным')`; `it('в упоминаниях только участники')`; `it('«Отметить как результат» зовёт setBizTaskResult и объявляет status')`; `it('наблюдатель пишет, посторонний видит «Писать могут участники задачи»')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/components/chat src/erp/store` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): диалог внутри бизнес-задачи`.

---

### Task 9: Уведомления, менеджер заказа, предупреждение при отгрузке

**Files:**
- Modify: `pinhead-react/src/erp/layout/NotificationCenter.jsx:50-51,193` — новые виды; переход только по ссылке, начинающейся с `/`; незнакомый `kind` — показывается без падения
- Тексты (заморожены на сервере в `title`): «Вам поручена задача «…» · PH-1234», «До срока задачи «…» меньше 24 часов», «Задача «…» просрочена»
- Modify: `pinhead-react/src/erp/screens/OrderCard.jsx:259-262` — «Менеджер заказа (сотрудник)» → `manager_id` (`order.manage`)
- Create: `pinhead-react/src/erp/screens/useShipConfirm.js` (вынос из `OrdersScreen.jsx` — ратчет 793/793); Modify: `OrdersScreen.jsx:413-429`, `screens/warehouse/PackShipCard.jsx:88` — «Открытые бизнес-задачи: N» + список; «Отгрузить» / «Не отгружать»; отгрузка не блокируется
- Test: `layout/NotificationCenter.test.jsx`, `screens/useShipConfirm.test.js` (Create), `screens/warehouse/PackShipCard.test.jsx`

- [ ] **Step 1: Failing tests:** `it('task_overdue открывает карточку задачи')`; `it('ссылка не с «/» — не переходит')`; `it('незнакомый kind не роняет центр')`; `it('отгрузка с открытыми задачами — список, «Отгрузить» продолжает')`; `it('без открытых задач — прежний текст')`.
- [ ] **Step 2:** FAIL. **Step 3:** реализовать. **Step 4:** `npx vitest run src/erp/layout src/erp/screens/useShipConfirm.test.js src/erp/screens/warehouse src/fileSizeRatchet.test.ts` — PASS.
- [ ] **Step 5:** `npm run erp:freeze`; commit `feat(erp): уведомления задач и предупреждение при отгрузке`.

---

### Task 10: Проверка, e2e, документы, выкатка

**Files:**
- Create: `pinhead-react/e2e/erp-biz-tasks.spec.ts` — создание из заказа → взять в работу → сообщение с @ → сдать на проверку → вернуть → принять; 375 px — вкладки
- Modify: `e2e/erp-axe.spec.ts` (+ `/biz-tasks`, карточка, форма), эталоны `erp-biz-tasks-*`
- Create: `supabase/rollout/r1910b/README.md` — предусловие «A выкачена»; T1 → T2 → T3 (сухой прогон с пробой, применение, `notify pgrst`), в нерабочее время для T3; смоук старого вызова `erp_chat_send` через REST; SELECT `cron.job`, через 15 мин — `cron.job_run_details` `succeeded`; фронт строго после T1–T3. Триггеры отката: `PROBE_RESULT fails>0` → откат миграции; `42883`/`PGRST202`/«not unique» на `erp_chat_*` за 60 мин → `T3_rollback`; `cron.job_run_details failed` → `unschedule`; новые «Ошибки интерфейса» за 2 ч → откат фронта. Таблицы при откате не удаляются (данные).
- Modify: `CLAUDE.md` (маршруты ERP, схема, правило «задачи пишут только RPC», тред задачи с `order_id null`), `pinhead-react/CLAUDE.md`, `docs/rules/pravila-biznes-zadach-19-10.md` + `INDEX.md`, `docs/rules/react/INDEX.md`, `docs/DESIGN.md`, `docs/changelog/2026-10.md`, `SESSION-STATE.md`
- Test: `pinhead-react/src/erp/utils/rollout1910b.test.ts` — rollback-тела

- [ ] **Step 1:** `npm run lint && npm run typecheck && npx vitest run --maxWorkers=3` — зелёное.
- [ ] **Step 2:** `npm run build && npm run bundle:budget` — PASS.
- [ ] **Step 3:** `npx playwright test e2e/erp-biz-tasks.spec.ts e2e/erp-axe.spec.ts e2e/visual.spec.ts` — PASS.
- [ ] **Step 4:** обход `pinhead-qa`: менеджер (задача на доставку), снабженец (ответственный, «ждём поставщика»), директор (наблюдатель, попытка завершить), постановщик (проверка, возврат), продавец без `erp_employees` (только чтение).
- [ ] **Step 5:** документы; commit `docs: правки 19.10 — бизнес-задачи`; push.

---

## Проверка скиллами (до одобрения)

| Находка | Уровень | Куда внесено |
|---|---|---|
| Тред задачи с `order_id` попадает в ~24 поиска треда сделки, счётчик сделки смешивается | High ×3 | Architecture: `order_id = null`, якорь «ровно один из трёх», `erp_chat_unread_tasks`, звонок по `thread_id` |
| Продавец (профиль `manager`) получает `biz_task.manage`; `erp_is_member` = все профили | High | Р1, Р2, проба |
| Пересоздание `erp_chat_send`: перегрузка, окно PGRST, откат возвращает старую ошибку | High | Task 3 — `drop`+`create` в транзакции, `notify pgrst`, смоук, rollback-тела без ветки задач |
| Нет публикации realtime для новых таблиц | High | Task 1 |
| `erp_create_order`/`manager_id` не описаны; подделка через `tz_order_id` | High/Medium | Р3, Task 1, проба |
| Порядок задач B ломает импорты тестов; `permissionsCoverage` красный | High | Task 1 — константы, типы, права |
| Сторож переходов по SQL-комментариям — не сторож | High | Task 2 — матрица пробы из `BIZ_TASK_TRANSITIONS` |
| Бюджет оболочки: потолок не поднимается `--write-baseline` | High | Р6, Task 6 |
| Вложения: прямая вставка любым; пути в `erp_chat_send` без проверки | Medium | Task 1 restrictive-политика, `erp_biz_task_attach`, проверка `storage.objects` |
| Белый список ключей, принадлежность пункта, проверка профилей, лимиты, помощники открыты по умолчанию | Medium/Low | Task 2, Р8, Global Constraints |
| Ратчет `OrdersScreen`, `realtimeSlice` | High | Task 4, Task 9 — вынос |
| Тексты, пустые состояния, вкладки на телефоне, «Просрочена» не только цветом | Medium (UX) | Global Constraints, Tasks 5–9 |
| Публичный бакет, квоты | Low | Р7 — вынесено владельцу |
