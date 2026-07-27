# PINHEAD Order Studio — pinhead-react

## Проект
ERP/CRM для типографии (печать на одежде). React 19 + Vite 7 + Zustand 5 + Supabase.
URL: https://pinhead-os.vercel.app

## Два раздела (переключение в шапке, admin/director)
- **erp/** — 🏭 Производство (по умолчанию): ErpApp (lazy-экраны), layout,
  screens (Dashboard/Orders/OrderCard/ProductionBoard+Kanban/DepartmentQueue/
  ProductionTask/FabricPurchasing/AdminScreen; крупные экраны разбиты на под-компоненты:
  screens/orders/ — DueCell/OrderRow/OrderCardMobile/CreateOrderModal
  (+ create/: SizeGridEditor, FormParts, ItemBlock, TzSection — форма разрезана);
  screens/queue/ — Lightbox/PhotoAttach/TzBlock/QueueCard/QueueRow (компактная строка)/
  StageActionsPanel + useStageActions (действия цеха, общие со страницей задания);
  screens/orderCard/ — format/PlanCell/StageStepper/OrderItemSection/CommentsSection/HistorySection +
  useOrderDetail (общий хук данных)/OrderDrawer/OrderDrawerHost (боковая карточка, редизайн)/
  TzDocsSection (ТЗ в PDF: загрузка, назначение цехам, версии);
  screens/admin/ — PermissionsTab (матрица прав)/DictionariesTab (справочники + статусы r/o);
  screens/warehouse/ — MaterialReceiptCard (план/факт, правка 4.1.3)/MarkingCard/PackShipCard/
  SubcontractReceiptCard (приёмка от подрядчика, правка 4.2.1) — задачи склада),
  screens/purchasing/ — SupplierOptionsModal (сравнение вариантов поставщика, правка 10),
  components (ErpKanban + kanban/ KanbanCard/useTouchDndPolyfill, InlineEdit, PageHead, ErpSkeletons,
  RouteProgress (маршрут в штуках), QueueFilters, DictionaryDatalist, TzViewer (PDF в iframe) +
  редизайн-примитивы: Badge/Drawer/Pagination/FilterBar/Stepper/Pipeline), store/ (composition-root
  useErpStore.ts + слайсы в slices/ + useOrderDrawer.ts (боковая карточка) + useErpSearch.ts (глоб. поиск)
  + useErpAccess.ts (права: can/canActIn/canDo) + useDictionary.js (активные значения справочника);
  orders/stages/materials/procurement/subcontracting/employees/permissions/dictionaries/tz/realtime;
  контракт+DTO в types.ts, плумбинг в shared.ts, чистые хелперы в orderHelpers.ts;
  точечный realtime, ленивый архив, RPC erp_create_order, pendingMutations),
  utils (routes/time/stageUi/orderForm/progress/filterStages/queueEntries/queueOrder/
  stageMove/permissions/tz + tzFile),
  data/departments, types.ts, erp.module.css (брейкпоинты 760/480,
  pointer:coarse). Touch-DnD канбана: mobile-drag-drop (dynamic import).
  PWA: public/manifest.webmanifest + icon-192/512.
- **orderstudio/** — ✏️ ТЗ (Order Studio, за флагом orderStudio): визард,
  SKU, аналитика. Компоненты ниже — его состав.
- Единая админка: erp/screens/AdminScreen смонтирован в оба раздела.
- Правила ERP: см. SESSION-STATE.md и docs/DESIGN.md в корне репо.

## Структура src/
- components/ — UI-компоненты
  - steps/ — Визард: StepGarment → StepDesign → StepItems → StepDetails → StepSummary (lazy 2-5)
  - steps/garment/ — SkuList (expandable cards), FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
  - orders/ — KanbanBoard, KanbanCard (keyboard DnD), OrderDrawer
  - editors/ — PriceEditor (wrapper), SkuEditor (8 табов), ExpressCalc
  - editors/sku/ — SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal, ZonesModal, SkuDetailModal
  - analytics/ — Dashboard (Chart.js)
  - auth/ — AuthScreen, AdminPanel
  - layout/ — Header (dark mode toggle), ProgressBar (fill bar)
  - output/ — PrintPreview
  - shared/ — ErrorBoundary, Toast, PageHeader, Skeleton, OnboardingTips, CommandPalette, PriceBreakdown, RolePreviewBar
- store/ — Zustand (все .ts)
  - useStore.ts — главный store (7 слайсов)
  - slices/ — все .ts: wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice
  - useAuthStore.ts, useOrdersStore.ts, useCommentsStore.ts, useToastStore.ts, useConfirmStore.ts
- utils/ — все .ts: pricing, skuRules, validate, mockup, deadline, i18n
- lib/ — все .ts: supabase, api, storage (+ Supabase Storage: sku-photos), catalogs
- types/ — TypeScript типы: order, catalog, auth, pricing
- data/ — fallback данные: prices, skuCatalog (с description, sizeChart, photos), extras, fabrics, colors
- hooks/ — useDraft.js, useFocusTrap.js, useEffectiveRules.ts, useMediaQuery.js, useScrollHints.js, useScrollRestore.js

## Ключевые правила
- Общение с пользователем: всегда на русском языке
- Цены: getPrices() -> store -> localStorage -> DEFAULT_PRICES
- Каталоги: Supabase (app_config + catalog_config) -> localStorage -> defaults
- Все каталоги в Zustand store (catalogSlice): skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, labelsCatalog
- app_config хранит: sku_catalog, prices, extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog
- catalog_config хранит: fabricsCatalog, trimCatalog
- SKU Editor: 8 табов (items, fabrics, trims, extras, hardware, pricing, rules, zones)
- CategoryRules: per-категория (allowedTechs, moq, availableSizes, defaultExtras, allowedZoneTechs)
- Per-SKU overrides: allowedFabrics, allowedExtras, availableSizes, overrides (techs/moq/colors), priceMultiplier
- Зоны нанесения: динамические (ZoneDefinition в zonesCatalog), не хардкод
- Визард: useEffectiveRules() → фильтрация техник, цветов, размеров, тканей, обработок
- SKU фото: Supabase Storage bucket `sku-photos`, до 4 фото на артикул, поле `photos[]` (photoUrl удалён)
- Черновик: localStorage 'pinhead_draft'
- Роли: admin > director > rop > manager > production > designer
- Auth states (ProfileStatus): active | pending_approval | disabled | no_profile
- Пользователи: soft-delete (active=false), не hard delete
- RLS: manager видит только свои заказы
- Supabase ключи только через .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Dark mode: html[data-theme="dark"], toggle в Header, persist в localStorage

## Правила ERP (волна 1 «Ядро диспетчера»)
- Права: только через `useErpAccess` — `can(право)` (матрица `erp_role_permissions`) И
  `canActIn(цех)` (привязка `erp_employees`). Не проверять роли в компонентах вручную
- Приоритет очереди: `erp_item_stages.queue_position` — numeric-середина между соседями,
  писать через `reorderStageQueue`, не перенумеровывать вручную
- Перенос между цехами: только `moveStageToDepartment`; правила и последствия — в
  `utils/stageMove.analyzeStageMove`, подтверждение в UI. Молча этап не закрывать
- Прогресс — в штуках (`utils/progress`), не в числе завершённых этапов
- Задания: группа и причина ожидания считаются одним `buildQueueEntries`, не по месту
- Исполнитель проставляется при «Взять в работу» (`assignee = currentActor()`)
- Фильтры заданий — `utils/filterStages`, состояние в URL (возврат из заказа его восстанавливает)
- Справочники (`erp_dictionaries`) — подсказка, а не ограничение: `datalist`/чипы поверх
  свободного ввода. Значения отключаются (`active:false`), не удаляются
- Статусы в справочник не выносить: они в CHECK-констрейнтах и стейт-машинах;
  в админке — вкладка только для чтения

## Правила ERP (волны 3–4: поставщики и ТЗ в PDF)
- Варианты поставщика — `erp_material_suppliers`; выбранный дублируется в
  `erp_materials.supplier`, поэтому все прежние экраны показывают его без правок.
  Снимать флаг у прежнего варианта ДО установки нового (партиальный уникальный индекс)
- ТЗ: назначение цеху хранит `group_id`, а не версию. Замена файла = новая версия
  + снятие `is_current` со старой (именно в таком порядке) → у всех цехов обновилось само
- Гейт ТЗ (`utils/tz.stageMissingTz`) — только для производственных цехов (`deptNeedsTz`)
  и только при `tz_required === true`. Отсутствие поля не блокирует: остановка цеха fail-open
- Заказ с ТЗ создаётся одной транзакцией: файлы в бакет (`tz/new/<group_id>/`) → RPC
  `erp_create_order` с секцией `tz`. Обратный порядок нарушил бы «заказ без ТЗ невозможен»
- File-объекты никогда не кладутся в `form`/`items` формы создания — черновик пишется
  через `JSON.stringify`, и File молча превратился бы в `{}`
- Маршрут позиции считать `buildItemRoute` (и в сторе, и в превью формы) — правило
  вырезания `supply` при материале подрядчика живёт там

## Правила ERP (аудит по скилам)
- «Производственный цех» — признак из данных (`erp_departments.is_production`,
  хелпер `isProductionDept`), НЕ константа. Иначе участок, заведённый в админке,
  не появится ни в меню, ни в канбане, ни в маршруте, ни в гейте ТЗ
- Диалоги — только через `useConfirmStore`: `confirm()` для да/нет,
  `confirmWithInput()` когда нужна причина. `window.confirm/prompt` не использовать
- Архив заказов грузится страницами (`ARCHIVE_PAGE_SIZE`, кнопка «Показать ещё»),
  тихих лимитов не ставить — сколько загружено, должно быть видно
- e2e: ERP-сценарии живут в `e2e/erp-queue.spec.ts` и гоняются проектом `desktop`;
  mobile — другой интерфейс, ему нужны свои спеки, а не те же на 375px

## Не трогать без тестов
- utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- store/slices/ — 796 тестов зависят от них
- erp/utils/ progress · filterStages · queueOrder · stageMove · permissions — чистая логика
  волны 1, 88 тестов
- erp/utils/tz.ts — резолюция версий и гейт ТЗ, 38 тестов
- erp/utils/queueEntries.js — единый источник групп очереди, 21 тест

## Тесты
```bash
npm run test     # 1205 unit тестов (Vitest)
npm run e2e      # E2E (Playwright, 9 файлов)
npm run lint     # 0 ошибок обязательно
npm run build    # успешный билд обязательно
```

## Design System
- Токены: src/index.css (:root) — --type-*, --space-*, --z-*, --radius-*, --color-*
- Dark mode: html[data-theme="dark"] с полным набором override-токенов
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
- Кнопки: .btn + variants (.btn-primary, .btn-secondary, .btn-danger, .btn-ghost)
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
