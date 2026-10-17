# Веха 2 единого потока: данные, права и прототип запуска

> Одобрено владельцем 17.10. Разделы «Проверка плана скиллами» и «Проверка безопасности» — поправки, они ИМЕЮТ ПРИОРИТЕТ над разделом «Решения» (например, журнал — `order_events`, страж — белый список, запуск — через `order_v4_launch_check`). Спека: `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md`.


## Context
Это веха 2 единого потока заказа. Спека: `docs/superpowers/specs/2026-10-16-unified-order-flow-design.md`. Веха 1 (уборка, оболочка, сторожа) запушена в `claude/exciting-galileo-uk2po2`.

Цель вехи — подготовить данные и права под рабочее место (веха 3), дизайн-мейкер (веха 5), ТЗ в PDF (веха 6) и «К запуску» (веха 7). Плюс снять главный риск плана заранее: запуск заказа в производство через стор ERP без правки ERP. Пользовательских экранов в этой вехе нет.

**Что показала разведка (код и живая база, 17.10):**
- В `orders` уже есть `notes`, `paid_at`, `tz_ready_at`, `erp_order_id`. CHECK статусов v4 уже знает `ready_to_launch` и `production`.
- **Дыра в правах:**
  - RLS даёт менеджеру и руководству прямой `UPDATE orders`, поэтому статус v4 можно поставить любой (`production`, `done`) мимо всех проверок. Стража на `orders` нет.
  - Позиции, нанесения и бирки правятся в любом статусе.
  - Политики не смотрят на `active`/`approved` профиля.
- `order_v4_save` статус не пишет и `schema_version` не меняет — это верно, переписывать не нужно.
- **Кто есть кто в живой базе:**
  - менеджеров сопровождения (`erp_employees.role = 'manager'`) нет ни одного;
  - 10 профилей с ролью `manager` — в ERP это `production_head`;
  - заказов v4 — 4 черновика, v3 — 3.
- **Запуск:**
  - `createOrder` стора ERP (`erp/store/slices/orderWriteSlice.ts:48`) работает после `ensureDomainSlices()` (`erp/lazyScreen.js:22`) и `loadBootstrap()`. Из загруженных данных ему нужны только `departments`.
  - `NewOrderInput` из черновика моста собирает готовая функция `createOrderPayload` + `payloadItems` (`erp/screens/orders/create/orderPayload.ts:212`).
  - `tz_order_id`/`tz_number` проходят через spread `orderFields`.
  - Повтор запуска даёт ошибку `23505` (`erp_orders_tz_order_uniq`).
  - ТЗ можно передать прямо в payload (`tz.documents`) — одной транзакцией с заказом.
- **Права в ERP:** у роли ERP `manager` есть `order.manage` и `tz.manage`. `erp_create_order` — `security invoker`.
- **Обратная связь:** RPC ERP не заполняет `orders.erp_order_id`. Писать её должен Order.

## Решения (без вопросов владельцу — по спеке и правилам проекта)
1. **МС** = активная строка `erp_employees` с `role = 'manager'` и `profile_id = вызывающий` при активном и одобренном профиле. Функция `public.sales_is_ms()`:
   - `stable security definer`, `search_path = public`;
   - `(select auth.uid())` в теле;
   - `revoke … from public, anon`, `grant … to authenticated`.
2. **Переходы статуса — только через RPC** `order_v4_transition(p_id uuid, p_to text, p_reason text default null)` (`security definer`, свой гейт). Разрешено:

   | Переход | Кто | Условие |
   |---|---|---|
   | `draft → ready_to_launch` («Отправить в работу») | автор или admin/director/rop | есть клиент, срок и хотя бы одна позиция |
   | `ready_to_launch → draft` («Вернуть менеджеру») | МС или admin/director | причина обязательна |
   | `ready_to_launch → production` | МС или admin/director | был `order_v4_launch_check`; есть заказ ERP этого запуска (`tz_order_id = id`, создан после `launch_started_at`, `tz_number = order_number`, не `cancelled` — см. «Проверка безопасности», п. 1); связь `erp_order_id` RPC ставит сам (идемпотентно); есть оплата `paid_at` либо `paid_override_reason` (её ставит только rop/director/admin) |
   | `production → done` | МС или admin/director | — |
   | `draft → archived` | автор или admin | — |

   Каждый переход пишется в новую таблицу `order_status_events` (`order_id`, `from`, `to`, `reason`, `actor`, `at`).
3. **Оплата** — RPC `order_v4_set_payment(p_id, p_kind text /* 'prepaid'|'full'|null */, p_override_reason text default null)` (`definer`). Кто:
   - отметку ставит автор, admin, director, rop;
   - `override` — только rop, director, admin.
4. **Триггер-страж `order_v4_guard`** на `orders` (BEFORE UPDATE, только `schema_version = 4`). Правило проекта — «страж перечисляет исключения»:
   - вне флага `current_setting('order_v4.rpc', true) = 'on'`, который ставят только `definer`-RPC Order, нельзя менять `status`, `created_by`, `erp_order_id`, `paid_*`, `schema_version`;
   - при `old.status <> 'draft'` запрещена любая правка, кроме тех же RPC.
   Плюс триггеры на `order_items`, `order_item_prints`, `order_item_labels`: INSERT/UPDATE/DELETE только если родительский заказ в `draft` (иначе `42501`). У `on delete cascade` от удалённого заказа — ветка «родитель удалён».
5. **RLS на команду** (политики `orders_*` пересоздаются):
   - **SELECT:** руководство (admin/director/rop) — всё; автор-менеджер — свои; МС — v4 со статусом `ready_to_launch`, `production`, `done`.
   - **INSERT/UPDATE/DELETE:** как сейчас (руководство и автор), но профиль обязан быть активным и одобренным.
   - **Для v3 поведение не меняется:** визард менеджера продолжает сохранять.
   - Хелпер `public.sales_is_lead()` (admin/director/rop + active/approved) — `definer`, вызывается в предикате как `(select public.sales_is_lead())`.
   - **Дочерние таблицы** наследуют видимость через родителя, как сейчас.
6. **Новые поля модели v4** (по разделу «Формат ТЗ» спеки), все nullable или с default:
   - `orders`: `paid_kind`, `paid_override_reason`, `sent_at`, `launched_at`, `launched_by`, `sticker_preview_path`.
   - `order_items`: `supplier`, `model_description`, `extra_processing_note`, `client_pattern`, `part_colors jsonb`, `tz_comment`, `tz_pdf_path`, `flat_id`.
   - `order_item_prints`:
     - `layout jsonb`, `artwork_path`, `offset_mm`, `offset_from`, `offset_dir`, `effects text[]`, `contractor`, `contractor_days`;
     - метод `other` (П = прочее/подряд) добавляется в CHECK `method`.
   - `order_item_labels`: `blank bool`, `preview_paths text[]`, `attach_scheme`, `attach_image_path`.
   - Новая таблица `order_notes_cards` (`id`, `order_id`, `item_id` null, `group_title`, `caption`, `link`, `image_path`, `sort_order`) с RLS через родителя и тем же триггером «только в draft».
   - `order_v4_save` пересоздаётся новой миграцией (применённую не правим) с записью новых полей. Подлинный текст функции берётся из `pg_get_functiondef`.
7. **Бакет `order-artworks`:**
   - **приватный**, лимит 25 МБ;
   - пути `orders/<order_id>/…` — только ASCII;
   - политики `storage.objects` на команду;
   - **чтение** — если заказ виден по RLS (`exists (select 1 from orders where id = (storage.foldername(name))[2]::uuid)`);
   - **запись и удаление** — автор или руководство и заказ в `draft`;
   - **МС только читает.**
8. **Прототип запуска** — `orderstudio/bridge/launch.ts`. Функция `launchToErp(order, { launchDate }) → { ok, erpOrderId, alreadyLaunched, warnings, error }`:
   1. Читает `orders.erp_order_id` и `erp_orders` по `tz_order_id`; если заказ уже есть — `alreadyLaunched` и сразу переход.
   2. Динамический `import()` трёх модулей ERP: `erp/lazyScreen` (`ensureDomainSlices`), `erp/store/useErpStore`, `erp/screens/orders/create/orderPayload`.
   3. `ensureDomainSlices()` → `loadBootstrap()`; если цехов нет — ошибка «Справочники производства не загрузились».
   4. `tzToErpDraft` → `createOrderPayload({ form, validItems: payloadItems(items), notesList: [], tzDocuments: [], attachments: [] })` + `draft.link`.
   5. `createOrder(input)`. Ответ `23505` — повторить шаг 1, это идемпотентность.
   6. `order_v4_transition(id, 'production')`.

   ТЗ в PDF подключается в вехе 6 через `tz.documents` того же payload (одна транзакция). Экран — в вехе 7. Сторож `erpImports.test.ts`: `bridge/launch.ts` получает разрешение ровно на эти три модуля, и только динамическим импортом.
9. **Хвост вехи 1 — задача 0, самая первая (просьба владельца):** мок Storage различает `object/sign|list|move|copy` и отвечает на `sign` подписанной ссылкой — иначе e2e закрытого бакета (задача 3) и запуска проверяют не тот путь.

## Проверка плана скиллами (17.10): что добавлено
Проверка шла скиллами architecture, system-design, testing-strategy, deploy-checklist и tech-debt, плюс отдельная проверка безопасности (раздел ниже).

**Архитектура и данные:**
- **Страж и на INSERT, и на DELETE.** Через REST можно сразу вставить заказ v4 со статусом `production` или удалить запущенный. Поэтому `order_v4_guard` вешается на `BEFORE INSERT OR UPDATE OR DELETE`:
  - вставка v4 — только `status = 'draft'`, `erp_order_id`/`paid_*` пустые;
  - удаление v4 — только в `draft`;
  - страж срабатывает при `old` или `new` с `schema_version = 4`, поэтому через смену версии его не обойти.
- **Блокировка строки в переходах.** `order_v4_transition` начинает с `select … for update` по заказу: двойной запуск и гонка «вернуть / запустить» исключены.
- **Журнал событий — одна таблица `order_events`** (`kind`: `status` | `payment`) вместо `order_status_events`. Решение «запуск без оплаты» (кто, когда, причина) пишется туда же.
- **Архив.** `draft → archived` ставит и `archived_at`.
- **Дочерние стражи** на `order_items`, `order_item_prints`, `order_item_labels`, `order_notes_cards`:
  - ветка «родитель удалён» для каскада;
  - запрет на перенос строки в другой заказ (`order_id`/`item_id` неизменны).

**Тесты:**
- **Номер заказа в пробах.** Пробы не расходуют `order_number_seq`: тестовые заказы вставляются суперпользователем с явным `order_number = 'PROBE-…'` до `set local role` (правило проекта «проба без расхода номера»).
- **Пробный прогон миграции.** Перед настоящим применением каждая миграция прогоняется на бою внутри `begin; <миграция>; <пробы>; rollback;` через `execute_sql`. DDL в Postgres транзакционен, поэтому синтаксис, политики и пробы проверяются без следа в базе.
- **Сторож старого клиента.** Пока ветка не слита, на бою работает клиент из `main`. Тест-сторож проверяет, что клиент `main` не пишет в v4 ничего из охраняемых колонок: `salesOrders.ts` пишет только через `order_v4_save_full`, `useOrdersStore` — только v3 (проверено grep).

**Выкатка (на каждую миграцию):**
1. Пробный прогон в откатываемой транзакции.
2. `apply_migration`.
3. `get_advisors` (security и performance) — без новых предупреждений.
4. Файл, `APPLIED.json`, `migrations:verify`.
5. Пробы на бою.
6. Смоук v3: менеджер сохраняет свой заказ (проба).
7. `query_logs` по `42501` на `orders` через 15 минут.

**Признак отката:** новые `42501` у v3 или у ERP («Заказы ТЗ»). Откат — новой миграцией с прежними политиками и снятием стражей.

**Техдолг:**
- **Закрывает:** дыру прямой записи статуса, правку после отправки и видимость заказов неактивным профилем.
- **Создаёт:**
  - вторую систему стражей рядом с ERP (тот же приём, задокументировать в `docs/rules`);
  - ручной перечень исключений стража (держит сторож-тест);
  - зависимость моста от `erp/screens/orders/create/orderPayload.ts` — сторож импортов разрешает ровно этот модуль, а сторож «ERP заморожен» узнает о любой его правке.

## Проверка безопасности (17.10): поправки
Проверял отдельный агент, атакуя REST и RPC от лица менеджера, начальника цеха, МС и отключённой учётной записи. Принято:
1. **Запуск проверяется до создания заказа ERP, и подмена исключена.**
   - Новый шаг `order_v4_launch_check(p_id)` (`definer`, МС или руководство): проверяет все условия перехода в `production`, ставит `launch_started_at` и `launch_by` и возвращает «можно» либо понятную причину.
   - `launch.ts`: `launch_check` → `createOrder` → `transition`.
   - `transition → production` принимает только заказ ERP, у которого `tz_order_id = id`, `created_at >= launch_started_at`, `tz_number = order_number`, а статус не `cancelled`.
   - Ответ `23505`, если найденный заказ ERP этим условиям не удовлетворяет, — **конфликт** («Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства»), а не «уже запущен».
   - Заказ ERP создан, а переход не прошёл — интерфейс показывает «Запущен в ERP, статус не обновлён — повторить»; повтор идемпотентен.
   - **Почему без токена в payload ERP:** uuid заказа v4 цех не видит, пока заказ не запущен (RLS). Окно атаки — инсайдер, знающий uuid. Сверка времени и номера его закрывает, не засоряя поля ERP.
   - Пробы: захват `tz_order_id` до запуска даёт конфликт; сирота при повторе — успех.
2. **Страж `orders` — белый список.**
   - Сравнение `to_jsonb(new) - allowed = to_jsonb(old) - allowed`. `allowed` — ровно колонки, которые пишут `order_v4_save` и `set_urgent_days`.
   - INSERT v4 вне RPC: служебные поля пустые, `created_by = auth.uid()`, `order_number` только из умолчания.
   - DELETE v4 — только в `draft` и без связи с ERP.
   - Исключения стража держит сторож-тест.
3. **Обход стража.**
   - Метка `order_v4.rpc` снимается (`'off'`) сразу после своего UPDATE.
   - Страж дополнительно требует `current_user <> 'authenticated'`: внутри `definer` это владелец функции, клиенту такое недоступно.
   - Сторож-тест на парность `on`/`off`.
4. **Каждая `definer`-RPC проверяет текущую роль, `active` и `approved`.**
   - Значение `p_to` — из белого списка, причина ≤ 500 символов.
   - Для «нет такого заказа» и «не ваш заказ» — одна ошибка `42501` «Заказ не найден или недоступен».
   - `revoke … from public, anon` — и на функциях-триггерах.
5. **Storage.**
   - Хелпер `public.order_artwork_order_id(name)` возвращает uuid только при пути `orders/<uuid>/…`, иначе `null` — без `::uuid` в политике, поэтому другие бакеты не падают с `22P02`.
   - Регулярка пути (ASCII, без `..`) — в WITH CHECK.
   - UPDATE с USING и WITH CHECK, чтобы файл нельзя было перенести в чужой заказ.
   - Подписанные ссылки живут ≤ 10 минут и выдаются по требованию.
   - Цеху ссылки на `order-artworks` не даются: при запуске (веха 6–7) макеты и PDF копируются в `erp-attachments` через `tz.documents`.
6. **Целостность.**
   - `unique (id, order_id)` на `order_items` и составной FK `order_notes_cards (item_id, order_id)`.
   - Дочерние стражи берут `select status … for share` по родителю и проверяют родителя по `old` и `new`.
   - `order_v4_save` проверяет, что `parent_id` виден вызывающему.
7. **`order_events`.**
   - RLS включён, политик записи для `authenticated` нет, SELECT — через родителя.
   - `actor` берётся только из `auth.uid()`.
8. **Оплата (решение владельца: «менеджер + журнал»).**
   - `set_payment` ставят автор и руководство, только в `draft` и `ready_to_launch`.
   - Каждая отметка — событие в `order_events` (кто, когда, вид); МС видит его на экране «К запуску».
   - Запуск без оплаты — только с причиной от rop/director/admin.
9. **Пробный прогон на бою.**
   - `set local lock_timeout = '3s'` и `statement_timeout = '30s'`, в тихое время.
   - Сторож-тест: в файле проб нет `insert into orders` без `order_number`.
10. **Веха 3 учитывает:** автосохранение выключено, если статус не `draft` (иначе поток `42501`).

**Процесс (просьба владельца):** в «Правила и стиль» корневого `CLAUDE.md` вписать правило «после каждого плана — проверка подходящими скиллами (архитектура, тесты, безопасность, выкатка, техдолг, для экранов — дизайн и доступность), находки вносятся в план до одобрения». Это первый шаг после одобрения плана.

## Порядок работ (задачи для субагентов, как в вехе 1)
| # | Задача | Ключевые файлы |
|---|---|---|
| 0 | **Первой (просьба владельца):** мок Storage — `POST object/sign/<bucket>/<path>` отвечает `{ signedURL }` и пишется в журнал как `kind: 'storage-sign'`; `object/list|move|copy` — отдельные ветки, не «загрузка»; e2e-тест на каждую форму | `e2e/support/mockSupabase.ts`, `e2e/order-shell.spec.ts` |
| 1 | Миграция A — поля модели + `order_notes_cards` + метод `other`; новая редакция `order_v4_save`; клиент: `orderstudio/model/types.ts`, `model/factory.ts`, `api/salesOrders.ts` (туда-обратно), `bridge/tzToErpDraft.ts` (метод `other` → `method_as_other`) | `supabase/migrations/<ts>_order_v4_tz_fields.sql`, `APPLIED.json` |
| 2 | Миграция B — `sales_is_ms()`, `sales_is_lead()`, RLS `orders_*`, `order_status_events`, `order_v4_transition`, `order_v4_set_payment`, триггеры-стражи; клиент `api/salesTransitions.ts` (`transitionOrder`, `setPayment`; `toast.error` при ошибке, `return null`) | `<ts>_order_v4_rights.sql` |
| 3 | Миграция C — бакет `order-artworks` и политики; клиент `api/artworks.ts` (`artworkPath(orderId, kind, name)` ASCII, `uploadArtwork`, `signedUrl`) | `<ts>_order_artworks_bucket.sql` |
| 4 | SQL-пробы `supabase/probes/order_v4_rights.sql`: транзакция с `rollback`, роли заводятся внутри, `set_config(claims)` → `set local role authenticated` (сценарии — в «Проверке»); прогон на бою через MCP после применения миграций | `supabase/probes/` + README строка |
| 5 | Прототип запуска `bridge/launch.ts` + обновление сторожа импортов + e2e `order-launch.spec.ts` на моке (`erp_create_order` и `order_v4_transition` в журнале, повтор с `23505` → «уже запущен») | `orderstudio/bridge/launch.ts`, `e2e/support/mockSupabase.ts` |
| 6 | Документы, конец сессии, финальное ревью ветки | `CLAUDE.md` (схема, правила), changelog, SESSION-STATE |

**Применение на бою:** миграции A, B, C применяются на `pinhead-os-v2` через MCP `apply_migration` после зелёных тестов каждой задачи, затем записываются в `supabase/migrations/` и `APPLIED.json`, затем `npm run migrations:verify`. Миграции только добавляют; исключение — пересоздание политик `orders_*` и `order_v4_save`. Откат — новая миграция с прежними политиками (текст берётся из `20260727230000_orderstudio_rls_perf.sql:36-90`).

## Сторожа и правила
- Сторож «ERP заморожен» должен остаться зелёным:
  - `sales_is_ms` только читает `erp_employees`, DDL по `erp_*` нет;
  - сторож импортов — с узким разрешением для `launch.ts`.
- Новые сторожа (node):
  - `orderV4Rights.test.ts` читает последние определения (`latestDefining`) и проверяет: у каждой новой функции есть `revoke … from public, anon`; `definer`-функции имеют `search_path = public`; в предикатах `auth.uid()` стоит в `(select …)`; политики заданы на команду;
  - страж `order_v4_guard` перечисляет исключения.
- Мутационная проверка каждого сторожа.

## Проверка
- **Юнит:**
  - модель туда-обратно через `salesOrders` с новыми полями;
  - `transitionOrder`/`setPayment` (мок `supabase.rpc`);
  - `launchToErp` с замоканными динамическими модулями: порядок вызовов, `alreadyLaunched`, `23505`, пустые цеха.
- **e2e:** `order-launch.spec.ts` запускает `launchToErp` в браузере против мока; журнал содержит `erp_create_order` с `tz_order_id` и `order_v4_transition` с `production`.
- **SQL-пробы на бою (транзакция с откатом):**
  - менеджер видит только свои v4; не может поставить `status` прямым UPDATE; не может править позицию заказа в `ready_to_launch`;
  - МС видит `ready_to_launch`, не видит чужой `draft`, не может писать в `orders` напрямую; `transition → draft` без причины — ошибка;
  - `transition → production` без заказа ERP — ошибка;
  - production_head (профиль `manager`) не видит чужие заказы;
  - неактивный профиль не видит ничего;
  - v3: менеджер сохраняет свой заказ как раньше;
  - бакет: МС читает, но не пишет; менеджер не пишет в чужой заказ.
- **Каждая задача:** lint (≤ 38), typecheck, vitest (`--maxWorkers=3`), build, `bundle:budget` (оболочка ERP ≤ 194312/15932), e2e без `visual:`.

## Нужно от владельца
- Назначить роль МС (`erp_employees.role = manager`) реальным людям — до вехи 7.
- Обновить эталоны `studio-*` (Actions → CI → `update_snapshots`) — хвост вехи 1.
