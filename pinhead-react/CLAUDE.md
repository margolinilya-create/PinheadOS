# PINHEAD Order Studio — pinhead-react

React-приложение. Здесь только то, что специфично для клиента: структура,
стор, экраны, UI и тесты. Продукт, схема БД, права на сервере, маршрут
производства, даты и правила работы с Supabase — в корневом `CLAUDE.md`,
дублировать их сюда не нужно.

Правила сгруппированы ПО ТЕМАМ. Новое дописывается в существующий раздел;
раздел с датой или номером волны в названии не заводить.

## Два раздела

Переключение в шапке (admin/director), единая админка (`erp/screens/AdminScreen`)
смонтирована в оба.

- **`erp/`** — 🏭 Производство (по умолчанию)
- **`orderstudio/`** — ✏️ ТЗ (за флагом `orderStudio`): визард, SKU, аналитика

## Структура src/

```
src/
├── components/            # Order Studio
│   ├── steps/             # Визард: StepGarment → StepDesign → StepItems → StepDetails → StepSummary (lazy 2–5)
│   │   └── garment/       # SkuList, FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
│   ├── orders/            # KanbanBoard, KanbanCard (keyboard DnD), OrderDrawer
│   ├── editors/           # PriceEditor, SkuEditor (8 табов), ExpressCalc
│   │   └── sku/           # SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab,
│   │                      # PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal,
│   │                      # ZonesModal, SkuDetailModal
│   ├── analytics/         # Dashboard (Chart.js)
│   ├── auth/              # AuthScreen, AdminPanel
│   ├── layout/            # Header (dark mode toggle), ProgressBar
│   ├── output/            # PrintPreview
│   └── shared/            # ErrorBoundary, Toast, PageHeader, Skeleton, OnboardingTips,
│                          # CommandPalette, PriceBreakdown, RolePreviewBar
├── erp/                   # см. раздел «ERP: состав» ниже
├── store/                 # Zustand, всё .ts
│   ├── useStore.ts        # главный store (7 слайсов)
│   ├── slices/            # wizard, product, design, items, details, catalog, order
│   └── useAuthStore.ts · useOrdersStore.ts · useCommentsStore.ts · useToastStore.ts · useConfirmStore.ts
├── utils/                 # pricing, skuRules, validate, mockup, deadline, i18n, date
├── lib/                   # supabase, api, storage, catalogs, errorReport, configError
├── types/                 # order, catalog, auth, pricing, database.generated
├── data/                  # fallback: prices, skuCatalog, extras, fabrics, colors
└── hooks/                 # useDraft, useFocusTrap, useEffectiveRules, useMediaQuery,
                           # useScrollHints, useScrollRestore
```

Компоненты — `.jsx`, утилиты и типы — `.ts`. Тесты рядом с файлами:
`Component.test.jsx`, `util.test.ts`.

## ERP: состав

- **screens/** — Dashboard · Orders · OrderCard · ProductionBoard (+Kanban) ·
  DepartmentQueue · ProductionTask · FabricPurchasing · AdminScreen ·
  DeptLoad (`/load`, сетка «цех × день») · PlanScreen (`/plan`, недельная доска)
- Крупные экраны разрезаны на под-компоненты:
  - `screens/orders/` — DueCell, OrderRow, OrderCardMobile, CreateOrderModal
    (+ `create/`: SizeGridEditor, FormParts, ItemBlock, TzSection)
  - `screens/queue/` — Lightbox, PhotoAttach, TzBlock, QueueCard, QueueRow,
    StageActionsPanel + `useStageActions` (действия цеха, общие со страницей
    задания), DefectWizard, DeptPlanPanel
  - `screens/orderCard/` — PlanCell, StageStepper, OrderItemSection,
    CommentsSection, HistorySection, TzDocsSection, OrderCardTabs +
    `useOrderDetail`, OrderDrawer/OrderDrawerHost
  - `screens/plan/` — PlanTaskCard, PlanSlotDrawer, PlanAddModal
  - `screens/warehouse/` — MaterialReceiptCard, MarkingCard, PackShipCard,
    SubcontractReceiptCard
  - `screens/purchasing/` — SupplyQueue, SupplierOptionsModal
  - `screens/experimental/` — DevCard, DevTasksSection, DevSendToDept
  - `screens/admin/` — PermissionsTab, DictionariesTab
- **components/** — ErpKanban (+ `kanban/`: KanbanCard, useTouchDndPolyfill),
  InlineEdit, PageHead, ErpSkeletons, ErpStates (LoadFailed/EmptyResult/EmptyState),
  Icon + icons.js (свой SVG-набор), Button, Field, RouteProgress, QueueFilters,
  DictionaryDatalist, TzViewer, ReadOnlyFieldset, StageIndicator +
  примитивы Badge/Drawer/Pagination/FilterBar/Stepper
- **store/** — `useErpStore.ts` (ядро) + `slices/` + `useOrderDrawer.ts` +
  `useErpSearch.ts` + `useErpAccess.ts` + `useStagePermissions.ts` + `useDictionary.js`;
  контракт и DTO в `types.ts`, плумбинг в `shared.ts`, чистые хелперы
  в `orderHelpers.ts`
- **utils/** — routes · time · format · stageUi · orderForm · progress ·
  filterStages · queueEntries · queueOrder · stageMove · stageDone · stageDefect ·
  stageInput · permissions · screenAccess · kanbanDrop · tz + tzFile · supply ·
  subcontractPhase · bypass · capacity · deptLoad · planCard · planDay ·
  experimentalTasks · filterExperimental · tableSort · tabs
- Touch-DnD канбана: `mobile-drag-drop` (dynamic import). PWA:
  `public/manifest.webmanifest` + icon-192/512

## Order Studio: каталоги и визард

- Цены: `getPrices()` → store → localStorage → `DEFAULT_PRICES`
- Каталоги: Supabase (`app_config` + `catalog_config`) → localStorage → defaults.
  Все — в Zustand (`catalogSlice`): skuCatalog, fabricsCatalog, trimCatalog,
  extrasCatalog, hardwareCatalog, labelsCatalog
- SKU Editor — 8 табов: items, fabrics, trims, extras, hardware, pricing, rules, zones
- `CategoryRules` — per-категория: allowedTechs, moq, availableSizes, defaultExtras,
  allowedZoneTechs. Per-SKU overrides: allowedFabrics, allowedExtras, availableSizes,
  overrides (techs/moq/colors), priceMultiplier
- Зоны нанесения динамические (`ZoneDefinition` в `zonesCatalog`), не хардкод
- Визард: `useEffectiveRules()` → фильтрация техник, цветов, размеров, тканей, обработок
- SKU-фото: bucket `sku-photos`, до 4 на артикул, поле `photos[]` (`photoUrl` удалён).
  `deleteSkuPhotoByUrl` проверяет результат и показывает `toast.error` при ошибке
- Черновик: localStorage `pinhead_draft`

## Стор

- `useShallow` для объектных селекторов Zustand — обязательно
- **Стор ERP разделён на ЯДРО и доменную часть.** В ядре (`useErpStore.ts`) — ровно
  то, чем пользуется оболочка: `bootstrap`, `orders`, `permissions`, `bypass`,
  `realtime`. Остальные 11 слайсов приезжают отдельным чанком вместе с первым
  экраном (`store/domainSlices.ts`). Импорты ядра ЯВНЫЕ: баррель `./slices` тянет
  все шестнадцать, и лишние отваливаются только благодаря tree-shaking, то есть
  по умолчанию, а не по решению
- **`attachDomainSlices` переносит ТОЛЬКО функции.** Данные доменных слайсов стоят
  в ядре (`store/domainState.ts`): `loadBootstrap` наполняет
  `subcontracting`/`experimental`/`dictionaries` ещё до открытия любого экрана,
  а `myDeptId`/`myRole` читает `useErpAccess` в самой оболочке. Приедь данные вместе
  со слайсом — позднее подключение затирало бы загруженное. Сторожит
  `domainSlices.test.ts`
- У этапов, материалов, склада, закупки и ТЗ собственных данных НЕТ вовсе — они
  правят `orders` из ядра. В `DOMAIN_INITIAL_STATE` их нет, и пустая строка там
  была бы ложью о наличии состояния
- **Файлы `src/store/**`, `main.jsx` и `App.jsx` НЕ импортируют `erp/store/*`
  статически.** Одна такая строка (`resetErpStore` в `useAuthStore`) тянула весь
  ERP-стор во входной чанк — 26 кБ gzip у каждого, кто открыл только Order Studio.
  Сбросы регистрируются через `store/appReset`; строку сторожит тест, потому что
  бюджет бандла скажет «стало больше», но не скажет, из-за чего
- Кэш запросов — `store/queryCache`: дедупликация, stale-while-revalidate,
  инвалидация по префиксу. Отмены запроса нет намеренно (supabase-js не принимает
  AbortSignal); от «поздний ответ перезаписал экран» защищает alive-гард. Кэш
  чистится в `resetErpStore()` — это вторая память рядом со стором, и оставить её
  при выходе значит отдать следующей смене чужие данные
- **У `loadAll` НЕТ guard'а «уже грузим — выходим», и это проверено.** Обе формы
  экономии (ранний выход и дедупликация общим промисом) ломают очередь цеха —
  10 e2e из 24: экраны зовут `loadAll()` как загрузку своих данных и читают стор
  сразу после. Лишний запрос дешевле пустого экрана
- Любое действие, отправляющее запрос, блокируется на время ответа (`withPending`):
  он защищает от гонки с realtime, но не от повторного тапа — нужен `busy`-флаг
- **Одинаковые тосты не копятся**: повтор поднимает счётчик у висящей полосы. Один
  системный сбой доходит до человека десятью экранами сразу, потому что флаги
  загрузки общие. Id тоста — счётчик, а не `Date.now()`: два сообщения в одну
  миллисекунду получали общий id, и закрытие одного гасило оба
- Realtime точечный; архив ленивый; создание заказа — RPC `erp_create_order`

## Ленивость и бюджет

- **Все экраны ERP ленивые, включая первые три.** Обзор, заказы и очередь были
  статикой ради «без мигания на первом экране» и стоили оболочке 37 кБ gzip: их код
  ехал каждому и всегда, в том числе рабочему, который открывает только свой цех.
  Скелетоны у экранов есть, а `usePrefetchScreens` тянет соседние в ПРОСТОЕ
  (`requestIdleCallback`)
- **Экран ERP заводится `lazyScreen`, а не голым `lazy`** (`erp/lazyScreen.js`):
  обёртка грузит чанк экрана и доменный чанк ПАРАЛЛЕЛЬНО и подключает слайсы
  до первой отрисовки. Голый `lazy` даёт стор без половины действий — ошибка
  не при сборке и не при переходе, а при нажатии на кнопку, то есть у цеха
- **Правило сформулировано ПО ЭКРАНАМ, а не по файлу-оболочке.** Первая версия
  сторожа обходила статический граф `ErpApp` и пропустила настоящую поломку: единая
  админка смонтирована ЕЩЁ И в `OrderStudioApp`, голым `lazy`, мимо всякого
  `ErpApp` — `/admin` там падал с «loadEmployees is not a function»
- **Хост боковой карточки смонтирован вне `<Routes>`, поэтому её содержимое обязано
  быть ленивым.** Статический импорт тянул в критический путь всё дерево карточки —
  124 кБ, притом что хост возвращал `null`, пока карточка закрыта: не рисовалось,
  но ехало. Заглушка `Suspense` не использует примитив `Drawer` — иначе он вернулся
  бы в оболочку, ради чего всё и делалось
- **Бюджет считает `scripts/bundle-budget.mjs` ПО МАНИФЕСТУ сборки**, а не
  по `index.html`: оболочка ERP приезжает динамическим импортом, и в HTML её нет.
  Считать по HTML — значит не видеть 60 кБ из 280 и получить вечно зелёный страж.
  Чанк ищется по `manifest.name`. Пороги живут в `BUDGETS` того же файла — там
  их и смотреть, а не в документации: записанное здесь число устареет первым
- Бюджет, к которому подошли вплотную, ломает сборку на каждой правке вместо того,
  чтобы ловить регрессию. Возврат одного экрана в критический путь — это ~30 кБ,
  страж такое видит
- Новую утилиту в `orderHelpers.ts` не импортировать без замера: она попадёт
  в оболочку, а не в ленивый чанк

## Права в интерфейсе

Матрица и серверная сторона — в корневом `CLAUDE.md`. Здесь только клиент:

- Права проверяются **по действию**, а не по цеху: `useStagePermissions(deptId)`
  даёт `take/progress/complete/block/defect`, и каждая кнопка гейтится своим правом.
  `canActIn` — это «ваш ли цех» для пояснения «только просмотр», не гейт
- Не проверять роли в компонентах вручную — только `useErpAccess`
- Все права матрицы обязаны что-то выключать. Добавили право — сразу проведите его
  до элемента интерфейса, иначе матрица снова станет декоративной
- Колонка «Директор» в матрице не редактируется: профили `admin`/`director`
  приводятся к этой роли, и снятая галочка отключила бы доступ самому админу
- Без права экран остаётся на чтение — `ReadOnlyFieldset`, а не `disabled`
  на каждом элементе. Копий этого блока быть не должно

## Очередь, канбан, задания

- Приоритет очереди — `erp_item_stages.queue_position`, numeric-середина между
  соседями, писать через `reorderStageQueue`, не перенумеровывать вручную
- Группа и причина ожидания считаются одним `buildQueueEntries`, не по месту
- Исполнитель проставляется при «Взять в работу» (`assignee = currentActor()`)
- Фильтры заданий — `utils/filterStages`, состояние в URL (возврат из заказа его
  восстанавливает). Тем же `applyStageFilters` фильтруется производственный план:
  строка видна, если под подбор попал хотя бы один её этап
- Перенос между цехами — только `moveStageToDepartment`; правила и последствия —
  `utils/stageMove.analyzeStageMove`, подтверждение в UI. Молча этап не закрывать
- Закрытие этапа «целиком» пишет весь тираж, поэтому идёт через `confirmStageDone`
  (`utils/stageDone`) во всех трёх точках: очередь, дорожка канбана, чип плана
- Действие, откатывающее не только выбранный объект, обязано перечислить всё
  затронутое: возврат брака переоткрывает и промежуточные этапы. Считает
  `utils/stageDefect.intermediateReopened`, слайс зовёт ЕЁ ЖЕ, чтобы текст
  не разошёлся с фактом
- **Возврат брака переоткрывает этапы по ГРАФУ `depends_on`** (транзитивные потомки
  целевого), а не по интервалу `sort_order`. Ветки нанесения получают ОДИНАКОВЫЙ
  `sortOrder`, и отсечка по интервалу выбрасывала соседнюю ветку: партия уходила
  в пошив без печати
- Смысл броска на канбане считает `utils/kanbanDrop.kanbanDropIntent`. Дорожка
  НЕ трогает событие от карточки чужого цеха — иначе она обнулит drag-состояние
  раньше, чем сработает колонка, и перенос между цехами потеряется
- Прогресс — в штуках (`utils/progress`), не в числе завершённых этапов
- Фильтр очереди по происхождению — `origin` в `filterStages` (перечисление,
  не булев флаг: ссылки на отфильтрованную очередь живут в переписке)

Разработка образцов (ЭКС) считается своими утилитами —
`utils/experimentalTasks.ts` (готовность, блокер, следующее действие, состояние)
и `utils/filterExperimental.ts` (фильтры экрана). `isStageReady` там НЕ
переиспользуется: её сигнатура тянет материалы, цех, гейты закупки и ТЗ, которых
у задач разработки нет. Задача со `stage_id` в интерфейсе только на ЧТЕНИЕ — её
статус ведёт триггер, поэтому `updateDevTask` снимает `status`/`blocked_reason`/
`done_on` перед записью.

## Состояния экрана

- Три состояния в этом порядке: **ошибка** (`LoadFailed` с «Повторить») →
  **скелетон** → **пусто**. Скелетон вешать на `!loaded && !loadError`, а НЕ
  на `loading`: при сбое `loading` уже false, и экран замирал навсегда
- Новый экран со своими данными обязан обрабатывать `loadError`. Эффект
  `if (!loaded) loadAll()` второй раз не срабатывает — без кнопки повтора
  единственный выход у человека это F5
- Пустое состояние различает «работы нет» и «под фильтры ничего не попало»
  (`EmptyResult` с текстом запроса и кнопкой «Сбросить»)
- Скелетон повторяет финальный лейаут буквально, теми же классами. Разошёлся —
  это не скелетон, а мигание чужой разметкой
- Никаких тихих лимитов в списках: «показаны последние N из M» + кнопка.
  Архив грузится страницами (`ARCHIVE_PAGE_SIZE`, «Показать ещё»)
- Live-регион (`aria-live`) монтируется ВСЕГДА, даже пустой (`Toast.jsx`).
  Скринридер отслеживает ИЗМЕНЕНИЯ внутри уже существующего региона; регион,
  добавленный в DOM вместе с содержимым, он не читает. Разметка при этом выглядит
  правильной — поэтому баг и прожил долго

## Формы и диалоги

- Валидация различает `missing` (не заполнено) и `invalid` (заполнено неверно) —
  иначе подсказка «Осталось заполнить: Дата запуска» появляется при заполненной дате
- Проверка поля живёт в `validateOrderForm`, а не в сабмите: только оттуда работают
  рамка, `aria-invalid`, автоскролл и строка у кнопки. Тост для этого не годится
- Диалоги — только через `useConfirmStore`: `confirm()` для да/нет,
  `confirmWithInput()` когда нужна причина. `window.confirm/prompt` не использовать
- Удаление заполненного блока формы (позиция, нанесение) — через подтверждение:
  новое состояние уезжает в черновик через 500 мс, отката нет
- `Escape`/`Enter` внутри инлайн-правки гасить `stopPropagation()` — контейнеры
  слушают их через `useFocusTrap`/форму и реагируют вместо поля
- Чипы-подсказки справочника ДОПИСЫВАЮТ значение, а не затирают набранный текст
- Autofocus на первом поле формы
- File-объекты никогда не кладутся в `form`/`items` формы создания — черновик
  пишется через `JSON.stringify`, и File молча превратился бы в `{}`
- Маршрут позиции считать `buildItemRoute` (и в сторе, и в превью формы): правило
  вырезания `supply` при материале подрядчика живёт там

## Навигация и адрес

- Оверлей, который хочется переслать или обновить, живёт в адресе: боковая карточка
  заказа — `?order=`. Открытие пушит запись истории, закрытие снимает её же, поэтому
  «Назад» и ✕ совпадают. Пришли по чужой ссылке — своей записи нет, закрытие идёт
  `replace`, иначе ✕ уносит на прошлый сайт. Стор про роутер не знает: навигатор
  регистрирует `OrderDrawerHost`, без него `open/close` работают по памяти (тесты)
- Боковая карточка закрывается на смене маршрута: хост смонтирован вне `<Routes>`
  и иначе переживает переход
- Контекст списка (вкладка, даты, фильтр) — в URL, позиция прокрутки —
  `useScrollRestore` (ключ `pathname+search`)
- Ссылка «в глубину» несёт текущий `search` в `location.state.from`, а обратная
  ведёт по нему — иначе теряются и фильтры, и позиция
- Вкладки карточки заказа (`orderCard/OrderCardTabs`) — активная в адресе (`?tab=`),
  полный таб-паттерн. Шапка «почему заказ стоит» остаётся видимой на любой вкладке:
  она отвечает на вопрос, с которым в карточку и заходят
- Уведомления группируются по тому, ЧТО ДЕЛАТЬ, а не по типу записи. Срочное
  развёрнуто, давнее свёрнуто со счётчиком. Группа — нативный `<details>`:
  клавиатура и скринридер работают без строчки JS

## Доступность

- `role="tab"` ставится только вместе с `aria-controls`, `role="tabpanel"`,
  roving tabindex и `onTabListKeyDown` (`utils/tabs`). Половина паттерна хуже,
  чем обычные кнопки с `aria-pressed`
- У любого перетаскивания обязана быть клавиатурная альтернатива: приоритет
  очереди — кнопки ↑/↓ (они же решают проблему планшета), карточка канбана —
  Enter/Space
- `title` даётся для того, что НЕ видно: дублировать уже видимый номер бессмысленно,
  а обрезанное многоточием название без подсказки прочитать нельзя
- Горизонтально прокручиваемый блок оборачивается в `ScrollHintBox` — иначе не видно,
  что справа есть содержимое
- Ссылка-кнопка обязана оставаться ссылкой: `ButtonLink` сохраняет Ctrl+клик,
  «открыть в новой вкладке» и роль для скринридера

## Формат и представление

- Форматирование срока, процентов и дат — только `erp/utils/format`. Две метки
  срока и ровно две: `dueLabel` там, где фраза читается целиком, `dueLabelCompact`
  в плотных строках. Своя копия в компоненте означает пятый вариант написания
  одного и того же — их уже было семь
- **Ноль в знаменателе это «неизвестно», а не «готово»**: `percentOf` отдаёт `null`,
  интерфейс показывает «—». Прежняя 100 при плане 0 рисовала пустую неделю полностью
  закрытой. Рядом `percentUncapped`: потолок в 100 % прячет перегрузку — ровно тот
  случай, ради которого показатель заводили
- Сортировка таблиц — `utils/tableSort`: пустые ячейки ВСЕГДА внизу (иначе
  «по убыванию» поднимает строки без значения), порядок стабильный, значение
  берётся то же, что видно в ячейке. Применять до пагинации
- Индикатор стадий один — `StageIndicator`, ДВА вида: `dots` и `funnel`. Третий,
  `pipeline`, удалён вместе с фазовой моделью: после удаления `ExperimentalCard.jsx`
  он остался без единого вызова, и держал его только собственный тест. **Удаляя
  экран, проверьте, не осиротел ли примитив, который звал только он**
- Цвет — дополнительный сигнал, не единственный: текстовый статус
  (`PLAN_STATE_LABELS`) стоит рядом всегда. «Ожидает материалы» перебивает цвет
  просрочки (отвечает на вопрос «почему»), но сама просрочка отдаётся отдельно
  `planOverdue`, и на карточке видны обе
- **Нативный `type="date"` не заменяем**: на планшете это системный календарь,
  лучший тач-ввод из существующих. Формат задаёт локаль браузера (en-US → mm/dd/yyyy)
  и страницей не переопределяется — поэтому `DateField` печатает эхо «14 авг. 2026»
  под полем. Эхо НЕ убирать; пресеты убраны, решение записано в SESSION-STATE,
  чтобы его можно было оспорить

## CSS

- Токены из `:root` в `src/index.css` (`--type-*`, `--space-*`, `--z-*`,
  `--radius-*`, `--color-*`). Не `!important`
- **Фолбэки `var(--token, X)` не писать**: токены объявлены в `index.css`, который
  импортируется первым, а фолбэк становится вторым тихим источником правды. Токен,
  которого нет, молча работает фолбэком — так `var(--danger, #c0392b)`
  и `var(--font-mono, monospace)` жили в коде, не совпадая ни с чем
- Токены, нужные ERP-компонентам, объявляются в `index.css`, а не только в `.shell`:
  AdminScreen смонтирован и в Order Studio, вне `.shell` объявление отбрасывается
- **Невалидное CSS-объявление браузер отбрасывает МОЛЧА.** `var(--x))` с лишней
  скобкой прожил в примитиве неизвестно сколько, и вместо починки его обходили.
  Если примитив «не приживается» — сначала проверьте, работает ли он
- Цвет статуса и цвет текста на нём — разные токены: заливка `--color-*`/`--bg-*`,
  текст `--color-*-ink`. Красить текст той же переменной, что заливку, нельзя:
  в светлой теме «ожидает» давало 2.02:1 при норме 4.5
- Контраст текстовых токенов сторожит `styles/contrast.test.ts`: читает настоящий
  `index.css`, разворачивает `var()`-алиасы и считает WCAG по всем парам
  «текст × поверхность». Пятого уровня серого выше порога AA в палитре нет —
  иерархия ниже `--text-dim` выражается размером и положением, не контрастом
- Дубли примитивов сводить через `composes` (класс-источник объявлен ВЫШЕ).
  Заглавные начертания ERP — ОДНО групповое правило в начале `erp.module.css`
  (`.labelCaps` + заголовки), каждый класс уточняет только осознанную разницу.
  `composes` там не годится — он не работает на селекторе потомка (`.table th`).
  Сторожит `erp/styles.test.ts`
- **Uppercase Order Studio не трогать**: это его документированный язык, и из 155
  объявлений большинство — его кнопки. «Единый класс на весь проект» сменил бы вид
  половине интерфейса, а не убрал дубль
- Кнопки ERP — только примитив `Button`/`ButtonLink`. Глобальный `btn btn-*` —
  язык Order Studio
- Иконки ERP: `Icon` + набор в `icons.js`. Эмодзи вместо иконок не использовать;
  иконка участка — `deptIcon(code)`, значение это ИМЯ иконки, не глиф
- **Шрифты — только токенами и только загруженные.** `Space Grotesk`
  и `Roboto Condensed` жили в CSS, но отсутствовали в `index.html`: браузер молча
  падал на следующий, правила существовали, эффекта не давали. Сторожит
  `styles/fonts.test.ts`. Сейчас: Barlow Condensed (заголовки) / Inter (текст) /
  Roboto Mono (числа)
- Брейкпоинты: 480 / 768 / 1024, совпадают с `COMPACT_LAYOUT_QUERY`. Если сетка
  может подстроиться сама (`auto-fit` + `minmax`), порог не переносят, а убирают
- Ниже 760px сайдбар — выезжающий оверлей; в свёрнутом виде счётчик заданий
  остаётся точкой поверх иконки и дублируется в `title`
- Высоты оболочки — `100dvh`, не `100vh`: адресная строка планшета съедает низ
- Список в `@media (pointer: coarse)` — часть правила ≥44px, а не довесок. Добавили
  интерактивный класс — впишите его туда же, иначе на планшете он останется мелким.
  Инлайновый `minHeight`/`font` на элементе с классом всегда бьёт медиазапрос:
  компактные размеры — только классами (`.inputXs`, `.chipBtn`)
- Слои: `--z-drawer` < `--z-modal` < `--z-lightbox`. Один z-index на все
  полноэкранные элементы означает, что порядок наложения держится на порядке
  монтирования
- Dark mode: `html[data-theme="dark"]` с полным набором override-токенов, toggle
  в Header, persist в localStorage
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
- Витрина дизайн-системы — `/styleguide` за флагом `styleguide`. Тест проверяет
  вычислимое, витрина — различимы ли элементы рядом друг с другом

## Тесты

```bash
npm run test      # Vitest unit
npm run typecheck # tsc --noEmit, strict: true — 0 ошибок обязательно
npm run lint      # 0 ошибок обязательно
npm run build     # успешный билд обязательно
npm run e2e       # Playwright
```

Типы стора Order Studio собираются из `ReturnType` слайсов — типизированы
ДЕЙСТВИЯ, поля данных остались свободными: полная типизация состояния визарда —
отдельная работа.

**Не трогать без тестов** (чистая логика, на ней держатся расчёты):
`utils/pricing.ts` · `store/slices/` · `erp/utils/` progress, filterStages,
queueOrder, stageMove, permissions · `erp/utils/tz.ts` · `erp/utils/queueEntries.js`.

- Тест, который рендерит экран напрямую (минуя `lazyScreen`), обязан сам позвать
  `attachDomainSlices()`. В общий `setupTests` это не выносится: моки Supabase
  объявлены в файлах тестов, и слайсы, поднятые раньше, захватят другой инстанс
  клиента — действия будут работать, но мимо шпионов
- Тесты дат идут в поясе заказчика (`process.env.TZ = 'Europe/Moscow'` в unit,
  `test.use({ timezoneId })` в e2e): в UTC-контейнере сдвиг равен нулю и проходит
  ЛЮБАЯ реализация
- jsdom не умеет canvas: графики (`react-chartjs-2`) в тестах мокаются, иначе
  каждый прогон печатает «HTMLCanvasElement's getContext() is not implemented»

### e2e

- ERP-сценарии — `e2e/erp-*.spec.ts` (проект `desktop`), мобильная разметка —
  `e2e/erp-mobile.spec.ts` (проект `mobile`, 375px). Спеки разведены через
  `testIgnore` у обоих проектов: гонять desktop-разметку на 375px и наоборот
  бессмысленно — там другой интерфейс, а не тот же в меньшем масштабе
- **Перекрывающиеся `page.route` разрешаются ПОРЯДКОМ РЕГИСТРАЦИИ, и выигрывает
  ПОСЛЕДНИЙ.** В `e2e/support/mockSupabase.ts` частный `**/rest/v1/rpc/**` стоял
  перед общим `**/rest/v1/**` — и не срабатывал ни разу: `erp_bootstrap` отвечал
  `[]`, как таблица с именем `rpc/erp_bootstrap`, а приложение молча уходило
  на запасной путь `loadAll`. Весь e2e шёл не по тому пути, по которому ходит
  прод. Чинится не перестановкой (порядок забудут), а ОТСУТСТВИЕМ перекрытия:
  один обработчик, ветка по пути запроса
- Спека, которой нужны свои данные, передаёт их вторым аргументом
  `installSupabaseMock(page, { orders, experimental, dictionaries })`. Дописывать
  в общие фикстуры нельзя: базовые заказы держат visual-эталоны и счётчики
- **Без `.env` e2e падает ВЕСЬ, и падает молча белым экраном.** `lib/supabase.ts`
  бросает «Missing Supabase credentials» на уровне модуля — до React, поэтому
  ErrorBoundary не срабатывает, а Playwright видит пустой `<div id="root">`
  и сообщает «element(s) not found» про каждый локатор. Мок Supabase от этого
  не спасает: он перехватывает сеть, а падает импорт. Шаблон — `.env.example`.
  Увидели падения подряд с пустой страницей — сначала проверьте `.env`, а не спеки
- Если `@playwright/test` ждёт сборку браузера новее предустановленной, проще
  разложить ожидаемые пути симлинками на имеющиеся бинарники, чем держать свой
  конфиг

## Наблюдаемость

Отчёты об ошибках — `lib/errorReport`: адрес приёмника из `.env`, пусто =
выключено. Всё в try/catch, дубли гасятся, потолок на сессию: отчёт об ошибке,
роняющий приложение второй раз или забивающий сеть из цикла рендера, — худший
вид наблюдаемости.
