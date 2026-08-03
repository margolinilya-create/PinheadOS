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
  screens/PlanScreen.jsx — «План производства» (/plan): недельная доска по дням,
  вкладки цехов, сводка «Все цеха», отклонения; screens/plan/ — PlanTaskCard/
  PlanSlotDrawer (план+факт+проблема+переписка)/PlanAddModal (постановка из общего плана);
  screens/queue/DeptPlanPanel.jsx — вкладка «План» в кабинете цеха;
  screens/orderCard/ — format/PlanCell/StageStepper/OrderItemSection/CommentsSection/HistorySection +
  useOrderDetail (общий хук данных)/OrderDrawer/OrderDrawerHost (боковая карточка, редизайн)/
  TzDocsSection (ТЗ в PDF: загрузка, назначение цехам, версии);
  screens/admin/ — PermissionsTab (матрица прав)/DictionariesTab (справочники + статусы r/o);
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
- ТЗ принадлежит ПОЗИЦИИ (`erp_tz_documents.item_id`; `null` — общее ТЗ заказа) и видно
  всем цехам её производственного маршрута. Резолюция — `utils/tz.itemTzDocument`:
  своё ТЗ позиции → общее ТЗ заказа. Поцеховое назначение отменено правкой менеджера
  2026-08-03: оно требовало выбрать один и тот же PDF в N выпадающих списках и
  блокировало создание заказа, если пропущен хоть один. Таблица `erp_tz_assignments`
  осталась в схеме пустой и помечена `@deprecated` — код её не читает и не пишет
- Замена файла: снять `is_current` со старой версии, ПОТОМ вставить новую — тот же
  порядок, что у вариантов поставщика строкой выше, и по той же причине
  (`unique (group_id) where is_current`). Обратный порядок падает с 23505; он и стоял
  в коде вместе с комментарием и тестом, утверждавшими обратное. Между снятием и
  вставкой группа без актуальной версии, поэтому при сбое вставки флаг возвращается
- Гейт ТЗ (`utils/tz.stageMissingTz`) — только для производственных цехов (`deptNeedsTz`)
  и только при `tz_required === true`. Отсутствие поля не блокирует: остановка цеха fail-open
- Ключ объекта Storage строго ASCII: `tzFilePath` транслитерирует кириллицу. Supabase
  проверяет ключ регуляркой S3-safe символов (`\w` без флага `u`) и на русское имя
  отвечает `InvalidKey` — из-за этого не загрузилось НИ ОДНО ТЗ и не создавался ни один
  заказ с ним. Имя для человека берётся из `erp_tz_documents.file_name`
- Файл ТЗ уходит в бакет при ВЫБОРЕ, а не в сабмите, и несёт своё состояние
  (`uploading`/`uploaded`/`error`); «Создать заказ» заблокирована, пока есть
  незавершённые. Загрузка в сабмите показывала файл приложенным до того, как он
  оказывался в Storage
- Заказ с ТЗ создаётся одной транзакцией: файлы в бакет (`tz/new/<group_id>/`) → RPC
  `erp_create_order` с секцией `tz`. Обратный порядок нарушил бы «заказ без ТЗ невозможен»
- File-объекты никогда не кладутся в `form`/`items` формы создания — черновик пишется
  через `JSON.stringify`, и File молча превратился бы в `{}`
- Маршрут позиции считать `buildItemRoute` (и в сторе, и в превью формы) — правило
  вырезания `supply` при материале подрядчика живёт там

## Правила ERP (отложенное: ОТК, сортировка, даты, диплинк, индикаторы)
- Финальный ОТК (`qc`) — последний этап производственного маршрута, зависит от ВСЕХ
  терминальных этапов: нанесение на готовом даёт параллельные ветки, и «после
  последнего по списку» пустило бы контроль до конца соседней ветки. Маршрут без
  производственных этапов ОТК не получает — иначе вечная пробка на пустом месте.
  `needsQc` живёт только в форме: этапы материализуются при создании, и колонка
  в позиции стала бы вторым источником правды
- Сортировка таблиц — `utils/tableSort`: пустые ячейки ВСЕГДА внизу (иначе «по
  убыванию» поднимает строки без значения), порядок стабильный, значение колонки
  берётся то же, что видно в ячейке. Применять до пагинации
- Нативный `type="date"` не заменяем: на планшете это системный календарь, лучший
  тач-ввод из существующих. Формат задаёт локаль браузера (en-US → mm/dd/yyyy) и
  страницей не переопределяется — поэтому `DateField` печатает эхо «14 авг. 2026»
  под полем. Свой календарь был бы хуже, а не лучше
- Оверлей, который хочется переслать или обновить, живёт в адресе: боковая карточка
  заказа — `?order=`. Открытие пушит запись истории, закрытие снимает её же, поэтому
  «Назад» и ✕ совпадают. Пришли по чужой ссылке — своей записи нет, закрытие идёт
  `replace`, иначе ✕ уносит на прошлый сайт. Стор про роутер не знает: навигатор
  регистрирует `OrderDrawerHost`, без него `open/close` работают по памяти (тесты)
- Индикатор стадий один — `StageIndicator` с вариантами `dots`/`funnel`/`pipeline`.
  Три ВИДА осознанны (отвечают на разные вопросы), три РЕАЛИЗАЦИИ были долгом

## Правила ERP (UX-аудит, хвост долгов)
- Действие, откатывающее не только выбранный объект, обязано перечислить всё
  затронутое: возврат брака переоткрывает и промежуточные этапы (`utils/stageDefect`
  считает тот же диапазон `sort_order`, что и слайс, — чтобы текст не разошёлся с фактом)
- Ссылка «в глубину» несёт текущий `search` в `location.state.from`, а обратная
  ссылка ведёт по нему: `useScrollRestore` ключуется по `pathname+search`, и без этого
  теряются и фильтры, и позиция прокрутки
- `title` даётся для того, что НЕ видно: дублировать уже видимый номер бессмысленно,
  а обрезанное многоточием название без подсказки прочитать нельзя
- Горизонтально прокручиваемый блок оборачивается в `ScrollHintBox` — иначе не видно,
  что справа есть содержимое
- Любое действие, отправляющее запрос, блокируется на время ответа (`busy`-флаг):
  `withPending` в сторе защищает от гонки с realtime, но не от повторного тапа
- Чипы-подсказки справочника ДОПИСЫВАЮТ значение, а не затирают набранный текст
- Никаких тихих лимитов в списках: «показаны последние N из M» + кнопка

## Правила ERP (UX-аудит, волны UX-4…UX-6)
- Валидация формы различает `missing` (не заполнено) и `invalid` (заполнено неверно) —
  иначе подсказка «Осталось заполнить: Дата запуска» появляется при заполненной дате
- Проверка поля живёт в `validateOrderForm`, а не в сабмите: только оттуда работают
  рамка, `aria-invalid`, автоскролл и строка у кнопки. Тост для этого не годится
- Удаление заполненного блока формы (позиция, нанесение) — через `confirm()`:
  новое состояние уезжает в черновик через 500 мс, отката нет
- `Escape`/`Enter` внутри инлайн-правки гасить `stopPropagation()` — контейнеры
  слушают их через `useFocusTrap`/форму и реагируют вместо поля
- Боковая карточка закрывается на смене маршрута: хост смонтирован вне `<Routes>`
  и иначе переживает переход
- Контекст списка (вкладка, даты, фильтр) — в URL, позиция прокрутки — `useScrollRestore`
- `role="tab"` ставится только вместе с `aria-controls`, `role="tabpanel"`,
  roving tabindex и `onTabListKeyDown` (`utils/tabs`). Половина паттерна хуже, чем
  обычные кнопки с `aria-pressed` — так сделаны переключатели вида и вкладки заказов
- У любого перетаскивания обязана быть клавиатурная альтернатива: приоритет очереди —
  кнопки ↑/↓ (они же решают проблему планшета), карточка канбана — Enter/Space
- Фолбэки `var(--token, X)` не писать: токены объявлены в `index.css`, который
  импортируется первым, а фолбэк становится вторым тихим источником правды
- Дубли примитивов сводить через `composes` (класс-источник должен быть объявлен ВЫШЕ)
- Слои: `--z-drawer` < `--z-modal` < `--z-lightbox`. Один z-index на все полноэкранные
  элементы означает, что порядок наложения держится на порядке монтирования

## Правила ERP (UX-аудит, волна UX-3)
- Цвет статуса и цвет текста на нём — разные токены: заливка `--color-*`/`--bg-*`,
  текст `--color-*-ink`. Красить текст той же переменной, что заливку, нельзя:
  в светлой теме «ожидает» давало 2.02:1 при норме 4.5
- Список в `@media (pointer: coarse)` — часть правила ≥44px, а не довесок. Добавили
  интерактивный класс — впишите его туда же, иначе на планшете он останется мелким
- Инлайновый `minHeight`/`font` на элементе с классом всегда бьёт медиазапрос.
  Компактные размеры — только классами (`.inputXs`, `.chipBtn`)
- Токен, которого нет, молча работает фолбэком: так `var(--danger, #c0392b)` и
  `var(--font-mono, monospace)` жили в коде, не совпадая ни с чем. Прежде чем писать
  фолбэк — проверьте, что токен объявлен
- Токены, нужные ERP-компонентам, объявляются в `index.css`, а не только в `.shell`:
  AdminScreen смонтирован и в Order Studio, вне `.shell` объявление отбрасывается
- Ниже 760px сайдбар — выезжающий оверлей; в свёрнутом виде счётчик заданий остаётся
  точкой поверх иконки и дублируется в `title`
- Высоты оболочки — `100dvh`, не `100vh`: адресная строка планшета съедает низ

## Правила ERP (UX-аудит, волна UX-2)
- Три состояния экрана в этом порядке: **ошибка** (`LoadFailed` с «Повторить») →
  **скелетон** → **пусто**. Скелетон вешать на `!loaded && !loadError`, а НЕ на
  `loading`: при сбое `loading` уже false, и экран замирал навсегда
- Новый экран со своими данными обязан обрабатывать `loadError`. Эффект
  `if (!loaded) loadAll()` второй раз не срабатывает — без кнопки повтора
  единственный выход у человека это F5
- Пустое состояние обязано различать «работы нет» и «под фильтры ничего не попало»
  (`EmptyResult` с текстом запроса и кнопкой «Сбросить»)
- Скелетон повторяет финальный лейаут буквально, теми же классами. Разошёлся —
  это не скелетон, а мигание чужой разметкой

## Правила ERP (UX-аудит, волна UX-1)
- Права проверяются **по действию**, а не по цеху: `useStagePermissions(deptId)` даёт
  `take/progress/complete/block/defect`, и каждая кнопка гейтится своим правом.
  `canActIn` — это «ваш ли цех» для пояснения «только просмотр», не гейт
- Все 10 прав матрицы обязаны что-то выключать. Добавили право — сразу проведите его
  до элемента интерфейса, иначе матрица снова станет декоративной
- Колонка «Директор» в матрице не редактируется: профили `admin`/`director`
  приводятся к этой роли, и снятая галочка отключила бы доступ самому админу
- `DEFAULT_PERMISSIONS` обязан повторять seed миграций — есть тест
- Закрытие этапа «целиком» пишет весь тираж, поэтому идёт через `confirmStageDone`
  (`utils/stageDone`) во всех трёх точках: очередь, дорожка канбана, чип плана
- Смысл броска на канбане считает `utils/kanbanDrop.kanbanDropIntent`. Дорожка НЕ
  трогает событие от карточки чужого цеха — иначе она обнулит drag-состояние
  раньше, чем сработает колонка, и перенос между цехами потеряется
- Производственный план фильтруется тем же `applyStageFilters`, что очередь и канбан:
  строка видна, если под подбор попал хотя бы один её этап

## Правила ERP (правки менеджера, волны 2–3)
- Материальный гейт — из данных: `erp_departments.gate_material_kinds`, правится
  в админке. Пусто = участок не гейтится (fail-open). Гейтовые функции
  (`isStageReady`, `waitingReason`, `missingMaterialsForStage`) принимают СТРОКУ
  цеха, а не код: константа «ткань → закрой» не давала новому участку попасть под гейт
- Группа `awaiting_materials` отделена от `waiting`: «ждём ткань» и «швейка ещё
  не сдала» — разные решения руководителя. Дорожка на канбане идёт перед «Готово
  к работе», `blocked` тоже получил свою вместо подмешивания в «Готово»
- Отметка поступления материала ведёт в существующий путь приёмки
  (`acceptMaterial`/`confirmStockMaterial`): `status='received'` без `accept_status`
  гейт не снимает, и кнопка была бы декоративной. Право — `material.receive`
- План производства РУЧНОЙ: система ничего не переносит и не планирует за человека.
  Недовыполнение остаётся отклонением на своей дате (`utils/planDay.deviations`),
  новую дату ставит руководитель
- «Убрать из плана» — `status='cancelled'`, не DELETE: факт и переписка остаются,
  а повторная постановка на ту же дату проходит upsert-ом по
  `unique (stage_id, work_date)`. Обратный порядок падал бы на 23505
- **Индекс под `onConflict` не может быть частичным.** PostgREST шлёт голый
  `ON CONFLICT (col, col)`, а целевой индекс Postgres выводит только из списка
  колонок: частичный подойдёт, лишь если в ON CONFLICT продублирован его предикат,
  чего PostgREST не умеет. Индекс плана завели с `where stage_id is not null`,
  и `planStage` падал на 42P10 при КАЖДОМ вызове — спецификация проверяется при
  планировании запроса, до поиска конфликта. Предикат снимается без последствий:
  NULL-ы в обычном уникальном индексе Postgres считает разными. Сторожит
  `upsertConflict.test.ts` (находит каждый `onConflict` и сверяет со схемой)
- Факт за день (`qty_done`) — НАКОПИТЕЛЬНЫЙ за этот день, а не приращение:
  повторный ввод исправляет ошибку, а не удваивает результат. Поле факта пустое,
  а не предзаполнено планом — то же правило, что у «сколько сдано» в задании цеха
- Цвет карточки плана — дополнительный сигнал: текстовый статус
  (`PLAN_STATE_LABELS`) стоит рядом всегда. «Ожидает материалы» перебивает цвет
  просрочки (отвечает на вопрос «почему»), но сама просрочка отдаётся отдельно
  `planOverdue` и на карточке видны обе

## Правила ERP (закрытие техдолга аудита 29.07)

- Возврат брака переоткрывает этапы по ГРАФУ `depends_on` (транзитивные потомки
  целевого), а не по интервалу `sort_order`. Ветки нанесения получают ОДИНАКОВЫЙ
  `sortOrder`, и отсечка по интервалу выбрасывала соседнюю ветку: партия уходила
  в пошив без печати. Статус делает отбор сам — этап в `waiting` этих единиц
  не видел. Считает `utils/stageDefect.intermediateReopened`, слайс зовёт ЕЁ ЖЕ
- Действие из двух записей: при сбое второй НЕ откатывать интерфейс поверх
  закоммиченной первой. Сначала компенсирующая запись; если и она не прошла —
  показываем состояние базы и говорим, что делать. Иначе realtime возвращает
  закоммиченное, и задание исчезает из обоих цехов (`moveStageToDepartment`)
- Приёмка материала (`accept_*`, `qty_received`, `fact_*`, переход в `reserved`)
  требует `material.receive` и на сервере: она снимает материальный гейт цеха.
  Закупочные поля (артикул, срок, поставщик, ответственный) страж не трогает —
  их правит снабжение, и правом они не гейтятся ни в интерфейсе, ни на сервере
- Плановые даты этапа — под `order.manage` с ОБЕИХ сторон (`PlanCell` + страж).
  Не `plan.manage`: это расписание заказа у менеджера, а не дневная раскладка
  цеха. Без права даты показываются на чтение — цеху важно видеть срок
- Аудит: `erp_stage_events` — богатая лента, пишет клиент (комментарий знает
  только он); `erp_order_audit` — гарантированный след, пишет триггер
  `erp_log_changes` на пяти таблицах. Закрылась вкладка — лента потеряет строку,
  факт движения останется. Действующее лицо пишется и как `uuid`: имя рвётся при
  переименовании и не различает тёзок. Новые поля идут с ПРЕФИКСОМ
  (`material.status`), иначе история подписала бы их как поля заказа
- Пересоздаёшь функцию БД целиком — бери ПОДЛИННЫЙ текст прежней миграции,
  а не пиши по памяти: сверка показала расхождение в пяти правилах из десяти
- Списочный запрос заказов (`ORDER_LIST_SELECT`) отличается от полного
  (`ORDER_SELECT`) набором колонок: `select *` в PostgREST шлёт и NULL-колонки.
  Убрать оттуда колонку, которую читает списочный экран, — значит получить
  `undefined` молча, без ошибки. Сторожит `orderSelect.test.ts`: он вытаскивает
  обращения `stage.X` из файлов, работающих по всему массиву. Карточка
  дозагружает полный заказ по `detailIds`, а не по «есть ли заказ в сторе»
- Отчёты об ошибках — `lib/errorReport`: адрес приёмника из `.env`, пусто =
  выключено. Всё в try/catch, дубли гасятся, потолок на сессию: отчёт об ошибке,
  роняющий приложение второй раз или забивающий сеть из цикла рендера, —
  худший вид наблюдаемости

## Правила ERP (аудит по скилам)
- «Производственный цех» — признак из данных (`erp_departments.is_production`,
  хелпер `isProductionDept`), НЕ константа. Иначе участок, заведённый в админке,
  не появится ни в меню, ни в канбане, ни в маршруте, ни в гейте ТЗ
- Диалоги — только через `useConfirmStore`: `confirm()` для да/нет,
  `confirmWithInput()` когда нужна причина. `window.confirm/prompt` не использовать
- Архив заказов грузится страницами (`ARCHIVE_PAGE_SIZE`, кнопка «Показать ещё»),
  тихих лимитов не ставить — сколько загружено, должно быть видно
- e2e: ERP-сценарии живут в `e2e/erp-queue.spec.ts` (проект `desktop`), мобильная
  разметка — в `e2e/erp-mobile.spec.ts` (проект `mobile`, 375px). Спеки разведены
  через `testIgnore` у обоих проектов: гонять desktop-разметку на 375px и наоборот
  бессмысленно — там другой интерфейс, а не тот же в меньшем масштабе

## Правила ERP (аудит 03.08.2026, фазы 0–5)

- Бюджет критического пути считает `scripts/bundle-budget.mjs` ПО МАНИФЕСТУ
  сборки, а не по `index.html`: оболочка ERP приезжает динамическим импортом,
  и в HTML её нет. Считать по HTML — значит не видеть 60 кБ из 280 и получить
  вечно зелёный страж. Чанк ищется по `manifest.name`; переименуют файл —
  страж скажет, а не посчитает оболочку нулевой
- Форматирование срока, процентов и дат — только `erp/utils/format`. Две метки
  срока и ровно две: `dueLabel` там, где фраза читается целиком, `dueLabelCompact`
  в плотных строках. Своя копия в компоненте означает пятый вариант написания
  одного и того же — их уже было семь
- Ноль в знаменателе это «неизвестно», а не «готово»: `percentOf` отдаёт `null`,
  интерфейс показывает «—». Прежняя 100 при плане 0 рисовала пустую неделю
  полностью закрытой
- Просрочка ЗАКАЗА — `isOrderOverdue`: срок прошёл И заказ не готов к отгрузке.
  Готовый ждёт логистики, а не производства. Ступени 1–7 / 8–30 / 30+ —
  `overdueBucket`; одно число «просрочено: 47» не отвечает на вопрос «что делать»
- Тестовые заказы отделяются флагом `erp_orders.is_demo`, и фильтр стоит
  В САМОМ ЗАПРОСЕ, а не в экранах: их пятнадцать, и один забытый показывает демо
  как боевую работу. `loadOne` фильтру не подчиняется — прямая ссылка обязана
  открываться. Realtime тоже проверяет флаг. Автоматически по имени флаг
  не ставится: спрятать боевой заказ хуже, чем показать тестовый
- Кнопки ERP — только примитив `Button`/`ButtonLink`. Глобальный `btn btn-*` это
  язык Order Studio (uppercase-типографика). Ссылка-кнопка обязана оставаться
  ссылкой: `ButtonLink` сохраняет Ctrl+клик, «открыть в новой вкладке» и роль
  для скринридера
- Невалидное CSS-объявление браузер отбрасывает МОЛЧА. `var(--x))` с лишней
  скобкой прожил в примитиве неизвестно сколько, и вместо починки его обходили.
  Если примитив «не приживается» — сначала проверьте, работает ли он
- Контраст текстовых токенов сторожит `styles/contrast.test.ts`: читает настоящий
  `index.css`, разворачивает `var()`-алиасы и считает WCAG по всем парам
  «текст × поверхность». Пятого уровня серого выше порога AA в палитре нет —
  иерархия ниже `--text-dim` выражается размером и положением, не контрастом
- Данные страницы берутся ПАКЕТОМ: `erp_bootstrap()` для оболочки,
  `erp_order_detail(uuid)` для карточки. Обе `SECURITY INVOKER` — «одним
  запросом» не означает «мимо RLS». Цех вызывающего берётся из `auth.uid()`,
  а не из `profile_id` в параметрах
- Кэш запросов — `store/queryCache`: дедупликация, stale-while-revalidate,
  инвалидация по префиксу. Отмены запроса нет намеренно (supabase-js не принимает
  AbortSignal); от «поздний ответ перезаписал экран» защищает alive-гард.
  Кэш чистится в `resetErpStore()` — это вторая память рядом со стором, и
  оставить её при выходе значит отдать следующей смене чужие данные
- Брейкпоинты: 480 / 768 / 1024. Совпадают с `COMPACT_LAYOUT_QUERY`. Если сетка
  может подстроиться сама (`auto-fit` + `minmax`), порог не переносят, а убирают
- Раздел «Производство» — один пункт меню и вкладки `ProductionTabs`
  (Доска · План · Загрузка). Адреса `/board`, `/plan`, `/load` СОХРАНЕНЫ:
  редирект сломал бы закладки и добавил переход на самом частом пути.
  Вкладки — ссылки с `aria-current`, не `role="tab"`: каждая это своя страница
- Уведомления группируются по тому, ЧТО ДЕЛАТЬ, а не по типу записи. Срочное
  развёрнуто, давнее свёрнуто со счётчиком. Группа — нативный `<details>`:
  клавиатура и скринридер работают без строчки JS
- Витрина дизайн-системы — `/styleguide` за флагом `styleguide`. Тест проверяет
  вычислимое, витрина — различимы ли элементы рядом друг с другом
- Вкладки карточки заказа (`orderCard/OrderCardTabs`) — шесть, активная в адресе
  (`?tab=`), полный таб-паттерн. Шапка «почему заказ стоит» остаётся видимой
  на любой вкладке: она отвечает на вопрос, с которым в карточку и заходят
- Инлайн-правки заказа гейтятся `order.manage` НА КЛИЕНТЕ ТОЖЕ — страж
  `erp_order_guard` в БД зеркалит ровно это. Гейт и страж ставятся одним
  коммитом, иначе получится запрещённое «кнопка есть, действие падает»
- Активный список заказов серверной пагинации не получает (причина —
  в корневом CLAUDE.md). Постранично грузится архив; списку даны пагинация,
  сортировка (`utils/tableSort`) и контекст в адресе
- `strict: true` включён, `npm run typecheck` в CI. Типы стора Order Studio
  собираются из `ReturnType` слайсов — типизированы ДЕЙСТВИЯ, поля данных
  остались свободными: полная типизация состояния визарда — отдельная работа
- Live-регион тостов смонтирован всегда, даже пустой (`Toast.jsx`). Регион,
  появляющийся в DOM вместе с первым сообщением, скринридер не отслеживает

## Не трогать без тестов
- utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- store/slices/ — 796 тестов зависят от них
- erp/utils/ progress · filterStages · queueOrder · stageMove · permissions — чистая логика
  волны 1, 88 тестов
- erp/utils/tz.ts — резолюция версий и гейт ТЗ, 38 тестов
- erp/utils/queueEntries.js — единый источник групп очереди, 21 тест

## Тесты
```bash
npm run test      # 1765 unit тестов (Vitest)
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

**Без `.env` e2e падает ВЕСЬ, и падает молча белым экраном.** `lib/supabase.ts`
бросает «Missing Supabase credentials» на уровне модуля — до React, поэтому
ErrorBoundary не срабатывает, а Playwright видит пустой `<div id="root">`
и сообщает «element(s) not found» про каждый локатор. Мок Supabase от этого
не спасает: он перехватывает сеть, а падает импорт. `.env` в гите нет
(`.gitignore`), значения — `VITE_SUPABASE_URL` и публичный
`VITE_SUPABASE_ANON_KEY`, шаблон в `.env.example`. Увидели 13 падений подряд
с пустой страницей — сначала проверьте `.env`, а не спеки.

## Design System
- Токены: src/index.css (:root) — --type-*, --space-*, --z-*, --radius-*, --color-*
- Dark mode: html[data-theme="dark"] с полным набором override-токенов
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
- Кнопки: в ERP — примитив `erp/components/Button` (variant/size/icon/loading);
  глобальные .btn + variants остаются языком Order Studio
- Иконки ERP: `erp/components/Icon` + набор в icons.js. Эмодзи вместо иконок не использовать;
  иконка участка — `deptIcon(code)`, значение это ИМЯ иконки, не глиф
- Высоты примитивов заданы явно + свой @media (pointer: coarse) в их CSS-модуле
  (общий список классов ≥44px — в erp.module.css)
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
