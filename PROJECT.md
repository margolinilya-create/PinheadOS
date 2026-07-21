# Pinhead Order Studio — Проект

## История

### ERA 1 — Vanilla HTML (до марта 2026)
Весь проект в одном файле `pinhead-order-studio-v1_7__5_.html` (~9 500 строк).
Supabase через CDN. Финальная версия v1.7 — полностью функциональна для внутреннего использования.

Ушли от vanilla потому что: файл неподдерживаем, нет тестов, нет типов, невозможно масштабировать.

### ERA 2 — React Migration (февраль–март 2026)
Полная миграция в React 19 + Zustand. 138 коммитов. Воспроизведён весь функционал v1.7.

Ключевая сессия — 20 марта 2026 (56 коммитов): ревизия по Design Guidebook, 5 критических багов, 65 тестов на pricing.

### ERA 3 — Стабилизация + CRM/ERP (апрель 2026)
Сессии 1-5: баги, качество, UX, аудит UI, security hardening. Стратегический разворот к CRM/ERP интеграции.

---

## Changelog

### Сессия 18 (21.07.2026) — Правки ПМ волна 4: маршрутизация по типу результата

**План:** тип результата заказа (серийное / доработка / готовое изделие / проработка)
строит маршрут; склад/подряд/эксперимент — авто-наполняемые задачи маршрута, не ручные.
Доставка 3 волнами: Склад → Подряд → Эксперимент.

**Волна 4.2 — Подряд: тип при создании + авто-создание (в проде):**
- Миграции (на проде): `erp_order_items` += `subcontract_kind`/`material_source`;
  расширены статусы `erp_subcontracting` (готовое изделие: awaiting_payment→…→received_at_pinhead);
  RPC `erp_create_order` персистит поля подряда.
- При создании заказа с типом «Подряд» — селекты «Тип подряда» / «Материалы»; `createOrder`
  авто-создаёт операцию подряда (готовое → `awaiting_payment`). Кнопочная стейт-машина готового
  изделия в вкладке «Подряд»; отдельная операция — прежний select без finished-статусов.
- Adversarial-review (workflow, 3 находки исправлены): «Возврат» скрыт для готового изделия;
  смена типа согласует статус; `received_at_pinhead` не считается просрочкой. 988 тестов (+1).
- Решение: подряд остаётся отдельной сущностью с авто-созданием (ядро `buildRoute` не тронуто);
  подряд как литеральный этап маршрута — возможный следующий шаг.

**Волна 4.1 — Склад: задачи с жизненным циклом (в проде):**
- Новая таблица `erp_warehouse_tasks` (миграция `20260722120000`, на проде): задачи
  `material_receipt` / `marking` / `pack_ship` со статусами; realtime + бэкфилл активных заказов.
- Триггер БД `erp_warehouse_task_derive` (`20260722130000`, на проде): авто-создание задач
  по переходам маршрута (закупка done → приёмка; швейка в работу → маркировка;
  все этапы done → упаковка/отгрузка). Идемпотентно.
- Типы `WarehouseTaskType`/статусы + лейблы; `ErpOrderFull.warehouse_tasks` + `ORDER_SELECT` join.
- `warehouseSlice.advanceWarehouseTask` (optimistic+rollback, история операций); `acceptMaterial`
  закрывает задачу приёмки при полной приёмке; realtime подписан на `erp_warehouse_tasks`.
- Экран «Склад» переписан на список задач с фильтрами (тип/открытые); под-компоненты
  `screens/warehouse/` (MaterialReceiptCard/MarkingCard/PackShipCard).
- **Отгрузка теперь единственно со склада** (pack_ship→shipped → shipOrder → архив);
  кнопка отгрузки убрана из карточки заказа. 987 тестов (+6).

### Сессия 17 — Follow-up (20.07.2026) — Живой QA + realtime + декомпозиция

- **Живой QA прода** (Playwright, 6/7 сценариев ✅). Найден баг приёмки склада:
  `acceptMaterial` не проставлял `status='received'` → гейт закроя оставался закрыт после
  приёмки. Исправлено; тест обновлён. QA-артефакты на реальных заказах 55948/43232 откачены.
- **Realtime-публикация** (`20260721180000_erp_realtime_publication`, на проде): ERP-таблицы
  добавлены в `supabase_realtime` — точечные подписки `realtimeSlice` теперь получают
  `postgres_changes` (раньше вещали только `erp_item_stages`/`erp_order_comments`).
- **Декомпозиция `Experimental.jsx`** (292 → 105) на `screens/experimental/` (`ExperimentalCard`,
  `OpForm`). 981 тест зелёный (1 pre-existing флак `App.test` — проходит в изоляции).

### Сессия 17 (20.07.2026) — Правки ПМ волна 3 (8 доработок, доставка волнами)

**Wave 1 (правка 1) — Подряд: два типа операций + источник материалов:**
- Миграция `20260721120000_erp_subcontracting_types.sql` (на проде): `erp_subcontracting`
  += `op_type` (finished_product/operation), `material_source` (pinhead/contractor), `return_dept`.
- Типы `SubcontractOpType`/`SubcontractMaterialSource` + лейблы; поля в `ErpSubcontractOp`.
- `Subcontracting.jsx`: селекты типа/источника + «Возврат на цех» для операции, колонки таблицы.
- Материалы подрядчика (not_needed) не гейтят закрой. 961 тест (+3). PR #110.

**Wave 2 (правки 2, 3) — Склад: числовая приёмка + история операций:**
- Миграции (на проде): `20260721130000_erp_material_acceptance.sql` (`erp_materials` +=
  qty_expected/qty_received/accept_status/accepted_at/accepted_by/accept_comment, грандфазер
  существующих received → accepted_full); `20260721140000_erp_warehouse_ops.sql` (таблица истории).
- Гейт закроя (`routes.ts`): пришедший материал годен только после приёмки складом
  (accepted_full/partial); недостача/пересорт/отказ блокируют. Причина «Ожидает приёмки складом».
- Типы `MaterialAcceptStatus`/`WarehouseOpType` + лейблы; `ErpWarehouseOp`; `warehouse_ops` в
  `ErpOrderFull`/`ORDER_SELECT`. Новый `warehouseSlice` (`acceptMaterial`, `logWarehouseOp`).
- Новый экран `Warehouse.jsx` (nav «📦 Склад», роут `/warehouse`): приёмка план/факт/статус,
  история склада, упаковка/отгрузка/маркировка. 965 тестов (+4). PR #111.

**Wave 3 (правка 4) — Возврат брака: цель «подрядчику»:**
- `reportDefect` += target `subcontractor` (этап в ожидание + `createSubcontractOp` тип
  «операция», возврат на текущий цех). `ReportDefectOptions` += `subcontractOperation`/`contractor`.
- `QueueCard` defect-форма: пункт «Отправить подрядчику» + поля операция/контрагент.
  Единый механизм возврата на всех цехах (форма уже была на всех). 966 тестов (+1). PR #112.

**Wave 4 (правка 5) — Единый поиск во всех разделах:**
- Общий компонент `components/SearchInput.jsx` + матчер `utils/orderSearch.js`
  (`matchesOrderQuery`: № заказа/сделки, название, менеджер, изделие, материал).
- Поиск добавлен в `DepartmentQueue` (Мой цех) и `ProductionBoard` (таблица) — раньше их не было.
  Прочие разделы уже используют `styles.searchInput` (единый вид). 972 теста (+6). PR #113.

**Wave 5 (правка 7) — Уведомления по дозакупке (лёгкий вариант):**
- Хелпер `hasOpenProcurement(procurement_tasks)` в `routes.ts` (задача ∉ done/cancelled).
- Яркое выделение «🔔 дозакупка» на заказах в списке (`OrderRow`/`OrderCardMobile`).
- Панель «🔔 Требуют внимания» в `OrderCard` (`orderCard/NotificationsSection`): открытые задачи
  закупки — что / с какого этапа / причина / статус + переход в «Закупка». Без новой таблицы
  (реюз procurement_tasks). 974 теста (+2). PR #114.

**Wave 6 (правка 8) — Контроль просроченных этапов:**
- Миграция `20260721150000_erp_stage_overdue_ack.sql` (на проде): `erp_item_stages` +=
  `overdue_comment`, `overdue_ack_at`.
- `time.ts` `stageOverdue(planned_end, status)` (planned_end истёк, этап не done/skipped).
- Стор `ackStageOverdue(stageId, comment)`. `QueueCard`: плашка «Требуется комментарий» при
  просрочке без ack (красная рамка сохраняется); после коммента плашка исчезает.
- `DepartmentQueue`: бейдж «⏰N» необработанных просрочек на вкладках (`overdueUnackCountFor`)
  + фильтр-чип «Только необработанные просрочки». 978 тестов (+5). PR #115.

**Wave 7 (правка 6) — Экспериментальный цех (новый под-модуль):**
- Миграции (на проде): `20260721160000_erp_experimental.sql` (воронка со стейт-машиной фаз),
  `20260721170000_erp_experimental_ops.sql` (передачи в швейку/на нанесения с авто-возвратом).
- Фазы: `patterns` (лекала, конструктор; гейт по tech_name+табелю) → `development` (проработка,
  технолог; передачи `to_sewing`/`to_branding` → авто-возврат на development) → `final_fitting`
  (итог: утверждён/доработка/повторное нанесение/изменение лекал→конструктору/готов к серии) →
  `done`. `returned_to_constructor` — возврат конструктору.
- `experimentalSlice` (lazy): load/create/update, createExperimentalOp, completeExperimentalOp
  (авто-возврат). Экран `Experimental.jsx` (nav «🧪 Эксперим. цех», роут `/experimental`).
- `experimental` убран из `QUEUE_DEPT_CODES` и из `BASE_CHAIN.samples` — вынесен из общей воронки.
- **Все 8 правок ПМ волны 3 в проде.** 981 тест (+3). PR #NNN.

### Сессия 16 (20.07.2026) — Распил useErpStore на 7 слайсов + декомпозиция экранов

**Декомпозиция крупных экранов (техдолг аудита, завершено):**
- `OrdersScreen.jsx` 1336 → 322 → `screens/orders/` (DueCell, OrderRow, OrderCardMobile,
  CreateOrderModal + SizeGridEditor/FormSection/FieldError).
- `DepartmentQueue.jsx` 821 → 292 → `screens/queue/` (Lightbox, PhotoAttach, TzBlock, QueueCard).
- `OrderCard.jsx` 638 → 293 → `screens/orderCard/` (format, PlanCell, StageStepper,
  OrderItemSection, CommentsSection, HistorySection).
- `ErpKanban.jsx` 248 → 130 → `components/kanban/` (KanbanCard, useTouchDndPolyfill) +
  `utils/kanbanColumns.js` (чистая группировка + 5 юнит-тестов).
- **Все 5 «Very Complex» файлов аудита разъяты.** JSX-вывод идентичен, 958 тестов зелёные.

**Распил стора (PR #107, в проде):**

- **Рефакторинг стора (завершён):** `useErpStore.ts` 1280 → 59 строк (composition-root).
  35 действий разнесены на 7 доменных слайсов в `store/slices/`: orders, stages, materials,
  procurement, subcontracting, employees, realtime. Общие чистые хелперы (`findStage`,
  `patchStageIn`, `sortOrderFull`, `ORDER_SELECT`, `readyCountFor`, `withNewWorkToast`,
  `orderPreviewUrl`, `lastDefectPhotoUrl`) → `store/orderHelpers.ts`. Контракт `ErpStore`
  разбит на 7 под-интерфейсов в `store/types.ts` (пересечение = `ErpStore`).
- Чисто организационный шаг: публичный API, сигнатуры и пути импорта не менялись
  (11 экранов и тесты импортируют из `./useErpStore` как раньше). **953 теста зелёные без
  правок тестов** — доказательство неизменности API. Lint 0, build ок.
- Осталось (бэклог): разбить крупные экраны `OrdersScreen`/`DepartmentQueue`.

### Сессия 15 (20.07.2026) — Ruflo + мульти-агентный аудит ERP + фиксы

- **Ruflo v3.32.8** (claude-flow) установлен в репо (`.claude/`, PR #102): агенты,
  команды, скиллы, хуки координации. Runtime — в `.gitignore`.
- **Мульти-агентный аудит ERP** (рой из 5 агентов Ruflo) → `docs/erp-audit.md`.
  Метрики `ruflo analyze`: `useErpStore.ts` цикл. 96 / 1251 стр.
- **Фиксы аудита (PR #103):** гейт «на закупку» (открытая задача блокирует этап,
  `isStageAwaitingProcurement`); проверка результата `createProcurementTask`; realtime на
  materials/procurement/subcontracting; server-триггер целостности `kind`/`counts_as_purchase`;
  «Invalid Date» защита во всех экранах; +10 тестов (950 всего).
- **Рефакторинг (PR C):** инфраструктура стора вынесена в `store/shared.ts` (шаг 1;
  полный распил на слайсы — в бэклоге, план в `docs/erp-audit.md`).
- Открыто (бэклог/продуктовые решения): RLS-модель admin-разделов, валидация qty брака,
  переоткрытие промежуточных этапов, гейт «сиротских» материалов, назначение исполнителя задачи.

### Сессия 14, фаза 3 (19.07.2026) — Вкладка «Подряд»

- **Правки ПМ (волна 2), правка 5.** Новая таблица `erp_subcontracting`
  (миграция `20260719140000`, применена на прод) + вкладка «Подряд» (`/subcontracting`,
  admin) в ERP: контроль операций у внешних подрядчиков — контрагент, кол-во, даты
  передачи/готовности/возврата, статус, комментарий задержки, авто-пометка «Просрочено».
- Стор: `subcontracting` state, `loadSubcontracting` (join заголовка заказа),
  `createSubcontractOp`, `updateSubcontractOp`. Экран `Subcontracting.jsx` + пункт nav.
- Тесты 933 → 939, lint 0, build ок. Все 6 правок волны 2 — в проде.

### Сессия 14, фаза 2 (19.07.2026) — Материал со склада + SLA закупки

- **Правки ПМ (волна 2), правки 4, 6.**
- **Склад → закрой** (правка 4): статус `reserved` («Доступен со склада»,
  миграция `20260719130000`, применена на прод). Материал `source='stock'` рождается
  `pending`; кнопка «Подтвердить наличие» → `reserved` → открывает закрой.
- **Баг-фикс**: авто-закрытие этапа «Закупка» вынесено в `maybeCloseSupply` и вызывается
  теперь и из `addMaterial` (раньше — только из `updateMaterial`, из-за чего добавление
  сразу-готового материала не закрывало закупку).
- **SLA закупки** (правка 6): `procurementSla(created_at, status)` — норматив 3 дня;
  чип «На обработке»/«Просрочено» у закупаемых материалов.
- Тесты 924 → 933, lint 0, build ок. Дальше — фаза 3 (Подряд).

### Сессия 14, фаза 1 (19.07.2026) — Возврат из закроя: задачи закупки + выбор этапа переделки

- **Правки ПМ (волна 2), правки 1-3.** Новая таблица `erp_procurement_tasks`
  (миграция `20260719120000`, применена на прод): отдельная задача закупщику при
  возврате из закроя — исходная закупка не перезаписывается.
- **Классификация причины** (правка 2): брак поставщика → замена (не считается
  закупкой компании), внутренние причины → дозакупка. `cause_type` → `kind`/`counts_as_purchase`.
- **Маршрут переделки** (правка 3): `reportDefect(stageId, opts)` — пользователь
  выбирает этап устранения (текущий / конкретный цех / закрой / на закупку) + флаг
  «нужен новый материал» → создаётся задача закупки. Форма брака в «Мой цех» расширена.
- **UI закупки**: секция «Задачи на дозакупку/замену» под каждым заказом.
- Тесты 920 → 924, lint 0, build ок. Фазы 2 (склад+SLA) и 3 (Подряд) — следом.

### Сессия 13 (18.07.2026) — Правки проджект-менеджера: 10 доработок ERP

- **Заказы**: колонка «Создан» + фильтр по диапазону дат создания.
- **Закупка**: поиск (заказ/№ сделки/материал), колонка и поле «Поставщик»
  (`supplier`), обязательный план прихода для закупаемых материалов.
- **Мой цех/Закрой**: гейт запуска этапа только «своими» материалами
  (`MATERIAL_GATE_DEPT`: ткань→закрой, фурнитура/бирки→швейка); планы прихода
  недостающих материалов в причине ожидания и ТЗ; обязательная плановая дата
  завершения при «Взять в работу».
- **Брак**: деление партии — N брака возвращаются на предыдущий этап, годные идут
  дальше; получателю виден баннер с кол-вом, причиной и фото.
- Хелпер `formatDateShort`; правило «общаемся на русском» в обоих `CLAUDE.md`.
- Миграции БД не потребовались (колонки уже были). Тесты 901 → 920, lint 0, build ок.
  Визуальные эталоны `erp-orders`/`erp-queue` — пересобрать в CI (UI изменён намеренно).

### Сессия 12, часть 2 (17.07.2026) — Отгрузка, QA-прогон, зелёный CI

- **Отгрузка**: стадия «Готов к отгрузке» (все этапы done) → «🚚 Отгрузить»
  → архив со статусом по сроку; shipped_at/by, история через аудит.
- **CI**: baseline-миграция базовой схемы (Supabase Preview зелёный),
  visual-эталоны per-project + автокоммит эталонов из workflow_dispatch.
- **Полный QA-прогон** (11 зон, враждебный): 0 critical, 1 major
  (брак > тиража — починен сразу), 8 minor (3 починены, остальные в бэклоге).
- QA-мост для контейнера: scripts/qa-supabase-bridge.mjs.
- Тесты 887 → 901.

### Сессия 12 (17.07.2026) — Юзабилити-аудит ERP: 38 улучшений (91 тест новый)

**Формат:** аудит кода (43 находки) → 38 вопросов заказчику с вариантами →
все утверждены → 5 коммитов по блокам. Тесты 796 → 887, lint 0, build ок.

- **Цех:** автопривязка цеха из erp_employees (чужие — read-only), полное ТЗ
  в карточке очереди (сетка/нанесения/упаковка/материалы), ссылка на заказ,
  превью+лайтбокс, частичная готовность qty_done (миграция), фото брака/блока,
  бейдж готовой работы в навигации, фикс NaN qty_rework.
- **Форма заказа:** автосейв черновика + confirm, аккордеон-секции, инлайн-
  валидация, пресеты сеток чипсами, авторасчёт qty из сетки, обязательное
  нанесение при брендировании, дефолт дат + buffer_days, focus-trap/Escape.
- **Мобильная:** брейкпоинт 480px, полноэкранная модалка, карточки вместо
  таблицы заказов, touch-DnD канбана (mobile-drag-drop), тач-таргеты 44px,
  градиенты вкладок, PWA manifest + иконки.
- **Техбаза:** только активные заказы + ленивый архив, точечный realtime
  вместо loadAll, защита от race, RPC erp_create_order (атомарно, миграция),
  lazy loading экранов, дедупликация утилит, ретрай аудита.
- **Полировка:** скелетоны, line-clamp названий, фикс is_branding,
  токены --overlay/--shadow-modal (dark mode), текст ≥12px, empty states,
  onError-заглушки превью.

### Сессия 11 (16–17.07.2026) — Внутреннее ERP: с нуля до прода

**Разворот:** ТЗ/цены заморожены (в ящик за feature-flag ?studio=1),
построено внутреннее ERP производства. Логика: ТЗ → Производство.

**Фазы 0–3 (MVP):** зачистка старого ERP в БД (бэкап у заказчика),
схема erp_* (заказ → позиции → этапы-граф depends_on), маршруты по типу
производства с параллельными ветками нанесений (21 тест), экраны:
Обзор/Заказы/Производство/Мой цех/Закупка. Автозакрытие закупки по приходу
материалов. Импорт 100 заказов из Google-таблицы менеджера (39 активных).

**Редизайн:** дизайн-язык Order Studio (вкладки, синий акцент), вкладки
цехов со счётчиками, живой QA-прогон с реальными данными.

**Перенос kontora24 (4 волны):** канбан цехов (наш HTML5 DnD, drag=статус
внутри колонки, время-в-этапе, дедлайн-точки) · карточка заказа (InlineEdit,
степпер, audit-триггер + единая история, чат с realtime) · форма (плитки,
error-summary, Ctrl+V превью) · realtime всего ERP + уведомления цехам.
Анализ конфликтов: логика PinheadOS приоритетна (docs/erp/kontora24-integration-plan.md).

**Объединение:** сотрудники = общие profiles (ERP-экран в формате Админки
+ цех/цеховая роль), единая админка AdminScreen в обоих режимах
(Пользователи/Цеха/Заказы ТЗ), финальное разделение разделов.

**Поля ТЗ** (по примеру [53528]): erp_item_prints (нанесения: техника,
зона, В×Ш, отступ, Pantone), size_grid (цвет×размер, сумма→тираж),
упаковка/стикеры/Честный знак, материалы role/color/supplier. Форма +
карточка. E2E: заказ-копия ТЗ прошёл создание→отображение.

**Инфраструктура:** сотрудники/брак/частичная выработка/план-даты,
поставлено 8 миграций, 831 unit-тест зелёный, e2e desktop, живые прогоны
через Supabase-мост. Документы: SESSION-STATE.md, docs/DESIGN.md,
docs/erp/* (mvp-plan, spreadsheet-analysis, kontora24-*, tz-format-analysis).


### Сессия 10 (11.04.2026) — SKU как центр управления ТЗ (28 файлов, 796 тестов)

**Фаза 1: Ценообразование → SKU Editor**
- PriceEditor извлечён в PricingTabContent (переиспользуемый компонент)
- 6-й таб «Ценообразование» в SkuEditor с dirty-индикатором
- Секция «Экономика» (read-only себестоимость) в SkuDetailModal
- `/prices` → redirect `/sku?tab=pricing`, кнопка убрана из Header

**Фаза 2: Правила категорий**
- Типы: CategoryRules, CategoryRulesOverrides, ZoneDefinition
- getEffectiveRules() — мерж категория + per-SKU overrides (29 unit-тестов)
- 7-й таб «Правила категорий» — аккордеон с техниками, MOQ, размерами, zone↔tech матрицей
- Секция «Переопределения» в SkuDetailModal

**Фаза 3: Умный визард**
- useEffectiveRules() хук для визарда
- ZoneTechBlock — disabled техники, SizeTable — фильтр размеров
- ColorPicker — фильтр палитры, selectSku — авто defaultExtras + labelPresets
- StepSummary — MOQ warning

**Фаза 4: Продвинутые правила**
- priceMultiplier в getSkuEstPrice() — per-SKU множитель себестоимости
- Per-SKU color picker (swatch grid), Zone↔Tech матрица

**Динамические зоны + per-SKU конфигурация:**
- ZoneDefinition тип + ZONES_CATALOG_DEFAULT (8 зон)
- zonesCatalog в catalogSlice (Supabase + localStorage)
- 8-й таб «Зоны нанесения» — CRUD зон (add/rename/delete)
- Убран хардкод ALL_ZONES из 4 файлов → getAvailableZonesForSku()
- Per-SKU: allowedFabrics, allowedExtras, availableSizes в SkuDetailModal
- Wizard: FabricGrid + ExtrasAccordion фильтруют per-SKU

**Тестирование и качество:**
- Supabase mock в setupTests.js — починены 18 падавших тестов
- 796 unit-тестов (41 файл), все зелёные
- E2E: sku-editor.spec.ts (8 сценариев навигации/табов)
- Аудит: 6 багов найдено и исправлено (pricingDirty, ложный autosave, toast, TECHS дупликат, etc.)
- Мобильная адаптация: горизонтальный скролл табов, compact layout

### Сессия 9 (11.04.2026) — консолидация SKU-редактора (10 файлов)

**Data flow cleanup:**
- Hardware + extras перенесены из useState в Zustand store (catalogSlice)
- Hardware + extras сохраняются в Supabase (app_config) при saveAll()
- Удалён дубль цен: PriceEditor больше не пишет в catalog_config
- Удалено мёртвое поле photoUrl — везде photos[0]
- SkuItem тип обновлён: добавлены photos, description, sizeChart, article
- ExpressCalc читает из store вместо data/ — видит правки из редактора
- Убран дубль input курса USD из actions bar
- Индикатор несохранённых изменений (точка) на всех табах редактора

**Mobile UI:**
- SKU-карточки на step 1: text wrap, auto height, full-width кнопка
- SKU editor table: visible numbers, wider columns, no spinners

### Сессия 8 (10.04.2026) — архитектурные фиксы (10 файлов, 14 новых тестов)

**Каталоги и persistence:**
- catalogs.ts: partial failure logging (catalog_config/app_config падают независимо), валидация обязательных ключей
- catalogSlice.ts: usdRate fallback из localStorage (try + catch), fallback на top-level catalogs.usdRate
- Фикс: usdRate больше не теряется при перезагрузке когда Supabase недоступен

**Auth state machine:**
- Новый тип `ProfileStatus`: active | pending_approval | disabled | no_profile
- useAuthStore.ts: `profileStatus` поле, `fetchProfile` определяет статус по active+approved
- Удалённый пользователь → `user: null` вместо phantom manager (ghost-доступ закрыт)
- types/auth.ts: поле `active: boolean` на User и Profile

**Soft-delete пользователей:**
- Миграция: `ALTER TABLE profiles ADD COLUMN active BOOLEAN NOT NULL DEFAULT true`
- AdminPanel.jsx: деактивация вместо hard delete, кнопка реактивации, визуальный маркер "Деактивирован"

**Dev/prod consistency:**
- useOrdersStore.ts: duplicateOrder фильтрует 'dev' из created_by (как saveOrder)

**SKU фото:**
- storage.ts: deleteSkuPhotoByUrl возвращает boolean, логирует ошибки
- SkuDetailModal.jsx: проверяет результат удаления, toast.error при ошибке

**Тесты:** +14 (catalogs.test.ts — 5, useAuthStore.test.js — 5, useOrdersStore.test.js — 1, storage.test.js — 3)
**Verification:** 735 тестов ✓, lint 0 ошибок, build ✓

### Сессия 7 (10.04.2026) — техдолг, UX/UI, SKU каталог (24 коммита)

**Техдолг:**
- God-компоненты разбиты: SkuEditor (844→419), StepGarment (680→75), KanbanBoard (630→277) → 14 подкомпонентов
- TypeScript: 15 файлов JS→TS (все store/slices, utils, lib включая pricing.ts)
- E2E: 9→40 сценариев (7 файлов), покрытие всех роутов + dark mode
- Recharts→Chart.js: Dashboard 393→199 KB (-49%)
- Lazy-load wizard steps 2-5: main bundle 943→576 KB (-39%)

**5-агентный аудит (26 находок → все закрыты):**
- UX: empty states с иконками, Express redesign, sticky PriceEditor headers
- A11y: focus trap модалки, aria-labels, keyboard DnD (Arrow Left/Right), :focus-visible
- Mobile: touch targets 36px+, scroll affordance, Express stacking
- Design system: button consolidation (7→1 с variants), ~120 spacing tokens, ~40 color tokens, inline→CSS
- CSS: --font-mono баг, ЭКСПРЕСС красный→синий accent

**UX/UI фичи:**
- Dark mode (полная тёмная тема + ~60 CSS фиксов + toggle в хедере)
- Анимации: fadeSlideIn визард, slideInRight drawer, scaleIn модалки, hover-эффекты
- Skeleton loading: shimmer-компоненты для Kanban/Dashboard/Admin
- Wizard progress bar (заполняемая полоска по шагам)
- DnD визуал: ghost card, dashed drop zone, grab cursor
- Onboarding: 3-шаговые tooltips для новых пользователей
- Cmd+K command palette для быстрой навигации
- Zebra striping + hover на всех таблицах
- Kanban card polish: shadow, rounded corners, hover lift
- Garment category icons → заменены на реальные фото/мокапы

**SKU каталог — расширение:**
- SkuDetailModal: модалка полного редактирования SKU (фото, описание, табель мер, зоны, параметры)
- До 4 фото на SKU через Supabase Storage (drag&drop upload)
- Короткое + полное описание, sizeChart с редактируемой таблицей
- Expandable cards в визарде: клик→раскрытие панели с галереей, описанием, размерами, зонами
- Supabase: создана таблица app_config, RLS policies, Storage bucket sku-photos
- Фикс persistence: key mapping sku_catalog→skuCatalog, cache invalidation, localStorage fallback

**Чистка:** PNG из корня, .gitignore, старые планы, обновлены все docs.
**Vercel:** добавлены env-переменные Supabase (фикс белого экрана на проде).

### Сессия 6 (09.04.2026) — закрытие 10-agent аудита
Полное закрытие бэклога `docs/plans/2026-04-09-pinhead-react-audit.md` (30/30 задач).
- **CSS hygiene**: убраны все `!important` из проекта (22 инстанса → 0; остался только задокументированный `@media (prefers-reduced-motion)` как W3C exception). Замена — повышение специфичности селекторов / double-class boost.
- **a11y**: `PriceEditor` — 20 `<div className="pe-input-row">` → `<label>` (неявная ассоциация), aria-label на все matrix-инпуты (screen / flex / markup). KanbanBoard — shortcuts-диалог получил role="dialog" + aria-label.
- **CSS Modules**: инлайн-стили мигрированы из `StepDesign.jsx`, `Dashboard.jsx`, `KanbanBoard.jsx` (дра́вер + shortcuts-модалка + колоночные заголовки). Динамические значения (цвета из STATUS_COLORS, ширины) остаются inline как должно быть.
- **TypeScript**: `useStore.js` → `useStore.ts`, `useOrdersStore.js` → `useOrdersStore.ts`. Типизирован `OrdersStore` интерфейс, `STATUS_LIST/LABELS/COLORS` получили `OrderStatus`-типы, payload-ы описаны через `Order`/`OrderData`. Слайсы `useStore` остаются JS — загнаны через loose `SlicePart` type.
- **E2E**: добавлен `e2e/navigation.spec.ts` — smoke-тесты kanban/express/wizard навигации + открытие shortcuts-диалога по `?` и закрытие по Esc.
- **Verification**: lint 0 errors, 721/721 unit-тестов, build ✓.

### Сессия 5 (08.04.2026)
- Security: убраны хардкод Supabase ключи, .env обязателен
- Security: sanitizeHex XSS-защита SVG мокапов
- Auth: validatePassword + отображение ошибки, storageClearAll при logout
- Docs: консолидация 4 файлов -> CLAUDE.md + PROJECT.md

### Сессия 4 (08.04.2026)
- UI/UX аудит: WCAG AA контраст, design tokens, touch targets 44px, mobile responsive
- PageHeader компонент, нумерация шагов 01-05
- Удалены шаблоны заказов (не нужны)
- Стратегический разворот: Bitrix24 + Pinhead + 1С

### Сессия 3 (07.04.2026)
- Комментарии к заказу, пагинация (50 + загрузить ещё)
- SVG мокап в PrintPreview, keyboard shortcuts в Kanban
- useBlocker (блокировка навигации), дедлайн min/предупреждение
- Store audit: rollback/toast, useShallow (16 селекторов), memo()
- Dashboard lazy — бандл -26% (1537 -> 1142 KB)
- 3 Playwright E2E теста, 15 Claude Code скиллов

### Сессии 1-2 (06.04.2026)
- Фиксы: saveOrder/updateOrder/deleteOrder ошибки Supabase
- Визард 6 -> 5 шагов, кнопка "Повторить заказ"
- Топ артикулов в аналитике

---

## Статистика (10.04.2026, конец сессии 8)

| Метрика | Значение |
|---------|----------|
| Тесты (unit) | 735 |
| Тесты (E2E) | 40 сценариев (7 файлов) |
| TypeScript | store, slices, utils, lib, types — 100% .ts |
| Бандл main | 576 KB (было 943) |
| Бандл Dashboard | 199 KB (было 393) |
| Dark mode | полная поддержка |
| Supabase Storage | sku-photos bucket |
| SKU фото | до 4 на артикул |
| Auth states | active, pending_approval, disabled, no_profile |
| User deletion | soft-delete (active column) |
| God-компоненты (>500 строк) | 0 |

---

## Roadmap

### Закрыто
Все P0/P1/P2 задачи сессий 1-4: баги, качество, UX, UI/UX аудит.

### Фаза 2 — Планирование производства (следующая)
- [ ] Supabase таблицы: production_slots, production_capacity
- [ ] Триггер: approved -> автогенерация слотов
- [ ] ProductionBoard.jsx — недельный/Gantt вид
- [ ] WeeklyCapacity.jsx — бары загрузки
- [ ] useProductionStore.js
- [ ] Загрузка производства в StepDetails (дедлайн)

### Фаза 1 — Bitrix24 sync (после уточнения доступа)
- [ ] Edge Function: bitrix-inbound
- [ ] Edge Function: bitrix-sync
- [ ] integration_sync + status_mapping таблицы
- [ ] Frontend: компонент связи с Bitrix в StepDetails

### Фаза 3 — 1С интеграция
- [ ] Edge Function: 1c-export
- [ ] 1С HTTP Service (нужен 1С-разработчик)

### Фаза 4 — Управленческий дашборд
- [ ] Production heatmap + deadline risk
- [ ] Supabase Realtime подписки

### Арх. фиксы Batch 2 (после текущего PR)
- [ ] Типизация store: замена `Record<string, unknown>` на строгие интерфейсы слайсов
- [ ] Чистка тестовых предупреждений: act() wrapping, глобальный Chart.js/canvas mock
- [ ] Нормализация error objects в storage/catalog слое
- [ ] Консолидация хранения prices (сейчас дублируется в app_config + catalog_config)

### Отклонено / отложено
- Покупательский портал /order — приоритет сменился на CRM/ERP
- TypeScript миграция остальных `utils/pricing.js` (418 строк pricing-движка) + слайсы `useStore` — инкрементально, по мере касания кода
- Split `SkuEditor.jsx` (842 строки god-component на 5 tab'ов) — отложено: низкий ROI без активного касания, высокий риск регрессий
