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
  screens/admin/ — PermissionsTab (матрица прав)/DictionariesTab (справочники + статусы r/o)/
  InviteModal (выдача ссылок)/UserModal (карточка учётной записи: имя, логин, пароль, удаление);
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
  удалена 12.08 вместе с веткой вставки в `erp_create_order`; секция
  `tz.assignments` в payload по-прежнему принимается и игнорируется —
  падать на лишнем ключе значило бы сломать старый бандл ради чистоты
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

## Правила администрирования учётных записей (сессия 31)

- Клиентская половина — `erp/store/adminUsers.ts` (вызов серверной функции
  и разбор её ответа) + четыре действия в `employeesSlice`:
  `createUserAccount` · `setUserPassword` · `setUserEmail` · `deleteUserAccount`.
  Сам `service_role` живёт только в функции `supabase/functions/admin-users`
- **Причина отказа достаётся ОДИН раз, в `adminUsers.ts`.** У `functions.invoke`
  на любой не-2xx в `error` лежит единственный текст «Edge Function returned
  a non-2xx status code», а объяснение — в теле (`error.context`). Без разбора
  отказ прав, занятый адрес и заказы, держащие удаление, выглядят одинаково
- **`invoke` БРОСАЕТ, когда ответа не было** (нет сети, функция не выкачена) —
  то же правило, что у `erpQuery`: бросок превращается в обычный
  `{ data: null, error }`, иначе busy-флаг не снимется
- Список после заведения ПЕРЕЧИТЫВАЕТСЯ (`loadEmployees`), а не достраивается:
  профиль и строку сотрудника пишет триггер, и собрать их на клиенте — значит
  угадывать, что именно он записал
- Удаление НЕ оптимистичное (правило проекта) и гейтится `access.isAdmin` —
  дословным зеркалом серверной `is_admin()`, а не более широким `isPrivileged`
- Имя правится в ДВУХ местах: `profiles.name` (списки, авторство) и
  `erp_employees.full_name` (исполнитель этапа, назначения в цехе). Поправить
  одно — получить человека, который в заказе Иванов, а в очереди цеха «ivan@…»

## Правила ERP (правки заказчика 20.08, сессия 33)

- Подряд: поля этапа заполняются в конструкторе маршрута (`components/RouteFields`),
  превращение шага в поля сервера — единственное выражение `stepPayload`
  (`utils/routeDraft`). Движение операции — действия
  (`screens/subcontracting/StageActions`), не селект фазы; вычисляемые фазы
  и доступные действия — `utils/subcontractFlow`
- Приёмка подряда — задача склада на КАЖДЫЙ подрядный этап
  (`screens/warehouse/SubcontractReceiptCard`): «принято» пишет журнал `accept`,
  который приращает `qty_done` этапа и открывает следующий
- Лист закупки: файл менеджера (`purchase_list`) либо отметка «Закупка
  не требуется» — проверяет `validateOrderForm`. Резолюция файла —
  `utils/attachments.purchaseListFile`; маршрут вырезает `supply` при
  `needsPurchase = false` (`utils/routes.buildItemRoute`)
- ЭКС: доска по этапам — `utils/experimentalBoard` (шаг задачи, гейт кроя,
  состояния шагов, колонка разработки) + `screens/experimental/DevBoard`.
  Внутренние виды — `screens/experimental/DevViews`: свои очереди читают
  ЗАДАЧИ, нанесения — `buildQueueEntries` с отбором по `origin`
- ЭКС: доработка по областям — `utils/experimentalTasks.reworkPlan` (задачи
  и текст последствий считает ОДНА функция), интерфейс —
  `screens/experimental/DevSampleCheck`. История доработок — плоский список
  (`reworkHistory`): круг считает сервер по ТИПУ задачи, и группа по номеру
  собрала бы неполный круг
- ЭКС: финальный пакет — `utils/finalPackage` (перечень недостающего) +
  `screens/experimental/DevFinalPackage`. Файлы принадлежат разработке
  (`experimental_id`), виды `dev_pattern | dev_passport | dev_photo`
- Вид раздела ЭКС — в QUERY (`?view=`), а не подпутём: `canOpenScreen`
  перечисляет ИСКЛЮЧЕНИЯ и открывает незнакомый путь, поэтому
  `/experimental/dtf` был бы доступен всем, включая цех без права
- **E2E больше НЕ ЗАВИСИТ от `.env`** (правка 31.08): фиктивные ключи
  Supabase задаёт сам `playwright.config.ts` обоим серверам
  (`MOCK_SUPABASE_ENV`), и переменные процесса у Vite сильнее файла — прогон
  не может уйти на живой проект даже с боевым `.env` на машине. Прежде
  ключей не было → `lib/supabase.ts` бросал на уровне модуля, до React,
  и падал ВЕСЬ прогон белым экраном с «element(s) not found» у каждого
  локатора: свежая машина, чистый клон или пересозданный контейнер давали
  полностью красный e2e. Сторожит `src/lib/e2eEnv.test.ts` (в `src/`:
  vitest исключает `e2e/**`). Сеть по-прежнему перехватывает
  `e2e/support/mockSupabase`
- Спека, которой нужен этап образца, заводит СВОЙ заказ
  (`installSupabaseMock(page, { orders })`): базовые четыре держат
  visual-эталоны и счётчики очередей

## Правила ERP (правки заказчика 22.08, сессия 37)

- Подряд: `utils/outsourcing.stageLocation` — «где заказ сейчас» по ФАЗЕ,
  а не по маршруту; `subcontractShortfall` отдаёт три величины
  (`lost` · `awaitingAccept` · `defect`), брак берётся из хранимого
  `qty_defect`. Раскрытая карточка — `screens/subcontracting/StageDetails`
  (шапка + одно главное действие + свёрнутые блоки), служебные блоки живут
  в `MoveJournal` как отдельные экспортируемые компоненты
- Приёмка подряда складом — `receiveSubcontract` → RPC
  `erp_subcontract_receive`: принято и брак ОДНОЙ транзакцией
- ЭКС: карточка разработки — СТРАНИЦА `screens/DevPage.jsx`
  (`/experimental/:devId`, через `lazyScreen`), шторки нет; `?dev=<id>`
  переадресует. Основной маршрут — `screens/experimental/DevStageRoute`,
  задачи разделены на этапные и дополнительные (`extraTasks`)
- ЭКС: завершение задачи `patterns` требует технического названия лекал
  (`DevCard.updateTask` → `pattern_tech_name`); новая задача получает
  ответственного разработки по умолчанию
- Форма заказа: `emptyPrint()`/`emptyLabel()` вместо константы — у каждой
  строки СВОЙ ключ, по нему привязывается макет (`print_key`/`label_key`
  → `print_index`/`label_index` в payload). Бирки — `LabelsBlock`,
  заметки заказа — `screens/orders/create/NotesSection`
- Черновики формы — `store/slices/orderDraftsSlice` + таблица
  `erp_order_drafts`; `normalizeDraft` чинит снимок и из localStorage,
  и из базы. Список черновиков — на странице заказов
- `utils/progress.stageCountProgress` — «завершено N из M этапов»
  (сумма по штукам осталась в подсказке)

## Правила сессии 44 (устойчивость раскладки): где что лежит

- `deptsSettled(departments, bootstrapLoaded)` — `store/shared.ts`, рядом
  с `arrivedLate`. Один предикат «состав участков окончателен» на трёх
  потребителей: резерв меню цехов (`ErpLayout`), гейт панели плана
  (`PlanScreen.ready`) и — через них — ряд вкладок очереди
- Резерв меню: `ErpLayout` считает `reserveRows` из `erp_dept_rows`
  (localStorage, **KEEP_ON_LOGOUT**) и передаёт в `Sidebar`; заглушка —
  `.navLinkGhost` (`composes: navLink`, объявлен ПОСЛЕ `.navLinkActive`:
  `composes` работает только сверху вниз и только внутри файла). Заглушки —
  `<div aria-hidden>`, не ссылки: спеки доступности считают ссылки в `nav`
- Высота вкладки цеха — токен `--dept-tab-h` в `index.css` (+ переопределение
  под `pointer: coarse` там же). Его читают `.deptTab` (`erp.module.css`)
  и резерв ряда `.deptTabs::before` (`screens.module.css`). Строки
  `.deptTab { min-height: 48px }` в тач-блоке `erp.module.css` больше нет —
  на её месте комментарий-указатель на токен
- `PlanBoardSkeleton` — `screens/plan/PlanBoardSkeleton.jsx`, импортирует
  агрегатор `../../styles`. НЕ в `ErpSkeletons`: тот импортирует
  `erp.module.css` напрямую и едет в чанке оболочки, а `.planBoard`/`.planDay`
  объявлены в `screens.module.css` — импорт агрегатора вернул бы доску плана
  в критический путь
- `CapacityBar` принимает `loading`; точек вызова ТРИ — `ErpDashboard`,
  `DeptLoad`, `PlanScreen`, и мигрируются они одним коммитом
- Сторож — `e2e/erp-cls.spec.ts`, свой проект `perf` (порт 4173, собранное
  приложение); файл вписан в `testIgnore` проектов `desktop` и `mobile`.
  Гейт данных — `MockExtras.deptsGate` в `e2e/support/mockSupabase.ts`,
  ждут его ОБА писателя состава участков: ветка `rpc/erp_bootstrap`
  и таблица `erp_departments`

## Правила сессии 45 (документ 02.09): где что лежит

- Маршрут образца — `utils/routes.ts`: `BASE_CHAIN.samples = ['supply']`
  и `brandingCodes` пустой при `productionType === 'samples'`. Сторожа —
  `routes.test.ts` («Образец: только закупка», `it.each` по обоим `brandingOn`)
  и `routeWalk.test.ts`
- Подсказка у позиции-образца — `SampleRouteNotice` в `components/RouteFields`;
  оба вызывающих (`RouteEditor`, `RouteBlock` в `create/ItemBlock`) передают
  `productionType`. Запрета добавлять цех руками НЕТ — решение владельца
- Гейт отгрузки — `utils/stageUi`: `openDevelopments` (экспортируется, зеркало
  серверной `erp_order_has_open_dev`) и `hasNoRouteByDesign` вместо
  `isExternallyProduced`. Сигнатура `isOrderReadyToShip` НЕ менялась: данные
  приезжают эмбедом
- Эмбед — `store/orderHelpers`: `developments:erp_experimental!erp_experimental_order_id_fkey`
  в ОБЕИХ выборках + дефолт в `sortOrderFull`; тип `OrderDevelopment`
  в `store/types.ts`. Сторож — `store/orderSelect.test.ts` (проверяет оба
  запроса и то, что колонки берутся поимённо)
- Свежесть эмбеда — два писателя: ветка `erp_experimental` в `realtimeSlice`
  (патчит `orders` ДО `loadExperimental`) и `experimentalSlice.updateExperimental`
  (кладёт правку и в `experimental`, и в `orders`, откатывает оба при ошибке)
- Вопрос о названии лекал — `utils/devBoardMove.devMovePrompt`: условие
  «любой ход ВПЕРЁД при пустом `pattern_tech_name`»; у промпта появился
  `confirmLabel`, его читает `Experimental.moveDevStage`. Подпись источника —
  в `screens/experimental/DevFinalPackage`
- Серверная половина — миграции `20260902084052` (гейт + маркировка образцу
  не заводится), `20260902084729` (`erp_order_has_open_dev`,
  `erp_ensure_order_finish_tasks`, триггер `erp_dev_warehouse_gate_release`),
  `20260902085643` (чистка). Сторож — `utils/warehouseGate.test.ts`, блок
  «складские задачи образца ждут закрытия разработки»
- E2E — СВОЙ файл `e2e/erp-sample-route.spec.ts` (десктопные строка очереди
  и таблица заказов), исключён из проекта `mobile` в `playwright.config.ts`.
  Доска ЭКС и переходы по ней остались в `erp-experimental.spec.ts`, который
  гоняется и на 375px

## Правила сессии 44 (документ 01.09, вторая итерация): где что лежит

- Гейт «с Нанесений нельзя дальше» — отказ `branding` в `devMoveIntent`;
  признак `brandingOpen` считает `Experimental.brandingOpenByDev` по
  `DEV_BRANDING_TASK_TYPES` (зеркало формулы `erp_dev_branding_advance`)
- Какой этап закрыть переносом — `utils/devOwnStage` (`DEV_OWN_STAGE_DEPT`,
  `devOwnStageToClose`, `devStageRemainder`). Нанесений в таблице НЕТ
  осознанно. Вызов — `Experimental.closeOwnStage`, ДО записи колонки,
  через `reportProgress(stageId, остаток, { comment })`
- `reportProgress` принимает третьим аргументом `{ comment }`: автозакрытие
  переносом пишет тот же журнал, и «Частичная готовность» там было бы неправдой
- Переиспользование этапа — миграция `20260901114501`
  (`erp_experimental_task_send` + триггер `erp_experimental_task_sync` без
  `origin`); сторож — `utils/devStageReuse.test.ts`, читает текст миграции
- Блок финального пакета на шаге — `FinalPackageWork` в `DevStageRoute`;
  перечень и прогресс из `utils/finalPackage`, второй формы не заводится
- `BASE_CHAIN.samples` без `vto`; это проверяют `routes.test.ts`
  и `routeWalk.test.ts` — сторожей ДВА, и оба фиксировали прежнее поведение
- Мок Supabase отвечает на `erp_experimental_add_tasks`
  и `erp_experimental_task_send`, храня задачи в `createdTasks`

## Правила сессии 43 (документ 01.09): где что лежит

- Шагов доски ЭКС ШЕСТЬ: `patterns · materials · cutting · branding · sewing ·
  final` (`DEV_STAGE_ORDER`). `materials` — «Ожидает материалы», ключ отличается
  от дорожки `awaiting_materials` намеренно. CHECK базы сверяет с клиентом
  `utils/devBoardStage.test.ts`, миграция — `20260901053949`
- Вход в «Крой» держат ДВА условия: `cuttingGate({ …, supplyOpen })` —
  материалы позиции (`isMaterialPending`) И открытый этап закупки заказа
  (`utils/supply.openSupplyStages` + `findSupplyDept`). Контекст считают
  экраны: `Experimental` строит `supplyOpenByOrder` и `brandingByItem` рядом
  с `materialsByOrder`, `DevCard` и `DevPage` — из своего `order`
- Что применимо к конкретной разработке — `utils/devBoardMove.devStagePath`.
  Её зовут и `devMoveIntent` (запрет перескока, отказ `sequence` с `expected`),
  и `neighbourStage` (кнопки «‹ ›»). Текст отказа собирает
  `devMoveRefusalText`, а не таблица: `sequence` обязан НАЗЫВАТЬ пропущенный шаг
- `devStageStates` принимает `supplyOpen` и `hasBranding`; шаг `materials`
  разбирается своей веткой ВЫШЕ общих (задач у него не бывает, и `workLater`
  объявил бы его перепрыгнутым). `hasBranding` делает «Нанесения» применимыми
  ДО заведения первой задачи — иначе запрет п. 2 не на что опереть
- `devMovePrompt` спрашивает техническое название лекал на ЛЮБОМ ходе вперёд
  с `patterns` (в стоянку и в крой), а не только в «Крой»
- E2E-сторож последовательности ходит настоящим HTML5-броском (`dragCard`
  в `erp-experimental.spec.ts`): кнопками этот запрет не нарушить

## Правила сессии 42 (документ 30.08): где что лежит

- Гейт завершения этапа по закупке — `utils/supply.materialsBlockingCompletion`
  + `stageCompletionBlock` в `utils/stageDone`; зовётся внутри
  `confirmStageDone`, то есть во всех трёх точках закрытия (очередь цеха,
  дорожка канбана, чип доски). Сторож `stageDone.test.ts` читает исходники
  вызывающих: они на JS, и аргументы там тайпчеком не проверяются
- Остатки отгрузки — `utils/shipment` (`shipmentTotals`, `orderQty`).
  `orderQty` заменил `items.reduce(...)` в семи файлах; форма частичной
  отгрузки — `screens/warehouse/PackShipCard`, запись —
  `orderWriteSlice.shipOrder(orderId, lines, { clientKey })` → RPC
  `erp_ship_order`. Количества ведёт триггер, клиент их только читает
- `advanceWarehouseTask` больше НЕ отгружает: у перехода `pack_ship → shipped`
  один писатель — `erp_ship_order`, и он закрывает задачу сам, только при
  полной передаче
- Подпись частичной отгрузки берётся у ЗАКАЗА (`order.shipped_status`), а не
  у задачи: задача остаётся `ready_to_ship`, и `taskStatusLabel(task, order)`
  принимает заказ ВТОРЫМ аргументом во всех четырёх точках экрана склада —
  строка списка, карточка планшета, таблица и шапка шторки
- ЭКС: перенос по канбану — `utils/devBoardMove` (`devMoveIntent` — можно ли,
  `devMovePrompt` — что спросить), единственная точка вызова
  `Experimental.moveDevStage`. Нанесения образца —
  `experimentalBoard.devBrandingFromPrints` поверх экспортированной
  `routes.BRANDING_DEPT`; `DevBrandingPicker` удалён
- ЭКС: состояние `handed` в `DEV_STATE_LABELS`, доска исключает разработки
  с `handed_to_warehouse_at`; техническое название лекал видно на чтение
  в `DevAside`. Новое состояние заводится в ЧЕТЫРЁХ местах разом —
  `DevState`, `filterExperimental.STATE_VALUES`, плитки экрана (`counts`)
  и `STATE_VARIANT`; пропуск ничего не роняет, он молча врёт
- ЭКС: шаг, пройденный человеком вручную (`board_stage` правее шага),
  читается ЗАВЕРШЁННЫМ — `passedByHand` в `devStageStates`. Обязательных
  задач этапов больше нет, и без этого признака «Построение лекал» числилось
  бы незакрытым вечно, а гейт кроя отвечал бы «Ожидает лекала»
- Блок «Задачи этапов» в `DevCard` показывает ТОЛЬКО `extraTasks`: работа
  самих этапов видна в «Основном маршруте разработки», второй список тех же
  строк был бы третьим местом для одного и того же
- Дата запуска заказа участвует в РАСЧЁТЕ: `utils/stagePlan.defaultPlannedEnd`
  принимает `launchDate` и не планирует этап раньше запуска (все три точки
  входа в работу передают её), `validateOrderForm` ловит «срок раньше
  запуска». В производственном плане видна на `plan/PlanTaskCard`
  и в `plan/PlanAddModal`. Каскада плана по нормативам НЕТ — `norm_days`
  пуст у всех участков, механизм не дал бы ни одной даты
- Гейт завершения разработки требует ДВУХ условий (`utils/finalPackage`):
  отшитый и проверенный образец (`sample_approved_at`) и техдокументация.
  Серверное зеркало — `erp_dev_package_guard`, слова те же
- Факт отгрузки виден в «Истории операций» карточки склада: `erp_ship_order`
  пишет `erp_warehouse_ops` вида `shipment` внутри ветки идемпотентности
- Очередь цеха: `COLLAPSIBLE` (что можно свернуть) и `COLLAPSED_BY_DEFAULT`
  (что свёрнуто сначала) — разные списки; состояние экрана хранит СВЁРНУТЫЕ
  группы. Счётчик будущей работы — `orderHelpers.waitingCountFor`, рядом
  с `readyOnlyCountFor` и отдельным числом на вкладке
- Канбан: дорожка `waiting` есть и в `utils/kanbanColumns`, и в `LANES`
  компонента `ErpKanban`. Бросков она не принимает — готовность считается,
  а не выставляется

## Правила сессии 41 (документ 24.08): где что лежит

- Закупка: подписи величин — `purchasing/purchaseLabels.PURCHASE_FIELD_LABELS`
  (одна на величину, читают шесть файлов); автостатус «Заказано» —
  `utils/materialStatus.autoOrderedStatus`, зовут оба писателя в
  `materialsSlice`; подпись состояния — `SUPPLY_STATE_BADGE` рядом
  с `supplyState` в `utils/supply`
- Финальный пакет: `utils/finalPackage.wantsSkuCard` — идёт ли модель
  в каталог; от него зависит, обязательны ли поля карточки SKU. Серверное
  зеркало — `erp_pkg_flag(final_package, 'add_to_sku')`
- ЭКС как участок маршрута: `EXPERIMENTAL_DEPT_CODE` в `utils/routeDraft`,
  строки очереди — `utils/experimentalQueue` (читают вид «Очередь участка»
  и сам экран, решающий, показывать ли переключатель видов)
- Канбан ЭКС: колонка — `erp_experimental.board_stage`, читает
  `devBoardColumn` («ручное → иначе расчёт»); смысл переноса —
  `utils/devBoardMove` (одна логика на бросок и на кнопки «‹ ›»);
  дорожка карточки — `laneOf` в `DevBoard` с фолбэком `waiting`
- Нанесения: `DEV_BRANDING_CHOICES` (что предлагаем) и
  `DEV_BRANDING_TASK_TYPES` (что считает автопереход) в
  `utils/experimentalBoard`; выбор — `experimental/DevBrandingPicker`;
  переход в «Пошив» — серверный `erp_dev_branding_advance`
- Задачи разработки: файл через `uploadDevFile({ …, taskId })`, вид
  вложения `dev_task`; активные и завершённые разделяет сам
  `DevTasksSection`
- Подряд: задача склада `subcontract_send` (`warehouse/SendToContractorCard`),
  единственный писатель — `erp_ensure_subcontract_send`; признак
  «операция при этапе» — `SubcontractView.hasStage`, им же снята кнопка
  запуска у маршрутного подряда
- Карточка разработки: вкладки — `experimental/DevCardTabs` (свой префикс
  `dev-tab-*`), постоянная справка — `experimental/DevAside` (блокер,
  следующее действие, материалы — видны на любой вкладке), реестр вложений —
  `experimental/DevFilesTab`. Раскладка — `.devLayout` в `screens.module.css`.
  `DevPage` дозагружает ПОЛНЫЙ заказ (`loadOne` по `detailIds`): размерный ряд
  живёт в `size_grid`, которого нет в списочной выборке
- Запоздавший ответ загрузчика раздела не затирает то, что наполнил другой
  путь: снимок флага берётся ДО ожидания, правило — `store/shared.arrivedLate`,
  зовут ОБА загрузчика обоих разделов (`experimental`, `subcontracting`)

## Правила сессии 40 (документ 23.08): где что лежит

- Граница двух ожиданий очереди — `utils/supply.isSupplyWait` (снабжение
  против производства). Ею пользуется `buildQueueEntries`, то есть и очередь,
  и канбан, и фильтры. Порядок блоков очереди задаёт `GROUP_TITLES`
  в `DepartmentQueue`, свёрнутые по умолчанию — `COLLAPSED_BY_DEFAULT`;
  раскрытие держится за сеанс экрана и НЕ пишется в localStorage
- `MaterialWait` свёрнут внутри себя (`<details>`), а не у потребителей:
  их два (строка и карточка планшета), и две обёртки разошлись бы молча.
  Причина ожидания — компактный маркер у ОБЕИХ групп
- Закупка — мастер-деталь: `purchasing/SupplyQueue` (только навигация,
  «Открыть») + `purchasing/PurchaseCard` (действия, сводка, таблица
  материалов заказа). Выбранный заказ в адресе `?supply=`. Сводку считает
  `supplyMaterialSummary` (там же `notOrdered` и `problems`), а не экран
- Склад: `PACK_SHIP_STATUS_LABELS` — ровно три статуса. Писателей задачи
  три, сторож на всех — в `warehouseGate.test.ts`
- Легаси подряда — `admin/LegacySubcontractTab`, предикат
  `hasLegacySubcontracts` в `utils/outsourcing` (не рядом с компонентом:
  `react-refresh/only-export-components`)
- ЭКС: `devRouteSteps` строит узлы stepper-а, `DEV_STAGE_COMPLETE_LABELS` —
  подписи действий по этапу. Результат этапа пишется в `result` задач
  тем же действием, что закрывает этап
- `withoutJsComments` — в `utils/migrations.testutil`, рядом с `withoutComments`

## Правила сессии 39 (вторая половина): даты, разделение кода

- `utils/stagePlan` — `defaultPlannedEnd` (подстановка плана, одна на три
  формы) и `unplannedStages` (сколько открытых этапов без срока).
  `deptLoad.ordersWithoutPlan` надстроена над второй
- Общий диалог умеет поле-дату: `prompt.type = 'date'` + `prompt.initialValue`
  (`useConfirmStore` + `ConfirmDialog`). Заведено ради «Взять в работу»
  в закупке — своя форма рядом с кнопкой была бы вторым механизмом
- `store/slices/orderWriteSlice` — запись по заказу, доменный чанк.
  В `ordersSlice` осталось чтение; `orderFilePaths` и `orderBundleKey`
  экспортируются для него
- CSS раздела — ДВА модуля: `erp.module.css` (нужен и оболочке) и
  `screens.module.css` (только экранам). Экраны импортируют агрегатор
  `erp/styles.js` (Proxy-слияние, не спред). Границы разделения сторожит
  `erp/stylesResolve.test.ts`

## Правила офлайна и планшета (сессия 39)

- Service worker — `public/sw.js` (ручной, без зависимости) + клиентская
  половина `lib/serviceWorker.ts`. Регистрация только при
  `import.meta.env.PROD`; отсюда проект `offline` в `playwright.config.ts`
  со своим сервером (`vite preview` из `dist-e2e`) и спека `e2e/offline.spec.ts`
- Компактная раскладка есть у ВСЕХ экранов с таблицами: к прежним пяти
  добавлены `screens/subcontracting/StageRowCard` (+ `StageFields`,
  `subcontractLabels`), `screens/DeptLoadCard` (карточка на ЦЕХ с лентой
  недели — здесь матрица, а не список), `screens/experimental/DevRowCard`,
  `screens/admin/EmployeeCard` + `LooseEmployeeCard` (+ `EmployeeFields`),
  `screens/admin/DeptCard` (+ `DeptFields`). Сторожа — `e2e/erp-tablet.spec.ts`
- `buildDeptLoad` возвращает `totals` («планируют ли вообще»): считается
  по ВСЕМ открытым этапам, без оглядки на видимую неделю. Пока `planned = 0`,
  `/load` прямо говорит, что загрузка не рассчитывается
- Мок Supabase умеет `profiles` и `erp_employees` — без них экран сотрудников
  показывал бы пустое состояние, и проверять было бы нечего

## Правила ERP (UI/UX, сессия 36)

- Компактная раскладка экранов с таблицами — `useCompactLayout()` + карточки:
  `screens/warehouse/WarehouseTaskCard`, `screens/purchasing/PurchaseRowCard`
  рядом с прежними `QueueCard` и `OrderCardMobile`. Вид — семейство
  `.dataCard*` в `erp.module.css`, `.orderCardM*` его `composes`
- Содержимое колонок закупки — `screens/purchasing/PurchaseFields` (одно
  на таблицу и карточку), подписи и группы — `purchasing/purchaseLabels`
  (константы отдельно от компонентов: `react-refresh/only-export-components`)
- Главное действие карточки — `Button block`, своего класса не заводить:
  примитив уже даёт ширину и ≥44px на тач-экранах
- Состояния экрана: `LoadFailed` → `TableSkeleton` → `EmptyState`/`EmptyResult`.
  Скелетон вешать на `!loaded && !loadError`. `employeesError` в сторе заведена
  ровно для этого: у `loadEmployees` сбой не поднимал `employeesLoaded`,
  и экран оставался пустым навсегда
- Сторож токенов — `src/styles/tokens.test.ts`: ни одного `var(--x, фолбэк)`,
  каждый `var()` на объявленный токен. Комментарии он снимает (объяснение
  «почему фолбэка больше нет» содержит те же слова, что и фолбэк)
- `contrast.test.ts` читает и `index.css`, и блоки `.shell` в `erp.module.css`
- Тема — `hooks/useTheme`: `prefers-color-scheme` при отсутствии выбора,
  запись в localStorage только из тумблера
- CSS Order Studio импортируют `orderstudio/OrderStudioApp` и
  `components/auth/AdminPanel`, а не глобальный `styles/index.css`

## Правила ERP (пред-продакшен аудит 22.08, сессия 35)

- **Приёмка материала — ОДНО действие**: `acceptMaterial` → RPC
  `erp_material_accept` (журнал `erp_material_receipts` + статус позиции одной
  транзакцией). Отдельного `addMaterialReceipt` больше НЕТ: он был необязательным
  вторым шагом, и за полтора месяца им не воспользовались ни разу — 9 принятых
  материалов при пустом журнале. Форма в `MaterialReceiptCard` тоже одна:
  два селекта статуса на одной карточке — это «статус рядом с величиной, которую
  ведёт журнал», то есть разрешение соврать. Сторож — `materialReceipts.test.ts`
- **`qty_received` клиент только ЧИТАЕТ.** Её ведёт триггер
  `erp_material_receipts_rollup`; писать колонку с клиента — второй писатель,
  и приход затирал бы приход
- **Запись, у которой «0 строк» означает отказ, идёт через `erpWrite`**
  (`store/shared.ts`), а не шестью копиями `.select()` + проверка длины по
  слайсам. RLS на UPDATE и DELETE запрещает через `USING` — пустой результат
  без ошибки
- **Реалтайм:** `realtimeLive` / `realtimeResyncing` / `resyncRealtime`
  в `realtimeSlice`; полоса — `components/StaleDataBar`, смонтирована
  в `ErpLayout` (устареть может любой экран). Обработчик статуса `.subscribe()`
  и слушатели `visibilitychange`/`online`/`focus` заводятся ВМЕСТЕ с ней:
  переподключение без видимого признака — невидимая починка
- **`canActInDept` принимает роль сотрудника** (`DEPT_BOUND_ROLES`), а не только
  роль профиля. Отказ объясняет `components/DeptBindingNotice` — один текст
  на очередь цеха и страницу задания
- Ошибки Supabase из `erpError` уходят в `lib/errorReport` (source
  `erp-supabase`). Офлайн не отправляется — это состояние сети, а не поломка
- **Ключ идемпотентности приёмки — `utils/attemptKey`**: `keyFor(подпись)`
  отдаёт тот же ключ, пока не менялся ввод, `reset()` после успеха. Хранить
  его в состоянии компонента нельзя — перерисовка от realtime сбросила бы его
  ровно тогда, когда он нужен; поэтому `useRef`
- **Офлайн-очередь — `store/offlineQueue`, и в ней ТОЛЬКО приёмка материала.**
  Кладётся при `navigator.onLine === false`, отдаётся первой в `resyncRealtime`
  (до чтения). Счётчик ожидающих показывает `components/StaleDataBar`. Класть
  сюда переходы складских задач нельзя — см. корневой CLAUDE.md

## Правила ERP (участок «Подряд», документ 21.08)

- Участок `outsource` («Подряд») — в `data/departments` и в `erp_departments`,
  непроизводственный. Конструктор предлагает его наравне с закупкой:
  `ROUTE_EXTRA_DEPT_CODES` в `utils/routeDraft` — производственные плюс участки
  со своим экраном, читающим ЭТАПЫ
- **Селекта «Исполнитель этапа» в `RouteFields` больше НЕТ.** Правило
  «участок → исполнитель» — `executorForDept` (`utils/outsourcing`), применяется
  в `emptyStep` и `patchStep` (`utils/routeDraft`). Там же чистка имени
  подрядчика при возврате на обычный цех — раньше это делал обработчик селекта
- Отсев подряда везде остаётся по `executor === 'contractor'`, НИКОГДА по коду
  участка: этапы до 21.08 стоят на реальном цехе и по коду выпали бы из раздела
  «Подряд» в очередь этого цеха. Сторож — `contractorStageNotInQueue.test.ts`
- Подрядные поля (`ContractorFields`) раскрываются по `step.executor`, а не по
  участку — по той же причине
- «Склад» из примера маршрута документа участком НЕ заводится: вычисляемый
  финальный шаг `utils/warehouseStep`

## Правила ERP (правки заказчика 16.08, сессия 32)

- Карточка заказа — только страница `/orders/:orderId`. Боковая панель
  (`OrderDrawer`, `OrderDrawerHost`, стор `useOrderDrawer`) удалена. Открытие —
  `components/OrderLink`, для мест без ссылки — `utils/orderLink.orderLinkTarget`
- Упаковка позиции: `utils/packaging.itemPackaging` — единственное место, где
  «своё → общее по заказу» разрешается. `inherit` ≠ `none`
- Лист закупки: `screens/orders/create/PurchaseListSection` → секция `materials`
  payload; печатная форма — `screens/purchasing/PurchaseListPrint` (`window.print()`).
  Строки листа проверяет `validateOrderForm` (четвёртый, необязательный
  аргумент): начатая строка обязана нести название и количество, совсем пустая
  ошибкой не считается. Без этого заказ уезжал со строкой без `qty_expected`,
  а закупка по такой строке не закрывается автоматически никогда
- Подряд: `utils/outsourcing.ts` (модуль-лист) — что такое подрядный этап,
  где заказ сейчас, следующий этап маршрута, подпись этапа. Отсев подряда
  из очереди/счётчиков/загрузки есть в трёх файлах, сторожит
  `contractorStageNotInQueue.test.ts`
- Конструктор маршрута: `utils/routeDraft.ts` — группы вместо линейного списка,
  инвариант тождества с `buildItemRoute`, замок на этапе с фактом.
  Сохранение — RPC `erp_route_apply` (одна транзакция, `depends_on` индексами)
- Разметка конструктора ОДНА на два места — `components/RouteFields`:
  `components/RouteEditor` (карточка заказа, сохранение через RPC) и
  `RouteBlock` в `screens/orders/create/ItemBlock` (форма создания, маршрут
  уезжает в payload). Правило «правка или расчёт» — `formItemRoute`, и оно же
  собирает аргументы `buildItemRoute`: читателей трое
- Конструктор в карточке монтируется только открытым — черновик посеян
  из `item.stages` и после сохранения устаревает
- Раздел «Подряд» (`screens/Subcontracting`) строит строки ИЗ ЭТАПОВ; журнал
  перемещений — `screens/subcontracting/MoveJournal`, и он же механизм закрытия
  подрядного этапа (приёмка приращает `qty_done` триггером). Бейдж меню —
  `ordersWithOutsourcing(orders)` из ядра, а не из лениво загружаемого реестра
- Новые справочники: `fit` (крой изделия), `route_operation` (операции маршрута).
  Вид справочника по-прежнему живёт в ЧЕТЫРЁХ местах

## Правила ERP (документ 20.08, сессия 33)

- Подряд: `utils/subcontractFlow.ts` — вычисляемые фазы («Запланировано»,
  «Готово к передаче — N шт» считаются из `stageInputQty`, хранимая фаза
  двигается с ПЕРЕДАЧИ) + `SUBCONTRACT_ACTIONS`. Селекта фазы нет: им можно
  было объявить операцию завершённой, не записав ни одного перемещения
- Действия подряда идут ОДНИМ RPC `erp_subcontract_apply`: журнал, фаза
  и легаси-зеркало `status` одной транзакцией. Приёмку делает СКЛАД
  (`screens/warehouse/SubcontractReceiptCard`) — она пишет журнал `accept`
  и только потом закрывает задачу; неудачная запись задачу не закрывает
- Файлы подрядного этапа: `uploadStageFile`/`deleteStageFile`
  (`subcontractingSlice`) для существующего этапа, `stage_key` → `stage_index`
  для формы создания. Разметка одна — `RouteFields` со слотом `renderStageFiles`
- ЭКС: `utils/experimentalBoard.ts` (шаги доски, гейт кроя, состояния дорожек),
  `utils/finalPackage.ts` (перечень недостающего для «Готово к серии»),
  `reworkPlan` в `utils/experimentalTasks` (доработка ПО ОБЛАСТЯМ, и та же
  функция формулирует текст последствий). Доска — `screens/experimental/DevBoard`,
  внутренние виды — `DevViews` (отбор `buildQueueEntries` по `origin`)
- Лист закупки: файл менеджера (`purchase_list`) либо отметка
  `purchase_required = false`; проверка — в `validateOrderForm`. Отметка
  вырезает `supply` из маршрута (`buildItemRoute({ needsPurchase })`), и заказ
  не попадает к закупщику ПО ПОСТРОЕНИЮ
- Участок DTG заведён полноценным цехом брендирования (`data/departments`,
  `BrandingMethod`, `BRANDING_DEPT`, матрица прав, справочники) — документ
  называет его и в маршруте, и среди видов ЭКС

## Правила ERP (правки заказчика 12.08)

- Закупка как этап маршрута — `erp/utils/supply.ts` (модуль-лист): им пользуются
  бейдж оболочки, `screens/purchasing/SupplyQueue.jsx` и `maybeCloseSupply`.
  Строка списка — ЗАКАЗ, а не этап
- Экран непроизводственного цеха обязан строить строки ИЗ ЭТАПОВ —
  сторожит `utils/routeReachable.test.ts`. Экран, показывающий соседние данные,
  выглядит рабочим и прячет заказ целиком
- Модель ЭКС: `utils/experimentalTasks.ts` (готовность, блокер, следующее
  действие, состояние) + `utils/filterExperimental.ts` (фильтры экрана).
  `isStageReady` НЕ переиспользуется: её сигнатура тянет материалы, цех, гейты
  закупки и ТЗ, которых у задач разработки нет
- Карточка разработки — `screens/experimental/DevCard.jsx` + `DevTasksSection`
  (доска задач) + `DevSendToDept` (передача в цех). Пять веток по `phase`
  удалены: это и была линейная модель, от которой заказчик отказался
- Задача со `stage_id` в интерфейсе только на ЧТЕНИЕ: её статус ведёт триггер.
  `updateDevTask` снимает `status`/`blocked_reason`/`done_on` перед записью
- Фильтр очереди по происхождению — `origin` в `filterStages` (перечисление,
  не булев флаг: ссылки на отфильтрованную очередь живут в переписке)
- `StageIndicator` — ДВА вида: `dots` и `funnel`. Третий, `pipeline`, удалён
  вместе с фазовой моделью: после удаления `ExperimentalCard.jsx` он остался
  без единого вызова, и держал его только собственный тест. Удаляя экран,
  проверьте, не осиротел ли примитив, который звал только он
- Объект БД, дропнутый миграцией, ищется В ТЕЛАХ ФУНКЦИЙ, а не только по коду —
  сторожит `utils/droppedObjects.test.ts`. `grep` по исходникам не видит
  `erp_bootstrap()`: её текст лежит в миграции, а не в `src/`
- **Перекрывающиеся `page.route` разрешаются ПОРЯДКОМ РЕГИСТРАЦИИ, и выигрывает
  ПОСЛЕДНИЙ.** В `e2e/support/mockSupabase.ts` частный `**/rest/v1/rpc/**` стоял
  перед общим `**/rest/v1/**` — и не срабатывал ни разу: `erp_bootstrap` отвечал
  `[]`, как таблица с именем `rpc/erp_bootstrap`, а приложение молча уходило
  на запасной путь `loadAll`. Весь e2e шёл не по тому пути, по которому ходит
  прод, — ровно то, что комментарий рядом обещал не допустить. Чинится не
  перестановкой (порядок забудут при следующей правке), а ОТСУТСТВИЕМ
  перекрытия: один обработчик, ветка по пути запроса
- Спека, которой нужны свои данные, передаёт их вторым аргументом
  `installSupabaseMock(page, { orders, experimental, dictionaries })`. Дописывать
  в общие фикстуры нельзя: четыре базовых заказа держат visual-эталоны
  и счётчики `erp-queue`/`erp-plan`

## Правила ERP (правки заказчика 10.08, волна 1)

- Роли: коды в БД неизменны, меняются подписи (`EMPLOYEE_ROLE_LABELS` в `erp/types.ts`).
  Новые роли — `technologist` + участки `dtf`/`silkscreen`/`embroidery`; у участков
  права как у `worker`, различает их привязка `erp_employees.department_id`
- ОТК: `buildRoute` больше не добавляет `qc`, поля `needs_qc` нет, цех деактивирован
- Аварийное снятие блокировок — `erp_bypasses` + `utils/bypass.ts`. Применяется
  в местах сборки гейта (`queueEntries`, `ordersSlice.shipOrder`), а не внутри
  `isStageReady`/`waitingReason`: они принимают материалы и «нет ТЗ» параметрами
- Пометка «Проверка снята вручную» ставится только там, где снятие повлияло —
  `buildQueueEntries` пересчитывает готовность по настоящим данным и сравнивает
- Пропуск этапа (`skipped`) — под `order.manage`, с обязательной причиной;
  в `erp_stage_guard` у него своя ветка (раньше переход не проверялся вовсе)

## Правила ERP (календарные даты, сессия 29)

- **Календарная дата — только `src/utils/date.ts`** (`isoDate`, `localToday`,
  `parseIsoDate`, `addDays`, `weekdayIndex`, `mondayOfWeek`). Модуль-лист без
  зависимостей: им пользуются оба раздела. `toISOString()` даёт дату в UTC —
  годится для МОМЕНТА (`created_at`, `fact_at`, `shipped_at`), не для дня
- **`toISOString().slice(0, 10)` — запрещённый оборот**, его ищет по всем
  исходникам `src/utils/date.test.ts` (комментарии снимаются). Он увёл доску
  плана на двое суток: `mondayOf` сдвигал на день и `weekDates` от него ещё
  на день, 10.08.2026 (понедельник) выходил «средой», неделя начиналась
  с субботы 08.08
- **Тесты дат идут в поясе заказчика**: `process.env.TZ = 'Europe/Moscow'`
  в unit, `test.use({ timezoneId: 'Europe/Moscow' })` в e2e. В UTC-контейнере
  сдвиг равен нулю и проходит ЛЮБАЯ реализация — поэтому дефект и доехал
  до прода при зелёном CI
- **День недели — `erp/utils/format.weekdayName`/`weekdayShort`, из ДАТЫ.**
  Подпись по индексу колонки (`DAY_NAMES[i]`) с датой не спорит: когда расчёт
  недели уехал, подписи уехали вместе с ним вместо того, чтобы дать расхождение
- **На сервере календарную дату даёт `erp_local_date()`**, а не `current_date`:
  база в UTC, и с 00:00 до 03:00 по Москве `current_date` — это вчера. Пояс
  назван в одной функции; `set timezone` на всю базу не ставим — он поменял бы
  печать всех `timestamptz` в ответах API. Сторожит `serverDates.test.ts`,
  проверяя ПОСЛЕДНИЕ определения всех функций миграций

## Правила ERP (вес оболочки, сессия 29)

- **Все экраны ERP ленивые, включая первые три.** Обзор, заказы и очередь цеха
  были статикой ради «без мигания на первом экране» и стоили оболочке 37 кБ
  gzip: их код ехал каждому и всегда, в том числе рабочему, который открывает
  только свой цех. Скелетоны у экранов есть, а `usePrefetchScreens` в `ErpApp`
  тянет соседние в ПРОСТОЕ (`requestIdleCallback`) — к нажатию чанк уже в кэше
- **Хост боковой карточки смонтирован вне `<Routes>`, поэтому её содержимое
  обязано быть ленивым.** Статический импорт тянул в критический путь всё
  дерево карточки (комментарии, история, ТЗ, файлы, инлайн-правки) — 124 кБ,
  притом что хост возвращал `null`, пока карточка закрыта: не рисовалось,
  но ехало. Заглушка `Suspense` не использует примитив `Drawer` — иначе он
  вернулся бы в оболочку, ради чего всё и делалось
- Потолок оболочки — 222 кБ gzip (был 250, упирались в 249). Бюджет, к которому
  подошли вплотную, ломает сборку на каждой правке вместо того, чтобы ловить
  регрессию. Возврат одного экрана в критический путь — это ~30 кБ, страж
  такое видит
- **Стор разделён на ЯДРО и доменную часть.** В ядре (`useErpStore.ts`) —
  ровно то, чем пользуется оболочка: `bootstrap`, `orders`, `permissions`,
  `bypass`, `realtime`. Остальные 11 слайсов приезжают отдельным чанком вместе
  с первым экраном (`store/domainSlices.ts`) — 208,8 → 198,2 кБ gzip. Импорты
  ядра ЯВНЫЕ: баррель `./slices` тянет все шестнадцать, и лишние отваливаются
  только благодаря tree-shaking, то есть по умолчанию, а не по решению
- **Экран ERP заводится `lazyScreen`, а не голым `lazy`** (`erp/lazyScreen.js`):
  обёртка грузит чанк экрана и доменный чанк ПАРАЛЛЕЛЬНО и подключает слайсы
  до первой отрисовки. Голый `lazy` даёт стор без половины действий — ошибка
  не при сборке и не при переходе, а при нажатии на кнопку, то есть у цеха
- **Правило сформулировано ПО ЭКРАНАМ, а не по файлу-оболочке.** Первая версия
  сторожа обходила статический граф `ErpApp` и пропустила настоящую поломку:
  единая админка смонтирована ЕЩЁ И в `OrderStudioApp`, голым `lazy`, мимо
  всякого `ErpApp` — `/admin` в том разделе падал с «loadEmployees is not
  a function». Сторож, привязанный к одной точке входа, сторожит одну точку входа
- **`attachDomainSlices` переносит ТОЛЬКО функции.** Данные доменных слайсов
  стоят в ядре (`store/domainState.ts`), потому что `loadBootstrap` наполняет
  `subcontracting`/`experimental`/`dictionaries` ещё до открытия любого экрана,
  а `myDeptId`/`myRole` читает `useErpAccess` в самой оболочке. Приедь данные
  вместе со слайсом — позднее подключение затирало бы загруженное, и кто
  финиширует последним, зависело бы от кэша. Совпадение значений с тем, что
  объявляют слайсы, сторожит `domainSlices.test.ts`
- У этапов, материалов, склада, закупки и ТЗ собственных данных НЕТ вовсе —
  они правят `orders` из ядра. В `DOMAIN_INITIAL_STATE` их нет, и пустая строка
  там была бы ложью о наличии состояния
- Тест, который рендерит экран напрямую (минуя `lazyScreen`), обязан сам
  позвать `attachDomainSlices()`. В общий `setupTests` это не выносится:
  моки Supabase объявлены в файлах тестов, и слайсы, поднятые раньше, захватят
  другой инстанс клиента — действия будут работать, но мимо шпионов

## Правила ERP (решения заказчика по матрице, сессия 29)

- Прав стало 16: добавлено `warehouse.manage` (движение складских задач).
  Гейт экрана склада — `useErpAccess().can('warehouse.manage')`, без права
  Drawer оборачивается в `ReadOnlyFieldset`. Тот же примитив у карточки
  разработки образцов — копий быть не должно
- `manager` получил `stage.move_department`; `production_head` — `catalog.edit`
  (подтверждённая правка заказчика). Все четыре решения закреплены поимённо
  в `permissionsCoverage.test.ts`, блок «решения заказчика по матрице»

## Правила ERP (хвосты документа 10.08, сессия 29)

- Подрядную операцию двигает `phase`, НЕ `status`. Маппинг — `utils/subcontractPhase`
  (`subcontractPhase` для чтения, `subcontractPhasePatch` для записи), один на оба
  типа операции. `status` — зеркало для совместимости, помечено `@deprecated`,
  читать не нужно нигде. Переходы в `subcontractingSlice` сравнивают ФАЗЫ:
  зеркало есть в патче всегда, и сравнение по `status` срабатывало бы вхолостую
- Гейты экранов: подряд — `order.manage`, разработка образцов —
  `experimental.manage`. Оба ставились ОДНИМ коммитом с серверной политикой.
  Без права экран остаётся на чтение; карточка разработки заворачивается
  в `fieldset[disabled]` (`.readonlyFieldset`) — он гасит всё вложенное разом
- Заглавные начертания — групповое правило в начале `erp.module.css`
  (`.labelCaps` + заголовки). Свой класс объявляет ТОЛЬКО отличие; полный набор
  объявлений в классе ловит `erp/styles.test.ts`
- Бюджет оболочки ERP исчерпан (248,8 из 250 кБ). Новую утилиту в `orderHelpers.ts`
  импортировать нельзя без замера — она попадёт в оболочку, а не в ленивый чанк

## Правила ERP (правки заказчика 10.08, волна 0)

- Dev-автологин — только по `VITE_DEV_AUTOLOGIN=1` и только вместо ОТСУТСТВУЮЩЕЙ
  сессии (`store/useAuthStore.ts`). Раньше он шёл от `import.meta.env.DEV`: любой
  `npm run dev` против боевой базы показывал полный доступ админа, а запросы уходили
  ролью `anon` — чтение пусто, запись «new row violates row-level security policy»
- Сессия отслеживается подпиской `watchAuthState()` из `main.jsx`, а не разовой
  проверкой в `init()`. Потеря сессии → `sessionLost()`: сброс сторов и «Сессия
  истекла, войдите заново»
- Каждый сетевой вызов слайса оборачивается `erpQuery` (`store/shared.ts`): бросок
  supabase-js становится обычным `{ data: null, error }`, и существующая ветка
  `if (error) …` снимает busy-флаг, откатывает и называет причину через `erpError`
- `loadAll` намеренно БЕЗ guard'а от повторного вызова — см. комментарий в
  `slices/ordersSlice.ts`: экономия ломает очередь цеха
- Повтор тоста поднимает счётчик, а не добавляет полосу (`useToastStore`)

## Правила ERP (код-ревью 05.08)

- Счётчики этапа (`qty_done`, `qty_rework`) пишутся ТОЛЬКО приращением, на сервере
  (`erp_stage_report_progress`, `erp_stage_apply_defect`). Абсолют с клиента —
  потерянное обновление: два планшета в одном цехе читают своё значение и
  затирают запись друг друга. Для цеха с несколькими исполнителями это обычный
  день, а не редкая гонка
- Действие из нескольких записей — ОДНА транзакция (RPC), а не `Promise.all`.
  Пачка независимых UPDATE с общим откатом интерфейса откатывает поверх уже
  закоммиченных: возврат брака оставлял позицию в состоянии, которого никто
  не выбирал. У переноса этапа это же правило раньше решалось компенсирующей
  записью — с транзакцией она не нужна
- Логику маршрута (какие этапы затронуты) считает КЛИЕНТ и остаётся её
  единственным источником. Сервер отвечает за атомарность и арифметику: вторая
  реализация обхода `depends_on` на SQL — та самая рассинхронизация, из-за
  которой текст подтверждения когда-то разошёлся с фактом
- Перенос между цехами переводит на целевой этап ВСЕХ, кто зависел от исходного.
  Без этого финальный ОТК открывался раньше перенесённой работы: исходный этап
  закрыт, ОТК видит зависимость выполненной, а новый цех ещё не начинал
- Страж этапов проверяет и ПРИНАДЛЕЖНОСТЬ ЦЕХУ (`erp_can_act_in_dept`, зеркало
  `canActInDept`) — интерфейс гейтит дважды, право И цех, и матрица второго
  не отменяет. Право `stage.move_department` проверку снимает: целевая строка
  по определению в чужом цехе, а перенос интерфейс гейтит по цеху-ИСТОЧНИКУ
- Плановые даты этапа — под `order.manage`, НО взятие задания в работу пишет
  `planned_end` под `stage.take`: форма «Взять в работу» просит план завершения
  и пишет его тем же действием. Без исключения каждый рабочий получал 42501
  на каждом взятии, а вместе с датой терялся расчёт просрочки
- Сторожевой тест, читающий миграцию ПО ИМЕНИ, сторожит файл, а не базу: функции
  пересоздаются целиком, и прежняя миграция остаётся со СТАРЫМИ правилами. Брать
  последнюю миграцию, определяющую функцию (`latestDefining` в
  `serverPermissions.test.ts`)
- Каждый `supabase.rpc(...)` сверяется с сигнатурой в миграциях
  (`rpcContract.test.ts`): опечатка в имени функции или параметра не ломает
  ни сборку, ни один тест — она отвечает PGRST202 в проде, на том действии,
  которое никто не прокликал
- Постраничная выборка обязана иметь УНИКАЛЬНЫЙ доводчик сортировки, а смещение
  вести своим счётчиком, а не считать из стора: `due_date` не уникален, а в стор
  архивные заказы попадают мимо пагинации (диплинк, realtime) и сдвигают
  смещение. Дубль гасит дедуп по id — пропуск не видно ничем
- `started_at` ставится ОДИН раз, при первом входе в работу. Снятие блокировки,
  переоткрытие после брака и открытие этапа при переносе её не сдвигают: от неё
  считается бейдж «ТЗ обновлено», и сдвиг прятал предупреждение, ради которого
  бейдж и сделан
- Файл, загруженный в бакет и не привязанный к строке БД, убирается за собой
  (`removeOrphanUpload`, политика `erp_att_delete_own` — автор удаляет СВОЙ
  объект). Прежде в трёх местах стоял комментарий «удалять политика не даёт»,
  и сироты копились навсегда
- Ошибки Supabase во ВСЕХ слайсах идут через `erpError` — он называет причину
  (офлайн, отказ прав, конфликт). Плоский `toast.error('Не удалось …')` делает
  42501 от стража неотличимым от обрыва сети

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
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
- Кнопки: в ERP — примитив `erp/components/Button` (variant/size/icon/loading);
  глобальные .btn + variants остаются языком Order Studio
- Иконки ERP: `erp/components/Icon` + набор в icons.js. Эмодзи вместо иконок не использовать;
  иконка участка — `deptIcon(code)`, значение это ИМЯ иконки, не глиф
- Высоты примитивов заданы явно + свой @media (pointer: coarse) в их CSS-модуле
  (общий список классов ≥44px — в erp.module.css)
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
