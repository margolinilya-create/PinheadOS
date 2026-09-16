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
  StageActionsPanel + useStageActions (действия цеха, общие со страницей задания)/
  DefectWizard (мастер брака: 2 шага в Drawer);
  screens/DeptLoad.jsx — «Загрузка цехов» (/load): сетка «цех × день» из плановых дат этапов;
  screens/GanttScreen.jsx — «Гант» (/gantt): этапы полосами во времени, даты
  цепочкой «план → факт → срок заказа» с подписью источника (utils/gantt);
  screens/PlanScreen.jsx — «План производства» (/plan): недельная доска по дням,
  вкладки цехов, сводка «Все цеха», отклонения; screens/plan/ — PlanTaskCard/
  PlanSlotDrawer (план+факт+проблема+переписка)/PlanAddModal (постановка из общего плана);
  screens/queue/DeptPlanPanel.jsx — вкладка «План» в кабинете цеха;
  screens/orderCard/ — format/PlanCell/StageStepper/OrderItemSection/CommentsSection/HistorySection +
  useOrderDetail (общий хук данных)/OrderDrawer/OrderDrawerHost (боковая карточка, редизайн)/
  TzDocsSection (ТЗ в PDF: загрузка, назначение цехам, версии);
  screens/admin/ — PermissionsTab (матрица прав)/DictionariesTab (справочники + статусы r/o)/
  SkuCatalogTab (каталог моделей: сетка, поиск и фильтры в адресе)/
  InviteModal (выдача ссылок)/UserModal (карточка учётной записи: имя, логин, пароль, удаление);
  screens/skuCard/ — SkuCardPage (/sku-card/:cardId: Описание · Технический пакет · Заказы ·
  История) + SkuCardLink (ссылка на карточку из разработки и из позиции заказа);
  screens/warehouse/ — MaterialReceiptCard (план/факт, правка 4.1.3)/MarkingCard/PackShipCard/
  SubcontractReceiptCard (приёмка от подрядчика, правка 4.2.1) — задачи склада),
  screens/purchasing/ — SupplierOptionsModal (сравнение вариантов поставщика, правка 10),
  components (ErpKanban + kanban/ KanbanCard/useTouchDndPolyfill, InlineEdit, PageHead, ErpSkeletons,
  ErpStates (LoadFailed/EmptyResult/EmptyState — единые состояния раздела, вид в States.module.css),
  Icon + icons.js (свой SVG-набор 48 иконок вместо эмодзи), Button, Field (свои *.module.css),
  RouteProgress (маршрут в штуках), QueueFilters, DictionaryDatalist, TzViewer (PDF в iframe) +
  редизайн-примитивы: Badge/Drawer/Pagination/FilterBar/Stepper/Pipeline), store/ (composition-root
  useErpStore.ts + слайсы в slices/ + useOrderDrawer.ts (боковая карточка) + useErpSearch.ts (глоб. поиск)
  + useErpAccess.ts (права: can/canActIn/canDo) + useStagePermissions.ts (права на этап по действиям) + useDictionary.js (активные значения справочника);
  orders/stages/materials/procurement/subcontracting/employees/permissions/dictionaries/tz/plan/realtime;
  контракт+DTO в types.ts, плумбинг в shared.ts, чистые хелперы в orderHelpers.ts;
  точечный realtime, ленивый архив, RPC erp_create_order, pendingMutations),
  utils (routes/time/stageUi/orderForm/progress/filterStages/queueEntries/queueOrder/
  stageMove/permissions/kanbanDrop/stageDone/tz + tzFile/deptLoad/planCard/planDay),
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
  - editors/ — SkuEditor (8 табов), ExpressCalc
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

## Где искать «как это устроено»

Секции «где что лежит» ПЕРЕЕХАЛИ в `docs/rules/react/` (15.09) — один файл
на секцию, текст перенесён дословно. Вход — **`docs/rules/react/INDEX.md`**
(карта по подсистемам: маршрут · закупка и склад · форма заказа · стор и вес
оболочки · интерфейс · планшет · даты · права · чат и каталог SKU).
Правила ПРОЕКТА — этажом выше, `docs/rules/INDEX.md`.

Поиск по слову: `grep -rn "слово" docs/rules/react/`.

Зачем: файл весил ~59k токенов и читался целиком на каждом запросе, притом
что 48 секций из 55 — журнал по сессиям. Здесь остаётся то, что нужно всегда:
состав приложения, структура `src/`, ключевые правила, что не трогать без
тестов, команды и дизайн-система.

## Не трогать без тестов
- utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- store/slices/ — 796 тестов зависят от них
- erp/utils/ progress · filterStages · queueOrder · stageMove · permissions — чистая логика
  волны 1, 88 тестов
- erp/utils/tz.ts — резолюция версий и гейт ТЗ, 38 тестов
- erp/utils/queueEntries.js — единый источник групп очереди, 21 тест

## Тесты
```bash
npm run test      # 1788 unit тестов (Vitest)
npm run typecheck # tsc --noEmit, strict: true — 0 ошибок обязательно
npm run e2e       # E2E (Playwright, 11 файлов, 96 сценариев desktop + 13 mobile).
                  # @playwright/test ждёт сборку 1208, а предустановлена 1194 —
                  # вместо временного конфига проще разложить ожидаемые пути
                  # из имеющихся бинарников:
                  #   mkdir -p /opt/pw-browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64
                  #   ln -s .../chromium_headless_shell-1194/chrome-linux/headless_shell \
                  #         .../chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell
                  #   ln -s .../chromium-1194/chrome-linux .../chromium-1208/chrome-linux
                  # Тогда работает штатная команда, без своего конфига
npm run lint      # 0 ошибок обязательно
npm run build     # успешный билд обязательно
```

**E2E `.env` больше не требует** (правка 31.08). Фиктивные ключи Supabase
задаёт сам `playwright.config.ts` обоим серверам, поэтому `npm run e2e`
работает на чистом клоне и в свежем контейнере. `.env` по-прежнему нужен
для `npm run dev` против боевой базы; unit-тестам он не нужен вовсе —
`setupTests.js` мокает `lib/supabase` целиком.

**Почему это чинилось.** `lib/supabase.ts` бросает «Missing Supabase
credentials» на уровне модуля — до React, поэтому ErrorBoundary
не срабатывает, а Playwright видит пустой `<div id="root">` и сообщает
«element(s) not found» про КАЖДЫЙ локатор. Мок сети не спасает: он
перехватывает запросы, а падает импорт. Отказ читается как десяток
сломанных спек, и найти в нём «нет настройки» нельзя — прежняя редакция
этого раздела прямо советовала «сначала проверьте `.env`, а не спеки», то
есть держала ловушку советом вместо починки. Сторож — `src/lib/e2eEnv.test.ts`.

## Design System
- Токены: src/index.css (:root) — --type-*, --space-*, --z-*, --radius-*, --color-*
- Dark mode: html[data-theme="dark"] с полным набором override-токенов
- Шрифты: Oswald (заголовки, `--font-display`) / Inter (текст) / Roboto Mono (числа).
  С 06.09 вместо Barlow Condensed: у того НЕТ кириллицы, и на русских заголовках
  он не применялся вовсе — валидное правило с нулевым эффектом. Сторож
  «каждое семейство покрывает кириллицу» — в `styles/fonts.test.ts`
- Кнопки: в ERP — примитив `erp/components/Button` (variant/size/icon/loading);
  глобальные .btn + variants остаются языком Order Studio
- Иконки ERP: `erp/components/Icon` + набор в icons.js. Эмодзи вместо иконок не использовать;
  иконка участка — `deptIcon(code)`, значение это ИМЯ иконки, не глиф
- Высоты контролов — токены `--control-h-sm/md/lg` (32/40/48; на `pointer: coarse`
  40/44/48, переопределение стоит рядом с объявлением в `index.css`, как
  у `--dept-tab-h`). Своих медиазапросов высоты у модулей примитивов НЕТ:
  два таких, в примитиве и в монолите, уже разъезжались (кнопка 36 против
  поля 40). Общий список классов ≥44px для НЕпримитивов — в erp.module.css
- Кегли — только ступени шкалы (`--type-label/body-sm/body/body-lg/title/h4/h3/h2/h1`
  + `--type-metric`), и все они ПРОСТЫЕ px: сторож мелкого текста разворачивает
  токен регуляркой по `px`, и ступень через `clamp()` он объявит ссылкой в пустоту
- Движение — `--dur-fast/base/slow` + `--ease-out`; тени — `--shadow-card/raise/modal`;
  кольцо фокуса — `--focus-ring`/`--focus-ring-error`. Литералы сторожат
  `styles/motion.test.ts` и `styles/shadows.test.ts`
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
- **Размер, заданный разметкой инлайном, требует блочного отображения.**
  `<span className={styles.X} style={{ width }}/>` на строчном элементе
  не работает ВООБЩЕ: так не рисовались три полосы прогресса сразу.
  Сторож — `erp/inlineSizing.test.ts`
- Пустое состояние собирают только `EmptyState`/`EmptyResult` (сторож
  `erp/emptyStates.test.ts`). Подпись поля обязана быть связана с контролом —
  `htmlFor` либо обёртка `<label>`; сторожится РЕЗУЛЬТАТ, а не способ
  (`erp/labelBinding.test.ts`), поэтому массовая миграция рукописных полей
  на примитив `Field` не требуется и НЕ делалась
- Обход вёрстки глазами — `npm run shots` (стенд `playwright.bench.config.ts`,
  29 состояний × 3 ширины × 2 темы) + `npm run shots:index -- before after`.
  Это НЕ эталоны: вывод в `.shots/` вне гита, сравнения нет, страница
  намеренно разжата. Сторож — `styles/screenshotBench.test.ts`
