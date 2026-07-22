# TESTMAP.md — карта атаки PINHEAD Order Studio

> Этап 0 (разведка) состязательного QA/security-аудита. Составлено по **чтению кода**
> + **read-only интроспекции прод-БД** (Supabase project `pinhead-os-v2` /
> `glhwbktsokphgksdvcxj`, только `SELECT` по системным каталогам + `get_advisors`,
> без единой записи). Ниже — карта приложения, граница доверия, точки входа,
> матрица «роль × действие» и пред-модель угроз с severity.
>
> **Статус:** это план. Реальное «ломание» (write-эксплойты, загрузка вредоносных
> файлов, тест-регистрация, гонки) — Этап 1, **после подтверждения**. Деструктив/нагрузка —
> только на preview (`pinhead-merch-preview`) или тест-аккаунте, **не по проду**.

---

## 0. Архитектура одной фразой (и почему это определяет всё)

**Это SPA на Vite + React 19, задеплоенный статикой на Vercel, который ходит НАПРЯМУЮ в
Supabase из браузера под `anon`-ключом.** Серверного слоя приложения (Next.js API,
server actions, бэкенд) **нет**. Значит:

- Вся авторизация и целостность данных держатся **исключительно на Supabase RLS** и на
  логике двух RPC (`erp_create_order`, `generate_order_number`). Больше защищать нечего.
- `anon`-ключ и код правил зашиты в бандл. Любой пользователь может взять свой JWT и
  дёргать REST/Realtime Supabase напрямую, **в обход всего UI**. Поэтому **любая проверка
  в React — косметика**: кнопку можно скрыть, но эндпоинт открыт.
- Единственная граница доверия = граница «браузер ↔ Postgres RLS».

Прод содержит **боевые данные**: 146 заказов `erp_orders`, 12 `orders`, 2 профиля-админа,
3 auth-пользователя. Тестировать деструктивно по этой базе нельзя.

---

## 1. Карта приложения

### 1.1 Две оболочки, выбор — клиентским флагом

`src/App.jsx:76` → `const Shell = FEATURES.orderStudio ? OrderStudioApp : ErpApp;`

- **ErpApp** (`src/erp/ErpApp.jsx`) — оболочка по умолчанию, боевое «🏭 Производство».
- **OrderStudioApp** (`src/orderstudio/OrderStudioApp.jsx`) — «✏️ ТЗ», визард + цены,
  спрятан за фиче-флагом `orderStudio` (по умолчанию `false`).
- Флаг `orderStudio` **полностью управляется клиентом**: `?studio=1` в URL →
  `localStorage['pinhead_feature_orderStudio']` → env → дефолт (`src/config/features.ts:61-69`),
  сеттер `window.setFeature` открыт в консоли (`features.ts:96`). Любой пользователь может
  переключить оболочку.

### 1.2 Роуты и гарды

Гарды **только клиентские**. `ErpGuard` рендерит инлайн-панель «🔒 Нет доступа»;
`RoleGuard` (Studio) делает `<Navigate to="/">`. Оба опираются на роль из стора.

**ERP (по умолчанию), `ErpApp.jsx:50-62`** — `isAdmin = ['admin','director'].includes(user.role)` (реальная роль):

| Путь | Экран | Гейт |
|---|---|---|
| `/` `/orders` `/orders/:id` `/board` `/queue` | Dashboard/Orders/OrderCard/ProductionBoard/DepartmentQueue | **нет** |
| `/admin` `/purchasing` `/warehouse` `/subcontracting` `/experimental` | Admin/Закупка/Склад/Подряд/Эксперимент | `ErpGuard allowed={isAdmin}` (render-gate) |
| `/employees`→`/admin?tab=users`, `/departments`→`/admin?tab=depts` | redirect | нет |

**Order Studio (за флагом), `OrderStudioApp.jsx:139-147`** — гейты на `effectiveRole = previewRole || user.role`:

| Путь | Экран | Гейт |
|---|---|---|
| `/` `/orders` `/print` | Wizard/Kanban/PrintPreview | нет |
| `/express` | ExpressCalc | `canEdit = !production && !designer` |
| `/sku` (`/prices`→сюда) | SkuEditor (цены/каталог) | `isAdmin` (**preview-aware**) |
| `/admin` | AdminScreen | `isAdmin` |
| `/analytics` | Dashboard | `isAdmin || rop || production` |

### 1.3 Модель данных (Postgres, схема `public`, RLS включён везде)

- **ERP (боевое):** `erp_orders` → `erp_order_items` → `erp_item_stages` (+ `depends_on[]`),
  `erp_item_prints`, `erp_materials`, `erp_departments`, `erp_calendar_slots`,
  `erp_stage_events` (аудит), `erp_order_audit` (аудит через триггер), `erp_order_comments`,
  `erp_order_attachments`, `erp_procurement_tasks`, `erp_subcontracting`, `erp_warehouse_ops`,
  `erp_warehouse_tasks`, `erp_experimental(_ops)`.
- **Legacy Order Studio:** `orders` (`total_sum`, `total_qty`, `data` JSONB, `created_by`),
  `order_comments`, `order_audit`, `app_config` (в т.ч. ключ `prices`, `sku_catalog`),
  `catalog_config` (`fabricsCatalog`, `trimCatalog`), `profiles`.
- **profiles:** `id, name, email, role, approved, active, sub_role, assigned_section_id`.
  Роли: `admin, director, rop, manager, designer, production`.

### 1.4 Хранилище (Supabase Storage)

- `erp-attachments` — **public:true** (превью/вложения заказов). Upload — authenticated,
  delete — admin. Публичное чтение по URL.
- `sku-photos` — **public:true**, создаётся на лету из клиента
  `storage.createBucket(..., {public:true})` (`lib/storage.ts:110`).

### 1.5 «API» = прямые вызовы Supabase (нет REST-эндпоинтов приложения)

- **RPC:** `erp_create_order(payload jsonb)` (`ordersSlice.ts:170`, SECURITY INVOKER),
  `generate_order_number()` (`useOrdersStore.ts:26`).
- **Таблицы:** `.select/.insert/.update/.upsert/.delete` напрямую по всем таблицам выше
  (полный инвентарь — §3).
- **Realtime:** один канал `erp-live-<uuid>` c 8 подписками `postgres_changes event:'*'`
  на erp_-таблицы (`realtimeSlice.ts:182-224`); канал комментариев на `erp_order_comments`.
- **Storage:** upload/getPublicUrl/remove/createBucket.

### 1.6 Внешние интеграции

- **Bitrix24** — только поле `bitrix_id`/`bitrix_deal` (номер сделки вводится вручную);
  автоматической интеграции в коде нет (планируется).
- **1С** — упоминается в доках, в коде нет.
- **Вебхуков нет.** Внешних callback-эндпоинтов нет (некуда слать — статика на Vercel).

---

## 2. Граница доверия — что реально проверяется на сервере

Ключевой вывод интроспекции прод-RLS (`pg_policies` + `get_advisors`):

### 2.1 Что сервер ДЕЙСТВИТЕЛЬНО ограничивает ✅

| Правило | Где enforced | Примечание |
|---|---|---|
| RLS включён на всех публичных таблицах | Postgres | адвайзер не нашёл ни одной таблицы с выключенным RLS |
| **profiles: запись только админом** | политики `admin_all_profiles` (ALL, `is_admin()`), `own_profile` (SELECT `auth.uid()=id`) | **самоэскалация роли НЕВОЗМОЖНА** — нет self-UPDATE/INSERT политики |
| ERP `DELETE` — только admin | `*_delete using is_admin()` | удаление заказов/этапов и т.п. закрыто |
| `orders` (legacy) — по ролям | `admins_see_all` (admin/director/rop), `manager_own_orders` (свои, только `manager`); designer/production доступа нет | forge `created_by` заблокирован WITH CHECK |
| `app_config`/`catalog_config` запись — admin/director | `*_write_admins` | ключ `prices` защищён на запись; в `catalog_config` — и на чтение (`catalog_read_with_price_guard`) |
| Аудит (`order_audit`, `erp_order_audit`) — только через SECURITY DEFINER-триггер | `audit_no_direct_writes using(false)` | прямая подделка аудита закрыта |
| `erp_subcontracting` insert/update, `erp_procurement_tasks` update | `erp_is_manager()` (admin/director) | частичное ужесточение A4 (миграция `20260720130000`) |

### 2.2 Что сервер НЕ проверяет (клиент — единственный «щит») ❌

| Правило (ожидается) | Факт |
|---|---|
| **ERP запись по ролям** | ❌ `erp_orders/_items/_item_stages/_materials/_item_prints/_order_comments/_order_attachments/_stage_events/_warehouse_ops/_warehouse_tasks/_experimental(_ops)/_calendar_slots/_departments/_procurement_tasks(insert)` — **INSERT/UPDATE `USING(true) WITH CHECK(true)` для любого `authenticated`**. Подтверждено адвайзером Supabase (`rls_policy_always_true`, ~15 таблиц). |
| **approved / active учитываются** | ❌ Ни одна политика не проверяет `approved`/`active`. «Ожидающий подтверждения» и «отключённый» (soft-delete) сохраняют полный API-доступ по действующему JWT. |
| **Легальность переходов статуса** | ❌ Ни на клиенте (кроме UI-группировки), ни в БД (только enum CHECK). `setStageStatus`/`updateOrder`/`updateStatus` — сквозные passthrough. |
| **Расчёт/потолок цены (legacy)** | ❌ `orders.total_sum` — голый `integer` без CHECK, пишется с клиента как есть; сервер не пересчитывает. |
| **Границы количеств** | ❌ `qty_done`/`qty_rework` без `check (<= qty)`; клампится только в `reportProgress`/`reportDefect`, не в `setStageStatus`/прямой записи. |
| **Валидация полей** (email/phone/даты/обяз.) | ❌ Только клиент (`validate.ts`, `orderForm.ts`). БД держит только `erp_order_items.qty>0` (CHECK) и `title` (RPC raise). |
| **Тип/размер загружаемых файлов** | ❌ `uploadOrderAttachment/Preview` берут `contentType` из клиентского `file.type`, без allowlist и лимита; бакет публичный. |

**Вывод:** между «есть подтверждённый `authenticated` JWT» и «читаю/меняю почти все боевые
данные ERP» **нет ни одного серверного барьера** — ни профиля, ни approve, ни роли не нужно.

---

## 3. Точки входа (ничего не пропускаем)

1. **Auth:** `signUp(email,password)`, `signInWithPassword`, `signOut`, `getSession`
   (`useAuthStore.ts`). Нет `updateUser`, reset, OTP, OAuth.
2. **Формы:** регистрация/логин; `CreateOrderModal` (заказ+позиции+нанесения+материалы);
   правки полей заказа (`useOrderDetail`); этапы/брак/склад/закупка/подряд; комментарии;
   визард Studio (5 шагов) + `SkuEditor` (8 табов, цены).
3. **Query-параметры:** `?studio=1` (переключение оболочки), `?order=` (deep-link),
   `?tab=` (админка). `features.ts` читает `window.location.search`.
4. **Заголовки / токен:** JWT в `localStorage` (Supabase default, autoRefresh). Прямые
   REST/Realtime-запросы с этим JWT — главный вектор обхода UI.
5. **Загрузка файлов:** превью заказа (drop/Ctrl+V), вложения (`PhotoAttach`), фото SKU,
   фото брака, base64 в TechCard.
6. **RPC:** `erp_create_order` (полный клиентский payload), `generate_order_number`.
   Плюс адвайзер: триггер-функции `erp_log_order_changes`, `erp_log_stage_plan_changes`,
   `erp_warehouse_task_derive` **вызываемы напрямую** через `/rest/v1/rpc/` (anon/authenticated).
7. **Realtime:** 8 подписок — «что пропустит RLS, то и утечёт» (RLS = `authenticated`, т.е. всё).
8. **Storage public URL:** прямой доступ к файлам обоих бакетов без авторизации.
9. **Вебхуки:** нет.

Полный инвентарь sink-ов записи (client-controlled → чувствительное поле):

| Файл:строка | Операция | Клиент управляет | Флаг |
|---|---|---|---|
| `useAuthStore.ts:113` | `profiles.upsert` | `role, approved` | RLS блокирует не-админа (insert закрыт) |
| `AdminPanel.jsx:41/47/55/61`, `employeesSlice.ts:64` | `profiles.update` | `role/approved/active` | только admin (is_admin); **director молча падает** |
| `useOrdersStore.ts:183/211/308` | `orders.insert/update` | `total_sum, created_by, status, data` | цена с клиента; created_by ограничен WITH CHECK |
| `ordersSlice.ts:170` | RPC `erp_create_order` | весь payload (`qty, department_id, status, created_by`) | SECURITY INVOKER; сервер не валидирует роль |
| `ordersSlice.ts:217/253/265` | `erp_orders.update/delete` | произвольный patch, `shipped_*` | update открыт всем authenticated |
| `stagesSlice.ts:29/70/193` | `erp_item_stages.update` | `status, qty_done, qty_rework` | без клампа/переходов на сервере |
| `useCommentsStore.ts:56` | `order_comments.insert` | `author_name, author_role` | спуф личности/роли |
| `ordersSlice.ts:387`, `shared.ts:28`, `warehouseSlice.ts:89` | comments/stage_events/warehouse insert | `author/actor` = `currentActor()` | аудит-поля с клиента |
| `ordersSlice.ts:291/325`, `lib/storage.ts:120` | `storage.upload` | путь (`ext`, `code`), `contentType` | без allowlist; public bucket; upsert-overwrite |
| `SkuEditor.jsx:122-129`, `PricingTabContent.jsx:45` | `app_config/catalog_config.upsert` | `prices, sku_catalog, …` | запись закрыта RLS (admin/director) |

---

## 4. Роли и матрица «роль × действие»

UI-гейт (что видно) vs серверный enforcement (что реально остановит). Легенда:
**UI** = скрыто в интерфейсе; **RLS✅** = сервер остановит; **RLS❌** = сервер пропустит
(прямой API проходит для любого authenticated).

| Действие | admin | director | rop | manager | designer | production | Сервер остановит не-разрешённого? |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Читать ВСЕ заказы/этапы/материалы/комменты ERP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **RLS❌** (`select using(true)`) |
| Создать заказ (`erp_create_order`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **RLS❌** |
| Править любой заказ/позицию/этап, менять `qty_done`, статус | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (нет гейта в ProductionBoard/queue-обход) | **RLS❌** (`update using(true)`) |
| Отгрузить/архивировать заказ (в обход `isOrderReadyToShip`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **RLS❌** |
| Менять справочник цехов/мощности (`erp_departments`) | UI:✅ | UI:✅ | UI:❌ | UI:❌ | UI:❌ | UI:❌ | **RLS❌** (update всем) |
| Закупка/Склад/Подряд/Эксперимент — экраны | UI:✅ | UI:✅ | UI:❌ | UI:❌ | UI:❌ | UI:❌ | subcontracting insert/procurement update — **RLS✅** (manager=admin/dir); остальное **RLS❌** |
| Удалить заказ/этап | UI:✅ | UI:✅ | UI:❌ | UI:❌ | UI:❌ | UI:❌ | **RLS✅** (`delete is_admin`) |
| Изменить роль/approve/active пользователя | UI:✅ | UI:✅ | ❌ | ❌ | ❌ | ❌ | **RLS✅** (admin only; **director фактически не может — is_admin=role='admin'**) |
| Изменить цены/каталог (`app_config`/`catalog_config`) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | **RLS✅** (admin/director) |
| **Самоэскалация до admin через profiles** | — | — | — | ❌ | ❌ | ❌ | **RLS✅ — заблокировано** (нет self-update) |

**Итог матрицы:** серверная граница фактически различает лишь **три** уровня — «любой
authenticated» (почти весь ERP: read+insert+update), «admin/director» (цены, подряд,
управление профилями/удаление) и «никто снаружи без JWT». Шесть продуктовых ролей на
сервере **не различаются** для основного потока производства.

---

## 5. Пред-модель угроз (гипотезы к проверке в Этапе 1)

`[П]` — **подтверждено** read-only интроспекцией/кодом; `[W]` — требует write-теста
(preview/тест-аккаунт); `[?]` — требует настройку/доступ, которого нет из кода.

### CRITICAL
- **CR-1 [W/?] Внешний злоумышленник → полный доступ к ERP.** Если в проекте включена
  само-регистрация (`signUp` в коде есть, экран регистрации есть), то посторонний
  регистрируется → подтверждает почту → получает `authenticated` JWT → **читает и меняет
  все 146 боевых заказов напрямую через REST**, минуя экран «Ожидание подтверждения»
  (approve на сервере не проверяется — `[П]`). Проверить: включён ли signup + confirm
  (тест-регистрацией), затем `GET /rest/v1/erp_orders` тем JWT (на preview или тест-аккаунте).

### HIGH
- **HI-1 [П] Тотальная запись в ERP для любого authenticated.** Designer/production/manager
  (и даже аккаунт без профиля) через прямой API меняют любой заказ/этап/кол-во/срок/материал.
  Подтверждено адвайзером (`rls_policy_always_true`, ~15 таблиц). Демо write-тестом на preview.
- **HI-2 [П] approved/active — только UI.** Отключённый (soft-delete `active=false`) или
  неподтверждённый сотрудник сохраняет полный API-доступ, пока не удалён его auth-аккаунт.
  Сейчас таких 0, но 3-й auth-пользователь **без профиля** уже существует — демонстрация, что
  «аккаунт без авторизации в приложении» имеет доступ к данным.
- **HI-3 [П/W] Обход бизнес-переходов.** Прямой `update erp_orders/erp_item_stages`:
  отгрузить незавершённый заказ (обход `isOrderReadyToShip`), `done→waiting`, пропуск этапа
  с невыполненными `depends_on`, `qty_done > qty`. Порча производственной доски.
- **HI-4 [П/W] Цена legacy с клиента.** `orders.total_sum` пишется как есть (отрицательное/
  произвольное принимается); менеджер правит цену/статус своего заказа без серверной проверки.
  (OrderStudio за флагом, но таблица живая, 12 заказов.)

### MEDIUM
- **ME-1 [П/W] Небезопасная загрузка → XSS на storage-origin.** `uploadOrderAttachment`:
  нет allowlist/лимита, `contentType` из клиента; файл открывается `<a target=_blank>`
  (`OrderDrawer.jsx:191`). Залить `.svg`/`.html` как `image/svg+xml` → исполнение JS на
  `*.supabase.co` (фишинг/малварь с доверенного домена). `sku-photos`: SVG проходит,
  `upsert:true` перезапись по предсказуемому пути.
- **ME-2 [П] Спуф аудита/личности.** `order_comments.author_role`, ERP `actor/uploaded_by/
  author`, `erp_create_order.created_by` — клиентские строки; журнал «кто сделал» подделываем.
- **ME-3 [П] Публичные бакеты.** `erp-attachments`/`sku-photos` public:true → макеты/арт
  клиента читаются по URL кем угодно; клиент может создать публичный бакет.
- **ME-4 [П] Триггер-функции вызываемы как RPC.** `erp_log_order_changes`,
  `erp_log_stage_plan_changes`, `erp_warehouse_task_derive` (SECURITY DEFINER) открыты
  для anon/authenticated через `/rest/v1/rpc/` (адвайзер `0028/0029`).
- **ME-5 [W] Нет идемпотентности создания заказа.** Двойной сабмит `erp_create_order` →
  дубль заказа; гонки realtime исторически ломали этапы (фикс #122 — проверить регрессии).
- **ME-6 [П] `canAct` обходится.** `DepartmentQueue.jsx:121`: пользователь без привязки к
  цеху получает `canAct=true`; `boundDept` из localStorage; ProductionBoard-advance без гейта.

### LOW
- **LO-1 [П] Нет security-заголовков/CSP** на Vercel (`vercel.json`) — clickjacking, нет
  mitigation для XSS.
- **LO-2 [П] Directror не может писать profiles** (is_admin=role='admin') — функц. баг
  админки (молчаливый отказ RLS).
- **LO-3 [П] Ценовые данные `app_config.prices`** читаются любым authenticated
  (в отличие от `catalog_config`, где есть price-guard) — утечка себестоимости/наценки.
- **LO-4 [П] Слабые пароли** — leaked-password protection (HIBP) выключен (адвайзер).
- **LO-5 [П] Мутабельный search_path** у нескольких функций (адвайзер `0011`).
- **LO-6 [П] Краевые qty в legacy-ценообразовании** (отрицательный тираж → отрицательный
  итог; нет верхнего клампа; сырая строка в per-row size-инпутах). Вторично — `total_sum`
  и так пишется напрямую.
- **LO-7 [проц.] QA против прода.** `qa-supabase-bridge.mjs` таргетит прод-проект; в БД
  бывают временные `tmp_*` QA-политики (SESSION-STATE) — риск забытых ослаблений RLS.

### Известно команде (docs/erp-audit.md) — подтвердить, не выдавать за новое
- `qty_rework` без кумулятивной границы; возврат на ранний этап не переоткрывает
  промежуточные; «сиротские» материалы `packaging/other` не гейтят отгрузку; **A4** —
  admin-разделы защищены только UI (частично закрыто для subcontracting/procurement).

### Проверено и НЕ подтвердилось (важно для честности отчёта)
- ❌ Самоэскалация роли через `profiles` — **невозможна** (RLS: self только SELECT).
- ❌ Stored-XSS через DOM (комменты/названия/заметки) — **невозможен**: все 7
  `dangerouslySetInnerHTML` идут через санитайзенный `getGarmentSVG` (цвет через
  `sanitizeHex`, тип — ключ поиска), остальной текст экранируется React.
- ❌ Захардкоженные секреты (service_role/JWT) — **нет** ни в коде, ни в бандле.
- ❌ RLS выключен на публичной таблице — **нет** (включён везде).
- ❌ Open redirect — **нет**.

---

## 6. План тестов (Этап 1) — как и где

Складываем в `pinhead-react/tests/security/` (API-скрипты) и `pinhead-react/e2e/` (Playwright).
Приоритет по severity. **Никакого деструктива/нагрузки по проду.**

| # | Тест | Тип | Среда |
|---|---|---|---|
| T1 | Регистрация тест-аккаунта → `GET erp_orders` его JWT (CR-1, HI-1, HI-2) | API (fetch) | тест-аккаунт / **preview** |
| T2 | «Designer» правит чужой заказ/этап/`qty_done`, отгружает незавершённый (HI-1, HI-3) | API | **preview** |
| T3 | Прямой `update orders.total_sum` = отрицательное/1 (HI-4) | API | **preview** |
| T4 | Загрузка `.svg`/`.html` в `erp-attachments`, проверка `content-type` ответа (ME-1) | API | **preview** |
| T5 | Спуф `author_role='admin'` в комментарии (ME-2) | API | **preview** |
| T6 | Прямой вызов `/rest/v1/rpc/erp_warehouse_task_derive` (ME-4) | API | **preview** |
| T7 | Двойной сабмит `erp_create_order` (ME-5, идемпотентность) | API | **preview** |
| T8 | Юнит/логика: краевые qty в `pricing.ts` (0/отриц/дробь/1e9/NaN) (LO-6) | Vitest | локально |
| T9 | E2E: `?studio=1` + `setPreviewRole('admin')` открывают SkuEditor/AdminScreen (ME-6) | Playwright | локально/preview |
| T10 | Проверка заголовков ответа Vercel (CSP/X-Frame) (LO-1) | curl | прод (read-only, безопасно) |

Для write-тестов создаётся изолированная **Supabase preview-ветка** от прод-схемы (миграции
реплеятся) либо используется отдельный **тест-аккаунт**; боевые 146 заказов не трогаем.

---

## 7. Чего не смогу проверить из кода (нужен доступ/подтверждение)

1. **Включена ли само-регистрация и требуется ли confirm email** (GoTrue-настройка проекта) —
   определяет, CR-1 это Critical (внешний) или High (инсайдер). Проверяется тест-регистрацией.
2. **Реальный прод-бандл `DEV=false`** — `useAuthStore.ts:9,43` в dev-режиме даёт
   хардкод-админа без пароля. В прод-сборке Vite вырезает, но нужно подтвердить по
   задеплоенному JS.
3. **Storage-политики `storage.objects`** для `erp-attachments`/`sku-photos` в проде
   (в репо только часть) — точные права на upload/list/overwrite.
4. **Настройки JWT/сессии** (TTL, refresh, ротация) — конфиг проекта, не код.
5. **Забытые `tmp_*` QA-политики** в проде (LO-7) — проверяется отдельным `pg_policies`-срезом.

---

*Следующий шаг (по подтверждению): Этап 1 — написать воспроизводимые тесты T1–T10 на
preview/тест-аккаунте, собрать BUGREPORT.md (сводка, топ-5 критичных с фиксами, полный список,
что не проверено, 5 быстрых побед).*
