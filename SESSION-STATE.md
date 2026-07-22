# SESSION-STATE — память проекта PinheadOS

> Живой документ: обновляется в конце КАЖДОЙ сессии (правило в CLAUDE.md).
> Здесь — текущее состояние системы и последние решения. История — в PROJECT.md.

## Состояние на 2026-07-22 (сессия 20) — Редизайн фронтенда ERP завершён (6 фаз, 1 ветка)

**Контекст:** правки 4.1.3 + 4.2.1–4.2.4 смёрджены на прод (PR #123, squash `1cc5047`; CI `test`
зелёный, `visual` — non-blocking, эталоны обновим позже). Затем — **полный редизайн ERP по макетам
заказчика + UI Kit**, накоплен 6 фазами в одной ветке `claude/warehouse-auto-fill-plan-9f9bhq`
(перезапущена от main после #123). План: `/root/.claude/plans/rosy-wobbling-pie.md`; трек —
`docs/erp/frontend-redesign-plan.md`. Backend/API/маршруты/статусы НЕ менялись — только frontend.

**Коммиты редизайна (поверх main):** `c96555e` PR1 · `3f5aa81` PR2 · `fb17085` PR3–4 ·
`2979c86` PR5 · `62c3d53` PR6. Итог по фазам:
- **PR2 — Dashboard/Обзор:** KPI-плитки, «Заказы в работе»/«Загрузка цехов»/«Ближайшие дедлайны»,
  «Быстрые действия», «Уведомления» (`ErpDashboard` переписан; лейблы быстрых действий отличны от
  пунктов Sidebar во избежание коллизий `getByText` в App.test).
- **PR3–4 — примитивы + таблицы:** `erp/components/` — `Pagination`, `FilterBar`, `Drawer`; Закупка
  (`FabricPurchasing`) и Склад (`Warehouse`) приведены к макету: KPI-плитки, вкладки-чипы со счётчиками,
  пагинация (паттерн `safePage = min(page, pageCount)` вместо `setState` в effect — правило React
  Compiler), детали задач склада — в правом `Drawer`. `open` в Warehouse считается инлайн (ранние
  return в `useMemo` не сохраняются компилятором).
- **PR5 — карточка заказа как боковой Drawer:** общий хук `useOrderDetail` (события/аудит/комментарии
  + realtime, инлайн-правки, план этапов) — им же питается страница `OrderCard`; `OrderDrawer`
  (вкладки Информация/Маршрут/Материалы/Комментарии/История) + `OrderDrawerHost` в `ErpApp`; стор
  `useOrderDrawer` + хелпер `orderLinkClick` (ЛКМ → Drawer, Ctrl/Cmd/Shift → диплинк `/orders/:id`).
  Точки открытия: `KanbanCard`/`OrderRow`/`OrderCardMobile`/`QueueCard`.
- **PR6 — Подряд степпер + Эксперимент пайплайн:** `erp/components/Stepper.jsx` — нумерованная
  воронка готового изделия со счётчиками по 6 статусам (заменил статичную `flowStepper`-легенду);
  `erp/components/Pipeline.jsx` — фазы разработки образца (Лекала→Проработка→Примерка→Готов к серии)
  + боковой узел «Возврат конструктору». CSS: `.numStepper*`/`.pipe*` на токенах.
- Проверка: **1006 тестов**, lint/build чисто; headless-Playwright прогнан по всем экранам (route-mock
  Supabase REST; в свежем контейнере нужен `.env` с любым валидным URL/anon-key — REST перехвачен).

**PR1 — фундамент/оболочка (ветка `claude/warehouse-auto-fill-plan-9f9bhq`, перезапущена от main):**
- **Палитра из UI Kit, ERP-scoped:** токены переопределены на корне `.shell`
  (`:global(html) .shell` / `:global(html[data-theme='dark']) .shell` — выигрывают у :root/тёмной
  темы в обеих темах), Order Studio (ТЗ) **не затронут**. Primary `#2563EB`, статусы
  success `#10A34A`/warning `#F59E0B`/error `#EF4444`/info `#2563EB` + violet/cyan; светло-серый фон,
  белые карточки.
- **Sidebar** (`erp/layout/Sidebar.jsx`): вертикальный, сгруппирован (Главное/Операции/Настройки —
  «Производство» переименована в «Главное» во избежание коллизии с пунктом `/board`), иконки, активный
  пункт — синяя пилюля, **счётчики активных задач** по разделам, сворачивание в иконочный рельс (persist).
- **Header** (`ErpLayout`): поиск (визуальный, wiring — позже), колокол уведомлений со счётчиком
  просрочек, тема, ✏️ ТЗ, чип пользователя, выход. Раскладка `.shell` = Sidebar | (Header + прокруч. Main).
- **Badge** (`erp/components/Badge.jsx`) + перекраска `.chip*` под палитру (в работе=синий, ожидает=амбер).
- **Счётчики** (`orderHelpers.ts`): `activeOrdersCount`/`openWarehouseTaskCount`/`openProcurementCount`/
  `openSubcontractCount`/`activeExperimentalCount` (реэкспорт из `useErpStore`).
- Проверка: **1006 тестов** (+5), lint/build чисто; визуальная проверка через Playwright (свет/тьма/
  свёрнутый) — оболочка совпадает с макетом. (App.test: `waitFor` таймаут поднят до 4с — integration под нагрузкой.)

**Next steps (после мёрджа редизайна):** обновить эталоны visual-снапшотов (Playwright), когда UI
устаканится; wiring глобального поиска в Header; следующая очередь по продукту — мост «ТЗ →
авто-создание производственного заказа» и генерация ТЗ-PDF (см. CLAUDE.md «Логика продукта»).

## Состояние на 2026-07-22 (сессия 19) — Правки ПМ 4.1.3 + 4.2.1–4.2.4 (Склад / Подряд / Закупка)

**Замысел:** пять точечных правок логики склада/подряда/закупки. Полный редизайн фронтенда —
отдельным треком (`docs/erp/frontend-redesign-plan.md`, не реализован). План:
`/root/.claude/plans/rosy-wobbling-pie.md`. Все миграции применены на прод `pinhead-os-v2`.

**Миграции (на проде):**
- `20260722160000_erp_material_article_fact` — `erp_materials` += `article`, `fact_name`,
  `fact_color`, `fact_article`; RPC `erp_create_order` персистит `article`/`qty_expected`.
- `20260722170000_erp_warehouse_subcontract_receipt` — `erp_warehouse_tasks.task_type` +=
  `subcontract_receipt`; триггер `erp_warehouse_task_derive` не создаёт `pack_ship`, пока не
  принято готовое изделие от подрядчика.

**4.1.3 — Склад: авто-план при приёмке.** План (материал/цвет/артикул/кол-во) заводит закупка;
на приёмке он read-only, склад вносит только факт (`fact_*` + `qty_received`) — карточка приёмки
теперь блок «Поле / План / Факт» на каждый материал. `qty_expected` — **обязательная графа**
закупки (гейт в `maybeCloseSupply`: без плана этап «Закупка» не закрывается). Закупка
(`FabricPurchasing`) получила поля Цвет/Артикул/План(кг), инлайн-правки.

**4.2.1 — Подряд: обязательная приёмка готового изделия складом.** `shipped_by_contractor`
авто-создаёт задачу склада `subcontract_receipt`; после подтверждения (`SubcontractReceiptCard`,
чек-лист) op → `received_at_pinhead` + авто-`pack_ship`. Прямой кнопки shipped→received больше нет.

**4.2.2 — Подряд: без закупки для материала подрядчика.** `createOrder` убирает этап `supply`
из маршрута, если `material_source='contractor'` (ядро `buildRoute` не тронуто).

**4.2.3 — Подряд: «Отдельная операция» — операция + маршрут.** В создании заказа: поле «Операция»,
«Требуется доработка в Pinhead?» Да/Нет, «Следующий участок» (→ `return_dept`). После возврата
(`updateSubcontractOp`→`returned`): есть участок → готовый `erp_item_stage` на нём; нет → `pack_ship`.

**4.2.4 — Подряд: таблица переработана.** Текущий статус и следующее действие — в РАЗНЫХ колонках;
верхний Stepper-легенда маршрута готового изделия; `SearchInput` вместо инлайна.

**Оркестрация** кросс-сущностей (подряд↔склад↔маршрут) — в стор-слайсах (`subcontractingSlice`/
`warehouseSlice`), не в триггерах (тестируемо). Стор: **1001 тест** (+9). Lint/build чисто.

**Возможные следующие шаги:** старт трека редизайна (`docs/erp/frontend-redesign-plan.md`);
справочник операций подряда вместо текстового поля; живой QA прода по 5 сценариям.

## Состояние на 2026-07-21 (сессия 18) — Правки ПМ волна 4: маршрутизация по типу результата

**Замысел:** тип результата заказа при создании (серийное / доработка материала /
готовое изделие подрядчика / проработка-образец) строит маршрут; склад/подряд/эксперимент —
авто-наполняемые задачи маршрута, а не ручные модули. Доставка 3 волнами: **Склад → Подряд → Эксперимент**.
План: `/root/.claude/plans/elegant-watching-marble.md`.

**Решения (умолчания плана):** доставка волнами по порядку; склад/подряд/эксперимент — свои вкладки
с авто-наполнением (ядро `erp_item_stages` не ломаем, эксперимент — циклическая сущность);
отгрузка уходит на склад. Оркестрация авто-создания — триггеры БД (образец `erp_procurement_task_derive`).

**Волна 4.1 — Склад: задачи с жизненным циклом (в проде, PR следующий):**
- `erp_warehouse_tasks` (миграция `20260722120000`): задачи `material_receipt`/`marking`/`pack_ship`
  со статусами; realtime + бэкфилл. Триггер `erp_warehouse_task_derive` (`20260722130000`):
  авто-создание по переходам (supply done→приёмка; sewing in_progress→маркировка; все этапы done→pack_ship).
- `warehouseSlice.advanceWarehouseTask`; экран «Склад» = список задач с фильтрами; под-компоненты
  `screens/warehouse/`. **Отгрузка теперь только со склада** (pack_ship→shipped→shipOrder→архив);
  кнопка в карточке заказа убрана. Стор: 987 тестов.
**Волна 4.2 — Подряд: тип при создании + авто-создание (в проде):**
- Миграции (на проде): `erp_order_items` += `subcontract_kind`/`material_source`; статусы
  `erp_subcontracting` расширены циклом готового изделия; RPC `erp_create_order` персистит поля.
- Форма создания: селекты «Тип подряда»/«Материалы» при `production_type='outsource'`; `createOrder`
  авто-создаёт операцию подряда. Кнопочная стейт-машина готового изделия. Ревью-воркфлоу: 3 фикса.
- **Решение:** подряд — отдельная сущность с авто-созданием (ядро `buildRoute` не тронуто).

**Волна 4.3 — Эксперимент: маршрутизация проработки (в проде, без миграций):**
- `createOrder`: заказ-образец авто-заводит разработку (фаза patterns). Гейт «→ Проработка»
  требует лекала + приёмку материала складом. Бейдж локации образца (нанесения/швейка).
- **Волна 4 закрыта** (Склад 4.1 + Подряд 4.2 + Эксперимент 4.3, все в проде). 989 тестов.
- **Возможные следующие шаги (документированы, не сделаны):** подряд/эксперимент как литеральные
  этапы маршрута с распределёнными цепочками; складская приёмка «готового изделия» от подрядчика
  (received_at_pinhead → задача склада); параллельная закупка материала для проработки с гейтом.

## Состояние на 2026-07-20 (сессия 17) — Правки ПМ волна 3 (8 доработок, все в проде)

Доставлены волнами (PR #110–#116), каждая — мёрдж в прод + миграции на прод:
1. **Подряд**: `op_type` (готовое изделие/операция), `material_source` (Pinhead/подрядчик), `return_dept`.
2+3. **Склад**: числовая приёмка (`erp_materials` += qty_expected/received/accept_status/…),
   история `erp_warehouse_ops`, гейт закроя по приёмке, экран `Warehouse.jsx`, `warehouseSlice`.
4. **Брак** → цель `subcontractor` (единый механизм на всех цехах).
5. **Единый поиск**: `SearchInput` + `matchesOrderQuery` во все разделы (Мой цех/Производство).
6. **Эксперим. цех**: новый модуль `erp_experimental`(+ops) со стейт-машиной фаз, `experimentalSlice`,
   экран `Experimental.jsx`; убран из `QUEUE_DEPT_CODES`/`BASE_CHAIN.samples`.
7. **Уведомления**: `hasOpenProcurement` + «🔔 дозакупка» + панель `NotificationsSection` (без новой таблицы).
8. **Просрочки**: `stage_overdue_ack` (`overdue_comment`/`overdue_ack_at`), `stageOverdue`,
   `ackStageOverdue`, плашка «Требуется комментарий», бейдж+фильтр в «Мой цех».

Стор: 9 слайсов (добавлены `warehouseSlice`, `experimentalSlice`). 981 тест. Правки ПМ волны 3 закрыты.
Прод-проект Supabase: `pinhead-os-v2` (glhwbktsokphgksdvcxj).

**Follow-up после волны 3 (тот же branch, отдельный PR):**
- **Живой QA прода** (6/7 сценариев ✅). Найден и исправлен баг: `acceptMaterial` проставлял
  `accept_status`, но не `status='received'` → гейт закроя не срабатывал. Теперь приёмка ставит
  `status='received'`. QA-артефакты на реальных заказах 55948/43232 откачены на проде.
- **Realtime-публикация закрыта:** миграция `20260721180000_erp_realtime_publication` (на проде)
  добавила в `supabase_realtime` `erp_orders/order_items/materials/procurement_tasks/subcontracting/
  warehouse_ops/experimental/experimental_ops` — точечные подписки `realtimeSlice` теперь реально
  получают `postgres_changes` (раньше вещали только `erp_item_stages`/`erp_order_comments`).
- **Декомпозиция `Experimental.jsx`** (292 → 105): под-компоненты `screens/experimental/`
  (`ExperimentalCard`, `OpForm`).

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
- **Рефакторинг стора (завершён):** `useErpStore.ts` 1280 → 59 строк (composition-root).
  35 действий → 7 слайсов в `store/slices/` (orders/stages/materials/procurement/
  subcontracting/employees/realtime); контракт `ErpStore` (7 под-интерфейсов) + DTO в
  `store/types.ts`; плумбинг в `shared.ts`; чистые хелперы в `store/orderHelpers.ts`.
  Публичный API идентичен, 953 теста зелёные без правок тестов.
- **Декомпозиция экранов (завершена полностью):** `OrdersScreen` 1336 → 322 (`screens/orders/`),
  `DepartmentQueue` 821 → 292 (`screens/queue/`), `OrderCard` 638 → 293 (`screens/orderCard/`),
  `ErpKanban` 248 → 130 (`components/kanban/` + чистая `utils/kanbanColumns.js` с тестами).
  **Все 5 «Very Complex» файлов аудита разъяты; бэклог рефакторинга закрыт.** 958 тестов зелёные.

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
