# Выкатка правок 19.10, план B («Бизнес-задачи») — T1, T2

План — `docs/superpowers/plans/2026-10-19-erp-edits-19-10-b-biz-tasks.md`, задача 10.
Правила — `docs/rules/pravila-biznes-zadach-19-10.md`. Сторож папки — `pinhead-react/src/erp/utils/rollout1910b.test.ts`
(состав отката = состав миграции, порядок и разделы этого файла).

| Код | Миграция | Что делает | Проба (ожидание) | Откат |
|---|---|---|---|---|
| T1 | `20261020090000_erp_biz_tasks_schema` | таблицы `erp_biz_task*` (только SELECT), `erp_orders.manager_id` и страж заказа, `erp_create_order` (менеджер заказа при подлинном запуске), якорь треда `task_id`, вложения `biz_task_id`, виды уведомлений `task_*`, publication, право `biz_task.manage` | `erp_biz_tasks_schema.sql` → `PROBE_RESULT fails=0 total=31` | только фронт (см. раздел 3) |
| T2 | `20261020100000_erp_biz_tasks_rpc` | писатели задачи (`erp_biz_task_*`), **и T3 в том же файле**: `erp_chat_send`/`erp_chat_page` с `p_task_id` (`drop` + `create` в одной транзакции), `erp_chat_edit`/`erp_chat_delete`, `erp_chat_unread_tasks`, напоминания `erp_biz_task_reminders_run` и расписание `pg_cron` | `erp_biz_tasks.sql` → `PROBE_RESULT fails=0 total=407`; `erp_biz_tasks_chat.sql` → `PROBE_RESULT fails=0 total=55` | `20261020100000_erp_biz_tasks_rpc_rollback.sql` |

Применяет **владелец в SQL Editor** (MCP `execute_sql` виснет на `drop`/`delete`); контроллер — только SELECT
и запись в `APPLIED.json`. Пробы до этой выкатки на бою не прогонялись ни разу (только локально, PostgreSQL 16
с заглушкой схемы) — первый сухой прогон и есть их проверка.

## 1. Предусловия

1. **Часть A выкачена:** S1, E1, C1 (`20261019090000`, `20261019100000`, `20261019110000`) применены и записаны
   в `supabase/migrations/APPLIED.json`, `npm run migrations:verify` зелёный. Иначе неприменённых станет 5 + 2
   и сторож журнала (≤ 5) покраснеет; бакет `erp-attachments` — 30 МБ.
2. Расширение `pg_cron` включено (им уже живут `erp_overdue_requests_run` и напоминания заявок):

   ```sql
   select extname, extversion from pg_extension where extname = 'pg_cron';
   select jobname, schedule, active from cron.job order by jobname;
   ```

3. **T2 — в нерабочее время** (до 8:00 или после 20:00 МСК): `erp_chat_send` и `erp_chat_page` пересоздаются
   `drop` + `create`; пока PostgREST не перечитал схему, чат ERP отвечает `PGRST202`. Транзакция короткая,
   окно — секунды до `notify pgrst`.

## 2. Порядок

**T1 → T2, затем фронт.** Фронт части B — строго после T1 и T2 (клиент зовёт `erp_biz_task_*`,
`erp_chat_send(…, p_task_id)` и `erp_chat_unread_tasks`; прежний фронт новую схему переживает).

Каждую миграцию:

1. **Сухой прогон.** Открыть файл пробы; сразу после `begin;` и строк `set local …` вставить текст миграции
   целиком (для проб T2 — и T1, если T1 ещё не применена). Выполнить: проба заканчивается исключением
   `PROBE_RESULT fails=0 total=N` — оно же откатывает всё. Любое `fails>0` — стоп, миграцию не применять.
   Для T2 — обе пробы: `erp_biz_tasks.sql` (total=407) и `erp_biz_tasks_chat.sql` (total=55).
2. **Применение.** Текст миграции → Run. Затем `notify pgrst, 'reload schema';` (у T2 он уже в конце файла —
   повторить не вредно).
3. **Журнал.** Контроллер SELECT-ом видит версию в `supabase_migrations.schema_migrations`, дописывает её
   в `supabase/migrations/APPLIED.json`, `cd pinhead-react && npm run migrations:verify` — зелёное, коммит.

### Проверки после T2

1. **Смоук старого вызова `erp_chat_send`** через REST (прежний фронт ещё на бою, он шлёт 9 именованных
   аргументов без `p_task_id`): в «Обсуждении» любой сделки отправить сообщение из интерфейса — оно приходит,
   в консоли нет `PGRST202`/`42883`. Та же проверка SELECT-ом — одна перегрузка у каждой функции:

   ```sql
   select p.proname, count(*) as overloads
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('erp_chat_send', 'erp_chat_page')
    group by p.proname;
   -- ожидание: по 1
   ```

2. **Расписание напоминаний:**

   ```sql
   select jobid, jobname, schedule, active from cron.job where jobname = 'erp-biz-task-reminders';
   -- ожидание: одна строка, '*/15 * * * *', active = true
   ```

   Через 15 минут:

   ```sql
   select status, return_message, start_time
     from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'erp-biz-task-reminders')
    order by start_time desc limit 3;
   -- ожидание: status = 'succeeded'
   ```

## 3. Откат

**По умолчанию — только фронт** (redeploy предыдущей сборки): прежний фронт новых таблиц не читает, а
`erp_chat_send`/`erp_chat_page` после T2 принимают прежний вызов. Серверный откат — только по триггерам ниже
и всегда ПОСЛЕ отката фронта.

- **T2** — `20261020100000_erp_biz_tasks_rpc_rollback.sql`, одной транзакцией: снимает расписание
  (`cron.unschedule` внутри `if exists`), `erp_biz_task_reminders_run`, `erp_chat_unread_tasks`, возвращает
  прежние подписи `erp_chat_send` (9 аргументов) и `erp_chat_page` (7 аргументов), `erp_chat_edit` и
  `erp_chat_delete` — **тела без ветки задач, записанные заново, а не дословно прежние** (сторож сверяет, что в
  них нет `task_id`), снимает всех писателей `erp_biz_task_*` и `erp_profile_is_staff`; в конце
  `notify pgrst, 'reload schema'`.
- **T1** — серверного отката нет. **Таблицы при откате не удаляются**: в них данные (задачи, история,
  уведомления, треды задач). После отката T2 таблицы `erp_biz_task*` только читаются, писать в них некому;
  `erp_orders.manager_id` остаётся под стражем заказа, `erp_create_order` продолжает ставить менеджера заказа
  при подлинном запуске — прежнему фронту это не мешает. Снять схему T1 — отдельной миграцией с решением
  владельца (бэклог).

Запись в `APPLIED.json` после серверного отката остаётся: журнал отражает факт применения, а откат
фиксируется записью в `docs/changelog/2026-10.md` и `SESSION-STATE.md`.

## 4. Триггеры отката

| Условие | Действие |
|---|---|
| `PROBE_RESULT fails>0` после применения (повторный прогон пробы на применённой базе) | откат миграции |
| `42883`, `PGRST202` или «not unique» (`function … is not unique`) на `erp_chat_*` за 60 мин после T2 | откат фронта, затем `r1910b/20261020100000_erp_biz_tasks_rpc_rollback.sql` |
| `cron.job_run_details` со `status = 'failed'` у `erp-biz-task-reminders` | `select cron.unschedule('erp-biz-task-reminders');`, разбор `return_message`; задачи и чат работают без напоминаний |
| новые «Ошибки интерфейса» ERP (`/admin`, вкладка) за 2 ч после выкладки фронта | откат фронта |

## 5. Известные ограничения (не триггеры)

- **Прямой INSERT в `erp_orders`** открыт любому участнику ERP старой политикой `erp_orders_insert`, а страж
  менеджера заказа (`manager_id` — только сотрудник ERP) стоит на UPDATE. Закрыть — вместе с давней дырой
  прямой вставки заказа ERP (бэклог).
- Файлы задач лежат в публичном бакете `erp-attachments` (решение Р7): кто знает ссылку — открывает.
