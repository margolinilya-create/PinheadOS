# PINHEAD Order Studio — pinhead-react

## Проект
ERP/CRM для типографии (печать на одежде). React 19 + Vite 7 + Zustand 5 + Supabase.
URL: https://pinhead-os.vercel.app

## Два раздела (выбор оболочки по профилю — `config/shellChoice.ts`, веха 8)

Оболочку выбирает `chooseShell` в `ShellGate` (`App.jsx`) один раз за загрузку на `user.id`:
выключатель `VITE_FEATURE_ORDER_STUDIO=0|false` → ERP всем; `?studio=1|0` на заход; путь раздела
(`/sales…`, `/sales-staff`, `/order-settings`, `/express`, `/sku`, `/prices`) + `canUseSales` → раздел;
записанный выбор устройства; продавец/МС/rop по умолчанию — раздел «Оформление заказа»,
admin/director — Производство. Подробно — корневой `CLAUDE.md`, «Роутинг».
- **erp/** — 🏭 Производство (по умолчанию): ErpApp (lazy-экраны), layout,
  screens (Dashboard/Orders/OrderCard/ProductionBoard+Kanban/DepartmentQueue/
  ProductionTask/FabricPurchasing/AdminScreen; крупные экраны разбиты на под-компоненты:
  screens/orders/ — DueCell/OrderRow/OrderCardMobile/CreateOrderModal
  (+ create/: useTzDocs (ТЗ формы: загрузка при выборе, снимок для черновика
  с именем/типом/размером — 27.09 п. 12), SizeGridEditor (не даёт завести вторую строку того же цвета —
  дубли удваивали ввод, правка 21.09 п. 8), DraftPicker (выбор черновика прямо
  в форме; окна подтверждения при выходе больше нет — 21.09 п. 6),
  FormParts, ItemBlock (+ PrintBlock/CopyPrintPicker/TechBlock/LabelsBlock/PackagingBlock/
  RouteBlock — блоки позиции), TzSection, useOrderSubmit (сабмит), useOrderDraft (черновик),
  orderPayload.ts (сборка payload правки и создания) — форма разрезана, 09.10);
  screens/queue/ — Lightbox/PhotoAttach/TzBlock/QueueCard/QueueRow (компактная строка)/
  StageActionsPanel + useStageActions (действия цеха, общие со страницей задания)/
  MoveStageSelect (перенос в цех из панели)/форма закроя (правки 19.10):
  useCutReport (состояние, ошибки, payload) + CutResultTable («Результат кроя» —
  выпуск один раз по сетке позиции, «Размер вне заказа…») + CutUsageSection
  («Расход ткани» — группы «материал · цвет», режимы «Не использован / Полностью /
  Частично», «Использованы полностью», «Уточнить метраж рулона») + CutTotalsBar
  (липкая полоса итогов, один role="status"); рулоны «в работе» прежних сдач —
  окном RollFinishModal «Завершить рулон»/
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
  TzDocsSection (ТЗ в PDF: загрузка, назначение цехам, версии)/
  EconomicsSection (вкладка «Экономика позиции», правка 20.09 п. 9: расход и стоимость
  полотна, средняя сборка, прямая себестоимость — считает сервер, право `economics.view`;
  с 27.09 п. 8 расход в метрах, «Себестоимость годной единицы» и «Затраты
  на единицу клиентского тиража») + LossesSection («Остатки и потери
  по заказу»: пригодные и списанные остатки, корректировки, плюсы, брак,
  в работе — раскрываются до рулона и этапа);
  components/chat/ — ChatWindow (окно поверх ERP, смонтировано в ОБОЛОЧКЕ: переживает
  переход между разделами)/ChatPanel (лента: дни, группы по 5 минут, граница
  непрочитанного, «Новые сообщения, N»)/ChatMessage/ChatComposer/ChatSection (вход
  с экранов)/ChatNotifyMenu (режим подписки)/ChatReadReceipts («Прочитали N»);
  layout/NotificationCenter + layout/NoticePopups (центр и всплывающие под колоколом;
  очередь показа считает `utils/noticePopups`, первая загрузка сессии молчит);
  screens/admin/ — PermissionsTab (матрица прав)/DictionariesTab (справочники + статусы r/o)/
  SkuCatalogTab (каталог моделей: сетка, поиск и фильтры в адресе)/
  InviteModal (выдача ссылок)/UserModal (карточка учётной записи: имя, логин, пароль, удаление);
  screens/skuCard/ — SkuCardPage (/sku-card/:cardId: Описание · Технический пакет · Заказы ·
  История) + SkuCardLink (ссылка на карточку из разработки и из позиции заказа);
  screens/warehouse/ — MaterialReceiptCard → AcceptMaterialForm (форма материала с 05.10 п. 4:
  рулоны строками, итог в закреплённом низу, план/факт/документы/история свёрнуты;
  ReceiptHistory — поставки и рулоны по receipt_id) (план/факт, правка 4.1.3; веса рулонов
  и дозаполнение веса у принятых до правки — 21.09 п. 2; ширина/плотность/метраж
  поставщика на рулон — 27.09 п. 4) + RollParamsFields (поля рулонов при приёмке
  и дозаполнение параметров у принятых до правки)/MarkingCard/PackShipCard/
  SubcontractReceiptCard (приёмка от подрядчика, правка 4.2.1) — задачи склада),
  screens/FabricLeftovers.jsx — «Остатки ткани» (/leftovers, правка 21.09 п. 5):
  рулоны с ненулевым остатком, вес, цена и заказ-источник; остаток это САМ рулон,
  отдельной сущности нет; с 27.09 п. 4 — в метрах с источником, ширина,
  плотность, цена за метр, кг «расчёт» рядом;
  screens/purchasing/ — AddPurchaseModal (модалка «Новая закупка», подсветка
  обязательных полей — 27.09 п. 1; ширина и плотность у ткани — п. 4),
  PurchaseFields (+ FabricParamsFields: ширина/плотность в таблице закупки),
  SupplierOptionsModal (сравнение вариантов поставщика, правка 10),
  purchaseLabels.js (подписи; `pricePerUnitLabel` — цена по ЕДИНИЦЕ материала,
  одна функция на таблицу, карточку планшета, инлайн-правку и модалку),
  components (StageReportForm + SizeReportSection (размерная таблица сдачи, остаток
  по размерам) + useStageReports (отчёты предков и свои — 27.09 пп. 6, 7) +
  RollParamsForm (параметры рулона для учёта в метрах: общая для закроя
  и склада, расчёт виден до нажатия — 27.09 п. 4; чистый вес у рулона без веса — 28.09) +
  useForeignRolls (остатки других заказов для формы закроя),
  ErpKanban + kanban/ KanbanCard/useTouchDndPolyfill, InlineEdit, PageHead, ErpSkeletons,
  ErpStates (LoadFailed/EmptyResult/EmptyState — единые состояния раздела, вид в States.module.css),
  Icon + icons.js (свой SVG-набор 48 иконок вместо эмодзи), Button, Field (свои *.module.css),
  RouteProgress (маршрут в штуках), QueueFilters, DictionaryDatalist, TzViewer (PDF в iframe) +
  редизайн-примитивы: Badge/Drawer/Pagination/FilterBar/Stepper/Pipeline), store/ (composition-root
  useErpStore.ts + слайсы в slices/ + useOrderDrawer.ts (боковая карточка) + useErpSearch.ts (глоб. поиск)
  + useErpAccess.ts (права: can/canActIn/canDo) + useStagePermissions.ts (права на этап по действиям) + useDictionary.js (активные значения справочника);
  orders/stages (+ stageGates.ts — гейты закрытия у писателя: файл → программа
  вышивки → тираж → закупка/рулоны, не учтённые изделия)/materials/procurement/subcontracting/employees/permissions/dictionaries/tz/plan/realtime;
  realtimeCoalesce.ts (серия событий → одно перечитывание), realtimeHelpers.ts, reworkEvents.ts (журнал
  переделок с кэшем по `id:qty`), slices/rollActions.ts (действия с рулонами: судьба остатка,
  параметры, место хранения, остатки по всем заказам — 28.09), attempts.ts (ключи попыток сдачи по этапу —
  в модуле, не в состоянии: повтор не спишет метры дважды, 27.09 п. 4),
  authHelpers.ts у useAuthStore;
  контракт+DTO в types.ts, плумбинг в shared.ts, чистые хелперы в orderHelpers.ts;
  точечный realtime, ленивый архив, RPC erp_create_order, pendingMutations),
  utils (routes/time/stageUi/orderForm (+ orderDraftEnvelope — снимок черновика,
  файлы проходят нормализацию)/stageRemaining (не учтено = принято − сдано − брак,
  пока предшественник в работе — от большего из тиража; stageDonePatch пишет принятое)/
  stageInput (выход этапа = факт, прозрачный этап, itemProducedQty — 05.10)/progress/filterStages/queueEntries/queueOrder/
  stageMove/permissions/kanbanDrop/stageDone/tz + tzFile/deptLoad/planCard/planDay/
  sizeGrid (схлопывает дубли `(цвет, размер)` при ЧТЕНИИ — один раз на пятерых
  читателей)/cutRolls (расход в метрах, доступно по рулону, тексты отказов
  общие с RPC)/cutExtras (производственный «плюс», накопительно)/
  rollFinish (сводка метража рулона в закройке и план завершения рулона:
  замер → уточнение полного метража, 05.10 п. 5)/
  fabricMetres (формулы кг ↔ м и ₽/м, `fmtM`/`fmtKg`, рабочий метраж рулона
  с источником — 27.09 п. 4)/rollParams (параметры рулонов приёмки → payload
  `p_roll_params`)/foreignRolls (рулоны других заказов как варианты закроя — 28.09)/
  analyticsCsv (выгрузка аналитики в CSV)/reportTotals (числа отчёта из разбивки — правило одно
  с сервером)/itemEconomics (подписи экономики: пробелы, покрытие, пересчёт)/
  fabricLeftovers/attachmentView/deptMap (карты участков, WeakMap по массиву)/cellKey (`CELL_SEP`)),
  orderFormGrid.ts (размерная сетка формы, реэкспорт из orderForm),
  data/departments, types.ts, erp.module.css (брейкпоинты 760/480,
  pointer:coarse). Touch-DnD канбана: mobile-drag-drop (dynamic import).
  PWA: public/manifest.webmanifest + icon-192/512.
- **orderstudio/** — ✏️ «Оформление заказа» (ТЗ, Order Studio; по профилю, `shellChoice`): визард,
  SKU, Order v4 (без аналитики продаж и канбана v3 — убраны в вехе 1, 16.10). Оболочка —
  `orderstudio/layout/` (OrderLayout/OrderSidebar/orderNav, стиль оболочки ERP). Компоненты ниже — его состав.
  Веха 2 (17.10): `api/salesTransitions` (статус и оплата v4 — только RPC), `api/artworks`
  (закрытый бакет `order-artworks`), `bridge/launch` (прототип запуска через стор ERP).
  Правила — `docs/rules/pravila-prav-i-strazhey-order-v4-veha-2-17-10.md`.
  Веха 3 (17.10): `workplace/` — рабочее место заказа `/sales/:id` (OrderWorkplace: список
  изделий ItemList + вкладки «Изделие» ItemTab/GarmentPanel на панелях визарда, «Клиент»
  ClientTab, «ТЗ и цена» SummaryTab; SaveIndicator; `itemBuffer` — буфер позиции в `useStore`);
  `screens/SalesList` — «Мои / Отдела / Все заказы»; `admin/SalesStaff` (`/sales-staff`,
  признак `profiles.is_sales`); `model/itemOps` (копия в другом цвете, разнесение);
  `model/editable`; доступ `canUseSales` (с вехи 8 — `layout/salesAccess.ts`, реэкспорт из `layout/orderNav.ts`). Визард v3 как экран, перенос
  «Оформить как заказ v4», мастер позиции и старая карточка SalesCard убраны.
  Правила — `docs/rules/pravila-rabochego-mesta-i-revizii-klienta-veha-3-17-10.md`.
  Веха 4 (17.10): `admin/OrderSettings` — «Справочники заказа» `/order-settings` (admin, director, rop;
  вкладки `?tab=suppliers|labels|packaging|pricing|tz`, реестр `admin/orderSettingsTabs.ts`, на ≤ 760 px
  только просмотр), `admin/useCatalogEditor` (свежее чтение, конфликт, запасной путь),
  `admin/tabs/*` (поставщики и палитры, бирки и схемы, упаковка, правила цены, подвал ТЗ);
  `catalog/` (типы и сиды справочников, `suppliers` — палитра по поставщику ткани, `labels` — цена
  бирки из библиотеки); `api/catalogAdmin` — единственный писатель `app_config`/`catalog_config`
  (RPC `catalog_put`/`prices_patch`); «Сотрудники продаж» `/sales-staff` — `is_sales` и `is_ms`
  (МС на стороне ТЗ), правит и rop. Правила — `docs/rules/pravila-spravochnikov-zakaza-i-ms-veha-4-17-10.md`.
  Веха 5а (17–18.10): `design/` — вкладка «Дизайн» рабочего места (`/sales/:id?tab=design&item=`): холст
  konva с флэтом позиции, логотипы (PNG/JPEG/WEBP/SVG/PDF/AI → бакет `order-artworks`), инспектор,
  слои, undo, «Скачать PDF макета» (jsPDF + svg2pdf, ленивый по клику); на ≤ 760 px — превью `<img>`.
  Ленивые чанки: `DesignTab` (холст ≤ 100 кБ gzip), `DesignSide`, `DesignPreview`, `exportPdf`, `loadPdf`
  (pdfjs), `seedFlats`. Источник правды — заказ: запись только `useDesignStore.commit` → `useSalesStore.edit`;
  `layout` нанесения — геометрия v1 без путей (`model/layoutMark` — разбор без zod для оболочки Order);
  `PrintRow placed` на «Изделии». Флэты — приватный бакет `garment-flats` (`api/garmentFlats`) +
  `app_config.garmentFlats` (`catalog/flatsSchema` на `zod/mini`, `useFlatsCatalog`, `pickFlat`);
  вкладка «Флэты и зоны» `/order-settings?tab=flats` (`admin/tabs/FlatsTab`, кнопка «Загрузить
  типовые флэты» — admin/director). Техники — `model/printMethods.ts`. Карта модуля и бюджет —
  `src/orderstudio/design/README.md`; правила — `docs/rules/pravila-dizain-meikera-veha-5a-18-10.md`.
  Веха 5б (18.10): админка «Флэты и зоны» — `admin/flats/` (ленивые `FlatEditor` с холстом konva
  `canvas/` и `FlatPreview` без konva для ≤ 760 px; `saveFlat` + `useFlatEditor` — файлы всех видов
  → `putCatalog` одного флэта; `ZonesCatalogEditor` + `zonesEdit` — справочник зон с `tz_row`
  и «снять / вернуть»; свои иконки `flatIcons`), чистое ядро `design/edit/` (виды, зоны, якоря,
  размеры, id, новый флэт из SVG, зеркальный рукав, калибровка, `validateFlat`), версии —
  `design/catalog/flatVersion.ts` (`history[]`, `flatAtVersion`, `geometryOf`); строки ТЗ —
  `catalog/tzRows.ts`. Адрес: `?tab=flats&flat=<id>&view=<вид>`, `flat=new`, `part=zones`.
  Холст рабочего места — рукава и геометрия по версии позиции (`design/ui/useItemFlat`,
  `FlatNotices`). Миграция I `20261018090000_flats_admin` — форма и триггер-страж справочников;
  правила — `docs/rules/pravila-flety-i-zony-veha-5b-18-10.md`.
  Веха 6+7 (18.10): ТЗ в PDF, отправка, оплата, «К запуску», запуск в ERP. `tz/model/` — чистая модель
  (группы `tzGroups` по модели, ткани, цветам деталей и набору нанесений; документ `tzDocument`; раскладка
  `layoutTz`/`layoutTzPrints`/`layoutPager`/`layoutGrid`, `fitText`; глифы шрифта `pdfGlyphs`/`sendGlyphs`;
  `tzHash` (sha-256 зависимостью `digest`, без `issuedOn`/`footer.link`), `tzFileName`, `sendChecklist`
  (+ `SERVER_SEND_RULES`), `groupDiff`, `safeUrl`); `tz/pdf/` — движок (`tzPdf`, `drawBoxes`, `tzImages`,
  `tzPdfError`) на `design/export/pdfCore.ts`, грузится только `tz/ui/tzExport.ts`; `tz/sendToWork.ts` —
  цепочка «Отправить в работу»; `tz/ui/` — ленивый `TzSummary` на «ТЗ и цена» (оплата, группы ТЗ
  с предпросмотром ссылкой, `SendPanel` + `ChecklistView`), `ReturnBanner`; `tz/tzCatalogs.ts` — одна сборка
  справочников для хэша; `tz/appOrigin.ts` (`VITE_APP_ORIGIN`). `payment/PaymentPanel` — оплата кнопками,
  «без оплаты» с причиной (lead). Стор: `applyServer`, `beginSend`/`endSend`/`editDuringSend`.
  Запуск: `bridge/launch.ts` (шаги `check → bootstrap → payload → tzcheck → files → recheck → create →
  transition`, `onStage`), `launchFiles` (копия ТЗ на каждую позицию ERP, макеты к нанесениям и биркам, тип
  по байтам), `erpKeys`, `tzCheck`, шлюз `erpGateway` (стор ERP — единственный путь); `api/erpFiles.ts` —
  писатель `erp-attachments`; `api/salesEvents.ts` — последний возврат и «без оплаты». Экран «К запуску» —
  `launch/` (`/sales/:id/launch`, ленивый `LaunchScreen`, `LaunchSide`, `LaunchOutcome`, `ReturnDialog`,
  `TzFrame`, `RouteView`), пресет списка `LAUNCH_QUEUE_PATH`. Миграция J `20261018120000_order_v4_launch`.
  Сверка имён и замеры — `src/orderstudio/tz/README.md`; правила —
  `docs/rules/pravila-tz-i-zapuska-veha-6-7-18-10.md`.
  Веха 8 (18.10): выбор оболочки `config/shellChoice.ts` + `ShellGate`, `layout/salesAccess.ts`, маркер
  сборки SHA + флаг (`scripts/build-id.mjs`), кнопка «Производство» всем с доступом; на 375 px шапка без
  заголовка, маркеры вкладок `workplace/TabMarker.jsx` + `tabState.ts` (точка/бейдж + `.srOnly`), общий
  `ui/a11y.module.css`. Зона нанесения по id (`zone_id`: холст, `PrintRow`, цена кармана, строка ТЗ),
  «Комментарий для цехов» `workplace/OrderNotesField.jsx` (только когда сервер знает поле —
  `api/serverZoneNotes.ts`), ревизия клиента 4; журнал признаков `admin/SalesStaffJournal.jsx`;
  палитра модели `catalog/allowedColors.ts`; подложка по цвету изделия `model/garmentTextile.ts`.
  Рестайл: `components/editors/SkuEditor` и `ExpressCalc` (+ `express/`) на примитивах ERP и модулях,
  панели `steps/garment/*` на модулях, `AdminPanel` — старые заказы только просмотр;
  удалены `editors.css`, `express.css`, `garment.css`, `PageHeader.jsx`, `useCommentsStore.ts`. Миграции L/K/M — файлы
  `supabase/rollout/m8/`, отчёт о ничьих файлах — `supabase/functions/order-files-gc/`. Правила —
  `docs/rules/pravila-vklyucheniya-i-restayla-veha-8-18-10.md`.
- Единая админка: erp/screens/AdminScreen смонтирован в оба раздела.
- Правила ERP: см. SESSION-STATE.md и docs/DESIGN.md в корне репо.

## Структура src/
- components/ — UI-компоненты
  - steps/garment/ — панели визарда: SkuList (expandable cards; `readOnly`, `reorderable`), FabricGrid,
    ColorPicker, SizeTable (`readOnly`, `showPrice`), ExtrasAccordion — вкладка «Изделие» рабочего места
    (шаги визарда v3 убраны в вехе 3)
  - editors/ — SkuEditor («Каталог моделей и цен», 8 вкладок; ≤ 760 px — только просмотр), ExpressCalc («Экспресс-расчёт»); CSS-модули (веха 8)
  - editors/express/ — expressModel (модель цены), OptionGroup, блоки техник, зон, обработок и итога
  - editors/sku/ — SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent (+ PricingMatrixTabs, PricingRulesTabs), CategoryRulesTab, ZonesCatalogTab (просмотр со ссылкой, веха 5б), AddSkuModal, ZonesModal, SkuDetailModal (+ skuDetail/), RateBar, ScrollTable, skuExcel, useSkuSave
  - auth/ — AuthScreen, AdminPanel (старые заказы v3 — только просмотр, примитивы ERP)
  - shared/ — ErrorBoundary, Toast, Skeleton, UpdateBanner, ConfirmDialog (PageHeader удалён в вехе 8)
  - шапка и сайдбар Order — orderstudio/layout/
- store/ — Zustand (все .ts)
  - useStore.ts — store визарда (6 слайсов); с вехи 3 — буфер ОДНОЙ позиции рабочего места
    (`resetItemFields`, сброс при выходе через `appReset.registerAppReset`)
  - slices/ — все .ts: wizardSlice, productSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice (действия зон визарда убраны в вехе 5а)
  - useAuthStore.ts (+ devAutologin.ts, devProfiles.ts — подмена профиля только в DEV), useOrdersStore.ts (v3 только чтение), useToastStore.ts, useConfirmStore.ts (useCommentsStore удалён в вехе 8)
- utils/ — все .ts: pricing, skuRules, validate, mockup, deadline, i18n, quoteRules (округление до 5 ₽, порог шелкографии)
- config/ — features.ts (флаги, env-тройка, `FEATURE_STORAGE_KEYS`), shellChoice.ts (выбор оболочки)
- lib/ — все .ts: supabase, api, storage (+ Supabase Storage: sku-photos), catalogs
- types/ — TypeScript типы: order, catalog, auth, pricing
- data/ — fallback данные: prices, skuCatalog (с description, sizeChart, photos), extras, fabrics, colors
- hooks/ — useFocusTrap.js, useEffectiveRules.ts, useMediaQuery.js, useScrollHints.js, useScrollRestore.js

## Ключевые правила
- Общение с пользователем: всегда на русском языке
- Цены: getPrices() -> store -> localStorage -> DEFAULT_PRICES
- Каталоги: Supabase (app_config + catalog_config) -> localStorage -> defaults
- Все каталоги в Zustand store (catalogSlice): skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, labelsCatalog
- app_config хранит: sku_catalog, prices (+ `packOptions`/`prepFees`/`minMarginPct`, `flexMatrix`), extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog, labelLibrary, tzSettings (веха 4), garmentFlats (веха 5а: флэты изделий; в `loadAllCatalogs` не входит — вкладка «Дизайн» читает сама; веха 5б — `history[]` прежних версий, рукава, `tz_row` у зоны); zonesCatalog с вехи 5б — `tz_row`, `active` (правит только «Флэты и зоны»; `ph_zones` больше не читается)
- catalog_config хранит: fabricsCatalog, trimCatalog, suppliers (веха 4: поставщики с палитрами)
- Запись справочников — только `orderstudio/api/catalogAdmin.ts` (RPC с базой; сторож `catalogWrites.test.ts`); стор знает `catalogSource: 'db' | 'fallback'` — на запасном пути редактор не сохраняет
- hex из справочника в стиль — только через `utils/sanitizeHex`
- SKU Editor: 8 табов (items, fabrics, trims, extras, hardware, pricing, rules, zones)
- CategoryRules: per-категория (allowedTechs, moq, availableSizes, defaultExtras, allowedZoneTechs)
- Per-SKU overrides: allowedFabrics, allowedExtras, availableSizes, overrides (techs/moq/colors), priceMultiplier
- Зоны нанесения: динамические (ZoneDefinition в zonesCatalog), не хардкод
- Визард: useEffectiveRules() → фильтрация техник, цветов, размеров, тканей, обработок
- SKU фото: Supabase Storage bucket `sku-photos`, до 4 фото на артикул, поле `photos[]` (photoUrl удалён)
- Черновик визарда v3 (`pinhead_draft`) убран в вехе 3: ключ стирается разово при загрузке раздела ТЗ; заказ v4 сохраняется автосохранением `useSalesStore` (ревизия клиента `SALES_CLIENT_REV`, `expected_updated_at`)
- Роли: admin > director > rop > manager > production > designer
- Auth states (ProfileStatus): active | pending_approval | disabled | no_profile
- Пользователи: soft-delete (active=false), не hard delete
- RLS: manager видит только свои заказы
- Supabase ключи только через .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Dark mode: html[data-theme="dark"], переключатель в шапке оболочки (ERP и Order), persist в localStorage

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
- utils/pricing.ts + pricingCore.ts — 88 тестов (pricing.test.js + pricing-extended.test.js)
  и pricingCore.test.ts; формула — в ядре, pricing.ts — обёртки с getPrices()
- utils/costRules.ts + printRules.ts — формула правок CRM 13.10 (накладные, группы наценки,
  срочность, DTF/DTG/вышивка); контрольные примеры документа — costRules.test.ts, printRules.test.ts
- orderstudio/ — priceOrder (16), tzToErpDraft (22, сторож контракта с формой ERP),
  salesOrders (7, туда-обратно с RPC), useSalesStore (очередь автосохранения),
  erpImports (сторож: без рантайм-импорта ERP; стор ERP — только шлюз `bridge/erpGateway.ts`, ровно
  пять модулей ERP, сам шлюз — только `import()` из `bridge/launch.ts`), salesTransitions (переходы v4, проверка запуска, оплата — только RPC),
  bridge/launch (запуск: launch_check → tzcheck → копии файлов → recheck → createOrder → transition
  с `p_erp_order_id`; 6+7), api/artworks
  (бакет order-artworks), сторожа orderV4Rights (стражи и RPC вехи 2), orderArtworksBucket,
  probesFiles (пробы `supabase/probes/`), wizardAdapter (`garmentPatch` — запись по разнице),
  leaveGuard, веха 3: workplace/itemBuffer (буфер позиции: быстрый переход, загрузка
  ничего не пишет), OrderWorkplace (вкладки, только чтение, тексты состояний), itemOps,
  orderNav (`canUseSales` — зеркало сервера), workplaceSource и deadCode (сторожа: нет
  `app_config` в рабочем месте, удалённые модули не импортируются и не названы живыми в CLAUDE.md),
  pricing/wizardParity (цена буфера = цена заказа); веха 4: catalog/seedsMatch (сид миграции G =
  `seeds.ts`, цены бирок = `pricingCore`), catalog/catalogKeys (ключи уникальны по двум таблицам),
  catalogWrites (единственный писатель справочников), useCatalogEditor (конфликт, запасной путь),
  catalog/suppliers и catalog/labels (снятое значение в заказе остаётся); веха 5а: design/designGuards
  (нет импортов ERP и HTML-строкой в DOM, ядро без React), design/assets/sanitizeSvg + sniff + assetGuards
  (белый список SVG, тип по байтам, object URL только в кэшах картинок), design/model/pricingParity (цена
  холста = цена строки), layoutMark (эталон против zod), useDesignStore (запись только в черновике, undo),
  DesignTab (открытие ничего не пишет), export/pdfGuards (PDF только `import()`), seed/garmentFlatsSeed
  (сид проходит санитайзер, `zone_id` есть в справочнике зон), garmentFlatsBucket / flatsWrites /
  artworkWrites (бакеты и единственные писатели), ui/konva (ядро konva без Tween, плагины сборки);
  веха 5б: catalog/flatVersion (классификация GEOMETRY_KEYS/META_KEYS по ключам схем, история),
  designGuards (`edit/` без api/стора/тостов), admin/flats/saveFlat (файлы до справочника, «v2…v6 заняты →
  v7», сбой переноса), zonesWrites (один писатель зон), flatsAdminGuards и canvas/canvasGuards (нет ERP,
  HTML-строк, иконок без aria-label), catalogKeys (паритет FLATS_CASES ↔ пробы I, ZONE_ID_RE в SQL),
  bundleBudget5b (konva не в OrderSettings/FlatsTab/FlatPreview);
  веха 6+7: orderV4Launch (J — тела B/F + блоки правок, md5, гейты экрана = J, эталон 960 сочетаний,
  `SERVER_SEND_RULES`), mockContract (мок e2e = тексты J), tz/model (5 фикстур образцов, хэш, глифы, цены
  не в ТЗ — tzModelGuards), design/export/pdfGuards (jsPDF только в pdfCore, tzPdf только `import()`, ссылки
  только после `isSafeHttpUrl`), sceneGolden (лист макета 5а побайтно), bridge/launchFiles + erpKeys (ключи,
  тип по байтам, 409), tzCheck, erpFilesWrites и artworkWrites (единственные писатели), tz/bundleBudgetM67;
  веха 8: config/shellChoice (таблица правил и их порядок) + App.test (оболочка не меняется на перерисовке),
  orderV4M8 (L/K/M: порядок, md5-цепочка, лексика файлов контроллера, CHECK = `ZONE_ID_RE`), orderFilesGc и
  scripts/lib/orderFileHolders.test.mjs (носители, ворота, удаление только `apply` + секрет), ordersReadOnly
  (нет записи `orders` в обход RPC), devProfilesGuard, ui/a11yGuards, skuGuards / expressGuards /
  garmentCss / deadCss (модули на токенах, мёртвый CSS), bundleBudgetM8, ciVisualGuard (пересъёмка только `studio-`),
  mockContract (тексты и порог K), deadCode (удалённые модули вехи 8)
- store/slices/ — 796 тестов зависят от них
- erp/utils/ progress · filterStages · queueOrder · stageMove · permissions — чистая логика
  волны 1, 88 тестов
- erp/utils/tz.ts — резолюция версий и гейт ТЗ, 38 тестов
- erp/utils/queueEntries.js — единый источник групп очереди, 21 тест

Сторожа, читающие файлы, — под `// @vitest-environment node` (сторож `guardEnv.test.ts`);
обходчик исходников один — `src/testutil/sourceFiles.ts`. Полный прогон и линт
в контейнере 16 ГБ — по очереди (`--maxWorkers=3`), иначе процесс убивается.

## Тесты
```bash
npm run test      # unit-тесты (Vitest); сколько — PROJECT.md, «Статистика» (с датой)
npm run typecheck # tsc --noEmit, strict: true — 0 ошибок обязательно
npm run e2e       # E2E (Playwright, 24 спеки на 24.09 + визуальные эталоны).
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
