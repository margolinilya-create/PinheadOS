# SESSION-STATE — память проекта PinheadOS

> Живой документ: обновляется в конце КАЖДОЙ сессии (правило в CLAUDE.md).
> Здесь — текущее состояние системы и последние решения. История — в PROJECT.md.

## Состояние на 2026-07-20 (сессия 15)

### Ruflo + аудит ERP + фиксы
- **Ruflo v3** установлен (`.claude/`, PR #102), runtime в `.gitignore`. Хуки координации
  активны во всех сессиях; live-хелперы Ruflo самообновляются (откатывать перед коммитом).
- **Аудит ERP** (рой из 5 агентов) → `docs/erp-audit.md`. Все находки/приоритеты там.
- **Фиксы (PR #103, в проде):** гейт «на закупку» `isStageAwaitingProcurement` (routes+
  DepartmentQueue+OrderCard+readyCountFor); проверка `createProcurementTask` в `reportDefect`;
  realtime на materials/procurement/subcontracting; триггер `erp_procurement_task_derive`
  (миграция `20260720120000`, на проде) форсит `kind`/`counts_as_purchase` из `cause_type`;
  «Invalid Date» → `formatDateShort` во всех экранах. Тесты 950/950.
- **Рефакторинг стора:** вынесен `store/shared.ts` (аудит/pending/тайминги). Полный распил
  на 7 слайсов + `store/types.ts` — следующий focused-PR (план в `docs/erp-audit.md`).

### Открытые вопросы (нужны решения/бэклог)
- **RLS admin-разделов (A4):** «Закупка»/«Подряд» admin-only только в UI; задачи создаются
  рабочими цеха → жёсткий admin-only на insert сломает флоу. Решить модель доступа по ролям.
- Валидация qty брака vs `stage.qty_done`; переоткрытие промежуточных этапов при возврате;
  гейт «сиротских» материалов (packaging/other/цех вне маршрута); назначение исполнителя задачи.

## Состояние на 2026-07-19 (сессия 14)

### Правки ПМ (волна 2) — 6 доработок, доставка этапами. Фаза 1 готова.
Ветка `claude/project-manager-edits-5bw6mj` (пересоздана от `main`). План — 3 фазы:
(1) брак+задачи закупки, (2) склад+SLA, (3) Подряд.

**Фаза 1 (правки 1-3) — реализована:**
- Новая таблица `erp_procurement_tasks` (миграция `20260719120000_erp_procurement_tasks.sql`,
  **применена на прод** через Supabase MCP): id, order_id, item_id, source_stage_id,
  initiating_dept, material_name, rework_qty, required_qty, cause_type, kind
  (replacement/restock), reason, supplier, planned_date, responsible, status,
  counts_as_purchase. RLS: read/insert/update authenticated, delete admin.
- Типы `ErpProcurementTask` + `PROCUREMENT_*` метки; `procurement_tasks` в `ErpOrderFull`/`ORDER_SELECT`.
- Стор: `createProcurementTask` (правка 2: supplier_defect→replacement/counts=false,
  прочее→restock/counts=true), `updateProcurementTask`.
- `reportDefect(stageId, opts)` — новая сигнатура (правка 3): `target` = current /
  <stageId> / 'procurement'; `needsMaterial` → создаёт задачу закупки. Заменил
  прошлый автовозврат на предыдущий этап.
- UI: форма брака в `DepartmentQueue` (селект этапа устранения + блок закупки),
  секция «Задачи на дозакупку/замену» в `FabricPurchasing`.
- Тесты 924/924, lint 0, build ок.

**Фаза 2 (правки 4, 6) — реализована:**
- Статус материала `reserved` («Доступен со склада», миграция `20260719130000`, **на проде**).
  Материал `source='stock'` рождается `pending`; `confirmStockMaterial` → `reserved`.
- `maybeCloseSupply(orderId)` — вынесен из `updateMaterial`, вызывается и из `addMaterial`
  (баг-фикс: сразу-готовый материал теперь закрывает этап «Закупка»). `reserved` считается готовым.
- `procurementSla(created_at, status)` (`utils/time.ts`) — SLA 3 дня; чип «На обработке»/«Просрочено».
- UI: кнопка «Подтвердить наличие» для stock pending; SLA-чип в таблице материалов.
- Тесты 933/933, lint 0, build ок.

**Фаза 3 (правка 5) — реализована:**
- Таблица `erp_subcontracting` (миграция `20260719140000`, **на проде**): order_id, item_id,
  operation, contractor, qty, sent_date, planned_date, returned_date, status, delay_comment.
- Стор: `subcontracting` + `subcontractingLoaded`, `loadSubcontracting` (join title/bitrix_id),
  `createSubcontractOp`, `updateSubcontractOp`. Хелпер `subcontractOverdue` в `utils/time.ts`.
- Экран `screens/Subcontracting.jsx` (таблица + инлайн-добавление/редактирование),
  роут `/subcontracting` (ErpGuard admin), пункт «Подряд» 🤝 в `ErpLayout` NAV.
- Тесты 939/939, lint 0, build ок.

**Итог волны 2:** все 6 правок в проде (PR #98, #99 и текущий). Три новые таблицы
(`erp_procurement_tasks`, статус `reserved`, `erp_subcontracting`) применены на прод.
⚠️ Новый пункт nav «Подряд» меняет визуальные эталоны всех ERP-экранов — пересобрать
на `main` штатным self-heal (сброс PNG).

## Состояние на 2026-07-18 (сессия 13)

### Сессия 13 — правки проджект-менеджера (10 доработок ERP)
Рабочая ветка: `claude/project-manager-edits-5bw6mj`. Миграции БД не требовались —
нужные колонки уже были (`orders.created_at`, `erp_materials.supplier`/`eta_date`,
`erp_item_stages.planned_end`/`qty_rework`). Блоки:
1. **Заказы** (`erp/screens/OrdersScreen.jsx`): колонка «Создан» (`created_at`) в
   таблице и мобильной карточке; фильтр по диапазону дат создания (`dateFrom`/`dateTo`
   + «Сбросить даты»).
2. **Закупка** (`erp/screens/FabricPurchasing.jsx`): поиск по названию заказа/№ сделки/
   материалу; поле и колонка «Поставщик» (`supplier` — добавлен в тип `ErpMaterial`,
   в БД/RPC уже был); план прихода (`eta_date`) обязателен для `source=purchase`.
3. **Мой цех / Закрой** (`erp/utils/routes.ts`, `DepartmentQueue.jsx`, `OrderCard.jsx`):
   гейт запуска этапа только «своими» материалами — карта `MATERIAL_GATE_DEPT`
   (ткань→закрой, фурнитура/бирки→швейка), `materialsBlockStage`/`missingMaterialsForStage`
   вместо `materialsBlockCutting`; в причине ожидания и в ТЗ/карточке показываются планы
   прихода недостающих материалов; «Взять в работу» требует плановую дату завершения
   (инлайн-форма → `setStagePlan(planned_end)` + `setStageStatus`).
4. **Брак** (`useErpStore.reportDefect`): деление партии — N брака возвращаются на
   предыдущий этап (`depends_on`, ближайший по `sort_order`) как `in_progress` на N штук,
   годные остаются; аудит-событие пишется на получателя. Получателю в очереди виден
   баннер «↩ На переделку: N шт · причина · 📷 фото» (`loadStageReworkEvents`,
   `lastDefectPhotoUrl`).
5. **Общее**: хелпер `formatDateShort` в `erp/utils/time.ts`; правило «общаемся всегда
   на русском» добавлено в оба `CLAUDE.md`.

Тесты: **920/920** (добавлены проверки `materialsBlockStage`/`waitingReason` и деления
партии в `reportDefect` + `addMaterial` supplier), lint 0, build ок.
⚠️ Визуальные e2e-эталоны `erp-orders`/`erp-queue` менялись намеренно — пересобрать в CI
(`npm run e2e:update`); локально не пересобирались из-за рассинхрона версии браузера Playwright.

## Состояние на 2026-07-17 (сессия 12)

### Что развёрнуто
- **Прод:** https://pinhead-os.vercel.app (main → Vercel auto-deploy)
- **БД:** Supabase `pinhead-os-v2` (glhwbktsokphgksdvcxj)
- **Рабочая ветка:** `claude/workshop-orders-usability-review-7uk82y` (5 коммитов,
  запушена, ждёт merge в `main`)

### Сессия 12 — юзабилити-аудит и 38 улучшений (все реализованы)
Аудит (код-анализ, 43 находки) → 38 решений заказчика через опрос → 5 блоков:
1. **Цех** (`/queue`): автопривязка цеха по `erp_employees.profile_id` (чужие цеха
   read-only, admin/director/rop — полный доступ), полное ТЗ в карточке очереди
   (сетка/нанесения/упаковка/материалы), ссылка на заказ, превью макета + лайтбокс,
   частичная готовность (`erp_item_stages.qty_done`, прогресс N/M), фото брака/блока
   в `erp-attachments`, бейдж готовых этапов на «Мой цех».
2. **Форма заказа**: автосейв черновика (localStorage `erp_order_draft`) + confirm,
   3 аккордеон-секции, инлайн-валидация с автоскроллом, пресеты размерных сеток
   (взрослая/детская/своя, чипсы), авторасчёт qty из сетки, обязательное нанесение
   при брендировании, дефолт даты запуска + `buffer_days`, focus-trap + Escape.
   Хелперы: `erp/utils/orderForm.ts`.
3. **Мобильная**: брейкпоинт 480px, полноэкранная модалка (sticky-кнопки), карточки
   вместо таблицы заказов (`useMediaQuery`), touch-DnD канбана (`mobile-drag-drop`,
   dynamic import при pointer:coarse), тач-таргеты 44px (`pointer: coarse`),
   градиент-подсказки вкладок (`useScrollHints`), PWA manifest + иконки.
4. **Техбаза**: loadAll грузит только активные, архив лениво (`loadArchive`),
   точечный realtime (`applyRealtimeEvent` + `loadOne`, fallback loadAll),
   защита от race (`_pendingMutations`), RPC `erp_create_order(payload)` — атомарное
   создание заказа (маршрут считает клиент), lazy loading экранов, дедупликация
   (`erp/utils/time.ts`, `stageUi.ts`), ретрай аудита + toast.
5. **Полировка**: скелетоны (`ErpSkeletons.jsx`) на всех экранах, line-clamp названий,
   фикс поля `is_branding`, токены `--overlay`/`--shadow-modal` (dark mode), мелкий
   текст ≥12px, empty states, превью с onError-заглушкой.

Тесты: **901/901** (было 796), lint 0, build ок. Миграции применены к БД:
`20260717170000_erp_stage_qty_done.sql`, `20260717190000_erp_create_order_rpc.sql`,
`20260718090000_erp_order_shipping.sql`, `20260101000000_baseline_order_studio.sql`.

### Сессия 12, часть 2: отгрузка + QA + CI
- **Отгрузка**: вычисляемая стадия «Готов к отгрузке» (все этапы done/skipped,
  `isOrderReadyToShip`), KPI на дашборде, фильтр `?filter=ready`, кнопка
  «🚚 Отгрузить» (confirm) → `shipped_at/shipped_by/shipped_status` → архивный
  статус по сроку (done_on_time/late/early). История через аудит-триггер.
- **CI починен**: baseline-миграция `20260101000000` (базовая схема Order
  Studio — реплей preview-веток Supabase больше не падает), guard
  `cron.unschedule` через execute; visual-эталоны разделены per-project
  (`{arg}-{projectName}` — mobile был вечно красным из-за общего файла),
  workflow_dispatch `update_snapshots=true` коммитит эталоны сам.
- **QA-прогон (полный, враждебный)**: 0 critical, 1 major (брак > тиража —
  починен), 8 minor (3 починены: maxLength названия, буфер ≥0, предупреждение
  о клампе частичной готовности). Открытые minor: BUG-01 (инлайн-правки полей
  не пишутся в Историю карточки), даты в прошлом без min, KPI «Срок ≤3»/
  «Просрочено» не кликабельны, 20px overflow на мобиле, нет тумблера тёмной
  темы в ERP (CSS темы готов), в тёмной теме кнопка «+ Новый заказ» бледная.
- **QA-мост**: `scripts/qa-supabase-bridge.mjs` (QA_SB_BRIDGE=1) — браузер
  ходит в Supabase через localhost:5173/sb, curl-прокси с актуальным
  $HTTPS_PROXY на каждый запрос. Решает ERR_CONNECTION_RESET в контейнере.

### Архитектура продукта
- **🏭 Производство (ERP)** — корень приложения. Раздел по умолчанию.
- **✏️ ТЗ (Order Studio)** — за feature-flag, кнопки переключения в шапках
  (admin/director). Код цел, вернётся как раздел создания ТЗ.
- **⚙️ Единая админка** — один AdminScreen в обоих режимах:
  Пользователи (общие profiles + цех) · Цеха · Заказы ТЗ.
- Поток: **ТЗ → Производство** (мост — следующая очередь).

### ERP: экраны
| Экран | Что умеет |
|---|---|
| Обзор `/` | KPI, загрузка цехов, горящие заказы |
| Заказы `/orders` | Активные/Архив, поиск, создание (ТЗ-поля: сетка, нанесения, упаковка) |
| Карточка `/orders/:id` | Инлайн-правки, степпер, сетка, нанесения, материалы, план-даты, чат, история |
| Производство `/board` | Таблица-светофор ⇄ Канбан цехов (DnD внутри колонки) |
| Мой цех `/queue` | Очередь цеха: взять/готово (частично)/брак/блок |
| Закупка `/purchasing` | Материалы, приход → автозакрытие этапа закупки |
| Админка `/admin` | Пользователи/Цеха/Заказы ТЗ |

### ERP: данные (все таблицы с префиксом erp_)
`erp_departments` (11 цехов) · `erp_orders` (+упаковка/стикеры/ЧЗ) ·
`erp_order_items` (+size_grid) · `erp_item_stages` (граф depends_on) ·
`erp_item_prints` (нанесения с параметрами) · `erp_materials` (+role/color/supplier) ·
`erp_employees` (profile_id → profiles) · `erp_stage_events` (аудит этапов) ·
`erp_order_audit` (аудит полей, триггер) · `erp_order_comments` (чат, realtime) ·
`erp_order_attachments` (превью, Storage erp-attachments) · `erp_calendar_slots` (зарезервировано)

### Ключевая логика
- Маршрут позиции: `buildRoute` (тип производства + техники нанесений из
  erp_item_prints), параллельные ветки брендирования, «на крое/на готовом»
- Готовность этапа: `isStageReady` (depends_on done + материалы received)
- Закупка автозакрывается при приходе всех материалов
- Realtime: erp_orders/erp_item_stages/erp_order_comments (debounce 500ms),
  уведомление цеху при появлении новой работы
- Аудит: события этапов + правки полей заказа → единая история в карточке

### Данные
- 100 заказов импортированы из Google-таблицы менеджера (39 активных, 61 архив)
- Реальные сотрудники: заводить через Админку (profiles общие с Order Studio)

### В ящике (отложено решениями заказчика)
Оплата труда · детальный раскрой/пошив/ВТО · упаковка-этап · фурнитура-склад ·
инвентаризация · табель · печатные документы · Bitrix24 · Честный знак ·
клиенты-справочник · календарь цехов по дням · мост ТЗ→ERP · генерация ТЗ-PDF

### Следующие кандидаты
1. Мост: создание ТЗ в Order Studio → авто-создание производственного заказа
2. Генерация ТЗ-PDF из полей заказа
3. Календарь цехов (раскладка по дням)
4. Реальные логины сотрудников по цехам

### Технические заметки
- Контейнер: браузер не достаёт Supabase напрямую — QA через route-мост
  (NODE_USE_ENV_PROXY=1 + fulfill), realtime проверяется только на проде
- Vercel Hobby: лимит деплоев/день — пуши могут копиться
- Временные QA-политики в БД называются tmp_* — в конце сессии удалять все
