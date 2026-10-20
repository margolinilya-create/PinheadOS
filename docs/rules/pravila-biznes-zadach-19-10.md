# Правила «Бизнес-задач» (правки 19.10, план B, п. 7)

План — `docs/superpowers/plans/2026-10-19-erp-edits-19-10-b-biz-tasks.md` (решения владельца Р1–Р8),
выкатка — `supabase/rollout/r1910b/README.md`, ledger и отчёты — `.superpowers/sdd/2026-10-19-erp-edits-19-10-b-biz-tasks/`.
Владелец одобрил правку замороженного ERP; `erpFrozen.json` пересчитан.

## Что это

Поручение по заказу ERP: доставка, закупка или другое (`delivery|purchase|other`), один ответственный, срок
(`timestamptz`, показ по `Europe/Moscow` — «до 20.10, 18:00 МСК»), статусы «Новая / В работе / Приостановлена /
На проверке / Завершена / Отменена» (`new|in_progress|paused|review|done|cancelled`), наблюдатели, чек-лист,
результат, свой диалог, файлы, история и уведомления. «Просрочена» — бейдж рядом со статусом (иконка + текст),
а не статус: открытая — по сроку, сданная и завершённая — по времени СДАЧИ (`submitted_at`, возврат его стирает),
отменённая — никогда (`utils/bizTasks.isOverdue`). Удаления задачи нет — только «Отменить задачу» с причиной.

Где: вкладка «Задачи» карточки заказа (`/orders/:id?tab=tasks`, `OrderBizTasksTab`), общий раздел `/biz-tasks`
(вкладки «Мне / Поставленные мной / Наблюдаю», фильтры в адресе) и карточка `/biz-tasks/:taskId` — один ленивый
`lazyScreen` (`BizTasksScreen` сам выбирает список или страницу). `/task/:stageId` — производственное задание, не путать.

## Схема и запись (T1 `20261020090000`, T2 `20261020100000`)

- Таблицы `erp_biz_tasks`, `erp_biz_task_watchers`, `_checklist`, `_events`, `_seen`. У клиента **только SELECT**
  (RLS `erp_is_member()`; `_seen` — только свои строки), политик записи нет. **Задачи пишут только `security definer`
  RPC** `erp_biz_task_create / _transition / _update / _set_result / _checklist_op / _attach / _mark_seen`: событие
  истории и уведомления — одной транзакцией с изменением. Новая функция — `revoke` у `public, anon, authenticated`,
  `grant` — только писателям из белого списка (сторож `bizTasksRpc.test.ts`), помощники — никому.
- Белый список ключей у `create` и `update`; прочие ключи (`creator_id`, `status`, `id`, `result_*`) — `22023`.
  Повтор `client_key` — прежняя строка (двойной клик «Создать задачу» — одна задача).
- Переходы — одна таблица `BIZ_TASK_TRANSITIONS` (`utils/bizTasks.ts`) и в SQL, и в клиенте; матрица пробы
  `erp_biz_tasks.sql` генерируется из неё (`supabase/probes/gen-biz-task-matrix.mjs`, паритет — сторож).
  Неверный переход — `22023`, чужая роль — `42501`, устаревшая версия (`p_expected_updated_at`) — `P0001`
  «Задача изменена — обновите карточку». `submit` — только у задачи с «Проверкой постановщиком», `complete` — только без.
- `set_result`, `checklist_op` и `attach` поднимают `updated_at` без сверки версии: клиент берёт версию из их ответов
  и из звонка realtime, иначе ложные конфликты.
- Ворота сотрудника (`erp_biz_task_gate`, клиент — `isBizTaskStaff`): активная карточка `erp_employees` либо профиль
  admin/director. **Право `biz_task.manage` — только по должности ERP** (admin, director, production_head, manager),
  не по запасной роли профиля: продавец без карточки (`PROFILE_ROLE_FALLBACK` → `manager`) задачами не управляет
  (Р2; клиент — `canManageBizTasks(can, isStaff)`). Адресаты уведомлений — только `erp_profile_is_staff`.
- Лимиты Р8: наблюдателей ≤ 20, пунктов ≤ 100, задач ≤ 30 в час на постановщика; у заказа `done*`/`cancelled`
  новых задач нет.
- Файлы — `erp_order_attachments` (вид `biz_task`, колонка **`biz_task_id`** — `task_id` там уже занят
  экспериментальным цехом); прямая вставка закрыта RESTRICTIVE-политикой, пишет только `erp_biz_task_attach`
  (объект бакета `erp-attachments` с `owner = auth.uid()` и префиксом `att/<order_id>/biz_task/`). Бакет публичный (Р7).
- Менеджер заказа — `erp_orders.manager_id` (Р3): ставит `erp_create_order` при подлинном запуске из «Оформления
  заказа» (автор заказа v4, свежая метка запуска), вручную — `order.manage` в карточке (`OrderManagerField`), только
  сотрудник ERP (ветка стража `erp_order_guard`, `22023`). Пока пусто — менеджер не наблюдатель и не получатель.
  Прямой INSERT в `erp_orders` старой политикой этот страж обходит — бэклог вместе с давней дырой вставки.

## Диалог задачи

Тред существующего чата ERP с якорем `task_id` и **`order_id = null`** — тред задачи не попадает ни в один поиск
треда сделки (CHECK `erp_chat_thread_anchor` — ровно один из `order_id`/`experimental_id`/`task_id`). `erp_chat_send`
и `erp_chat_page` пересозданы с `p_task_id` (`drop` + `create` в одной транзакции, по одной перегрузке, прежний вызов
с 9 именованными аргументами работает). Писать — участники и `biz_task.manage` (`42501` прочим); упоминания — только
участники; **сообщения задачи уведомлений не создают** (Р4), кроме `task_mention`; счётчик — `erp_chat_unread_tasks`
(сделочную `erp_chat_unread_many` не трогаем). Удаление сообщения-результата затирает текст, `result_text` и событие
остаются. Клиент — тот же `ChatPanel` с `taskId` (`useTaskChat`: кто пишет, кого звать, «Отметить как результат»);
в карточке он грузится `lazy()` — статический импорт переписал бы карту предзагрузки оболочки.

## Уведомления и напоминания

Виды `task_assigned`, `task_unassigned`, `task_status`, `task_review`, `task_returned`, `task_due_soon`, `task_overdue`,
`task_mention` (CHECK = `ErpNotificationKind`, сторож `notificationsGuard.test.ts`); одно уведомление человеку на
событие (уникальный `(user_id, task_event_id)`), заголовки — шаблоном на сервере (`{task}`/`{order}`). Центр и
всплывающие переходят только по ссылке внутри приложения (`utils/noticeNav.inAppLink`). Напоминания —
`erp_biz_task_reminders_run()` (только `service_role`) по `pg_cron` `erp-biz-task-reminders` раз в 15 минут (Р5):
`due_soon` за 24 ч (если задача заведена раньше окна), `overdue` — ответственному, постановщику, менеджеру; ключ
события `(task_id, kind, due_at)` — повтора нет до переноса срока. Отгрузка заказа с открытыми задачами — предупреждение
списком («Отгрузить» / «Не отгружать», `useShipConfirm`), не блок.

## Клиент

- Стор — `store/slices/bizTasksSlice.ts`; состав наблюдателей после создания и правки — с сервера, не из формы.
  Realtime — только «звонок» `erp_biz_tasks`/`erp_biz_task_events` в существующем канале (второго канала нет);
  `_watchers`, `_checklist`, `_seen` — в `NO_REALTIME` (меняются только вместе с событием задачи).
- Кто я в задаче — `user.id` стора авторизации (карточка и `useTaskChat`), не `currentUserId()`: тот гасит
  dev-автологин (`id = dev`) в `null`, и в dev/e2e у постановщика пропадало поле ввода. Списки «Мне / Поставленные
  мной / Наблюдаю» читают через `currentUserId()` — у dev-автологина они пусты (запись в uuid-колонки).
- Блок по условию — `Button ariaDisabledReason` с причиной («Заполните: …», «Задачи ставят сотрудники ERP»);
  `disabled` — только на время запроса. На ≤ 760 px карточка — вкладки «Задача / Обсуждение / История / Файлы».
- Бюджет оболочки ERP: раздел взял 667 Б из ≤ 1 000 Б по Р6 (195 724 / 196 000 Б gzip после сборки полос) —
  разбор в `src/orderstudio/design/README.md`, «Замеры 19.10, часть B». Запас 276 Б: новое в оболочку — с разбором.

## Сторожа

`bizTasksSchema` (политики, CHECK, якорь, publication, `erp_create_order`), `bizTasksRpc` (definer/grant, матрица,
белые списки), `bizTasksChat` (ветка задачи, упоминания, reminders, rollback-тела), `rollout1910b` (состав отката =
состав миграции, README), `notificationsGuard`, `attachmentKinds`, `permissionsCoverage`, `serverPermissions`,
`realtimeCoverage`, `bizTasksMock` (мок e2e = тексты миграции); e2e `erp-biz-tasks.spec.ts`, `erp-axe.spec.ts`
(раздел, карточка, форма), эталоны `erp-biz-tasks*` (снимает владелец).
